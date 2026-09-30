"""Shared aggregation of person-level microdata (US ACS PUMS, Canada Census PUMF) into cells.

Input frame columns: wage, w (person weight), occ (detailed code), occ_major, age, sex, edu, region.
"""

from __future__ import annotations

import itertools

import polars as pl

from .common import MIN_N, QUANTILES


def weighted_cells(df: pl.DataFrame, keys: list[str]) -> pl.DataFrame:
    """Weighted mean and quantiles of wage per group of `keys`."""
    wage_sorted = pl.col("wage").sort_by("wage")
    cw = pl.col("w").sort_by("wage").cum_sum() / pl.col("w").sum()
    aggs = [
        pl.len().alias("n"),
        pl.col("w").sum().alias("pop"),
        ((pl.col("wage") * pl.col("w")).sum() / pl.col("w").sum()).alias("mean"),
    ] + [wage_sorted.filter(cw >= q).first().alias(f"p{int(q * 100)}") for q in QUANTILES]
    g = df.group_by(keys).agg(aggs) if keys else df.select(aggs)
    return g.filter(pl.col("n") >= MIN_N)


# Dimensions in the cell key, in this fixed order. `occ` is either detailed SOC or major group.
KEY_DIMS = ["occ", "age", "sex", "edu"]


def build_cells(df: pl.DataFrame) -> dict[str, list]:
    """All subsets of KEY_DIMS, with occ at both detail and major-group level.

    Returns {key: [n, mean, p10, p25, p50, p75, p90, method, pop]}, key = "occ|age|sex|edu" with "*" = all;
    n is the unweighted sample size, method 0 (direct), pop the weighted population estimate.
    """
    out: dict[str, list] = {}
    for r in range(len(KEY_DIMS) + 1):
        for subset in itertools.combinations(KEY_DIMS, r):
            occ_levels = ["occ", "occ_major"] if "occ" in subset else [None]
            for occ_col in occ_levels:
                cols = [occ_col if d == "occ" else d for d in subset]
                cells = weighted_cells(df, cols)
                for row in cells.iter_rows(named=True):
                    key = "|".join(
                        (f"M{row['occ_major']}" if occ_col == "occ_major" else row["occ"])
                        if d == "occ" and d in subset
                        else (row[d] if d in subset else "*")
                        for d in KEY_DIMS
                    )
                    out[key] = (
                        [row["n"], int(round(row["mean"], -2))]
                        + [int(round(row[f"p{int(q * 100)}"], -2)) for q in QUANTILES]
                        + [0, int(round(row["pop"], -2))]
                    )
    return out


# Profile dimensions a facet cell may also condition on (occupation only at major-group level)
FACET_KEY_DIMS = ["occ_major", "age", "sex"]


def build_facets(df: pl.DataFrame, facets: list[str]) -> dict[str, list]:
    """Cells for extra dimensions ("facets" such as industry or citizenship).

    Key: "<facet>=<value>|<occ major or *>|<age or *>|<sex or *>", same cell layout as build_cells.
    Rows with a null facet value are left out of that facet.
    """
    out: dict[str, list] = {}
    for facet in facets:
        sub = df.filter(pl.col(facet).is_not_null())
        for r in range(len(FACET_KEY_DIMS) + 1):
            for subset in itertools.combinations(FACET_KEY_DIMS, r):
                for row in weighted_cells(sub, [facet, *subset]).iter_rows(named=True):
                    occ = f"M{row['occ_major']}" if "occ_major" in subset else "*"
                    age = row["age"] if "age" in subset else "*"
                    sex = row["sex"] if "sex" in subset else "*"
                    out[f"{facet}={row[facet]}|{occ}|{age}|{sex}"] = (
                        [row["n"], int(round(row["mean"], -2))]
                        + [int(round(row[f"p{int(q * 100)}"], -2)) for q in QUANTILES]
                        + [0, int(round(row["pop"], -2))]
                    )
    return out
