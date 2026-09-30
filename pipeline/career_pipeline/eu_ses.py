"""Germany, France, Italy: Eurostat Structure of Earnings Survey (SES) 2022 → wage-distribution cells.

SES 2022 publishes annual earnings *means* by occupation (ISCO-08, 1 digit) × age × sex, by education
× sex, and by NUTS1 region, but annual deciles only nationally or for broad occupation groups.
Each cell's distribution is therefore:

  mean (2022, full-time equivalent)  ×  shape ratios D1/mean, MED/mean, D9/mean

where the ratios come from the closest SES group that publishes deciles for full-time employees:
2018 occupation × age × sex → 2018 occupation → 2022 occupation group (OC1-5 / OC6-8 / OC7-9) → 2022
national. p25 and p75 are interpolated on a log scale between D1, the median and D9 (method 3).

Everything comes from the Eurostat dissemination API (JSON-stat, no key). Units: EUR, enterprises
with 10+ employees, NACE B-S excluding O.
"""

from __future__ import annotations

import itertools
import json
import math
import time
from collections import defaultdict

import requests

from .common import RAW_DIR, WEB_DATA_DIR, write_json, write_region_summary

API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
EU_RAW = RAW_DIR / "eu"
COUNTRIES = ["DE", "FR", "IT"]
YEAR = 2022
SHAPE_YEAR = 2018
METHOD_SHAPE = 3
Z = {0.10: -1.2815516, 0.25: -0.6744898, 0.50: 0.0, 0.75: 0.6744898, 0.90: 1.2815516}
SIZE_GE10 = ["10-49", "50-249", "250-499", "500-999", "GE1000"]

AGE = {
    "Y_LT20": "18-19", "Y20-29": "20-29", "Y_LT30": "18-29", "Y30-39": "30-39", "Y30-49": "30-49",
    "Y40-49": "40-49", "Y50-59": "50-59", "Y_GE50": "50-69", "Y_GE60": "60-69", "TOTAL": "*",
}
# Occupation × age cells exist only for these three bands (finer bands are not published with the
# enterprise-size and sector filters we use), so they are both the display and the matching bands.
AGES_DISPLAY = ["18-29", "30-49", "50-69"]
SEX = {"T": "*", "M": "M", "F": "F"}
EDU = {"ED0-2": "lower_secondary", "ED3_4": "upper_secondary", "ED5-8": "tertiary", "TOTAL": "*"}
ISCO = {
    "OC1": ("Managers", "管理職"),
    "OC2": ("Professionals", "専門職"),
    "OC3": ("Technicians and associate professionals", "技術者・准専門職"),
    "OC4": ("Clerical support workers", "事務補助"),
    "OC5": ("Service and sales workers", "サービス・販売"),
    "OC6": ("Skilled agricultural, forestry and fishery workers", "農林漁業"),
    "OC7": ("Craft and related trades workers", "技能工"),
    "OC8": ("Plant and machine operators and assemblers", "設備・機械の運転・組立"),
    "OC9": ("Elementary occupations", "単純作業"),
}
GROUP = {"OC1": "OC1-5", "OC2": "OC1-5", "OC3": "OC1-5", "OC4": "OC1-5", "OC5": "OC1-5",
         "OC6": "OC6-8", "OC7": "OC6-8", "OC8": "OC6-8", "OC9": "OC7-9"}

