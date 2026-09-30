"""US: job mobility from the CPS Annual Social and Economic Supplement (ASEC), 2024 + 2025 pooled.

Input (data/raw/us/cps/): asecpub{24,25}csv.zip from
  https://www2.census.gov/programs-surveys/cps/datasets/{year}/march/asecpub{yy}csv.zip  (no key)

Output: web/public/data/us/mobility.json
  {"occ|age|sex|edu": [n, multiEmployer, occupationChange, medianOneEmployer, medianMultiEmployer]}
  multiEmployer     share of full-year workers who had 2+ employers during the previous calendar year
  occupationChange  share of currently employed whose major occupation group differs from last year's longest job
  median*           weighted median wage and salary income of full-year workers with 1 / 2+ employers
Cross-sectional: shares compare groups; they are not the effect of changing jobs.
"""

from __future__ import annotations

import itertools
import zipfile

import polars as pl
import requests

from .common import RAW_DIR, WEB_DATA_DIR, write_json

YEARS = {2024: "24", 2025: "25"}
CPS_RAW = RAW_DIR / "us" / "cps"
URL = "https://www2.census.gov/programs-surveys/cps/datasets/{year}/march/asecpub{yy}csv.zip"
MIN_N = 100
AGES = [("18-24", 18, 24), ("25-34", 25, 34), ("35-44", 35, 44), ("45-54", 45, 54), ("55-64", 55, 64)]
# ASEC 23 major occupation groups (A_DTOCC / WEMOCG) in SOC order → SOC 2018 major group
SOC_MAJOR = ["11", "13", "15", "17", "19", "21", "23", "25", "27", "29", "31", "33", "35", "37", "39",
             "41", "43", "45", "47", "49", "51", "53", "55"]
COLS = ["A_AGE", "A_SEX", "A_HGA", "MARSUPWT", "WKSWORK", "PHMEMPRS", "I_PHMEMP", "WSAL_VAL",
        "A_LFSR", "A_DTOCC", "WEMOCG", "I_OCCUP", "FL_665"]


def fetch() -> None:
    CPS_RAW.mkdir(parents=True, exist_ok=True)
    for year, yy in YEARS.items():
        path = CPS_RAW / f"asecpub{yy}csv.zip"
        if not path.exists():
            print(f"downloading ASEC {year} (~150MB)")
            with requests.get(URL.format(year=year, yy=yy), stream=True, timeout=120) as r:
                r.raise_for_status()
                with open(path, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)


def load() -> pl.DataFrame:
    frames = []
    for yy in YEARS.values():
        with zipfile.ZipFile(CPS_RAW / f"asecpub{yy}csv.zip") as z:
            (name,) = [n for n in z.namelist() if n.endswith(f"pppub{yy}.csv")]
            frames.append(pl.read_csv(z.read(name), columns=COLS, infer_schema_length=0))
    df = pl.concat(frames).with_columns(pl.col(c).cast(pl.Float64) for c in COLS)
    age = pl.col("A_AGE")
    age_expr = pl.when(False).then(pl.lit(None, dtype=pl.Utf8))
    for band, lo, hi in AGES:
        age_expr = age_expr.when(age.is_between(lo, hi)).then(pl.lit(band))
    hga = pl.col("A_HGA")
    return df.with_columns(
        w=pl.col("MARSUPWT") / len(YEARS),  # pooled years: halve weights so totals stay annual
        age=age_expr,
        sex=pl.when(pl.col("A_SEX") == 1).then(pl.lit("M")).otherwise(pl.lit("F")),
        edu=pl.when(hga <= 39).then(pl.lit("secondary")).when(hga <= 42).then(pl.lit("short_tertiary"))
        .when(hga == 43).then(pl.lit("bachelor")).otherwise(pl.lit("graduate")),
        occ=pl.col("WEMOCG").cast(pl.Int64).map_elements(
            lambda g: f"M{SOC_MAJOR[g - 1]}" if 1 <= g <= 23 else None, return_dtype=pl.Utf8
        ),
    ).filter(pl.col("age").is_not_null() & pl.col("occ").is_not_null())


def weighted_median(values: pl.Expr, weights: pl.Expr) -> pl.Expr:
    order = values.arg_sort()
    v, w = values.gather(order), weights.gather(order)
    return v.filter(w.cum_sum() >= w.sum() / 2).first()


def build() -> None:
    df = load()
    full_year = df.filter((pl.col("WKSWORK") >= 50) & (pl.col("I_PHMEMP") != 9) & pl.col("PHMEMPRS").is_between(1, 3))
    employed = df.filter(
        pl.col("A_LFSR").is_in([1, 2]) & (pl.col("I_OCCUP") == 0) & (pl.col("FL_665") == 1) & pl.col("A_DTOCC").is_between(1, 23)
    ).with_columns(changed=(pl.col("A_DTOCC") != pl.col("WEMOCG")).cast(pl.Float64))
    print(f"CPS ASEC pooled: {full_year.height:,} full-year workers, {employed.height:,} employed with reported occupation")

    dims = ["occ", "age", "sex", "edu"]
    out: dict[str, list] = {}
    for r in range(len(dims) + 1):
        for subset in itertools.combinations(dims, r):
            keys = list(subset)
            multi = pl.col("PHMEMPRS") >= 2
            fy = full_year.with_columns(multi=multi.cast(pl.Float64))
            agg_fy = [
                pl.len().alias("n"),
                ((pl.col("multi") * pl.col("w")).sum() / pl.col("w").sum()).alias("multi"),
                weighted_median(pl.col("WSAL_VAL").filter(~multi & (pl.col("WSAL_VAL") > 0)), pl.col("w").filter(~multi & (pl.col("WSAL_VAL") > 0))).alias("med1"),
                weighted_median(pl.col("WSAL_VAL").filter(multi & (pl.col("WSAL_VAL") > 0)), pl.col("w").filter(multi & (pl.col("WSAL_VAL") > 0))).alias("med2"),
                (multi & (pl.col("WSAL_VAL") > 0)).sum().alias("n2"),
            ]
            agg_emp = [((pl.col("changed") * pl.col("w")).sum() / pl.col("w").sum()).alias("change"), pl.len().alias("n_emp")]
            a = fy.group_by(keys).agg(agg_fy) if keys else fy.select(agg_fy)
            b = employed.group_by(keys).agg(agg_emp) if keys else employed.select(agg_emp)
            joined = a.join(b, on=keys, how="left") if keys else a.hstack(b)
            for row in joined.iter_rows(named=True):
                if row["n"] < MIN_N:
                    continue
                key = "|".join(row[d] if d in subset else "*" for d in dims)
                change = row["change"] if (row["n_emp"] or 0) >= MIN_N else None
                med2 = row["med2"] if row["n2"] >= 30 else None
                out[key] = [
                    row["n"], round(row["multi"], 4), None if change is None else round(change, 4),
                    None if row["med1"] is None else int(row["med1"]), None if med2 is None else int(med2),
                ]
    write_json(WEB_DATA_DIR / "us" / "mobility.json", {
        "source": {
            "name": {"en": "U.S. Census Bureau, Current Population Survey ASEC 2024–2025 (pooled)",
                     "ja": "米国国勢調査局 人口動態調査 年次社会経済補足調査（ASEC）2024〜2025年を合算"},
            "url": "https://www.census.gov/data/datasets/time-series/demo/cps/cps-asec.html",
        },
        "ages": [a for a, _, _ in AGES],
        "cells": out,
    })
    print(f"  {len(out)} cells")


if __name__ == "__main__":
    fetch()
    build()
