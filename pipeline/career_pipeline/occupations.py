"""Validate the cross-country role table against each country's meta.json and publish it.

Input:  labels/common_occupations.json
Output: web/public/data/occupations.json
"""

from __future__ import annotations

import json
from pathlib import Path

from .common import WEB_DATA_DIR, write_json

SOURCE = Path(__file__).parent / "labels" / "common_occupations.json"


def build() -> None:
    roles = json.loads(SOURCE.read_text())["roles"]
    known: dict[str, set[str]] = {}
    for meta_path in WEB_DATA_DIR.glob("*/meta.json"):
        meta = json.loads(meta_path.read_text())
        known[meta["country"]] = {o["code"] for o in meta["occupations"]} | {m["code"] for m in meta["occupationMajor"]}
    problems = []
    for role in roles:
        for country, codes in role["codes"].items():
            if country not in known:
                continue
            missing = [c for c in codes if c not in known[country]]
            if missing:
                problems.append(f"{role['id']} {country}: {missing}")
    if problems:
        raise SystemExit("unknown occupation codes:\n  " + "\n  ".join(problems))
    write_json(WEB_DATA_DIR / "occupations.json", roles)


if __name__ == "__main__":
    build()