REGIONS = {
    "DE": [
        ("DE1", "Baden-Württemberg", "バーデン＝ヴュルテンベルク"), ("DE2", "Bavaria", "バイエルン"), ("DE3", "Berlin", "ベルリン"),
        ("DE4", "Brandenburg", "ブランデンブルク"), ("DE5", "Bremen", "ブレーメン"), ("DE6", "Hamburg", "ハンブルク"),
        ("DE7", "Hesse", "ヘッセン"), ("DE8", "Mecklenburg-Vorpommern", "メクレンブルク＝フォアポンメルン"),
        ("DE9", "Lower Saxony", "ニーダーザクセン"), ("DEA", "North Rhine-Westphalia", "ノルトライン＝ヴェストファーレン"),
        ("DEB", "Rhineland-Palatinate", "ラインラント＝プファルツ"), ("DEC", "Saarland", "ザールラント"), ("DED", "Saxony", "ザクセン"),
        ("DEE", "Saxony-Anhalt", "ザクセン＝アンハルト"), ("DEF", "Schleswig-Holstein", "シュレースヴィヒ＝ホルシュタイン"),
        ("DEG", "Thuringia", "テューリンゲン"),
    ],
    "FR": [
        ("FR1", "Île-de-France", "イル＝ド＝フランス"), ("FRB", "Centre-Val de Loire", "サントル＝ヴァル・ド・ロワール"),
        ("FRC", "Bourgogne-Franche-Comté", "ブルゴーニュ＝フランシュ＝コンテ"), ("FRD", "Normandy", "ノルマンディー"),
        ("FRE", "Hauts-de-France", "オー＝ド＝フランス"), ("FRF", "Grand Est", "グラン・テスト"), ("FRG", "Pays de la Loire", "ペイ・ド・ラ・ロワール"),
        ("FRH", "Brittany", "ブルターニュ"), ("FRI", "Nouvelle-Aquitaine", "ヌーヴェル＝アキテーヌ"), ("FRJ", "Occitanie", "オクシタニー"),
        ("FRK", "Auvergne-Rhône-Alpes", "オーヴェルニュ＝ローヌ＝アルプ"), ("FRL", "Provence-Alpes-Côte d'Azur", "プロヴァンス＝アルプ＝コート・ダジュール"),
        ("FRM", "Corsica", "コルス"), ("FRY", "Overseas regions", "海外地域圏"),
    ],
    "IT": [
        ("ITC", "North-West", "北西部"), ("ITH", "North-East", "北東部"), ("ITI", "Centre", "中部"),
        ("ITF", "South", "南部"), ("ITG", "Islands", "島嶼部"),
    ],
}
NACE = {
    "B": ("Mining and quarrying", "鉱業"), "C": ("Manufacturing", "製造業"), "D": ("Electricity and gas", "電気・ガス"),
    "E": ("Water supply and waste", "水道・廃棄物処理"), "F": ("Construction", "建設業"), "G": ("Wholesale and retail", "卸売・小売業"),
    "H": ("Transport and storage", "運輸・倉庫業"), "I": ("Accommodation and food", "宿泊・飲食サービス業"),
    "J": ("Information and communication", "情報通信業"), "K": ("Finance and insurance", "金融・保険業"),
    "L": ("Real estate", "不動産業"), "M": ("Professional, scientific and technical", "専門・科学技術サービス業"),
    "N": ("Administrative and support services", "事業支援サービス業"), "P": ("Education", "教育"),
    "Q": ("Health and social work", "医療・福祉"), "R": ("Arts and recreation", "芸術・娯楽"), "S": ("Other services", "その他のサービス業"),
}
SIZES = {"10-49": "10-49", "50-249": "50-249", "250-499": "250-499", "500-999": "500-999", "GE1000": "1000+"}
SIZE_LABELS = {"10-49": ("10–49 employees", "10〜49人"), "50-249": ("50–249 employees", "50〜249人"),
               "250-499": ("250–499 employees", "250〜499人"), "500-999": ("500–999 employees", "500〜999人"),
               "1000+": ("1,000+ employees", "1,000人以上")}
NAMES = {"DE": ("Germany", "ドイツ"), "FR": ("France", "フランス"), "IT": ("Italy", "イタリア")}


# ---------------------------------------------------------------- fetching (JSON-stat)

def fetch_json(name: str, dataset: str, params: dict[str, str | list[str]]) -> dict:
    path = EU_RAW / f"{name}.json"
    if path.exists():
        return json.loads(path.read_text())
    query = [("format", "JSON"), ("lang", "EN")]
    for k, v in params.items():
        for x in v if isinstance(v, list) else [v]:
            query.append((k, x))
    for attempt in range(4):
        try:
            r = requests.get(API + dataset, params=query, timeout=180)
            r.raise_for_status()
            break
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(5)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(r.text)
    return r.json()


def rows(d: dict):
    """Yield ({dimension: code}, value) for every non-missing observation."""
    ids = d["id"]
    cats = [sorted(d["dimension"][i]["category"]["index"], key=d["dimension"][i]["category"]["index"].get) for i in ids]
    values = d.get("value", {})
    for n, combo in enumerate(itertools.product(*cats)):
        v = values.get(str(n)) if isinstance(values, dict) else values[n]
        if v is not None:
            yield dict(zip(ids, combo)), float(v)


