"""Corroboration rules and API-corpus verification of community insights (no network)."""

from __future__ import annotations

import pytest

from career_pipeline.insights import check
from career_pipeline.reddit_collect import flatten, user_hash

T1 = "https://www.reddit.com/r/ukvisa/comments/abc123/"
T2 = "https://www.reddit.com/r/london/comments/def456/"


def source(url: str, user: str, date: str = "2025-06") -> dict:
    return {"url": url, "date": date, "note": "Paraphrased note.", "userHash": user_hash(user)}


def insight(sources: list[dict]) -> dict:
    return {"id": "x", "topic": "visa", "countries": ["UK"], "claim": {"ja": "主張", "en": "Claim"}, "sources": sources}


def thread(url: str, users: list[str], date: str = "2025-06-10") -> dict:
    return {"url": url, "date": date, "author": None,
            "comments": [{"userHash": user_hash(u), "date": date, "body": "…", "score": 1} for u in users]}


GOOD = insight([source(T1, "alice"), source(T1, "bob"), source(T2, "carol")])
CORPUS = {T1: thread(T1, ["alice", "bob"]), T2: thread(T2, ["carol"])}


def test_corroborated_and_verified():
    out = check(GOOD, "t", CORPUS)
    assert out["users"] == 3 and out["threads"] == [T2, T1]


def test_needs_three_users_and_two_threads():
    with pytest.raises(AssertionError, match="distinct users"):
        check(insight([source(T1, "alice"), source(T2, "alice"), source(T2, "bob")]), "t", None)
    with pytest.raises(AssertionError, match="threads"):
        check(insight([source(T1, "alice"), source(T1, "bob"), source(T1, "carol")]), "t", None)


def test_rejects_sources_missing_from_the_corpus():
    with pytest.raises(AssertionError, match="not in the API corpus"):
        check(GOOD, "t", {T1: CORPUS[T1]})
    with pytest.raises(AssertionError, match="did not post"):
        check(GOOD, "t", {T1: thread(T1, ["alice"]), T2: CORPUS[T2]})
    with pytest.raises(AssertionError, match="dated"):
        check(GOOD, "t", {T1: thread(T1, ["alice", "bob"], "2024-01-01"), T2: CORPUS[T2]})


def test_flatten_hashes_users_and_drops_deleted():
    listing = [
        {"kind": "t1", "data": {"id": "c1", "author": "Alice", "created_utc": 1750000000, "score": 3, "body": "hi",
                                "replies": {"data": {"children": [
                                    {"kind": "t1", "data": {"id": "c2", "author": "[deleted]", "created_utc": 1750000100, "body": "[deleted]"}},
                                    {"kind": "t1", "data": {"id": "c3", "author": "bob", "created_utc": 1750000200, "body": "yo", "replies": ""}},
                                ]}}}},
        {"kind": "more", "data": {}},
    ]
    out: list = []
    flatten(listing, out)
    assert [c["id"] for c in out] == ["c1", "c3"]
    assert out[0]["userHash"] == user_hash("alice") and "author" not in out[0]
