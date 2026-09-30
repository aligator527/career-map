"""Validate the hand-compiled work-visa summary and publish it for the web app.

Input:  labels/visas.json (official sources, checked on the date in _compiled; see asOf per route)
Output: web/public/data/visas.json
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .common import WEB_DATA_DIR, write_json

SOURCE = Path(__file__).parent / "labels" / "visas.json"
COUNTRIES = {"JP", "US", "UK", "CA", "DE", "FR", "IT", "AU", "SG", "NL", "KR"}
CURRENCIES = {"JPY", "USD", "GBP", "CAD", "EUR", "AUD", "SGD", "KRW"}


def build() -> None:
    data = json.loads(SOURCE.read_text())
    assert set(data["countries"]) == COUNTRIES, sorted(set(data["countries"]) ^ COUNTRIES)
    for country, c in data["countries"].items():
        for r in c["routes"]:
            assert r["name"]["ja"] and r["name"]["en"], f"{country}/{r['id']}: name"
            assert r["source"]["url"].startswith("https://"), f"{country}/{r['id']}: source"
            assert re.fullmatch(r"\d{4}-\d{2}", r["asOf"]), f"{country}/{r['id']}: asOf"
            t = r.get("salaryThreshold")
            if t:
                assert t["currency"] in CURRENCIES and t["amount"] > 0 and t["period"] == "year", f"{country}/{r['id']}: threshold"
    write_json(WEB_DATA_DIR / "visas.json", {k: v for k, v in data.items() if not k.startswith("_")} | {"compiled": data.get("_compiled")})


if __name__ == "__main__":
    build()
