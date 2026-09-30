"""Shared constants and helpers for all country pipelines."""

from __future__ import annotations

import json
from pathlib import Path

import polars as pl

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"
WEB_DATA_DIR = ROOT / "web" / "public" / "data"

# Quantiles shipped for every cell: p10, p25, p50, p75, p90
QUANTILES = [0.10, 0.25, 0.50, 0.75, 0.90]

# Cells with fewer unweighted records than this are not published
MIN_N = 30

# 5-year age bands aligned with Japan's Wage Census (年齢階級)
AGE_BANDS = ["18-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59", "60-64", "65-69"]


def age_band_expr(age: pl.Expr) -> pl.Expr:
    expr = pl.when(age < 20).then(pl.lit("18-19"))
    for band in AGE_BANDS[1:]:
        lo, hi = (int(x) for x in band.split("-"))
        expr = expr.when(age <= hi).then(pl.lit(band))
    return expr.otherwise(pl.lit(None))


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1024:,.0f} KB)")


def write_region_summary(country_dir: Path, max_dims: int = 2) -> None:
    """Bundle every region's cells for the map into one file: occupation at major-group level
    or unspecified, and at most `max_dims` conditioned dimensions (keeps the file small)."""
    out = {}
    for f in sorted(country_dir.glob("region-*.json")):
        code = f.stem.removeprefix("region-")
        if code.startswith(("CBSA", "CMA")):
            continue  # metropolitan areas are not drawn on the tile map
        cells = json.loads(f.read_text())
        out[code] = {
            k: v
            for k, v in cells.items()
            if (k.startswith("*") or k.startswith("M")) and sum(p != "*" for p in k.split("|")) <= max_dims
        }
    write_json(country_dir / "regions.json", out)


def write_national(country_dir: Path, cells: dict, major_of) -> None:
    """Write national cells split for lazy loading: national.json holds cells for all occupations and
    major groups ("*" / "M…"); occ-<major>.json holds the detailed occupations of one major group.
    `major_of(code)` returns the major-group code (without "M") of a detailed occupation code."""
    core: dict = {}
    detail: dict[str, dict] = {}
    for key, cell in cells.items():
        occ = key.split("|", 1)[0]
        if occ == "*" or occ.startswith("M"):
            core[key] = cell
        else:
            detail.setdefault(major_of(occ), {})[key] = cell
    for f in country_dir.glob("occ-*.json"):
        f.unlink()
    write_json(country_dir / "national.json", core)
    for major, part in sorted(detail.items()):
        write_json(country_dir / f"occ-{major}.json", part)
