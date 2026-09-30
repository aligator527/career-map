"""Canada: 2021 Census of Population Public Use Microdata File (individuals) → wage-distribution cells.

Input (data/raw/ca/): cen21_ind_98m0001x_part_rec21.zip
  https://www150.statcan.gc.ca/n1/pub/98m0001x/2023001/cen21_ind_98m0001x_part_rec21.zip
  (Statistics Canada Open Licence, no registration)

Wages refer to calendar year 2020 (from tax records). Occupation is the NOC 2021 variable of the
public file, which has only 26 groups.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import polars as pl
import requests

from .common import AGE_BANDS, RAW_DIR, WEB_DATA_DIR, write_json, write_national, write_region_summary
from .microdata import build_cells, build_facets

INCOME_YEAR = 2020
TARGET_YEAR = 2025
# Average weekly earnings incl. overtime, industrial aggregate excl. unclassified, Canada (table 14-10-0204)
AWE_VECTOR = 1740722
WDS = "https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods"
URL = "https://www150.statcan.gc.ca/n1/pub/98m0001x/2023001/cen21_ind_98m0001x_part_rec21.zip"
CA_RAW = RAW_DIR / "ca"
ZIP = CA_RAW / "cen21_ind_98m0001x_part_rec21.zip"
CSV = "data_donnees_2021_ind_v2.csv"
OUT_DIR = WEB_DATA_DIR / "ca"

# PR → (postal abbreviation used for tax, English, Japanese)
PROVINCES = {
    "10": ("NL", "Newfoundland and Labrador", "ニューファンドランド・ラブラドール"),
    "11": ("PE", "Prince Edward Island", "プリンスエドワードアイランド"),
    "12": ("NS", "Nova Scotia", "ノバスコシア"),
    "13": ("NB", "New Brunswick", "ニューブランズウィック"),
    "24": ("QC", "Quebec", "ケベック"),
    "35": ("ON", "Ontario", "オンタリオ"),
    "46": ("MB", "Manitoba", "マニトバ"),
    "47": ("SK", "Saskatchewan", "サスカチュワン"),
    "48": ("AB", "Alberta", "アルバータ"),
    "59": ("BC", "British Columbia", "ブリティッシュコロンビア"),
    "70": ("NT", "Territories (Yukon, NWT, Nunavut)", "準州（ユーコン・北西・ヌナブト）"),
}

# NOC21 (public-file groups) → (major = NOC broad category, English, Japanese)
NOC = {
    1: ("0", "Legislative and senior managers", "議員・上級管理職"),
    2: ("0", "Middle management occupations", "中間管理職"),
    3: ("1", "Professional occupations in business and finance", "ビジネス・金融の専門職"),
    4: ("1", "Administrative and financial supervisors and specialized administrative occupations", "事務・金融の監督者、専門事務職"),
    5: ("1", "Administrative occupations and transportation logistics occupations", "事務職・輸送物流職"),
    6: ("1", "Administrative and financial support and supply chain logistics occupations", "事務・金融サポート、サプライチェーン物流"),
    7: ("2", "Professional occupations in natural and applied sciences", "自然科学・応用科学の専門職（IT・エンジニアを含む）"),
    8: ("2", "Technical occupations related to natural and applied sciences", "自然科学・応用科学の技術職"),
    9: ("3", "Professional occupations in health", "医療の専門職"),
    10: ("3", "Technical occupations in health", "医療の技術職"),
    11: ("3", "Assisting occupations in support of health services", "医療補助職"),
    12: ("4", "Professional occupations in law, education, social, community and government services", "法律・教育・社会・公共サービスの専門職"),
    13: ("4", "Front-line public protection services and paraprofessional occupations in legal, social, community and education services", "公安の第一線、法律・社会・教育の準専門職"),
    14: ("4", "Assisting occupations and care providers in education, legal and public protection", "教育・法律・公安の補助職、ケア提供者"),
    15: ("5", "Professional and technical occupations in art, culture and sport", "芸術・文化・スポーツの専門職・技術職"),
    16: ("5", "Other occupations in art, culture and sport", "その他の芸術・文化・スポーツ職"),
    17: ("6", "Retail sales and service supervisors and specialized occupations in sales and services", "小売・サービスの監督者、専門販売職"),
    18: ("6", "Occupations in sales and services", "販売・サービス職"),
    19: ("6", "Sales and service representatives and other customer and personal services occupations", "販売・サービス担当、顧客・対人サービス"),
    20: ("6", "Sales and service support occupations", "販売・サービス補助職"),
    21: ("7", "Technical trades and transportation officers and controllers", "技術系技能職、輸送の管理・監督"),
    22: ("7", "General trades", "一般技能職"),
    23: ("7", "Mail and message distribution, other transport equipment operators and related maintenance workers", "郵便配達、輸送機器の運転・保守"),
    24: ("7", "Helpers and labourers and other transport drivers, operators and labourers", "補助作業員、運転手、労務職"),
    25: ("8", "Occupations in natural resources, agriculture and related production", "天然資源・農業・関連生産"),
    26: ("9", "Occupations in processing, manufacturing and utilities", "加工・製造・公益事業"),
}
NOC_MAJOR = {
    "0": ("Management occupations", "管理職"),
    "1": ("Business, finance and administration", "ビジネス・金融・事務"),
    "2": ("Natural and applied sciences", "自然科学・応用科学"),
    "3": ("Health", "医療"),
    "4": ("Education, law and social, community and government services", "教育・法律・社会・公共サービス"),
    "5": ("Art, culture, recreation and sport", "芸術・文化・レクリエーション・スポーツ"),
    "6": ("Sales and service", "販売・サービス"),
    "7": ("Trades, transport and equipment operators", "技能・輸送・機械操作"),
    "8": ("Natural resources and agriculture", "天然資源・農業"),
    "9": ("Manufacturing and utilities", "製造・公益事業"),
}
# Metropolitan areas (CMA variable of the public file) → (province abbreviation, English, Japanese)
CMAS = {
    205: ("NS", "Halifax", "ハリファックス"), 399: ("NB", "Moncton – Saint John", "モンクトン・セントジョン"),
    421: ("QC", "Québec City", "ケベック・シティ"), 462: ("QC", "Montréal", "モントリオール"),
    499: ("QC", "Sherbrooke – Trois-Rivières", "シャーブルック・トロワリビエール"), 505: ("ON", "Ottawa – Gatineau", "オタワ・ガティノー"),
    532: ("ON", "Oshawa", "オシャワ"), 535: ("ON", "Toronto", "トロント"), 537: ("ON", "Hamilton", "ハミルトン"),
    539: ("ON", "St. Catharines – Niagara", "セントキャサリンズ・ナイアガラ"), 541: ("ON", "Kitchener – Cambridge – Waterloo", "キッチナー・ウォータールー"),
    555: ("ON", "London", "ロンドン（オンタリオ州）"), 559: ("ON", "Windsor", "ウィンザー"),
    577: ("ON", "Brantford – Guelph – Barrie", "ブラントフォード・ゲルフ・バリー"), 588: ("ON", "Kingston – Peterborough", "キングストン・ピーターボロ"),
    599: ("ON", "Greater Sudbury – Thunder Bay", "サドベリー・サンダーベイ"), 602: ("MB", "Winnipeg", "ウィニペグ"),
    799: ("SK", "Regina – Saskatoon", "レジャイナ・サスカトゥーン"), 825: ("AB", "Calgary", "カルガリー"), 835: ("AB", "Edmonton", "エドモントン"),
    933: ("BC", "Vancouver", "バンクーバー"), 935: ("BC", "Victoria", "ビクトリア"), 988: ("BC", "Kelowna – Abbotsford-Mission", "ケロウナ・アボッツフォード"),
}

INDUSTRIES = {
    11: ("Agriculture, forestry, fishing and hunting", "農林水産業"), 21: ("Mining, quarrying, and oil and gas", "鉱業・石油ガス"),
    22: ("Utilities", "電気・ガス・水道"), 23: ("Construction", "建設業"), 31: ("Manufacturing", "製造業"),
    41: ("Wholesale trade", "卸売業"), 44: ("Retail trade", "小売業"), 48: ("Transportation and warehousing", "運輸・倉庫業"),
    51: ("Information and cultural industries", "情報・文化産業"), 52: ("Finance and insurance; management of companies", "金融・保険業、持株会社"),
    53: ("Real estate and rental and leasing", "不動産・物品賃貸業"), 54: ("Professional, scientific and technical services", "専門・科学技術サービス業"),
    56: ("Administrative and support, waste management", "事業支援・廃棄物処理"), 61: ("Educational services", "教育"),
    62: ("Health care and social assistance", "医療・福祉"), 71: ("Arts, entertainment and recreation", "芸術・娯楽"),
    72: ("Accommodation and food services", "宿泊・飲食サービス業"), 81: ("Other services", "その他のサービス業"), 91: ("Public administration", "公務"),
}
# CIP 2021 broad fields → the same field groups as the US file (labels/us_fields_of_study.json "_groups")
FIELD_GROUP = {1: "education", 2: "arts", 3: "humanities", 4: "social_sci", 5: "business", 6: "stem_sci", 7: "stem_cs",
               8: "stem_eng", 9: "stem_sci", 10: "health", 11: "other", 12: "other"}
CITIZENSHIP = {1: "native", 2: "naturalized", 3: "noncitizen"}
LANGUAGE = {1: ("english_only", "English only", "英語のみ"), 2: ("french_only", "French only", "フランス語のみ"),
            3: ("both", "English and French", "英語とフランス語"), 4: ("neither", "Neither English nor French", "英仏語どちらも話せない")}

# AGEGRP 7 = 18-19, 8 = 20-24, …, 17 = 65-69
AGEGRP = {7 + i: band for i, band in enumerate(AGE_BANDS)}


def fetch() -> None:
    CA_RAW.mkdir(parents=True, exist_ok=True)
    wage_index()
    if not ZIP.exists():
        print(f"downloading {URL} (~180MB)")
        with requests.get(URL, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(ZIP, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
    if not (CA_RAW / CSV).exists():
        with zipfile.ZipFile(ZIP) as z:
            (name,) = [n for n in z.namelist() if n.endswith(CSV)]
            (CA_RAW / CSV).write_bytes(z.read(name))


def wage_index() -> tuple[float, dict]:
    """Factor from INCOME_YEAR to TARGET_YEAR pay levels (cached in data/raw so rebuilds are reproducible)."""
    path = CA_RAW / "awe_index.json"
    if not path.exists():
        r = requests.post(WDS, json=[{"vectorId": AWE_VECTOR, "latestN": 12}], timeout=60)
        r.raise_for_status()
        points = r.json()[0]["object"]["vectorDataPoint"]
        path.write_text(json.dumps({p["refPer"][:4]: p["value"] for p in points}))
    values = {int(k): v for k, v in json.loads(path.read_text()).items()}
    factor = values[TARGET_YEAR] / values[INCOME_YEAR]
    return factor, {"from": values[INCOME_YEAR], "to": values[TARGET_YEAR]}


def edu_expr() -> pl.Expr:
    h = pl.col("HDGREE")
    return (
        pl.when(h <= 2).then(pl.lit("secondary"))
        .when(h <= 8).then(pl.lit("short_tertiary"))
        .when(h == 9).then(pl.lit("bachelor"))
        .otherwise(pl.lit("graduate"))
    )


def load_workers() -> pl.DataFrame:
    """Full-year (49-52 weeks), mainly full-time workers aged 18-69: employees (wages) and the self-employed
    (employment income). Main cells use employees only."""
    cols = ["PR", "CMA", "WEIGHT", "AGEGRP", "Gender", "HDGREE", "NOC21", "COW", "FPTWK", "WKSWRK", "Wages", "EmpIn",
            "NAICS", "CIP2021", "Citizen", "KOL"]
    self_employed = pl.col("COW").is_between(3, 6)
    income = pl.when(self_employed).then(pl.col("EmpIn")).otherwise(pl.col("Wages"))
    return (
        pl.scan_csv(CA_RAW / CSV, infer_schema_length=0)
        .select(cols)
        .with_columns(pl.col(c).cast(pl.Float64) for c in cols)
        .filter(
            (pl.col("COW").is_in([1, 3, 4, 5, 6]))
            & (pl.col("FPTWK") == 1)
            & (pl.col("WKSWRK") == 6)
            & (income > 0)
            & (income < 88_888_888)
            & pl.col("AGEGRP").is_between(7, 17)
            & pl.col("NOC21").is_between(1, 26)
            & pl.col("HDGREE").is_between(1, 13)
        )
        .with_columns(
            wage=income,
            w=pl.col("WEIGHT"),
            region=pl.col("PR").cast(pl.Int64).cast(pl.Utf8),
            cma=pl.col("CMA").cast(pl.Int64),
            occ=pl.format("N{}", pl.col("NOC21").cast(pl.Int64).cast(pl.Utf8).str.zfill(2)),
            occ_major=pl.col("NOC21").cast(pl.Int64).replace_strict({k: v[0] for k, v in NOC.items()}, return_dtype=pl.Utf8),
            age=pl.col("AGEGRP").cast(pl.Int64).replace_strict(AGEGRP, return_dtype=pl.Utf8),
            sex=pl.when(pl.col("Gender") == 1).then(pl.lit("F")).otherwise(pl.lit("M")),
            edu=edu_expr(),
            employment=pl.when(self_employed).then(pl.lit("self_employed")).otherwise(pl.lit("employee")),
            industry=pl.col("NAICS").cast(pl.Int64).replace_strict({k: str(k) for k in INDUSTRIES}, default=None, return_dtype=pl.Utf8),
            field=pl.col("CIP2021").cast(pl.Int64).replace_strict(FIELD_GROUP, default=None, return_dtype=pl.Utf8),
            citizenship=pl.col("Citizen").cast(pl.Int64).replace_strict(CITIZENSHIP, default=None, return_dtype=pl.Utf8),
            language=pl.col("KOL").cast(pl.Int64).replace_strict({k: v[0] for k, v in LANGUAGE.items()}, default=None, return_dtype=pl.Utf8),
        )
        .select("wage", "w", "region", "cma", "occ", "occ_major", "age", "sex", "edu",
                "employment", "industry", "field", "citizenship", "language")
        .collect()
    )


def facet_meta() -> dict:
    groups = json.loads((Path(__file__).parent / "labels" / "us_fields_of_study.json").read_text())["_groups"]
    return {
        "industry": {"label": {"en": "Industry", "ja": "業界"},
                     "values": [{"code": str(k), "label": {"en": en, "ja": ja}} for k, (en, ja) in INDUSTRIES.items()]},
        "field": {"label": {"en": "Field of study (post-secondary)", "ja": "専攻（高等教育修了者）"},
                  "values": [{"code": k, "label": v} for k, v in groups.items()]},
        "citizenship": {"label": {"en": "Citizenship", "ja": "国籍"}, "values": [
            {"code": "native", "label": {"en": "Canadian by birth", "ja": "出生によるカナダ市民"}},
            {"code": "naturalized", "label": {"en": "Naturalized citizen", "ja": "帰化した市民"}},
            {"code": "noncitizen", "label": {"en": "Not a Canadian citizen", "ja": "カナダ国籍なし"}},
        ]},
        "language": {"label": {"en": "Official languages spoken", "ja": "話せる公用語"},
                     "values": [{"code": c, "label": {"en": en, "ja": ja}} for c, en, ja in LANGUAGE.values()]},
        "employment": {"label": {"en": "Type of work", "ja": "働き方"}, "values": [
            {"code": "employee", "label": {"en": "Employee", "ja": "雇用者"}},
            {"code": "self_employed", "label": {"en": "Self-employed / own business", "ja": "自営業・経営者"}},
        ]},
    }


def build() -> None:
    factor, awe = wage_index()
    # 2020 incomes expressed at 2025 pay levels (average weekly earnings growth, applied uniformly)
    everyone = load_workers().with_columns(wage=pl.col("wage") * factor)
    print(f"  scaling {INCOME_YEAR} incomes to {TARGET_YEAR} by x{factor:.4f} (AWE {awe['from']} -> {awe['to']})")
    df = everyone.filter(pl.col("employment") == "employee")
    print(f"CA workers: {df.height:,} employees (+{everyone.height - df.height:,} self-employed), weighted {df['w'].sum():,.0f}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for f in OUT_DIR.glob("region-*.json"):
        f.unlink()
    write_national(OUT_DIR, build_cells(df), lambda occ: NOC[int(occ[1:])][0])
    facets = build_facets(df, ["industry", "field", "citizenship", "language"])
    facets.update(build_facets(everyone, ["employment"]))
    write_json(OUT_DIR / "facets.json", facets)
    for pr in PROVINCES:
        write_json(OUT_DIR / f"region-{pr}.json", build_cells(df.filter(pl.col("region") == pr)))
    for cma in CMAS:
        write_json(OUT_DIR / f"region-CMA{cma}.json", build_cells(df.filter(pl.col("cma") == cma)))
    write_json(OUT_DIR / "meta.json", {
        "country": "CA",
        "currency": "CAD",
        "year": TARGET_YEAR,
        "wageDefinition": {
            "en": f"Wages and salaries in {INCOME_YEAR} (from tax records), scaled to {TARGET_YEAR} pay levels by the growth of average weekly earnings (x{factor:.3f}, Statistics Canada table 14-10-0204). Employees who worked mainly full-time for 49-52 weeks, aged 18-69.",
            "ja": f"{INCOME_YEAR}年の賃金・給与（税務記録による）を、平均週給の伸び（×{factor:.3f}、カナダ統計局 表14-10-0204）で{TARGET_YEAR}年の水準に換算。主にフルタイムで49〜52週働いた18〜69歳の被用者。",
        },
        "method": "direct",
        "source": {
            "id": "cen2021",
            "name": {"en": "Statistics Canada, 2021 Census Public Use Microdata File (individuals)",
                     "ja": "カナダ統計局 2021年国勢調査 個票（PUMF）"},
            "url": "https://www150.statcan.gc.ca/n1/pub/98m0001x/index-eng.htm",
        },
        "regions": [{"code": k, "abbr": a, "label": {"en": en, "ja": ja}} for k, (a, en, ja) in PROVINCES.items()]
        + [{"code": f"CMA{k}", "abbr": a, "kind": "metro", "label": {"en": en, "ja": ja}} for k, (a, en, ja) in CMAS.items()],
        "occupationMajor": [{"code": f"M{k}", "label": {"en": en, "ja": ja}} for k, (en, ja) in NOC_MAJOR.items()],
        "occupations": [
            {"code": f"N{k:02d}", "major": m, "label": {"en": en, "ja": ja}} for k, (m, en, ja) in NOC.items()
        ],
        "ages": AGE_BANDS,
        "educations": ["secondary", "short_tertiary", "bachelor", "graduate"],
        "facets": facet_meta(),
    })
    write_region_summary(OUT_DIR)


if __name__ == "__main__":
    fetch()
    build()