def queries(c: str) -> dict[str, dict]:
    common = {"geo": c, "unit": "EUR", "indic_se": "ERN", "sizeclas": "GE10"}
    return {
        "occ_age_sex": fetch_json(f"ses22_28_{c}", "earn_ses22_28", common),
        "age_sex": fetch_json(f"ses22_27_{c}", "earn_ses22_27", {**common, "nace_r2": "B-S_X_O"}),
        "edu_sex": fetch_json(f"ses22_30_{c}", "earn_ses22_30", {**common, "nace_r2": "B-S_X_O"}),
        "counts": fetch_json(f"ses22_03_{c}", "earn_ses22_03", {"geo": c}),
        "shape2018": fetch_json(
            f"ses_annual_{c}_{SHAPE_YEAR}_FT", "earn_ses_annual",
            {"geo": c, "time": str(SHAPE_YEAR), "worktime": "FT", "nace_r2": "B-S_X_O",
             "indic_se": ["MEAN_E_EUR", "MED_E_EUR", "D1_E_EUR", "D9_E_EUR"]},
        ),
        "shape2022": fetch_json(
            f"ses_annual_{c}_{YEAR}_FT", "earn_ses_annual",
            {"geo": c, "time": str(YEAR), "worktime": "FT", "nace_r2": "B-S_X_O",
             "indic_se": ["MEAN_E_EUR", "MED_E_EUR", "D1_E_EUR", "D9_E_EUR"]},
        ),
        "occ_size_sex": fetch_json(f"ses22_32_{c}", "earn_ses22_32", {"geo": c, "unit": "EUR", "indic_se": "ERN"}),
        "occ_nace_sex": fetch_json(f"ses22_49_{c}", "earn_ses22_49", {**common, "nace_r2": list(NACE)}),
        "regions": fetch_json(
            f"ses22_rann_{c}", "earn_ses22_rann",
            {"geo": [code for code, _, _ in REGIONS[c]], "unit": "EUR", "indic_se": "ERN"},
        ),
    }


def fetch() -> None:
    for c in COUNTRIES:
        queries(c)


# ---------------------------------------------------------------- shapes

Shape = tuple[float, float, float]  # D1/mean, MED/mean, D9/mean


def shapes(d: dict) -> dict[tuple[str, str, str], Shape]:
    """{(isco, age, sex): ratios} from an earn_ses_annual extract."""
    vals: dict[tuple[str, str, str], dict[str, float]] = defaultdict(dict)
    for r, v in rows(d):
        vals[(r["isco08"], r["age"], r["sex"])][r["indic_se"]] = v
    out = {}
    for k, x in vals.items():
        if all(i in x for i in ("MEAN_E_EUR", "MED_E_EUR", "D1_E_EUR", "D9_E_EUR")) and x["MEAN_E_EUR"] > 0:
            m = x["MEAN_E_EUR"]
            out[k] = (x["D1_E_EUR"] / m, x["MED_E_EUR"] / m, x["D9_E_EUR"] / m)
    return out


def quantiles(mean: float, s: Shape) -> list[float]:
    d1, med, d9 = (mean * r for r in s)
    lo = math.log(d1 / med) / Z[0.10]  # slope in log income per z, lower half
    hi = math.log(d9 / med) / Z[0.90]
    return [d1, med * math.exp(lo * Z[0.25]), med, med * math.exp(hi * Z[0.75]), d9]


# ---------------------------------------------------------------- build

