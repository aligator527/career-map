"""Community insights: claims from Reddit that several independent users corroborate.

Input:  labels/insights_*.json (compiled by research agents; see each file's _access / _method)
        labels/insights_config.json  {"publish": false}  — publication switch (off by default)
Output: web/public/data/insights.json

Rules enforced here (an insight that breaks any of them stops the build):
  * at least 3 distinct users across at least 2 distinct threads
  * every source dated 2021-01 or later, and linking to a reddit.com thread (never a mirror)
  * paraphrases only (notes ≤ 25 words); no usernames are published — only counts and links
The comparison with official statistics is computed in the browser with the same engine as the
rest of the site (pay cells, tax models), so it always uses the currently published data.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from .common import WEB_DATA_DIR, write_json

LABELS = Path(__file__).parent / "labels"
MIN_USERS = 3
MIN_THREADS = 2
MIN_DATE = "2021-01"
THREAD = re.compile(r"^https://(www\.)?reddit\.com/r/[A-Za-z0-9_]+/comments/[a-z0-9]+/")
COUNTRY = re.compile(r"^[A-Z]{2}$")  # ISO 3166 alpha-2; claims about countries not on the site are simply not shown


def user_id(source: dict) -> str:
    if "userHash" in source:
        return source["userHash"]
    name = source["user"].removeprefix("u/").lower()
    return hashlib.sha256(f"reddit:{name}".encode()).hexdigest()[:12]


def thread_of(url: str) -> str:
    m = THREAD.match(url)
    assert m, f"not a reddit.com thread URL: {url}"
    return url[: m.end()].replace("://reddit.com", "://www.reddit.com")


def check(ins: dict, origin: str) -> dict:
    where = f"{origin}/{ins['id']}"
    sources = ins["sources"]
    users = {user_id(s) for s in sources}
    threads = {thread_of(s["url"]) for s in sources}
    assert len(users) >= MIN_USERS, f"{where}: {len(users)} distinct users"
    assert len(threads) >= MIN_THREADS, f"{where}: {len(threads)} threads"
    dates = sorted(s["date"] for s in sources)
    assert dates[0] >= MIN_DATE, f"{where}: source dated {dates[0]}"
    assert ins["countries"] and all(COUNTRY.match(c) for c in ins["countries"]), f"{where}: countries {ins['countries']}"
    assert ins["claim"].get("ja") and ins["claim"].get("en"), f"{where}: claim text"
    for s in sources:
        assert len(s.get("note", "").split()) <= 25, f"{where}: note too long (paraphrase only)"
    q = ins.get("quantity")
    if q:
        assert q.get("high") is None or q["low"] <= q["high"], f"{where}: quantity range"
    return {
        "id": ins["id"],
        "topic": ins["topic"],
        "countries": ins["countries"],
        "occupation": ins.get("occupation"),
        "claim": ins["claim"],
        "quantity": q,
        "caveats": ins.get("caveats"),
        "users": len(users),
        "threads": sorted(threads),
        "period": [dates[0], dates[-1]],
        "counterpoints": len(ins.get("counterpoints") or []),
    }


def build() -> None:
    config = json.loads((LABELS / "insights_config.json").read_text())
    checked = []
    for path in sorted(LABELS.glob("insights_*.json")):
        if path.name == "insights_config.json":
            continue
        data = json.loads(path.read_text())
        checked += [check(i, path.stem) for i in data.get("insights", [])]
    ids = [i["id"] for i in checked]
    assert len(ids) == len(set(ids)), "duplicate insight ids"
    out = {
        "published": bool(config.get("publish")),
        "access": config.get("access"),
        "insights": checked if config.get("publish") else [],
        "pending": 0 if config.get("publish") else len(checked),
    }
    write_json(WEB_DATA_DIR / "insights.json", out)
    print(f"  insights: {len(checked)} valid, {'published' if out['published'] else 'NOT published (publish=false)'}")


if __name__ == "__main__":
    build()
