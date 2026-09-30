"""South Korea: Survey on Labor Conditions by Employment Type 2025 (KOSIS) → wage-distribution cells.

Ministry of Employment and Labor, 고용형태별근로실태조사, June 2025 (employees of private-sector
establishments with 5+ employees, full- and part-time). All wages are 월임금총액: monthly regular
pay + overtime pay + 1/12 of the previous year's special payments (bonuses); annual = monthly × 12.

  DT_118N_PAYM39  major group × sex × age × 24 monthly pay bands (worker counts)
  DT_118N_PAYM42  major group × education × sex × age: mean wage, workers
  DT_118N_PAYM41  occupation (KSCO 7th revision, 3-digit) × sex: mean wage, workers

Major group × age × sex cells come from the pay-band histogram (method 1): quantiles are
interpolated linearly inside closed bands; the open top band (≥ 6,000k KRW/month, ~20% of all
workers) is a Pareto tail whose index is fixed by the published mean (PAYM42) minus the
closed bands' midpoint mass. Education cells (PAYM42) and 3-digit occupation cells (PAYM41) publish
means only and take the quantile/mean ratios of the matching histogram cell (method 3).

Regions (17 시도) scale the national all-occupation cells by each province's mean monthly wage of
regular employees at 5+ establishments relative to the national figure, from the Labour Force
Survey at Establishments 2025 (사업체노동력조사: DT_118N_MON061 by province, DT_118N_MON051
national); method 3.

KOSIS needs a headless browser to download CSVs; see kr_download.py. Raw CSVs are cached in
data/raw/kr/.
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from . import kr_download
from .common import MIN_N, RAW_DIR, WEB_DATA_DIR, write_json, write_national, write_region_summary

KR_RAW = RAW_DIR / "kr"
OUT_DIR = WEB_DATA_DIR / "kr"
YEAR = kr_download.YEAR
LABELS = {k: v for k, v in json.loads((Path(__file__).parent / "labels" / "kr_occupations.json").read_text()).items()
          if not k.startswith("_")}

METHOD_HIST = 1
METHOD_SHAPE = 3
TARGETS = [0.10, 0.25, 0.50, 0.75, 0.90]
# Weighted worker counts; the survey publishes population estimates only. Roughly MIN_N sampled
# workers at the survey's typical weight.
MIN_POP = MIN_N * 30

SEX = {"0": "*", "1": "M", "2": "F"}
AGE = {"00": "*", "02": "18-19", "03": "20-24", "04": "25-29", "05": "30-34", "06": "35-39", "07": "40-44",
       "08": "45-49", "09": "50-54", "10": "55-59", "11": "60-69"}
EDU = {"0": "*", "2": "lower_secondary", "3": "secondary", "4": "short_tertiary", "5": "bachelor"}

# Pay bands A01…A24 (thousand KRW/month): lower bounds. A01 is "under 800" (lower edge assumed);
# A24 is "6,000 and over" (Pareto tail).
BAND_LO = [400, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900,
           2000, 2200, 2400, 2600, 2800, 3000, 3500, 4000, 4500, 5000, 6000]
TOP = BAND_LO[-1]
ALPHA_RANGE = (1.5, 10.0)

MAJOR = {
    "1": ("Managers", "管理職"),
    "2": ("Professionals and related workers", "専門家・関連従事者"),
    "3": ("Clerical workers", "事務従事者"),
    "4": ("Service workers", "サービス従事者"),
    "5": ("Sales workers", "販売従事者"),
    "6": ("Skilled agricultural, forestry and fishery workers", "農林漁業熟練従事者"),
    "7": ("Craft and related trades workers", "技能工・関連技能従事者"),
    "8": ("Equipment, machine operating and assembling workers", "装置・機械操作・組立従事者"),
    "9": ("Elementary workers", "単純労務従事者"),
}

# KOSIS 2-digit 시도 codes (Korean label in MON061 → code, English, Japanese)
REGIONS = {
    "서울": ("11", "Seoul", "ソウル特別市"),
    "부산": ("21", "Busan", "釜山広域市"),
    "대구": ("22", "Daegu", "大邱広域市"),
    "인천": ("23", "Incheon", "仁川広域市"),
    "광주": ("24", "Gwangju", "光州広域市"),
    "대전": ("25", "Daejeon", "大田広域市"),
    "울산": ("26", "Ulsan", "蔚山広域市"),
    "세종": ("29", "Sejong", "世宗特別自治市"),
    "경기": ("31", "Gyeonggi", "京畿道"),
    "강원": ("32", "Gangwon", "江原特別自治道"),
    "충북": ("33", "North Chungcheong", "忠清北道"),
    "충남": ("34", "South Chungcheong", "忠清南道"),
    "전북": ("35", "North Jeolla", "全北特別自治道"),
    "전남": ("36", "South Jeolla", "全羅南道"),
    "경북": ("37", "North Gyeongsang", "慶尚北道"),
    "경남": ("38", "South Gyeongsang", "慶尚南道"),
    "제주": ("39", "Jeju", "済州特別自治道"),
}


def fetch() -> None:
    kr_download.download()


# ---------------------------------------------------------------- KOSIS CSV parsing

def num(s: str) -> float | None:
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None  # "-", "X" (suppressed), ""


def table(name: str) -> list[tuple[list[tuple[str, str]], dict[str, float | None]]]:
    """Rows of a KOSIS CSV (code+label layout) as ([(code token, label) per dimension], {item: value})
    for the columns of YEAR."""
    path = KR_RAW / f"{name}.csv"
    if not path.exists():
        raise SystemExit(f"missing {path}\n\n{kr_download.INSTRUCTIONS}")
    rows = list(csv.reader(path.open(encoding="utf-8-sig")))
    period, items = rows[0], rows[1]
    ndim = next(i for i, h in enumerate(period) if re.match(r"^Y\d{4}\b", h))
    cols = {}
    for i in range(ndim, len(period)):
        if period[i].startswith(f"Y{YEAR}"):
            m = re.match(r"^\S+\s+(.+?)\s*(\(|$)", items[i])
            cols[i] = m.group(1) if m else items[i]
    if not cols:
        raise SystemExit(f"{path}: no {YEAR} columns")
    out = []
    for r in rows[2:]:
        if len(r) < len(period):
            continue
        dims = [(x.split(None, 1)[0], x.split(None, 1)[1].strip() if " " in x.strip() else x.strip()) for x in r[:ndim]]
        out.append((dims, {name: num(r[i]) for i, name in cols.items()}))
    return out


def tail(token: str, sep: str) -> str:
    return token.rsplit(sep, 1)[-1]


# ---------------------------------------------------------------- distributions

def hist_quantiles(counts: list[float], mean: float) -> list[float]:
    """p10…p90 (thousand KRW/month) from pay-band counts and the published mean."""
    total = sum(counts)
    closed = sum(n * (BAND_LO[i] + BAND_LO[i + 1]) / 2 for i, n in enumerate(counts[:-1]))
    n_top = counts[-1]
    alpha = ALPHA_RANGE[1]
    if n_top > 0:
        m_top = (mean * total - closed) / n_top
        if m_top > TOP:
            alpha = min(max(m_top / (m_top - TOP), ALPHA_RANGE[0]), ALPHA_RANGE[1])
    out = []
    for q in TARGETS:
        target, cum = q * total, 0.0
        for i, n in enumerate(counts):
            if n > 0 and cum + n >= target:
                u = (target - cum) / n
                if i < len(counts) - 1:
                    out.append(BAND_LO[i] + u * (BAND_LO[i + 1] - BAND_LO[i]))
                else:
                    out.append(TOP * (1 - min(u, 0.999)) ** (-1 / alpha))
                break
            cum += n
    return out


def annual(x: float) -> int:
    return int(round(x * 1000 * 12, -4))


def cell(n: float, mean: float, q: list[float], method: int) -> list:
    return [round(n), annual(mean)] + [annual(x) for x in q] + [method]


# ---------------------------------------------------------------- build

def build() -> None:
    # PAYM42: means and workers by major group × education × sex × age
    means: dict[tuple[str, str, str, str], tuple[float, float]] = {}
    for dims, v in table("DT_118N_PAYM42"):
        occ = tail(dims[0][0], "_")
        occ = "*" if occ == "0" else f"M{occ}"
        edu, sex, age = EDU.get(tail(dims[1][0], ".")), SEX.get(tail(dims[2][0], ".")), AGE.get(tail(dims[3][0], "."))
        if None in (edu, sex, age) or not v.get("월임금총액") or not v.get("근로자수"):
            continue
        means[(occ, age, sex, edu)] = (v["월임금총액"], v["근로자수"])

    # PAYM39: pay-band histograms by major group × sex × age
    hists: dict[tuple[str, str, str], list[float]] = {}
    for dims, v in table("DT_118N_PAYM39"):
        band = tail(dims[2][0], ".")
        if not band.startswith("A"):
            continue
        occ = tail(dims[0][0], "_")
        occ = "*" if occ == "0" else f"M{occ}"
        sex, age = SEX.get(tail(dims[1][0], ".")), AGE.get(tail(dims[3][0], "."))
        if sex is None or age is None:
            continue
        hists.setdefault((occ, age, sex), [0.0] * len(BAND_LO))[int(band[1:]) - 1] = v.get("근로자수") or 0.0

    national: dict[str, list] = {}
    shapes: dict[tuple[str, str, str], list[float]] = {}
    for (occ, age, sex), counts in hists.items():
        m = means.get((occ, age, sex, "*"))
        if m is None or sum(counts) < MIN_POP:
            continue
        q = hist_quantiles(counts, m[0])
        shapes[(occ, age, sex)] = [x / m[0] for x in q]
        national[f"{occ}|{age}|{sex}|*"] = cell(sum(counts), m[0], q, METHOD_HIST)

    def shape_for(occ: str, age: str, sex: str) -> list[float]:
        for k in ((occ, age, sex), (occ, age, "*"), (occ, "*", sex), (occ, "*", "*"), ("*", age, sex), ("*", "*", sex)):
            if k in shapes:
                return shapes[k]
        return shapes[("*", "*", "*")]

    for (occ, age, sex, edu), (mean, n) in means.items():
        if edu == "*" or n < MIN_POP:
            continue
        national[f"{occ}|{age}|{sex}|{edu}"] = cell(n, mean, [mean * r for r in shape_for(occ, age, sex)], METHOD_SHAPE)

    # PAYM41: detailed occupations (3-digit, or 2-digit groups without a 3-digit breakdown) × sex
    detail: dict[tuple[str, str], tuple[float, float]] = {}
    for dims, v in table("DT_118N_PAYM41"):
        code, sex = tail(dims[0][0], "_"), SEX.get(tail(dims[1][0], "."))
        if sex is None or not code.isdigit() or len(code) < 2 or not v.get("월임금총액") or not v.get("근로자수"):
            continue
        detail[(code, sex)] = (v["월임금총액"], v["근로자수"])
    codes = {c for c, _ in detail}
    leaves = sorted(c for c in codes if not any(o != c and o.startswith(c) for o in codes))
    unlabelled = [c for c in leaves if c not in LABELS]
    if unlabelled:
        raise SystemExit(f"KR: occupations without labels in labels/kr_occupations.json: {unlabelled}")
    published = set()
    for (code, sex), (mean, n) in detail.items():
        if code in leaves and n >= MIN_POP:
            national[f"{code}|*|{sex}|*"] = cell(n, mean, [mean * r for r in shape_for(f"M{code[0]}", "*", sex)], METHOD_SHAPE)
            published.add(code)

    # Regions: province / national mean monthly wage of regular employees, establishments with 5+ employees
    nat = next(v["상용임금총액"] for dims, v in table("DT_118N_MON051")
               if dims[0][1] == "전체" and dims[1][1] == "소계" and "5인이상" in dims[2][1] and "~" not in dims[2][1])
    scale: dict[str, float] = {}
    for dims, v in table("DT_118N_MON061"):
        if dims[1][1] == "전산업" and dims[2][1].lstrip("-").strip() == "5인이상" and dims[0][1] in REGIONS:
            scale[REGIONS[dims[0][1]][0]] = (v["상용월급여액"] + v["상용특별급여"]) / nat
    if len(scale) != len(REGIONS):
        raise SystemExit(f"KR: regional table has {len(scale)} of {len(REGIONS)} provinces")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for f in OUT_DIR.glob("region-*.json"):
        f.unlink()
    for code, s in scale.items():
        cells = {}
        for key in ("*|*|*|*", "*|*|M|*", "*|*|F|*"):
            n, mean, *q, _ = national[key]
            cells[key] = [0, int(round(mean * s, -4))] + [int(round(x * s, -4)) for x in q] + [METHOD_SHAPE]
        write_json(OUT_DIR / f"region-{code}.json", cells)
    write_national(OUT_DIR, national, lambda occ: occ[0])
    write_json(OUT_DIR / "meta.json", {
        "country": "KR",
        "currency": "KRW",
        "year": YEAR,
        "wageDefinition": {
            "en": f"Monthly total wages in June {YEAR} × 12: regular and overtime pay plus 1/12 of the previous year's "
                  "special payments (bonuses). Employees of private-sector establishments with 5+ employees, including part-time workers.",
            "ja": f"{YEAR}年6月の月間賃金総額×12（所定内・超過労働給与に前年の特別給与（賞与など）の12分の1を加えたもの）。"
                  "従業員5人以上の民間事業所の被用者（短時間労働者を含む）。",
        },
        "nKind": "population",
        "source": {
            "id": f"lcet{YEAR}",
            "name": {"en": f"Ministry of Employment and Labor, Survey on Labor Conditions by Employment Type {YEAR} "
                           "(regional levels: Labor Force Survey at Establishments), via KOSIS",
                     "ja": f"韓国雇用労働部「雇用形態別労働実態調査」{YEAR}年（地域差は「事業体労働力調査」）、KOSIS"},
            "url": "https://kosis.kr/statHtml/statHtml.do?orgId=118&tblId=DT_118N_PAYM41",
        },
        "regions": [{"code": c, "label": {"en": en, "ja": ja}} for c, en, ja in sorted(REGIONS.values())],
        "occupationMajor": [{"code": f"M{k}", "label": {"en": en, "ja": ja}} for k, (en, ja) in MAJOR.items()],
        "occupations": [{"code": c, "major": c[0], "label": {"en": LABELS[c]["en"], "ja": LABELS[c]["ja"]}}
                        for c in leaves if c in published],
        "ages": [a for a in AGE.values() if a != "*"],
        "educations": [e for e in EDU.values() if e != "*"],
    })
    write_region_summary(OUT_DIR)
    print(f"  KR: {len(national)} national cells, {len(scale)} regions, {len(published)} occupations")


if __name__ == "__main__":
    fetch()
    build()
