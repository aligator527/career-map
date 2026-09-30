"""Invariants of everything published in web/public/data (runs in CI before every deploy).

These catch broken parsers or source-format changes: a new edition that shifts a column or unit
shows up here as disordered quantiles, implausible medians, dangling codes or missing files.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
COUNTRIES = ["jp", "us", "uk", "ca", "de", "fr", "it"]
KEY = re.compile(r"^[A-Za-z0-9*_-]+\|[0-9+*-]+(?:-[0-9]+)?\|[MF*]\|[a-z_*]+$")
FACET_KEY = re.compile(r"^([a-z_]+)=([A-Za-z0-9_+-]+)\|([A-Za-z0-9*]+)\|([0-9+*-]+)\|([MF*])$")
# Plausible national median annual pay of all full-time workers, by currency
MEDIAN_RANGE = {"JPY": (3_000_000, 7_000_000), "USD": (40_000, 90_000), "GBP": (25_000, 55_000),
                "CAD": (45_000, 100_000), "EUR": (20_000, 70_000)}


def load(path: Path):
    return json.loads(path.read_text())


def check_cell(where: str, t: list) -> None:
    assert len(t) >= 7, f"{where}: short cell {t}"
    n, mean, *q = t[:7]
    assert n >= 0 and mean > 0, f"{where}: n/mean {t}"
    assert all(x > 0 for x in q), f"{where}: non-positive quantile {t}"
    assert q == sorted(q), f"{where}: quantiles out of order {q}"
    assert q[0] * 0.5 <= mean <= q[4] * 2, f"{where}: mean {mean} far outside p10..p90 {q}"
    if len(t) >= 8:
        assert t[7] in (0, 1, 2, 3, 4), f"{where}: method {t[7]}"


@pytest.mark.parametrize("country", COUNTRIES)
def test_country_files(country: str):
    d = DATA / country
    meta = load(d / "meta.json")
    national = load(d / "national.json")
    occ_codes = {o["code"] for o in meta["occupations"]} | {m["code"] for m in meta["occupationMajor"]} | {"*"}

    lo, hi = MEDIAN_RANGE[meta["currency"]]
    assert lo <= national["*|*|*|*"][4] <= hi, f"{country}: national median {national['*|*|*|*'][4]}"

    for key, cell in national.items():
        assert KEY.match(key), f"{country}: bad key {key}"
        assert key.split("|")[0] in occ_codes, f"{country}: unknown occupation in {key}"
        check_cell(f"{country}/{key}", cell)

    for region in meta["regions"]:
        path = d / f"region-{region['code']}.json"
        assert path.exists(), f"{country}: missing {path.name}"
        for key, cell in load(path).items():
            check_cell(f"{country}/{region['code']}/{key}", cell)

    facets_path = d / "facets.json"
    if meta.get("facets"):
        values = {dim: {v["code"] for v in f["values"]} for dim, f in meta["facets"].items()}
        for key, cell in load(facets_path).items():
            m = FACET_KEY.match(key)
            assert m, f"{country}: bad facet key {key}"
            assert m.group(2) in values.get(m.group(1), set()), f"{country}: facet value not in meta: {key}"
            check_cell(f"{country}/facets/{key}", cell)


def test_shared_files():
    fx = load(DATA / "fx.json")
    for cur in ("JPY", "USD", "GBP", "CAD", "EUR"):
        assert fx["fx"][cur] > 0 and fx["ppp"][cur] > 0
    roles = load(DATA / "occupations.json")
    assert len(roles) >= 20
    research = load(DATA / "research.json")["effects"]
    assert all(e["source"]["url"].startswith("https://") for e in research)
    visas = load(DATA / "visas.json")
    assert set(visas["countries"]) == {c.upper() for c in COUNTRIES}
    community = load(DATA / "community.json")
    for c in community["countries"].values():
        for cell in c["cells"].values():
            assert cell[0] >= community["kMin"] and cell[0] % community["countStep"] == 0


def test_mobility_files():
    jp = load(DATA / "jp" / "mobility.json")
    for key, row in jp["payChange"].items():
        assert 95 <= sum(row[1:]) <= 105, f"jp payChange {key} shares sum to {sum(row[1:])}"
    for key, cell in jp["ranks"].items():
        assert "none" in cell, key
    us = load(DATA / "us" / "mobility.json")
    for key, (n, multi, change, *_rest) in us["cells"].items():
        assert n >= 100 and 0 <= multi <= 1 and (change is None or 0 <= change <= 1), key