def build_country(c: str) -> None:
    q = queries(c)
    s18, s22 = shapes(q["shape2018"]), shapes(q["shape2022"])

    def shape_for(isco: str, age: str, sex: str) -> Shape:
        candidates = [
            (s18, (isco, age, sex)), (s18, (isco, age, "T")), (s18, (isco, "TOTAL", sex)), (s18, (isco, "TOTAL", "T")),
            (s22, (GROUP.get(isco, "TOTAL"), "TOTAL", sex)), (s22, ("TOTAL", age, sex)), (s22, ("TOTAL", "TOTAL", sex)),
            (s22, ("TOTAL", "TOTAL", "T")),
        ]
        return next(tbl[k] for tbl, k in candidates if k in tbl)

    counts: dict[tuple[str, str, str], float] = defaultdict(float)
    for r, v in rows(q["counts"]):
        if r["sizeclas"] in SIZE_GE10:
            counts[(r["isco08"], r["age"], r["sex"])] += v

    def cell(mean: float, n: float, s: Shape) -> list:
        return [round(n), int(round(mean, -2))] + [int(round(x, -2)) for x in quantiles(mean, s)] + [METHOD_SHAPE]

    national: dict[str, list] = {}
    for r, v in rows(q["occ_age_sex"]):
        isco, age, sex = r["isco08"], r["age"], r["sex"]
        if (isco != "TOTAL" and isco not in ISCO) or age not in AGE:
            continue
        occ = "*" if isco == "TOTAL" else f"M{isco}"
        key = f"{occ}|{AGE[age]}|{SEX[sex]}|*"
        national[key] = cell(v, counts.get((isco, age, sex), 0), shape_for(isco, age, sex))
    for r, v in rows(q["age_sex"]):
        age, sex = r["age"], r["sex"]
        key = f"*|{AGE[age]}|{SEX[sex]}|*"
        if age in AGE and key not in national:
            national[key] = cell(v, counts.get(("TOTAL", age, sex), 0), shape_for("TOTAL", age, sex))
    for r, v in rows(q["edu_sex"]):
        edu, sex = r["isced11"], r["sex"]
        if edu in EDU and edu != "TOTAL":
            national[f"*|*|{SEX[sex]}|{EDU[edu]}"] = cell(v, 0, shape_for("TOTAL", "TOTAL", r["sex"]))

    # Facets: company size (occupation × size × sex) and industry (occupation × NACE section × sex); means only
    facets: dict[str, list] = {}
    for r, v in rows(q["occ_size_sex"]):
        isco, size, sex = r["isco08"], r["sizeclas"], r["sex"]
        if size in SIZES and (isco == "TOTAL" or isco in ISCO):
            occ = "*" if isco == "TOTAL" else f"M{isco}"
            facets[f"size={SIZES[size]}|{occ}|*|{SEX[sex]}"] = cell(v, 0, shape_for(isco, "TOTAL", sex))
    for r, v in rows(q["occ_nace_sex"]):
        isco, nace, sex = r["isco08"], r["nace_r2"], r["sex"]
        if nace in NACE and (isco == "TOTAL" or isco in ISCO):
            occ = "*" if isco == "TOTAL" else f"M{isco}"
            facets[f"industry={nace}|{occ}|*|{SEX[sex]}"] = cell(v, 0, shape_for(isco, "TOTAL", sex))

    out = WEB_DATA_DIR / c.lower()
    write_json(out / "facets.json", facets)
    for f in out.glob("region-*.json"):
        f.unlink()
    for r, v in rows(q["regions"]):
        write_json(out / f"region-{r['geo']}.json", {"*|*|*|*": cell(v, 0, shape_for("TOTAL", "TOTAL", "T"))})
    write_json(out / "national.json", national)

    en, ja = NAMES[c]
    write_json(out / "meta.json", {
        "country": c,
        "currency": "EUR",
        "year": YEAR,
        "wageDefinition": {
            "en": "Gross annual earnings including bonuses, full-time equivalent. Employees of enterprises with 10+ employees in industry and services (excluding public administration).",
            "ja": "賞与を含む年間総収入（フルタイム換算）。従業員10人以上の企業の被用者（公務を除く産業・サービス業）。",
        },
        "nKind": "population",
        "source": {
            "id": f"ses{YEAR}",
            "name": {"en": f"Eurostat, Structure of Earnings Survey {YEAR} (distribution shape from {SHAPE_YEAR})",
                     "ja": f"欧州統計局「賃金構造調査（SES）{YEAR}」（分布の形は {SHAPE_YEAR} 年調査）"},
            "url": "https://ec.europa.eu/eurostat/web/labour-market/database",
        },
        "regions": [{"code": code, "label": {"en": en_, "ja": ja_}} for code, en_, ja_ in REGIONS[c]],
        "occupationMajor": [{"code": f"M{k}", "label": {"en": e, "ja": j}} for k, (e, j) in ISCO.items()],
        "occupations": [],
        "ages": AGES_DISPLAY,
        "educations": ["lower_secondary", "upper_secondary", "tertiary"],
        "facets": {
            "industry": {"label": {"en": "Industry", "ja": "業界"},
                         "values": [{"code": k, "label": {"en": en, "ja": ja}} for k, (en, ja) in NACE.items()]},
            "size": {"label": {"en": "Company size", "ja": "企業規模"},
                     "values": [{"code": k, "label": {"en": en, "ja": ja}} for k, (en, ja) in SIZE_LABELS.items()]},
        },
    })
    write_region_summary(out)
    print(f"  {c}: {len(national)} national cells, {sum(1 for _ in out.glob('region-*.json'))} regions")


def build() -> None:
    for c in COUNTRIES:
        build_country(c)


if __name__ == "__main__":
    fetch()
    build()
