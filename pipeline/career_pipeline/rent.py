"""Typical monthly rent, nationally and per region, for the scenario comparison (net pay after rent).

The figure is what current tenants pay for a small home — a 1-bedroom where the source splits by size,
otherwise the average private rental — so it answers "roughly how much of the net pay goes to rent".
Sources differ in what they include (utilities, service charges) and each file says so in `basis`.

JP: 総務省 住宅・土地統計調査 2023, 第19表 民営借家の1か月当たり家賃 (prefectures)
US: Census ACS 2024 1-year, B25031 median gross rent, 1 bedroom (states, CBSAs) — bulk summary file, no key
UK: ONS Price Index of Private Rents, average private rent, 1 bedroom (regions and nations), latest month
CA: StatCan 46-10-0092 average asking rent, 1-bedroom apartment, latest quarter (CMAs; provinces = mean of their CMAs)
DE: Destatis Mikrozensus 2022 Nettokaltmiete per m², tenants who moved in 2019 or later, × 45 m² (Länder)
FR: Carte des loyers 2025 (ANIL / DHUP), predicted rent per m² for 1–2-room flats incl. charges, × 45 m² (regions)
IT: no official tenant-rent series by region; no file is written and the scenario omits the rent row.

Output: web/public/data/{country}/rent.json
  {"source": {"name", "url"}, "period", "basis": {ja,en}, "national": 1234, "regions": {code: 1234}}
"""

from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path

import openpyxl
import requests

from .common import RAW_DIR, WEB_DATA_DIR, write_json

HEADERS = {"User-Agent": "Mozilla/5.0 (career-map data pipeline)"}
FLOOR_M2 = 45

JP_URL = "https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040353920&fileKind=4"
US_URL = "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/1YRData/acsdt1y2024-b25031.dat"
UK_PAGE = ("https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/"
           "priceindexofprivaterentsukmonthlypricestatistics")
CA_URL = "https://www150.statcan.gc.ca/n1/tbl/csv/46100092-eng.zip"
DE_URL = ("https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Wohnen/_Grafik/_Interaktiv/Daten/"
          "nettokaltmieten.csv?__blob=value&v=8")
DE_PAGE = "https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Wohnen/_inhalt.html"
FR_URL = ("https://static.data.gouv.fr/resources/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/"
          "20251211-144934/pred-app12-mef-dhup.csv")
FR_PAGE = "https://www.data.gouv.fr/fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/"


def fetch(path: Path, url: str) -> Path:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        r = requests.get(url, headers=HEADERS, timeout=300)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path


def num(v) -> float | None:
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def jp() -> dict:
    ws = openpyxl.load_workbook(fetch(RAW_DIR / "jp" / "hlss2023_t19.xlsx", JP_URL), read_only=True).active
    rents = {}
    for row in ws.iter_rows(min_row=22, values_only=True):
        code, value = row[7], num(row[23])  # 地域コード, 民営借家 総数 (円/月)
        if isinstance(code, str) and re.fullmatch(r"\d{2}", code.strip()) and value:
            rents[code.strip()] = round(value)
    return {
        "source": {"name": {"ja": "総務省「住宅・土地統計調査」2023年 第19表", "en": "Statistics Bureau of Japan, Housing and Land Survey 2023, table 19"},
                   "url": "https://www.e-stat.go.jp/stat-search/files?toukei=00200522"},
        "period": "2023-10",
        "basis": {"ja": "民営借家の平均家賃（全規模、共益費・管理費を含まない）", "en": "Average rent of private rentals (all sizes, excluding service charges)"},
        "national": rents.pop("00"), "regions": rents,
    }


def us() -> dict:
    text = fetch(RAW_DIR / "us" / "acs1y2024_b25031.dat", US_URL).read_text()
    national, regions = None, {}
    for row in csv.DictReader(io.StringIO(text), delimiter="|"):
        value = num(row["B25031_E003"])
        if value is None or value <= 0:
            continue
        geo = row["GEO_ID"]
        if geo == "0100000US":
            national = round(value)
        elif geo.startswith("0400000US"):
            regions[geo[-2:]] = round(value)
        elif geo.startswith("310M700US"):
            regions[f"CBSA{geo[-5:]}"] = round(value)
    return {
        "source": {"name": {"ja": "米国勢調査局 ACS 2024年（1年推計）B25031", "en": "US Census Bureau, ACS 2024 1-year, table B25031"},
                   "url": "https://www.census.gov/programs-surveys/acs/data/summary-file.html"},
        "period": "2024",
        "basis": {"ja": "1ベッドルームの賃料中央値（光熱費込みのグロス賃料）", "en": "Median gross rent of 1-bedroom units (including utilities)"},
        "national": national, "regions": regions,
    }


