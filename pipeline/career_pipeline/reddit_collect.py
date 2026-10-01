"""Collect Reddit threads through the official Data API (OAuth, app-only) for the community-insights pilot.

Credentials (never committed): environment variables, or pipeline/.env.reddit with lines KEY=value
  REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET   from the approved app (https://www.reddit.com/prefs/apps)
  REDDIT_USERNAME                          the account that owns the app (only used in the User-Agent)

Input:  labels/reddit_queries.json  {"since": "2021-01-01", "queries": [{"id", "subreddits": [...], "q", "topic", "countries"}]}
Output: data/raw/reddit/threads/<id>.json  (local cache, gitignored)
        data/raw/reddit/digest/<query id>.md  (compact text for reading the threads)

Privacy: usernames are replaced by userHash = sha256("reddit:" + lowercase name)[:12] as soon as a response
arrives, so no username is ever written to disk. Deleted or removed comments are dropped. Re-running with
--refresh fetches every cached thread again, which also drops comments their authors have since deleted.

Usage: uv run python -m career_pipeline.reddit_collect [--refresh] [--max-threads N]
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from .common import RAW_DIR

LABELS = Path(__file__).parent / "labels"
CACHE = RAW_DIR / "reddit"
ENV_FILE = Path(__file__).resolve().parents[1] / ".env.reddit"
TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
API = "https://oauth.reddit.com"
MIN_INTERVAL = 0.7  # seconds between requests; the free tier allows 100 per minute
GONE = {"[deleted]", "[removed]"}


def user_hash(name: str) -> str:
    return hashlib.sha256(f"reddit:{name.removeprefix('u/').lower()}".encode()).hexdigest()[:12]


def credentials() -> dict[str, str]:
    env = dict(os.environ)
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                env.setdefault(key.strip(), value.strip())
    missing = [k for k in ("REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USERNAME") if not env.get(k)]
    if missing:
        raise SystemExit(f"missing {', '.join(missing)}: set them in the environment or in {ENV_FILE}")
    return env


class Client:
    def __init__(self) -> None:
        env = credentials()
        self.session = requests.Session()
        self.session.headers["User-Agent"] = f"script:career-map-insights:0.1 (by /u/{env['REDDIT_USERNAME']})"
        r = self.session.post(TOKEN_URL, auth=(env["REDDIT_CLIENT_ID"], env["REDDIT_CLIENT_SECRET"]),
                              data={"grant_type": "client_credentials"}, timeout=30)
        r.raise_for_status()
        token = r.json()
        if "access_token" not in token:
            raise SystemExit(f"no access token: {token}")
        self.session.headers["Authorization"] = f"bearer {token['access_token']}"
        self.last = 0.0

    def get(self, path: str, **params) -> object:
        for attempt in range(5):
            wait = MIN_INTERVAL - (time.monotonic() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            r = self.session.get(API + path, params={**params, "raw_json": 1}, timeout=60)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(float(r.headers.get("x-ratelimit-reset", 10)) if r.status_code == 429 else 5 * (attempt + 1))
                continue
            r.raise_for_status()
            if float(r.headers.get("x-ratelimit-remaining", 100)) < 2:
                time.sleep(float(r.headers.get("x-ratelimit-reset", 60)))
            return r.json()
        raise RuntimeError(f"giving up on {path}")


def search(client: Client, subreddit: str, q: str, since: float) -> list[str]:
    ids, after = [], None
    while True:
        page = client.get(f"/r/{subreddit}/search", q=q, restrict_sr=1, sort="relevance", t="all", limit=100,
                          **({"after": after} if after else {}))
        for child in page["data"]["children"]:
            post = child["data"]
            if post["created_utc"] >= since and post.get("num_comments", 0) > 0:
                ids.append(post["id"])
        after = page["data"].get("after")
        if not after:
            return ids


def flatten(children: list, out: list) -> None:
    for child in children:
        if child.get("kind") != "t1":
            continue
        c = child["data"]
        if c.get("author") not in GONE and c.get("body") not in GONE and c.get("author"):
            out.append({
                "id": c["id"],
                "userHash": user_hash(c["author"]),
                "date": datetime.fromtimestamp(c["created_utc"], timezone.utc).strftime("%Y-%m-%d"),
                "score": c.get("score", 0),
                "body": c["body"],
            })
        replies = c.get("replies")
        if isinstance(replies, dict):
            flatten(replies["data"]["children"], out)


def fetch_thread(client: Client, thread_id: str) -> dict | None:
    listing = client.get(f"/comments/{thread_id}", limit=500, depth=10, sort="top")
    post = listing[0]["data"]["children"][0]["data"]
    if post.get("removed_by_category"):
        return None
    comments: list = []
    flatten(listing[1]["data"]["children"], comments)
    return {
        "id": post["id"],
        "url": f"https://www.reddit.com/r/{post['subreddit']}/comments/{post['id']}/",
        "subreddit": post["subreddit"],
        "title": post["title"],
        "date": datetime.fromtimestamp(post["created_utc"], timezone.utc).strftime("%Y-%m-%d"),
        "author": None if post.get("author") in GONE else user_hash(post["author"]),
        "body": "" if post.get("selftext") in GONE else post.get("selftext", ""),
        "comments": comments,
        "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    }


def load_threads() -> dict[str, dict]:
    """The local corpus, keyed by thread URL (used by insights.py to verify every cited source)."""
    folder = CACHE / "threads"
    if not folder.exists():
        return {}
    threads = (json.loads(p.read_text()) for p in folder.glob("*.json"))
    return {t["url"]: t for t in threads}


def write_digest(query_id: str, threads: list[dict]) -> None:
    lines = [f"# {query_id}", ""]
    for t in sorted(threads, key=lambda t: t["date"], reverse=True):
        lines += [f"## {t['title']}", f"{t['url']} · r/{t['subreddit']} · {t['date']} · OP {t['author']}", ""]
        if t["body"]:
            lines += [t["body"][:1500], ""]
        for c in t["comments"]:
            lines.append(f"- [{c['userHash']} {c['date']} ▲{c['score']}] " + " ".join(c["body"].split())[:800])
        lines.append("")
    path = CACHE / "digest" / f"{query_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines))


def build(refresh: bool = False, max_threads: int = 40) -> None:
    config = json.loads((LABELS / "reddit_queries.json").read_text())
    since = datetime.fromisoformat(config["since"]).replace(tzinfo=timezone.utc).timestamp()
    client = Client()
    folder = CACHE / "threads"
    folder.mkdir(parents=True, exist_ok=True)
    for query in config["queries"]:
        ids: list[str] = []
        for subreddit in query["subreddits"]:
            ids += search(client, subreddit, query["q"], since)[:max_threads]
        threads = []
        for thread_id in dict.fromkeys(ids):
            path = folder / f"{thread_id}.json"
            if path.exists() and not refresh:
                threads.append(json.loads(path.read_text()))
                continue
            thread = fetch_thread(client, thread_id)
            if thread is None:
                path.unlink(missing_ok=True)
                continue
            path.write_text(json.dumps(thread, ensure_ascii=False))
            threads.append(thread)
        write_digest(query["id"], threads)
        print(f"  {query['id']}: {len(threads)} threads, {sum(len(t['comments']) for t in threads)} comments")


if __name__ == "__main__":
    max_threads = int(sys.argv[sys.argv.index("--max-threads") + 1]) if "--max-threads" in sys.argv else 40
    build(refresh="--refresh" in sys.argv, max_threads=max_threads)
