"""Exchange rates and purchasing power parities from the World Bank API (no key needed).

Output: web/public/data/fx.json
  {"year": {...}, "fx": {"JPY": 149.7, ...}, "ppp": {"JPY": 103.3, ...}}  (local currency per USD)
"""

from __future__ import annotations

import time

import requests

from .common import WEB_DATA_DIR, write_json

# ISO3 -> currency. Euro-area members share EUR; one representative country per currency.
COUNTRIES = {"JPN": "JPY", "USA": "USD", "GBR": "GBP", "DEU": "EUR", "CAN": "CAD", "AUS": "AUD", "SGP": "SGD", "KOR": "KRW"}

INDICATORS = {
    "fx": "PA.NUS.FCRF",  # official exchange rate, LCU per USD, period average
    "ppp": "PA.NUS.PRVT.PP",  # PPP for private consumption, LCU per international $
}


def fetch_indicator(indicator: str) -> dict[str, tuple[str, float]]:
    url = (
        f"https://api.worldbank.org/v2/country/{';'.join(COUNTRIES)}/indicator/{indicator}"
        "?format=json&mrnev=1&per_page=50"
    )
    for attempt in range(4):
        try:
            rows = requests.get(url, timeout=120).json()[1]
            break
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(5)
    return {COUNTRIES[r["countryiso3code"]]: (r["date"], r["value"]) for r in rows}


def build() -> None:
    out: dict = {
        "source": {
            "name": {"en": "World Bank, World Development Indicators", "ja": "世界銀行 世界開発指標"},
            "url": "https://data.worldbank.org/",
        },
        "year": {},
    }
    for key, indicator in INDICATORS.items():
        values = fetch_indicator(indicator)
        out[key] = {cur: round(v, 4) for cur, (_, v) in values.items()}
        out["year"][key] = max(y for y, _ in values.values())
    write_json(WEB_DATA_DIR / "fx.json", out)


if __name__ == "__main__":
    build()