def uk() -> dict:
    path = RAW_DIR / "uk" / "pipr.xlsx"
    if not path.exists():
        page = requests.get(UK_PAGE, headers=HEADERS, timeout=60).text
        link = re.search(r'href="(/file\?uri=[^"]*priceindexofprivaterents[^"]*\.xlsx)"', page)
        assert link, "PIPR download link not found"
        fetch(path, "https://www.ons.gov.uk" + link.group(1))
    ws = openpyxl.load_workbook(path, read_only=True)["Table 1"]
    rows = ws.iter_rows(min_row=3, values_only=True)
    header = list(next(rows))
    i_date, i_code, i_rent = header.index("Time period"), header.index("Area code"), header.index("Rental price one bed")
    latest: dict[str, tuple] = {}
    for row in rows:
        value = num(row[i_rent])
        if value and (row[i_code] not in latest or row[i_date] > latest[row[i_code]][0]):
            latest[row[i_code]] = (row[i_date], round(value))
    wanted = [f"E1200000{i}" for i in range(1, 10)] + ["W92000004", "S92000003", "N92000002"]
    period = latest["K02000001"][0].strftime("%Y-%m")
    return {
        "source": {"name": {"ja": "英国統計局（ONS）民間賃貸価格指数", "en": "ONS, Price Index of Private Rents"},
                   "url": UK_PAGE},
        "period": period,
        "basis": {"ja": "1ベッドルームの平均民間賃料（新規・既存契約、光熱費別）", "en": "Average private rent, 1 bedroom (new and existing tenancies, excluding bills)"},
        "national": latest["K02000001"][1], "regions": {c: latest[c][1] for c in wanted if c in latest},
    }


# Our CMA groups (from the census PUMF) → StatCan CMA codes they cover
CA_GROUPS = {
    "CMA205": ["205"], "CMA399": ["305", "310"], "CMA421": ["421"], "CMA462": ["462"], "CMA499": ["433", "442"],
    "CMA505": ["505"], "CMA532": ["532"], "CMA535": ["535"], "CMA537": ["537"], "CMA539": ["539"], "CMA541": ["541"],
    "CMA555": ["555"], "CMA559": ["559"], "CMA577": ["543", "550", "568"], "CMA588": ["521", "529"],
    "CMA599": ["580", "595"], "CMA602": ["602"], "CMA799": ["705", "725"], "CMA825": ["825"], "CMA835": ["835"],
    "CMA933": ["933"], "CMA935": ["935"], "CMA988": ["915", "932"],
}
CA_PROVINCE_OF_DIGIT = {"0": "10", "1": "11", "2": "12", "3": "13", "4": "24", "5": "35", "6": "46", "7": "47", "8": "48", "9": "59"}


def ca() -> dict:
    with zipfile.ZipFile(fetch(RAW_DIR / "ca" / "46100092-eng.zip", CA_URL)) as z:
        rows = list(csv.DictReader(io.TextIOWrapper(z.open("46100092.csv"), encoding="utf-8-sig")))
    # Paid rents are published for only a handful of CMAs, so use asking rents (new listings) throughout
    rows = [r for r in rows if r["Rental unit type"] == "Apartment - 1 bedroom" and r["Estimates"] == "Average asking rent" and num(r["VALUE"])]
    period = max(r["REF_DATE"] for r in rows)
    national, by_cma = None, defaultdict(list)
    for r in rows:
        if r["REF_DATE"] != period:
            continue
        if r["GEO"].startswith("All census metropolitan areas"):
            national = round(num(r["VALUE"]))
        else:
            by_cma[r["DGUID"][-3:]].append(num(r["VALUE"]))
    mean = lambda xs: round(sum(xs) / len(xs))
    regions = {}
    for group, codes in CA_GROUPS.items():
        values = [v for c in codes for v in by_cma.get(c, [])]
        if values:
            regions[group] = mean(values)
    by_province = defaultdict(list)
    for code, values in by_cma.items():
        by_province[CA_PROVINCE_OF_DIGIT[code[0]]] += values
    regions.update({p: mean(v) for p, v in by_province.items()})
    return {
        "source": {"name": {"ja": "カナダ統計局 表46-10-0092（平均募集賃料）", "en": "Statistics Canada, table 46-10-0092 (average asking rent)"},
                   "url": "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=4610009201"},
        "period": period,
        "basis": {"ja": "1ベッドルームのアパートの平均募集賃料（新規掲載。州は州内都市圏の平均）", "en": "Average asking rent of 1-bedroom apartments (new listings; provinces: mean of their metro areas)"},
        "national": national, "regions": regions,
    }


