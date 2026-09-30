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
from . import us_metros
from .microdata import build_cells, build_facets

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

STATES_JA = {'01': 'アラバマ州', '02': 'アラスカ州', '04': 'アリゾナ州', '05': 'アーカンソー州', '06': 'カリフォルニア州', '08': 'コロラド州', '09': 'コネチカット州', '10': 'デラウェア州', '11': 'ワシントンD.C.', '12': 'フロリダ州', '13': 'ジョージア州', '15': 'ハワイ州', '16': 'アイダホ州', '17': 'イリノイ州', '18': 'インディアナ州', '19': 'アイオワ州', '20': 'カンザス州', '21': 'ケンタッキー州', '22': 'ルイジアナ州', '23': 'メイン州', '24': 'メリーランド州', '25': 'マサチューセッツ州', '26': 'ミシガン州', '27': 'ミネソタ州', '28': 'ミシシッピ州', '29': 'ミズーリ州', '30': 'モンタナ州', '31': 'ネブラスカ州', '32': 'ネバダ州', '33': 'ニューハンプシャー州', '34': 'ニュージャージー州', '35': 'ニューメキシコ州', '36': 'ニューヨーク州', '37': 'ノースカロライナ州', '38': 'ノースダコタ州', '39': 'オハイオ州', '40': 'オクラホマ州', '41': 'オレゴン州', '42': 'ペンシルベニア州', '44': 'ロードアイランド州', '45': 'サウスカロライナ州', '46': 'サウスダコタ州', '47': 'テネシー州', '48': 'テキサス州', '49': 'ユタ州', '50': 'バーモント州', '51': 'バージニア州', '53': 'ワシントン州', '54': 'ウェストバージニア州', '55': 'ウィスコンシン州', '56': 'ワイオミング州'}

