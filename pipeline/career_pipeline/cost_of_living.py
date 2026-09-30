"""Regional price levels (national average = 100) for cost-of-living adjustment.

JP: 総務省 小売物価統計調査（構造編）消費者物価地域差指数, per prefecture (e-Stat Excel, no key)
US: BEA Regional Price Parities by state (SARPP.zip, no key)

Output: web/public/data/{jp,us}/prices.json
  {"year": 2025, "source": {...}, "regions": {"13": {"all": 104.2, "housing": 129.8}, ...}}
"""

from __future__ import annotations

import csv
import io
import re
import zipfile

import openpyxl
import requests

from .common import RAW_DIR, WEB_DATA_DIR, write_json

HEADERS = {"User-Agent": "Mozilla/5.0 (career-map data pipeline)"}

JP_YEAR = 2025
JP_STAT_INF_ID = "000040506879"
JP_URL = f"https://www.e-stat.go.jp/stat-search/file-download?statInfId={JP_STAT_INF_ID}&fileKind=0"
JP_PAGE = "https://www.e-stat.go.jp/stat-search/files?toukei=00200571&tstat=000001067253"

US_YEAR = 2024
US_URL = "https://apps.bea.gov/regional/zip/SARPP.zip"
US_PAGE = "https://www.bea.gov/data/prices-inflation/regional-price-parities-state-and-metro-area"


def fetch() -> None:
    for path, url in [
        (RAW_DIR / "jp" / f"cpi_regional_{JP_STAT_INF_ID}.xlsx", JP_URL),
        (RAW_DIR / "us" / "SARPP.zip", US_URL),
    ]:
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            print(f"downloading {url}")
            r = requests.get(url, headers=HEADERS, timeout=120)
            r.raise_for_status()
            path.write_bytes(r.content)


def build_jp() -> None:
    wb = openpyxl.load_workbook(RAW_DIR / "jp" / f"cpi_regional_{JP_STAT_INF_ID}.xlsx", read_only=True, data_only=True)
    regions = {}
    # Columns (0-based): 9 地域コード, 12 総合, 15 住居. Prefecture codes are "PP000".
    for row in wb["b001"].iter_rows(min_row=11, values_only=True):
        code = str(row[9] or "").strip()
        if re.fullmatch(r"\d{2}000", code) and code != "00000":
            regions[code[:2]] = {"all": float(row[12]), "housing": float(row[15])}
    assert len(regions) == 47, len(regions)
    write_json(
        WEB_DATA_DIR / "jp" / "prices.json",
        {
            "year": JP_YEAR,
            "source": {
                "name": {
                    "ja": f"総務省「小売物価統計調査（構造編）」{JP_YEAR}年 消費者物価地域差指数",
                    "en": f"MIC, Retail Price Survey (Structural Survey) {JP_YEAR}: Regional Difference Index of Consumer Prices",
                },
                "url": JP_PAGE,
            },
            "regions": regions,
        },
    )


def build_us() -> None:
    with zipfile.ZipFile(RAW_DIR / "us" / "SARPP.zip") as z:
        name = next(n for n in z.namelist() if n.startswith("SARPP_STATE") and n.endswith(".csv"))
        rows = list(csv.DictReader(io.TextIOWrapper(z.open(name), encoding="latin-1")))
    regions: dict[str, dict[str, float]] = {}
    lines = {"1": "all", "3": "housing"}  # 1 = All items, 3 = Services: Housing
    for r in rows:
        fips = (r.get("GeoFIPS") or "").strip().strip('"')
        line = (r.get("LineCode") or "").strip()
        if len(fips) == 5 and fips.endswith("000") and fips != "00000" and line in lines:
            regions.setdefault(fips[:2], {})[lines[line]] = float(r[str(US_YEAR)])
    assert len(regions) == 51, len(regions)
    write_json(
        WEB_DATA_DIR / "us" / "prices.json",
        {
            "year": US_YEAR,
            "source": {
                "name": {
                    "en": f"U.S. Bureau of Economic Analysis, Regional Price Parities by State {US_YEAR}",
                    "ja": f"米国経済分析局 州別地域価格差（RPP）{US_YEAR}年",
                },
                "url": US_PAGE,
            },
            "regions": regions,
        },
    )


def build() -> None:
    build_jp()
    build_us()


if __name__ == "__main__":
    fetch()
    build()
