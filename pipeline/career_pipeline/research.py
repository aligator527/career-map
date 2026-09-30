"""Validate the hand-compiled research effect sizes and publish them for the web app.

Input:  labels/research_effects.json (every estimate checked against its source; see _note)
Output: web/public/data/research.json
"""

from __future__ import annotations

import json
from pathlib import Path

from .common import WEB_DATA_DIR, write_json

SOURCE = Path(__file__).parent / "labels" / "research_effects.json"
UNITS = {"log wage points", "percent", "ratio", "percentage_points", "share", "elasticity"}
COUNTRIES = {"ALL", "JP", "US", "UK", "CA", "DE", "FR", "IT"}


def build() -> None:
    data = json.loads(SOURCE.read_text())
    ids = set()
    for e in data["effects"]:
        assert e["id"] not in ids, f"duplicate id {e['id']}"
        ids.add(e["id"])
        assert e["effect"]["unit"] in UNITS, f"{e['id']}: unit {e['effect']['unit']}"
        assert e["design"] in ("causal", "descriptive"), f"{e['id']}: design"
        assert set(e["countries"]) <= COUNTRIES, f"{e['id']}: countries"
        assert e["source"]["url"].startswith("https://"), f"{e['id']}: source url"
        assert e["label"].get("ja") and e["label"].get("en"), f"{e['id']}: labels"
    write_json(WEB_DATA_DIR / "research.json", {"compiled": data.get("_compiled"), "effects": data["effects"]})


if __name__ == "__main__":
    build()
