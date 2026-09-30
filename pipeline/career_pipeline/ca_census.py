"""Canada: 2021 Census of Population Public Use Microdata File (individuals) → wage-distribution cells.

Input (data/raw/ca/): cen21_ind_98m0001x_part_rec21.zip
  https://www150.statcan.gc.ca/n1/pub/98m0001x/2023001/cen21_ind_98m0001x_part_rec21.zip
  (Statistics Canada Open Licence, no registration)

Wages refer to calendar year 2020 (from tax records). Occupation is the NOC 2021 variable of the
public file, which has only 26 groups.
"""

from __future__ import annotations

import zipfile

import polars as pl
import requests

from .common import AGE_BANDS, RAW_DIR, WEB_DATA_DIR, write_json, write_region_summary
from .microdata import build_cells

INCOME_YEAR = 2020
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
# AGEGRP 7 = 18-19, 8 = 20-24, …, 17 = 65-69
AGEGRP = {7 + i: band for i, band in enumerate(AGE_BANDS)}


def fetch() -> None:
    CA_RAW.mkdir(parents=True, exist_ok=True)
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


def edu_expr() -> pl.Expr:
    h = pl.col("HDGREE")
    return (
        pl.when(h <= 2).then(pl.lit("secondary"))
        .when(h <= 8).then(pl.lit("short_tertiary"))
        .when(h == 9).then(pl.lit("bachelor"))
        .otherwise(pl.lit("graduate"))
    )


def load_workers() -> pl.DataFrame:
    """Full-year (49-52 weeks), mainly full-time employees aged 18-69 with positive wages."""
    cols = ["PR", "WEIGHT", "AGEGRP", "Gender", "HDGREE", "NOC21", "COW", "FPTWK", "WKSWRK", "Wages"]
    return (
        pl.scan_csv(CA_RAW / CSV, infer_schema_length=0)
        .select(cols)
        .with_columns(pl.col(c).cast(pl.Float64) for c in cols)
        .filter(
            (pl.col("COW") == 1)
            & (pl.col("FPTWK") == 1)
            & (pl.col("WKSWRK") == 6)
            & (pl.col("Wages") > 0)
            & (pl.col("Wages") < 88_888_888)
            & pl.col("AGEGRP").is_between(7, 17)
            & pl.col("NOC21").is_between(1, 26)
            & pl.col("HDGREE").is_between(1, 13)
        )
        .with_columns(
            wage=pl.col("Wages"),
            w=pl.col("WEIGHT"),
            region=pl.col("PR").cast(pl.Int64).cast(pl.Utf8),
            occ=pl.format("N{}", pl.col("NOC21").cast(pl.Int64).cast(pl.Utf8).str.zfill(2)),
            occ_major=pl.col("NOC21").cast(pl.Int64).replace_strict({k: v[0] for k, v in NOC.items()}, return_dtype=pl.Utf8),
            age=pl.col("AGEGRP").cast(pl.Int64).replace_strict(AGEGRP, return_dtype=pl.Utf8),
            sex=pl.when(pl.col("Gender") == 1).then(pl.lit("F")).otherwise(pl.lit("M")),
            edu=edu_expr(),
        )
        .select("wage", "w", "region", "occ", "occ_major", "age", "sex", "edu")
        .collect()
    )


def build() -> None:
    df = load_workers()
    print(f"CA workers: {df.height:,} records, weighted {df['w'].sum():,.0f}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUT_DIR / "national.json", build_cells(df))
    for pr in PROVINCES:
        write_json(OUT_DIR / f"region-{pr}.json", build_cells(df.filter(pl.col("region") == pr)))
    write_json(OUT_DIR / "meta.json", {
        "country": "CA",
        "currency": "CAD",
        "year": INCOME_YEAR,
        "wageDefinition": {
            "en": f"Wages and salaries in {INCOME_YEAR} (from tax records). Employees who worked mainly full-time for 49-52 weeks, aged 18-69.",
            "ja": f"{INCOME_YEAR}年の賃金・給与（税務記録による）。主にフルタイムで49〜52週働いた18〜69歳の被用者。",
        },
        "method": "direct",
        "source": {
            "id": "cen2021",
            "name": {"en": "Statistics Canada, 2021 Census Public Use Microdata File (individuals)",
                     "ja": "カナダ統計局 2021年国勢調査 個票（PUMF）"},
            "url": "https://www150.statcan.gc.ca/n1/pub/98m0001x/index-eng.htm",
        },
        "regions": [{"code": k, "abbr": a, "label": {"en": en, "ja": ja}} for k, (a, en, ja) in PROVINCES.items()],
        "occupationMajor": [{"code": f"M{k}", "label": {"en": en, "ja": ja}} for k, (en, ja) in NOC_MAJOR.items()],
        "occupations": [
            {"code": f"N{k:02d}", "major": m, "label": {"en": en, "ja": ja}} for k, (m, en, ja) in NOC.items()
        ],
        "ages": AGE_BANDS,
        "educations": ["secondary", "short_tertiary", "bachelor", "graduate"],
    })
    write_region_summary(OUT_DIR)


if __name__ == "__main__":
    fetch()
    build()
