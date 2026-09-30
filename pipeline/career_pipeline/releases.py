"""Check whether any data source has published an edition newer than the one the site uses.

Run monthly in GitHub Actions (.github/workflows/releases.yml). Prints one line per source and exits
with status 1 when something new is out, so the workflow can open an issue. Each check is a cheap
HTTP request against the URL or listing where the next edition will appear.
"""

from __future__ import annotations

import re
import sys

import requests

from .ca_census import INCOME_YEAR as CA_YEAR
from .eu_ses import YEAR as SES_YEAR
from .us_acs_pums import YEAR as ACS_YEAR
from .us_cps_mobility import YEARS as CPS_YEARS

UA = {"User-Agent": "Mozilla/5.0 (career-map release check)"}
ESTAT = "https://www.e-stat.go.jp/stat-search/files"


def exists(url: str) -> bool:
    try:
        r = requests.head(url, headers=UA, timeout=60, allow_redirects=True)
        if r.status_code == 405:
            r = requests.get(url, headers=UA, timeout=60, stream=True)
        return r.status_code == 200
    except requests.RequestException:
        return False


def estat_has_year(toukei: str, tstat: str, year: int, extra: str = "") -> bool:
    """The e-Stat file listing filtered to a year reports its total as `js-total_resource">N</span>件`."""
    url = f"{ESTAT}?page=1&toukei={toukei}&tstat={tstat}&year={year}0{extra}"
    try:
        html = requests.get(url, headers=UA, timeout=60).text
    except requests.RequestException:
        return False
    m = re.search(r'js-total_resource">(\d+)</span>', html)
    return bool(m and int(m.group(1)) > 0)


def checks() -> list[tuple[str, bool]]:
    next_cps = max(CPS_YEARS) + 1
    return [
        (f"ACS 1-Year PUMS {ACS_YEAR + 1}", exists(f"https://www2.census.gov/programs-surveys/acs/data/pums/{ACS_YEAR + 1}/1-Year/csv_pus.zip")),
        (f"CPS ASEC {next_cps}", exists(f"https://www2.census.gov/programs-surveys/cps/datasets/{next_cps}/march/asecpub{next_cps % 100:02d}csv.zip")),
        ("ONS ASHE 2026 provisional", exists("https://www.ons.gov.uk/file?uri=/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/occupation4digitsoc2010ashetable14/2026provisional/ashetable142026provisional.zip")),
        ("賃金構造基本統計調査 令和8年", estat_has_year("00450091", "000001011429", 2026)),
        ("雇用動向調査 令和8年", estat_has_year("00450073", "000001012468", 2026, "&cycle=7")),
        ("小売物価統計調査（構造編）2026", estat_has_year("00200571", "000001067253", 2026)),
        (f"Eurostat SES {SES_YEAR + 4}", exists(f"https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/earn_ses{(SES_YEAR + 4) % 100}_28?format=JSON&geo=DE")),
        (f"Canada census PUMF {CA_YEAR + 6}", exists(f"https://www150.statcan.gc.ca/n1/en/catalogue/98M0001X{CA_YEAR + 6}001")),
    ]


def main() -> int:
    new = []
    for name, available in checks():
        print(f"{'NEW ' if available else 'same'}  {name}")
        if available:
            new.append(name)
    if new:
        print("\nNew editions available: " + ", ".join(new))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
