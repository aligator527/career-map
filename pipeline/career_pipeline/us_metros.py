"""US metropolitan areas: map 2020 PUMAs (as in ACS PUMS 2022+) to CBSAs (2023 delineation).

There is no official PUMA–CBSA file, so it is built from official pieces:
  tract → PUMA (2020 relationship file), tract population (2020 centers of population),
  county → CBSA (OMB July 2023 delineation).
Each PUMA gets the CBSA holding most of its population, with that share; the ACS pipeline only
assigns a PUMA to a metro when the share is at least 0.5. (Connecticut's 2023 planning regions do
not match 2020 county codes; no large CT metro is published, so CT is left unassigned.)

Output: data/raw/us/puma_cbsa.json  {"SS-PPPPP": [cbsa, title, share]}
"""

from __future__ import annotations

import csv
import io
import json
from collections import defaultdict

import openpyxl
import requests

from .common import RAW_DIR

US_RAW = RAW_DIR / "us"
OUT = US_RAW / "puma_cbsa.json"
TRACT_PUMA = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/2020_Census_Tract_to_2020_PUMA.txt"
TRACT_POP = "https://www2.census.gov/geo/docs/reference/cenpop2020/tract/CenPop2020_Mean_TR.txt"
DELINEATION = "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx"
HEADERS = {"User-Agent": "Mozilla/5.0 (career-map data pipeline)"}


def _get(url: str) -> bytes:
    r = requests.get(url, headers=HEADERS, timeout=120)
    r.raise_for_status()
    return r.content


def build() -> None:
    if OUT.exists():
        return
    tracts = csv.DictReader(io.StringIO(_get(TRACT_PUMA).decode("utf-8-sig")))
    puma_of = {(t["STATEFP"], t["COUNTYFP"], t["TRACTCE"]): t["PUMA5CE"] for t in tracts}
    pops = csv.DictReader(io.StringIO(_get(TRACT_POP).decode("utf-8-sig")))
    pop_of = {(p["STATEFP"], p["COUNTYFP"], p["TRACTCE"]): int(p["POPULATION"]) for p in pops}

    wb = openpyxl.load_workbook(io.BytesIO(_get(DELINEATION)), read_only=True, data_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    header = [str(h).strip() if h else "" for h in rows[2]]
    col = {name: header.index(name) for name in ("CBSA Code", "CBSA Title", "Metropolitan/Micropolitan Statistical Area", "FIPS State Code", "FIPS County Code")}
    cbsa_of: dict[tuple[str, str], tuple[str, str]] = {}
    for r in rows[3:]:
        if not r[col["CBSA Code"]] or "Metropolitan" not in str(r[col["Metropolitan/Micropolitan Statistical Area"]]):
            continue
        key = (str(r[col["FIPS State Code"]]).zfill(2), str(r[col["FIPS County Code"]]).zfill(3))
        cbsa_of[key] = (str(r[col["CBSA Code"]]), str(r[col["CBSA Title"]]))

    by_puma: dict[str, dict[tuple[str, str], int]] = defaultdict(lambda: defaultdict(int))
    for (st, co, tr), puma in puma_of.items():
        cbsa = cbsa_of.get((st, co), ("", ""))
        by_puma[f"{st}-{puma}"][cbsa] += pop_of.get((st, co, tr), 0)
    out = {}
    for key, parts in by_puma.items():
        total = sum(parts.values())
        (code, title), pop = max(parts.items(), key=lambda kv: kv[1])
        if code and total:
            out[key] = [code, title, round(pop / total, 3)]
    OUT.write_text(json.dumps(out))
    print(f"  {len(out)} PUMAs mapped to metropolitan areas")


if __name__ == "__main__":
    build()
