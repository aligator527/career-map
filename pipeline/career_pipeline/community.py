"""Aggregate anonymous self-reported submissions (Supabase) into web/public/data/community.json.

Runs nightly in GitHub Actions with the service-role key. Raw rows never leave this process; only
groups with at least K_MIN submissions are published, with quartiles rounded to a coarse unit and no
minimum/maximum. Without credentials (e.g. a local full pipeline run) the step is skipped.

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   read submissions from the database
  COMMUNITY_SAMPLE=path.json                 aggregate a local list of rows instead (for testing)
"""

from __future__ import annotations

import datetime as dt
import itertools
import json
import os
from collections import defaultdict
from pathlib import Path

import requests

from .common import WEB_DATA_DIR, write_json

K_MIN = 10
# Published counts are rounded down to a multiple of this, so that comparing two overlapping groups
# (or two nightly releases) does not reveal a single added row. See docs/PRIVACY.md for remaining risks.
COUNT_STEP = 5
PAGE = 1000
COLUMNS = ("country,region,occupation,age_band,sex,education,employment,role_level,english,remote,"
           "changed_job_3y,income,currency")
BREAKDOWNS = ["employment", "role_level", "english", "remote", "changed_job_3y"]
ROUND = {"JPY": 100_000, "USD": 1_000, "GBP": 1_000, "CAD": 1_000, "EUR": 1_000}


def fetch_rows() -> list[dict] | None:
    sample = os.environ.get("COMMUNITY_SAMPLE")
    if sample:
        return json.loads(Path(sample).read_text())
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None
    rows: list[dict] = []
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    while True:
        r = requests.get(
            f"{url.rstrip('/')}/rest/v1/submissions",
            params={"select": COLUMNS, "order": "id"},
            headers={**headers, "Range": f"{len(rows)}-{len(rows) + PAGE - 1}"},
            timeout=60,
        )
        r.raise_for_status()
        batch = r.json()
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows


def quartiles(values: list[int], unit: int) -> list[int]:
    """p25, p50, p75 (nearest-rank), rounded to `unit`."""
    v = sorted(values)
    pick = lambda q: v[min(int(q * len(v)), len(v) - 1)]  # noqa: E731
    return [int(round(pick(q) / unit) * unit) for q in (0.25, 0.5, 0.75)]


def coarse(n: int) -> int:
    return n // COUNT_STEP * COUNT_STEP


def majors() -> dict[str, dict[str, str]]:
    """country → {occupation code: major group code}."""
    out: dict[str, dict[str, str]] = {}
    for p in WEB_DATA_DIR.glob("*/meta.json"):
        meta = json.loads(p.read_text())
        out[meta["country"]] = {o["code"]: f"M{o['major']}" for o in meta["occupations"]}
    return out


def aggregate(rows: list[dict]) -> dict:
    major_of = majors()
    by_country: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_country[r["country"]].append(r)

    countries = {}
    for country, items in sorted(by_country.items()):
        unit = ROUND[items[0]["currency"]]
        cells: dict[str, list[int]] = {}
        # Pay cells over the same dimensions as the official data (occupation at detail and major level)
        groups: dict[str, list[int]] = defaultdict(list)
        for r in items:
            occ = r.get("occupation")
            occ_levels = {"*"} | ({occ, major_of.get(country, {}).get(occ, occ)} if occ else set())
            dims = [sorted(occ_levels), ["*", r["age_band"]], ["*", r.get("sex") or "*"], ["*", r.get("education") or "*"]]
            for combo in {tuple(c) for c in itertools.product(*dims)}:
                groups["|".join(combo)].append(r["income"])
        for key, values in groups.items():
            if len(values) >= K_MIN:
                cells[key] = [coarse(len(values))] + quartiles(values, unit)

        breakdowns: dict[str, dict[str, list[int]]] = {}
        for dim in BREAKDOWNS:
            vals: dict[str, list[int]] = defaultdict(list)
            for r in items:
                v = r.get(dim)
                if v is not None:
                    vals[str(v).lower()].append(r["income"])
            published = {v: [coarse(len(xs))] + quartiles(xs, unit) for v, xs in vals.items() if len(xs) >= K_MIN}
            if published:
                breakdowns[dim] = published
        countries[country] = {"n": coarse(len(items)), "currency": items[0]["currency"], "cells": cells, "breakdowns": breakdowns}

    return {"generatedOn": dt.date.today().isoformat(), "kMin": K_MIN, "countStep": COUNT_STEP,
            "total": coarse(len(rows)), "countries": countries}


def build() -> None:
    rows = fetch_rows()
    if rows is None:
        print("  community: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set, skipping")
        return
    path = WEB_DATA_DIR / "community.json"
    new = aggregate(rows)
    # Keep the file (and its date) untouched when the published numbers did not change
    if path.exists():
        old = json.loads(path.read_text())
        if {k: v for k, v in old.items() if k != "generatedOn"} == {k: v for k, v in new.items() if k != "generatedOn"}:
            print("  community: no change")
            return
    write_json(path, new)


if __name__ == "__main__":
    build()
