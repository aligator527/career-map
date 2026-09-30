"""Netherlands: detailed occupations from CBS StatLine 86355NED, added on top of the Eurostat SES cells.

eu_ses builds web/public/data/nl/ like DE/FR/IT (ISCO major groups × age × sex, education, NUTS1
regions, facets). SES has no finer occupations, so this module adds the BRC 2014 occupation groups
(beroepsgroepen) with published wages from CBS table 86355NED "Werknemers; uurloon en beroep", which publishes the 25th,
50th and 75th percentile of gross *hourly* wages of all employees (full- and part-time) per year.

Converting hourly percentiles to the SES concept (gross annual earnings incl. bonuses, full-time
equivalent) — every step is applied to all three percentiles alike:

  1. year: CBS 2022, the SES year. An occupation suppressed in 2022 takes the nearest year within
     ±3 years, rescaled by the change in the all-occupation CBS median between that year and 2022.
  2. hours: × 1,656 paid hours a year. CBS divides pay by paid hours *excluding* holiday leave, so the
     full-time year is 36 h × 52 weeks = 1,872 h minus 30 days of holiday and public holidays
     (≈ 216 h).
  3. holiday allowance: × 1.08 (vakantiegeld, a statutory 8 %, excluded from the CBS hourly wage).
  4. calibration: × one factor so that the CBS all-occupation median equals the SES 2022 national
     median (national.json "*|*|*|*"). It absorbs other bonuses (13th month, profit sharing), the
     full-time premium and the SES scope (10+ employees, no public administration).

p10 and p90 are extrapolated from p25/p50/p75 assuming each half of the distribution is lognormal
(the same log-scale rule eu_ses uses to interpolate p25/p75), and the mean is the lognormal mean;
cells are method 4. Because CBS includes part-timers and youth wages, the lower percentiles of
occupations with many young part-time workers (cashiers, kitchen helpers, shelf fillers) are lower
than for full-time workers only.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import requests

from .common import RAW_DIR, WEB_DATA_DIR, write_json, write_national

API = "https://opendata.cbs.nl/ODataApi/odata/86355NED/"
NL_RAW = RAW_DIR / "nl"
OUT = WEB_DATA_DIR / "nl"
LABELS = Path(__file__).parent / "labels" / "nl_brc_occupations.json"

YEAR = 2022  # = eu_ses.YEAR
MAX_YEAR_GAP = 3
HOURS = 36 * 52 - 30 * 7.2  # 1,656 paid hours excluding holiday leave
HOLIDAY_ALLOWANCE = 1.08
METHOD = 4
Z25, Z10 = 0.6744898, 1.2815516
TOTAL = "T001014"


def fetch_json(name: str) -> dict:
    path = NL_RAW / f"cbs86355_{name}.json"
    if path.exists():
        return json.loads(path.read_text())
    r = requests.get(API + name, params={"$format": "json"}, timeout=180)
    r.raise_for_status()
    data = r.json()
    if "odata.nextLink" in data:  # the whole table (~2,300 rows) fits in one page; guard against growth
        raise RuntimeError("CBS 86355NED is paged; follow odata.nextLink")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(r.text)
    return data


def fetch() -> None:
    fetch_json("Beroep")
    fetch_json("TypedDataSet")


def hourly() -> dict[str, dict[int, tuple[float, float, float, int]]]:
    """{BRC 4-digit code or 'T': {year: (p25, p50, p75, employees)}} for published cells."""
    code_of = {}
    for b in fetch_json("Beroep")["value"]:
        if b["Key"] == TOTAL:
            code_of[b["Key"]] = "T"
        elif b["CategoryGroupID"] >= 21:  # beroepsgroep level; Title starts with the 4-digit code
            code_of[b["Key"]] = b["Title"][:4]
    out: dict[str, dict[int, tuple[float, float, float, int]]] = {}
    for r in fetch_json("TypedDataSet")["value"]:
        code = code_of.get(r["Beroep"])
        q = (r["k_25ePercentiel_2"], r["k_50ePercentielMediaan_3"], r["k_75ePercentiel_4"])
        if code and all(x is not None and x > 0 for x in q):
            out.setdefault(code, {})[int(r["Perioden"][:4])] = (*q, round((r["Werknemer_1"] or 0) * 1000))
    return out


def cell(q25: float, q50: float, q75: float, n: int) -> list:
    lo, hi = math.log(q50 / q25) / Z25, math.log(q75 / q50) / Z25  # log-scale sigma of each half
    p10, p90 = q50 * math.exp(-lo * Z10), q50 * math.exp(hi * Z10)
    mean = q50 * math.exp(((lo + hi) / 2) ** 2 / 2)
    return [n, int(round(mean, -2))] + [int(round(x, -2)) for x in (p10, q25, q50, q75, p90)] + [METHOD]


def build() -> None:
    labels = json.loads(LABELS.read_text())["occupations"]
    data = hourly()
    total = data["T"]
    national = json.loads((OUT / "national.json").read_text())
    ses_median = national["*|*|*|*"][4]
    base = HOURS * HOLIDAY_ALLOWANCE
    scale = ses_median / (total[YEAR][1] * base)

    cells: dict[str, list] = dict(national)
    occupations = []
    borrowed = []
    for code, lab in labels.items():
        years = data.get(code, {})
        year = next((y for d in range(MAX_YEAR_GAP + 1) for y in (YEAR + d, YEAR - d) if y in years), None)
        if year is None:
            continue
        q25, q50, q75, n = years[year]
        f = base * scale * total[YEAR][1] / total[year][1]
        if year != YEAR:
            borrowed.append(f"{code}:{year}")
        occ = f"B{code}"
        cells[f"{occ}|*|*|*"] = cell(q25 * f, q50 * f, q75 * f, n)
        occupations.append({"code": occ, "major": lab["major"], "label": {"en": lab["en"], "ja": lab["ja"]}})

    write_national(OUT, cells, lambda occ: next(o["major"] for o in occupations if o["code"] == occ))

    meta = json.loads((OUT / "meta.json").read_text())
    meta["occupations"] = occupations
    factor = round(base * scale)
    # strip what an earlier run appended, so build() can be re-run on its own output
    wd_en = meta["wageDefinition"]["en"].split(" Detailed occupations")[0]
    wd_ja = meta["wageDefinition"]["ja"].split("細分類の職業")[0]
    src_en = meta["source"]["name"]["en"].split("; detailed occupations")[0]
    src_ja = meta["source"]["name"]["ja"].split("／細分類の職業")[0]
    meta["wageDefinition"] = {
        "en": wd_en + (
            f" Detailed occupations (CBS occupation groups, BRC 2014) are estimated from CBS {YEAR} hourly-wage "
            f"percentiles of all employees (p25, median, p75; excluding bonuses and overtime): hourly wage × "
            f"{HOURS:,.0f} paid hours (36 h × 52 weeks less holidays) × 1.08 holiday allowance, then scaled "
            f"by {scale:.3f} so the all-occupation CBS median matches the SES median (in total about "
            f"× {factor:,} per euro of hourly wage); p10/p90 are extrapolated. Occupations not published for "
            f"{YEAR} use the nearest year (up to {MAX_YEAR_GAP} years away) adjusted by the change in the "
            f"overall CBS median. Because part-time and young "
            f"workers are included, the lower end is understated for occupations with many of them."),
        "ja": wd_ja + (
            f"細分類の職業（オランダ統計局 CBS の職業分類 BRC 2014）は、CBS の{YEAR}年の全被用者の時給分位点"
            f"（第1四分位・中央値・第3四分位。賞与・残業代を除く）から推計：時給 × 年{HOURS:,.0f}時間"
            f"（週36時間 × 52週から休暇を除く）× 休暇手当1.08 に、全職業の CBS 中央値が SES の中央値と一致する"
            f"よう {scale:.3f} 倍の補正をかけています（合計で時給1ユーロあたり約{factor:,}ユーロ）。"
            f"p10・p90 は外挿。{YEAR}年が非公表の職業は、{MAX_YEAR_GAP}年以内で最も近い年の値を全体の中央値の変化で"
            f"調整して使用。パートタイムや若年の被用者も含むため、それらが多い職業では下位の値が低めに出ます。"),
    }
    meta["source"]["name"] = {
        "en": src_en + "; detailed occupations: CBS StatLine 86355NED (hourly wages by occupation)",
        "ja": src_ja + "／細分類の職業：オランダ統計局 CBS StatLine 86355NED（職業別時給）",
    }
    write_json(OUT / "meta.json", meta)
    print(f"  NL: {len(occupations)} CBS occupations (scale {scale:.3f}, €{factor:,}/€ hourly)"
          + (f", from other years: {', '.join(borrowed)}" if borrowed else ""))


if __name__ == "__main__":
    fetch()
    build()
