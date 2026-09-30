"""Validate the hand-compiled US state income tax table and publish it for the web app.

Input:  labels/us_state_tax_2025.json (single filer, wages only; see its _source and _notes)
Output: web/public/data/us/tax.json
"""

from __future__ import annotations

import json
from pathlib import Path

from .common import WEB_DATA_DIR, write_json
from .us_acs_pums import STATES

SOURCE = Path(__file__).parent / "labels" / "us_state_tax_2025.json"
CA_SOURCE = Path(__file__).parent / "labels" / "ca_tax_2025.json"
CA_PROVINCES = {"NL", "PE", "NS", "NB", "QC", "ON", "MB", "SK", "AB", "BC", "YT", "NT", "NU"}
CA_FIELDS = ("brackets", "basicPersonalAmount", "creditRate", "surtax", "healthPremiumSegments", "bpaFollowsFederal", "canadaEmploymentAmount")
FIELDS = (
    "brackets", "standardDeduction", "personalExemption", "personalCredit",
    "deductionPhaseout", "exemptionPhaseout", "creditPhaseout",
)


def build() -> None:
    table = json.loads(SOURCE.read_text())
    states = table["states"]
    expected = {abbr for abbr, _ in STATES.values()}
    missing = expected - states.keys()
    assert not missing, f"missing states: {sorted(missing)}"
    for abbr, st in states.items():
        thresholds = [lo for lo, _ in st["brackets"]]
        assert thresholds == sorted(thresholds), f"{abbr}: brackets not ascending"
        assert not thresholds or thresholds[0] == 0, f"{abbr}: first bracket must start at 0"
        assert all(0 <= rate < 0.2 for _, rate in st["brackets"]), f"{abbr}: implausible rate"
        for k in ("standardDeduction", "personalExemption", "personalCredit"):
            assert st.get(k, 0) >= 0, f"{abbr}: negative {k}"
    out = {
        "_year": table["_year"],
        "_source": table["_source"],
        "states": {
            abbr: {k: st[k] for k in FIELDS if k in st}
            for abbr, st in sorted(states.items())
        },
    }
    write_json(WEB_DATA_DIR / "us" / "tax.json", out)
    build_ca()


def build_ca() -> None:
    table = json.loads(CA_SOURCE.read_text())
    provinces = table["provinces"]
    assert set(provinces) == CA_PROVINCES, sorted(set(provinces) ^ CA_PROVINCES)
    for code, p in [("federal", table["federal"]), *provinces.items()]:
        thresholds = [lo for lo, _ in p["brackets"]]
        assert thresholds == sorted(thresholds) and thresholds[0] == 0, f"{code}: bad brackets"
        assert all(0 < rate < 0.4 for _, rate in p["brackets"]), f"{code}: implausible rate"
    write_json(WEB_DATA_DIR / "ca" / "tax.json", {
        "_year": table["_year"],
        "_source": table["_source"],
        "federal": {k: table["federal"][k] for k in ("brackets", "basicPersonalAmount", "creditRate", "canadaEmploymentAmount", "quebecAbatement")},
        "payroll": {
            name: {k: v for k, v in item.items() if k != "notes"} for name, item in table["payroll"].items()
        },
        "provinces": {code: {k: p[k] for k in CA_FIELDS if k in p} for code, p in sorted(provinces.items())},
    })

if __name__ == "__main__":
    build()