# Metropolitan areas published as regions: the largest by number of full-time employees in the sample
N_METROS = 30
METRO_JA = {
    "35620": "ニューヨーク都市圏", "31080": "ロサンゼルス都市圏", "16980": "シカゴ都市圏", "19100": "ダラス・フォートワース都市圏",
    "26420": "ヒューストン都市圏", "47900": "ワシントンD.C.都市圏", "33100": "マイアミ都市圏", "37980": "フィラデルフィア都市圏",
    "12060": "アトランタ都市圏", "38060": "フェニックス都市圏", "14460": "ボストン都市圏", "40140": "リバーサイド都市圏",
    "41860": "サンフランシスコ都市圏", "19820": "デトロイト都市圏", "42660": "シアトル都市圏", "33460": "ミネアポリス都市圏",
    "41740": "サンディエゴ都市圏", "45300": "タンパ都市圏", "19740": "デンバー都市圏", "12580": "ボルチモア都市圏",
    "41180": "セントルイス都市圏", "36740": "オーランド都市圏", "16740": "シャーロット都市圏", "41700": "サンアントニオ都市圏",
    "38900": "ポートランド都市圏", "40900": "サクラメント都市圏", "38300": "ピッツバーグ都市圏", "12420": "オースティン都市圏",
    "29820": "ラスベガス都市圏", "17140": "シンシナティ都市圏", "41940": "サンノゼ（シリコンバレー）都市圏", "18140": "コロンバス都市圏",
    "28140": "カンザスシティ都市圏", "26900": "インディアナポリス都市圏", "34980": "ナッシュビル都市圏", "39580": "ローリー都市圏", "17410": "クリーブランド都市圏",
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
    us_metros.build()
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


LABELS_DIR = Path(__file__).parent / "labels"
INDUSTRIES = json.loads((LABELS_DIR / "us_industries.json").read_text())
FIELDS = json.loads((LABELS_DIR / "us_fields_of_study.json").read_text())
OCC_JA = json.loads((LABELS_DIR / "us_occupations_ja.json").read_text())

CITIZENSHIP = {
    "native": ("Born a US citizen", "米国生まれ・出生時から市民"),
    "naturalized": ("Naturalized citizen", "帰化した市民"),
    "noncitizen": ("Not a US citizen", "米国籍なし"),
}
ENGLISH = {
    "only_english": ("Speaks only English at home", "家庭では英語のみ"),
    "very_well": ("Other language at home; English very well", "他言語話者・英語はとても上手"),
    "well": ("English well", "英語は上手"),
    "not_well": ("English not well", "英語はあまり話せない"),
    "not_at_all": ("No English", "英語は話せない"),
}
EMPLOYMENT = {
    "employee": ("Employee", "雇用者"),
    "self_employed": ("Self-employed / own business", "自営業・経営者"),
}


def load_workers() -> pl.DataFrame:
    """Full-time, year-round civilian workers aged 18-69: employees (wages) and the self-employed (earnings).

    Main cells use employees only; the `employment` facet compares the two groups.
    """
    cols = ["STATE", "PUMA", "PWGTP", "AGEP", "SEX", "SCHL", "SOCP", "ESR", "WKHP", "WKWN", "WAGP", "PERNP", "ADJINC",
            "COW", "NAICSP", "FOD1P", "CIT", "ENG", "LANX"]
    ints = ["PWGTP", "AGEP", "SEX", "SCHL", "ESR", "WKHP", "WKWN", "WAGP", "PERNP", "ADJINC", "COW", "CIT", "ENG", "LANX"]
    lf = pl.concat(
        [
            pl.scan_csv(p, infer_schema_length=0).select(cols)
            for p in sorted(US_RAW.glob("psam_pus*.csv"))
        ]
    )
    sector = {code: v["sector"] for code, v in INDUSTRIES["industries"].items()}
    field_group = {code: v["group"] for code, v in FIELDS.items() if not code.startswith("_")}
    self_employed = pl.col("COW").is_in([6, 7])
    return (
        lf.with_columns(pl.col(c).cast(pl.Int64) for c in ints)
        .filter(
            pl.col("ESR").is_in([1, 2])
            & (pl.col("WKHP") >= 35)
            & (pl.col("WKWN") >= 50)
            & pl.col("AGEP").is_between(18, 69)
            & pl.col("SOCP").is_not_null()
            & pl.when(self_employed).then(pl.col("PERNP") > 0).otherwise(pl.col("WAGP") > 0)
        )
        .with_columns(
            wage=pl.when(self_employed).then(pl.col("PERNP")).otherwise(pl.col("WAGP")) * pl.col("ADJINC") / 1_000_000,
            w=pl.col("PWGTP").cast(pl.Float64),
            region=pl.col("STATE").str.zfill(2),
            puma=pl.col("PUMA").str.zfill(5),
            occ=pl.col("SOCP").str.strip_chars(),
            occ_major=pl.col("SOCP").str.slice(0, 2),
            age=age_band_expr(pl.col("AGEP")),
            sex=pl.when(pl.col("SEX") == 1).then(pl.lit("M")).otherwise(pl.lit("F")),
            edu=edu_expr(),
            employment=pl.when(self_employed).then(pl.lit("self_employed")).otherwise(pl.lit("employee")),
            industry=pl.col("NAICSP").str.strip_chars().replace_strict(sector, default=None),
            field=pl.col("FOD1P").str.strip_chars().replace_strict(field_group, default=None),
            citizenship=pl.col("CIT").replace_strict({1: "native", 2: "native", 3: "native", 4: "naturalized", 5: "noncitizen"}, default=None, return_dtype=pl.Utf8),
            english=pl.when(pl.col("LANX") == 2).then(pl.lit("only_english")).otherwise(
                pl.col("ENG").replace_strict({1: "very_well", 2: "well", 3: "not_well", 4: "not_at_all"}, default=None, return_dtype=pl.Utf8)
            ),
        )
        .select("wage", "w", "region", "puma", "occ", "occ_major", "age", "sex", "edu",
                "employment", "industry", "field", "citizenship", "english")
        .collect()
    )


def facet_meta() -> dict:
    fields_groups = FIELDS["_groups"]
    return {
        "industry": {"label": {"en": "Industry", "ja": "業界"},
                     "values": [{"code": k, "label": v} for k, v in INDUSTRIES["sectors"].items()]},
        "field": {"label": {"en": "Field of study (degree holders)", "ja": "専攻（学位保有者）"},
                  "values": [{"code": k, "label": v} for k, v in fields_groups.items()]},
        "citizenship": {"label": {"en": "Citizenship", "ja": "国籍"},
                        "values": [{"code": k, "label": {"en": en, "ja": ja}} for k, (en, ja) in CITIZENSHIP.items()]},
        "english": {"label": {"en": "English", "ja": "英語力"},
                    "values": [{"code": k, "label": {"en": en, "ja": ja}} for k, (en, ja) in ENGLISH.items()]},
        "employment": {"label": {"en": "Type of work", "ja": "働き方"},
                       "values": [{"code": k, "label": {"en": en, "ja": ja}} for k, (en, ja) in EMPLOYMENT.items()]},
    }


def occupation_labels() -> list[dict]:
    items = json.loads((US_RAW / f"variables_{YEAR}.json").read_text())["variables"]["SOCP"]["values"]["item"]
    occs = []
    for code, label in sorted(items.items()):
        if not code[:2].isdigit():
            continue
        name = label.split("-", 1)[1] if "-" in label[:5] else label
        occs.append({"code": code, "major": code[:2], "label": {"en": name, **({"ja": OCC_JA[code]} if code in OCC_JA else {})}})
    return occs


def build() -> None:
    everyone = load_workers()
    df = everyone.filter(pl.col("employment") == "employee")
    print(f"US workers: {df.height:,} employees (+{everyone.height - df.height:,} self-employed), weighted {df['w'].sum():,.0f}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    write_json(OUT_DIR / "national.json", build_cells(df))
    facets = build_facets(df, ["industry", "field", "citizenship", "english"])
    facets.update(build_facets(everyone, ["employment"]))
    write_json(OUT_DIR / "facets.json", facets)
    for f in OUT_DIR.glob("region-*.json"):
        f.unlink()
    for fips in STATES:
        cells = build_cells(df.filter(pl.col("region") == fips))
        write_json(OUT_DIR / f"region-{fips}.json", cells)

    # Metropolitan areas: a PUMA belongs to the CBSA holding at least half of its population
    crosswalk = json.loads(us_metros.OUT.read_text())
    metro_of = {k: v[0] for k, v in crosswalk.items() if v[2] >= 0.5}
    titles = {v[0]: v[1] for v in crosswalk.values()}
    df = df.with_columns(metro=(pl.col("region") + "-" + pl.col("puma")).replace_strict(metro_of, default=None))
    top = (df.filter(pl.col("metro").is_not_null()).group_by("metro").agg(pl.len().alias("n"), pl.col("region").mode().first().alias("state"))
           .sort("n", descending=True).head(N_METROS))
    metros = []
    for row in top.iter_rows(named=True):
        code = row["metro"]
        write_json(OUT_DIR / f"region-CBSA{code}.json", build_cells(df.filter(pl.col("metro") == code)))
        en = titles[code].split(",")[0].split("-")[0] + " metro area"
        metros.append({"code": f"CBSA{code}", "abbr": STATES[row["state"]][0], "kind": "metro",
                       "label": {"en": en, "ja": METRO_JA.get(code, en)}})

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
        "regions": [{"code": k, "abbr": a, "label": {"en": n, "ja": STATES_JA[k]}} for k, (a, n) in STATES.items()] + metros,
        "occupationMajor": [{"code": f"M{k}", "label": {"en": en, "ja": ja}} for k, (en, ja) in SOC_MAJOR.items()],
        "occupations": occupation_labels(),
        "ages": AGE_BANDS,
        "educations": ["secondary", "short_tertiary", "bachelor", "graduate"],
        "facets": facet_meta(),
    }
    write_json(OUT_DIR / "meta.json", meta)
    write_region_summary(OUT_DIR)


if __name__ == "__main__":
    fetch()
    build()
