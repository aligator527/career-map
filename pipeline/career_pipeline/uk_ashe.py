"""United Kingdom: ONS Annual Survey of Hours and Earnings (ASHE) 2025 provisional → wage-distribution cells.

Annual gross pay of full-time employee jobs (tables x.7a), sheets Full-Time / Male Full-Time /
Female Full-Time:

  Table 14  occupation (SOC 2020, 2- and 4-digit) × sex
  Table 20  age × occupation (2-digit) × sex
  Table 3   region × occupation (2-digit) × sex

ASHE publishes p10…p90 but suppresses unreliable ones ('x'), most often p90. Missing quantiles are
interpolated on a (normal z, log pay) scale from the published neighbours on the same side of the
median (method 4). There is no education dimension in ASHE.
"""

from __future__ import annotations

import io
import json
import math
import re
import time
import zipfile
from pathlib import Path

import openpyxl
import requests

from .common import RAW_DIR, WEB_DATA_DIR, write_json, write_region_summary

EDITION = "2025provisional"
BASE = "https://www.ons.gov.uk/file?uri=/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets"
TABLES = {
    14: "occupation4digitsoc2010ashetable14",
    20: "agegroupbyoccupation2digitsocashetable20",
    3: "regionbyoccupation2digitsocashetable3",
}
UK_RAW = RAW_DIR / "uk"
OCC_JA = json.loads((Path(__file__).parent / "labels" / "uk_occupations_ja.json").read_text())
OUT_DIR = WEB_DATA_DIR / "uk"
SHEETS = {"Full-Time": "*", "Male Full-Time": "M", "Female Full-Time": "F"}
PCTS = [10, 20, 25, 30, 40, 60, 70, 75, 80, 90]  # columns 7..16
TARGETS = [10, 25, 50, 75, 90]
METHOD_DIRECT = 0
METHOD_FILLED = 4

AGE = {"18-21": "18-21", "22-29": "22-29", "30-39": "30-39", "40-49": "40-49", "50-59": "50-59", "60+": "60-69"}

REGIONS = {
    "E12000001": ("North East", "北東イングランド", None),
    "E12000002": ("North West", "北西イングランド", None),
    "E12000003": ("Yorkshire and The Humber", "ヨークシャー・アンド・ハンバー", None),
    "E12000004": ("East Midlands", "イースト・ミッドランズ", None),
    "E12000005": ("West Midlands", "ウェスト・ミッドランズ", None),
    "E12000006": ("East of England", "イースト・オブ・イングランド", None),
    "E12000007": ("London", "ロンドン", None),
    "E12000008": ("South East", "南東イングランド", None),
    "E12000009": ("South West", "南西イングランド", None),
    "W92000004": ("Wales", "ウェールズ", None),
    "S92000003": ("Scotland", "スコットランド", "SCT"),
    "N92000002": ("Northern Ireland", "北アイルランド", None),
}

SUB_MAJOR_JA = {
    "11": "企業の経営者・役員", "12": "その他の管理職・事業主",
    "21": "科学・研究・工学・技術の専門職", "22": "医療専門職", "23": "教育専門職",
    "24": "ビジネス・メディア・公共サービスの専門職",
    "31": "科学・工学・技術の準専門職", "32": "医療・社会福祉の準専門職", "33": "保安職",
    "34": "文化・メディア・スポーツ職", "35": "ビジネス・公共サービスの準専門職",
    "41": "事務職", "42": "秘書・関連職",
    "51": "農業関連の熟練職", "52": "金属・電気・電子の熟練職", "53": "建設の熟練職", "54": "繊維・印刷ほかの熟練職",
    "61": "介護・対人ケア職", "62": "余暇・旅行関連のサービス職",
    "71": "販売職", "72": "顧客サービス職",
    "81": "工程・設備・機械の操作員", "82": "輸送・移動機械の運転員",
    "91": "単純技能職", "92": "単純事務・サービス職",
}

Z = {10: -1.2815516, 20: -0.8416212, 25: -0.6744898, 30: -0.5244005, 40: -0.2533471, 50: 0.0,
     60: 0.2533471, 70: 0.5244005, 75: 0.6744898, 80: 0.8416212, 90: 1.2815516}


def zip_path(n: int) -> str:
    return str(UK_RAW / f"ashetable{n}{EDITION}.zip")


def fetch() -> None:
    UK_RAW.mkdir(parents=True, exist_ok=True)
    for n, slug in TABLES.items():
        path = UK_RAW / f"ashetable{n}{EDITION}.zip"
        if path.exists():
            continue
        url = f"{BASE}/{slug}/{EDITION}/ashetable{n}{EDITION}.zip"
        print(f"downloading {url}")
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0 (career-map data pipeline)"}, timeout=300)
        r.raise_for_status()
        path.write_bytes(r.content)
        time.sleep(4)  # ONS rate-limits rapid requests (HTTP 429)


def workbook(n: int) -> openpyxl.Workbook:
    zf = zipfile.ZipFile(zip_path(n))
    (name,) = [x for x in zf.namelist() if ".7a" in x and "Annual pay - Gross" in x and "CV" not in x]
    return openpyxl.load_workbook(io.BytesIO(zf.read(name)), read_only=True, data_only=True)


def num(v) -> float | None:
    return float(v) if isinstance(v, (int, float)) else None


def table_rows(ws):
    """Yield (description, code, jobs_thousand, median, mean, {pct: value}) until the footnotes."""
    for row in ws.iter_rows(min_row=6, max_col=17, values_only=True):
        if row[1] is None:
            break
        pcts = {p: num(row[7 + i]) for i, p in enumerate(PCTS)}
        yield str(row[0] or "").strip(), str(row[1]).strip(), num(row[2]), num(row[3]), num(row[5]), pcts


