"""US: aggregate ACS 1-Year PUMS person records into wage-distribution cells.

Input (data/raw/us/):
  csv_pus_{year}.zip       https://www2.census.gov/programs-surveys/acs/data/pums/{year}/1-Year/csv_pus.zip
  variables_{year}.json    https://api.census.gov/data/{year}/acs/acs1/pums/variables.json (no key needed)

Output (web/public/data/us/):
  national.json            cells with region = "*" (all dimension subsets)
  region-{fips}.json       cells for one state, loaded lazily by the web app
  meta.json                dimension labels and source info
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import polars as pl
import requests

from .common import (
    AGE_BANDS,
    RAW_DIR,
    WEB_DATA_DIR,
    age_band_expr,
    write_json,
    write_region_summary,
)
from .microdata import build_cells

YEAR = 2024
SOURCE_ID = f"acs{YEAR}"
PUMS_URL = f"https://www2.census.gov/programs-surveys/acs/data/pums/{YEAR}/1-Year/csv_pus.zip"
VARS_URL = f"https://api.census.gov/data/{YEAR}/acs/acs1/pums/variables.json"

US_RAW = RAW_DIR / "us"
OUT_DIR = WEB_DATA_DIR / "us"

# State FIPS -> (postal, name)
STATES = {
    "01": ("AL", "Alabama"), "02": ("AK", "Alaska"), "04": ("AZ", "Arizona"),
    "05": ("AR", "Arkansas"), "06": ("CA", "California"), "08": ("CO", "Colorado"),
    "09": ("CT", "Connecticut"), "10": ("DE", "Delaware"), "11": ("DC", "District of Columbia"),
    "12": ("FL", "Florida"), "13": ("GA", "Georgia"), "15": ("HI", "Hawaii"),
    "16": ("ID", "Idaho"), "17": ("IL", "Illinois"), "18": ("IN", "Indiana"),
    "19": ("IA", "Iowa"), "20": ("KS", "Kansas"), "21": ("KY", "Kentucky"),
    "22": ("LA", "Louisiana"), "23": ("ME", "Maine"), "24": ("MD", "Maryland"),
    "25": ("MA", "Massachusetts"), "26": ("MI", "Michigan"), "27": ("MN", "Minnesota"),
    "28": ("MS", "Mississippi"), "29": ("MO", "Missouri"), "30": ("MT", "Montana"),
    "31": ("NE", "Nebraska"), "32": ("NV", "Nevada"), "33": ("NH", "New Hampshire"),
    "34": ("NJ", "New Jersey"), "35": ("NM", "New Mexico"), "36": ("NY", "New York"),
    "37": ("NC", "North Carolina"), "38": ("ND", "North Dakota"), "39": ("OH", "Ohio"),
    "40": ("OK", "Oklahoma"), "41": ("OR", "Oregon"), "42": ("PA", "Pennsylvania"),
    "44": ("RI", "Rhode Island"), "45": ("SC", "South Carolina"), "46": ("SD", "South Dakota"),
    "47": ("TN", "Tennessee"), "48": ("TX", "Texas"), "49": ("UT", "Utah"),
    "50": ("VT", "Vermont"), "51": ("VA", "Virginia"), "53": ("WA", "Washington"),
    "54": ("WV", "West Virginia"), "55": ("WI", "Wisconsin"), "56": ("WY", "Wyoming"),
}

# SOC 2018 major groups (first two digits of SOCP)
SOC_MAJOR = {
    "11": ("Management", "管理職"),
    "13": ("Business and Financial Operations", "ビジネス・財務"),
    "15": ("Computer and Mathematical", "コンピュータ・数理"),
    "17": ("Architecture and Engineering", "建築・エンジニアリング"),
    "19": ("Life, Physical, and Social Science", "生命・物理・社会科学"),
    "21": ("Community and Social Service", "地域・社会サービス"),
    "23": ("Legal", "法務"),
    "25": ("Educational Instruction and Library", "教育・図書館"),
    "27": ("Arts, Design, Entertainment, Sports, and Media", "芸術・デザイン・娯楽・スポーツ・メディア"),
    "29": ("Healthcare Practitioners and Technical", "医療専門職・技術職"),
    "31": ("Healthcare Support", "医療サポート"),
    "33": ("Protective Service", "保安"),
    "35": ("Food Preparation and Serving", "飲食調理・給仕"),
    "37": ("Building and Grounds Cleaning and Maintenance", "建物・敷地の清掃・保守"),
    "39": ("Personal Care and Service", "パーソナルケア・サービス"),
    "41": ("Sales and Related", "販売"),
    "43": ("Office and Administrative Support", "事務・管理サポート"),
    "45": ("Farming, Fishing, and Forestry", "農林漁業"),
    "47": ("Construction and Extraction", "建設・採掘"),
    "49": ("Installation, Maintenance, and Repair", "設置・保守・修理"),
    "51": ("Production", "生産"),
    "53": ("Transportation and Material Moving", "輸送・運搬"),
    "55": ("Military Specific", "軍"),
}

# SCHL -> common education level (shared with JP)
def edu_expr() -> pl.Expr:
    s = pl.col("SCHL")
    return (
        pl.when(s <= 17).then(pl.lit("secondary"))
        .when(s <= 20).then(pl.lit("short_tertiary"))
        .when(s == 21).then(pl.lit("bachelor"))
        .otherwise(pl.lit("graduate"))
    )


def fetch() -> None:
    US_RAW.mkdir(parents=True, exist_ok=True)
    zpath = US_RAW / f"csv_pus_{YEAR}.zip"
    if not zpath.exists():
        print(f"downloading {PUMS_URL} (~600MB)")
        with requests.get(PUMS_URL, stream=True, timeout=60) as r:
            r.raise_for_status()
            with open(zpath, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
    vpath = US_RAW / f"variables_{YEAR}.json"
    if not vpath.exists():
        vpath.write_bytes(requests.get(VARS_URL, timeout=60).content)
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            if name.endswith(".csv") and not (US_RAW / name).exists():
                print(f"extracting {name}")
                z.extract(name, US_RAW)


def load_workers() -> pl.DataFrame:
    """Full-time, year-round civilian wage earners aged 18-69."""
    cols = ["STATE", "PWGTP", "AGEP", "SEX", "SCHL", "SOCP", "ESR", "WKHP", "WKWN", "WAGP", "ADJINC"]
    lf = pl.concat(
        [
            pl.scan_csv(p, schema_overrides={"STATE": pl.Utf8, "SOCP": pl.Utf8, "PUMA": pl.Utf8}, infer_schema_length=0).select(cols)
            for p in sorted(US_RAW.glob("psam_pus*.csv"))
        ]
    )
    return (
        lf.with_columns(pl.col(c).cast(pl.Int64) for c in ["PWGTP", "AGEP", "SEX", "SCHL", "ESR", "WKHP", "WKWN", "WAGP", "ADJINC"])
        .filter(
            pl.col("ESR").is_in([1, 2])
            & (pl.col("WKHP") >= 35)
            & (pl.col("WKWN") >= 50)
            & (pl.col("WAGP") > 0)
            & pl.col("AGEP").is_between(18, 69)
            & pl.col("SOCP").is_not_null()
        )
        .with_columns(
            wage=pl.col("WAGP") * pl.col("ADJINC") / 1_000_000,
            w=pl.col("PWGTP").cast(pl.Float64),
            region=pl.col("STATE").str.zfill(2),
            occ=pl.col("SOCP").str.strip_chars(),
            occ_major=pl.col("SOCP").str.slice(0, 2),
            age=age_band_expr(pl.col("AGEP")),
            sex=pl.when(pl.col("SEX") == 1).then(pl.lit("M")).otherwise(pl.lit("F")),
            edu=edu_expr(),
        )
        .select("wage", "w", "region", "occ", "occ_major", "age", "sex", "edu")
        .collect()
    )


def occupation_labels() -> list[dict]:
    items = json.loads((US_RAW / f"variables_{YEAR}.json").read_text())["variables"]["SOCP"]["values"]["item"]
    occs = []
    for code, label in sorted(items.items()):
        if not code[:2].isdigit():
            continue
        name = label.split("-", 1)[1] if "-" in label[:5] else label
        occs.append({"code": code, "major": code[:2], "label": {"en": name}})
    return occs


def build() -> None:
    df = load_workers()
    print(f"US workers: {df.height:,} records, weighted {df['w'].sum():,.0f}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    write_json(OUT_DIR / "national.json", build_cells(df))
    for fips in STATES:
        cells = build_cells(df.filter(pl.col("region") == fips))
        write_json(OUT_DIR / f"region-{fips}.json", cells)

    meta = {
        "country": "US",
        "currency": "USD",
        "year": YEAR,
        "wageDefinition": {
            "en": "Annual wage or salary income (ACS WAGP, inflation-adjusted with ADJINC). Full-time (35+ h/week), year-round (50+ weeks) civilian employees aged 18-69.",
            "ja": "年間の賃金・給与収入（ACS の WAGP を ADJINC で物価調整）。フルタイム（週35時間以上）かつ通年（50週以上）勤務の18〜69歳の文民就業者。",
        },
        "method": "direct",
        "source": {
            "id": SOURCE_ID,
            "name": {"en": f"U.S. Census Bureau, American Community Survey {YEAR} 1-Year PUMS", "ja": f"米国国勢調査局 アメリカン・コミュニティ・サーベイ {YEAR}年 1年推計 個票（PUMS）"},
            "url": "https://www.census.gov/programs-surveys/acs/microdata.html",
        },
        "regions": [{"code": k, "abbr": a, "label": {"en": n}} for k, (a, n) in STATES.items()],
        "occupationMajor": [{"code": f"M{k}", "label": {"en": en, "ja": ja}} for k, (en, ja) in SOC_MAJOR.items()],
        "occupations": occupation_labels(),
        "ages": AGE_BANDS,
        "educations": ["secondary", "short_tertiary", "bachelor", "graduate"],
    }
    write_json(OUT_DIR / "meta.json", meta)
    write_region_summary(OUT_DIR)


if __name__ == "__main__":
    fetch()
    build()
