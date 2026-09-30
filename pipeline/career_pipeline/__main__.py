"""Rebuild all published data: `uv run python -m career_pipeline [fx|prices|tax|jp|us|uk|ca|eu|occupations ...]`."""

import sys

from . import ca_census, cost_of_living, eu_ses, fx_ppp, jp_wage_census, occupations, tax_tables, uk_ashe, us_acs_pums

STEPS = {
    "fx": [fx_ppp.build],
    "prices": [cost_of_living.fetch, cost_of_living.build],
    "tax": [tax_tables.build],
    "jp": [jp_wage_census.fetch, jp_wage_census.build],
    "us": [us_acs_pums.fetch, us_acs_pums.build],
    "uk": [uk_ashe.fetch, uk_ashe.build],
    "ca": [ca_census.fetch, ca_census.build],
    "eu": [eu_ses.fetch, eu_ses.build],
    # after all countries: validates codes against every meta.json
    "occupations": [occupations.build],
}

for name in sys.argv[1:] or list(STEPS):
    print(f"== {name}")
    for step in STEPS[name]:
        step()