def fill_quantiles(median: float, pcts: dict[int, float | None], fallback_sigma: float) -> tuple[list[float], bool]:
    """p10, p25, p50, p75, p90 from the published percentiles, interpolating missing ones."""
    known = {p: v for p, v in pcts.items() if v} | {50: median}
    out, filled = [], False
    for t in TARGETS:
        if known.get(t):
            out.append(known[t])
            continue
        filled = True
        side = sorted((p for p in known if (p <= 50 if t < 50 else p >= 50)), key=lambda p: abs(Z[p] - Z[t]))
        if len(side) >= 2:
            a, b = side[0], side[1]
            slope = (math.log(known[b]) - math.log(known[a])) / (Z[b] - Z[a])
            out.append(math.exp(math.log(known[a]) + slope * (Z[t] - Z[a])))
        else:
            out.append(median * math.exp(fallback_sigma * Z[t]))
    return out, filled


class Cells:
    def __init__(self) -> None:
        self.cells: dict[str, list] = {}
        self.sigma = 0.5  # updated from the all-employees row before anything else is added

    def add(self, key: str, jobs: float | None, median: float | None, mean: float | None, pcts: dict) -> None:
        if not median:
            return
        q, filled = fill_quantiles(median, pcts, self.sigma)
        if mean is None:  # lognormal mean from the fitted spread
            sigma = math.log(q[4] / q[0]) / (2 * 1.2815516)
            mean = median * math.exp(sigma**2 / 2)
        n = round((jobs or 0) * 1000)
        self.cells[key] = [n, int(round(mean, -2))] + [int(round(x, -2)) for x in q] + [METHOD_FILLED if filled else METHOD_DIRECT]


def age_of(desc: str) -> str | None:
    m = re.match(r"^\s*(\d{2}-\d{2}|60\+)", desc)
    return AGE.get(m.group(1)) if m else None


def build() -> None:
    national = Cells()
    regions: dict[str, Cells] = {}
    occupations: dict[str, str] = {}
    majors: dict[str, str] = {}

    wb = workbook(14)
    for sheet, sex in SHEETS.items():
        for desc, code, jobs, median, mean, pcts in table_rows(wb[sheet]):
            if code == "" and desc.startswith("All employees"):
                if sex == "*" and median and pcts.get(10) and pcts.get(90):
                    national.sigma = math.log(pcts[90] / pcts[10]) / (2 * 1.2815516)
                national.add(f"*|*|{sex}|*", jobs, median, mean, pcts)
            elif len(code) == 4 and code.isdigit():
                occupations[code] = desc
                national.add(f"{code}|*|{sex}|*", jobs, median, mean, pcts)
            elif len(code) == 2 and code.isdigit():
                majors[code] = desc
                national.add(f"M{code}|*|{sex}|*", jobs, median, mean, pcts)

    wb = workbook(20)
    for sheet, sex in SHEETS.items():
        for desc, code, jobs, median, mean, pcts in table_rows(wb[sheet]):
            age = age_of(desc)
            if age is None:
                continue
            if code == "":
                national.add(f"*|{age}|{sex}|*", jobs, median, mean, pcts)
            elif len(code) == 2 and code.isdigit():
                national.add(f"M{code}|{age}|{sex}|*", jobs, median, mean, pcts)

    wb = workbook(3)
    for sheet, sex in SHEETS.items():
        region = None
        for desc, code, jobs, median, mean, pcts in table_rows(wb[sheet]):
            if code[:1].isalpha():
                region = code if code in REGIONS else None
                if region:
                    cells = regions.setdefault(region, Cells())
                    cells.sigma = national.sigma
                    cells.add(f"*|*|{sex}|*", jobs, median, mean, pcts)
            elif region and len(code) == 2 and code.isdigit():
                regions[region].add(f"M{code}|*|{sex}|*", jobs, median, mean, pcts)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for f in OUT_DIR.glob("region-*.json"):
        f.unlink()
    write_json(OUT_DIR / "national.json", national.cells)
    for code, cells in regions.items():
        write_json(OUT_DIR / f"region-{code}.json", cells.cells)
    write_json(OUT_DIR / "meta.json", {
        "country": "UK",
        "currency": "GBP",
        "year": 2025,
        "wageDefinition": {
            "en": "Annual gross pay of full-time employee jobs (employees in the same job for more than a year), April 2025. Excludes the self-employed.",
            "ja": "フルタイム被用者の年間総支給額（同じ仕事に1年以上就いている人。2025年4月時点）。自営業者を除く。",
        },
        "nKind": "population",
        "source": {
            "id": "ashe2025",
            "name": {"en": "ONS, Annual Survey of Hours and Earnings 2025 (provisional)",
                     "ja": "英国統計局「年次労働時間・所得調査（ASHE）」2025年速報"},
            "url": "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours",
        },
        "regions": [{"code": k, "label": {"en": en, "ja": ja}, **({"abbr": a} if a else {})} for k, (en, ja, a) in REGIONS.items()],
        "occupationMajor": [{"code": f"M{k}", "label": {"en": v, "ja": SUB_MAJOR_JA.get(k, v)}} for k, v in sorted(majors.items())],
        "occupations": [{"code": k, "major": k[:2], "label": {"en": v, **({"ja": OCC_JA[k]} if k in OCC_JA else {})}} for k, v in sorted(occupations.items())],
        "ages": list(AGE.values()),
        "educations": [],
    })
    write_region_summary(OUT_DIR)
    print(f"  UK: {len(national.cells)} national cells, {len(regions)} regions, {len(occupations)} occupations")


if __name__ == "__main__":
    fetch()
    build()