DE_LAND = {"Baden-Württemberg": "DE1", "Bayern": "DE2", "Berlin": "DE3", "Brandenburg": "DE4", "Bremen": "DE5",
           "Hamburg": "DE6", "Hessen": "DE7", "Mecklenburg-Vorpommern": "DE8", "Niedersachsen": "DE9",
           "Nordrhein-Westfalen": "DEA", "Rheinland-Pfalz": "DEB", "Saarland": "DEC", "Sachsen": "DED",
           "Sachsen-Anhalt": "DEE", "Schleswig-Holstein": "DEF", "Thüringen": "DEG"}
DE_NATIONAL_PER_M2 = 8.4  # Deutschland, moved in 2019 or later — shown in the same Destatis chart, not in its CSV


def de() -> dict:
    text = fetch(RAW_DIR / "de" / "nettokaltmieten_2022.csv", DE_URL).read_text(encoding="utf-8-sig")
    regions = {}
    for row in csv.reader(io.StringIO(text), delimiter=";"):
        if row and row[0] in DE_LAND and num(row[1]):
            regions[DE_LAND[row[0]]] = round(num(row[1]) * FLOOR_M2)
    assert len(regions) == 16, regions
    return {
        "source": {"name": {"ja": "ドイツ連邦統計局 マイクロセンサス住宅調査 2022", "en": "Destatis, Microcensus housing supplement 2022"},
                   "url": DE_PAGE},
        "period": "2022",
        "basis": {"ja": f"2019年以降に入居した世帯の正味冷家賃（㎡単価）× {FLOOR_M2}㎡（暖房・共益費を含まない）",
                  "en": f"Net cold rent per m² of households that moved in 2019 or later × {FLOOR_M2} m² (excluding heating and service charges)"},
        "national": round(DE_NATIONAL_PER_M2 * FLOOR_M2), "regions": regions,
    }


FR_NUTS = {"11": "FR1", "24": "FRB", "27": "FRC", "28": "FRD", "32": "FRE", "44": "FRF", "52": "FRG", "53": "FRH",
           "75": "FRI", "76": "FRJ", "84": "FRK", "93": "FRL", "94": "FRM"}


def fr() -> dict:
    text = fetch(RAW_DIR / "fr" / "carte_loyers_2025_app12.csv", FR_URL).read_text(encoding="latin-1")
    sums, weights = defaultdict(float), defaultdict(float)
    for row in csv.DictReader(io.StringIO(text), delimiter=";"):
        value, weight = num(row["loypredm2"]), num(row["nbobs_com"]) or 0
        if value is None or weight <= 0:
            continue
        region = FR_NUTS.get(row["REG"].zfill(2), "FRY")
        for key in (region, "*"):
            sums[key] += value * weight
            weights[key] += weight
    per_m2 = {k: sums[k] / weights[k] for k in sums}
    return {
        "source": {"name": {"ja": "フランス エコロジー移行省・ANIL「家賃マップ」2025", "en": "Ministère de la Transition écologique / ANIL, Carte des loyers 2025"},
                   "url": FR_PAGE},
        "period": "2025-Q3",
        "basis": {"ja": f"1〜2室アパートの募集家賃（㎡単価、共益費込み、掲載件数で加重）× {FLOOR_M2}㎡",
                  "en": f"Asking rent per m² of 1–2-room flats (incl. charges, weighted by listings) × {FLOOR_M2} m²"},
        "national": round(per_m2.pop("*") * FLOOR_M2), "regions": {k: round(v * FLOOR_M2) for k, v in per_m2.items()},
    }


def build() -> None:
    for country, make in [("jp", jp), ("us", us), ("uk", uk), ("ca", ca), ("de", de), ("fr", fr)]:
        data = make()
        known = {r["code"] for r in json.loads((WEB_DATA_DIR / country / "meta.json").read_text())["regions"]}
        data["regions"] = {k: v for k, v in sorted(data["regions"].items()) if k in known}
        assert data["national"] and data["regions"], country
        write_json(WEB_DATA_DIR / country / "rent.json", data)
        print(f"  rent {country}: national {data['national']} ({data['period']}), {len(data['regions'])} regions")


if __name__ == "__main__":
    build()
