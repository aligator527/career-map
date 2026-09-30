"""Singapore: Ministry of Manpower (MOM) statistics → wage-distribution cells.

Two MOM sources, both for full-time employed *residents* (citizens and PRs; foreign workers are not
covered):

  Labour Force in Singapore 2025 (Comprehensive Labour Force Survey, June 2025), Section C:
    gross monthly income from employment, *excluding* employer CPF contributions, which MOM defines
    to include 1/12 of annual bonuses. Annual pay = monthly × 12.
      C2   median by occupation major group × sex         C4  median by occupation major group × age
      C8   median by highest qualification × age × sex
      C10  full-time histogram by sex (→ national cells, method 1)
      C12 / C16 / C17  histograms of all employed residents by occupation / age / qualification × sex
      (these include part-timers; they only give each group's distribution *shape*, rescaled so the
      lower tail matches the full-time/all-employed ratio seen nationally in C10 vs C11, and never
      longer than the national full-time lower tail)
    Cells anchored on a published median with a borrowed histogram shape are method 3.
  Section A9 (labour force by qualification × age × sex) weights the "Below secondary" and
    "Secondary" groups when merging them into "lower_secondary".

  Occupational Wages 2025 (Occupational Wage Survey, June 2025): monthly *gross wage* (basic +
    overtime + commissions + allowances) of full-time resident employees in private-sector
    establishments with 25+ employees; bonuses and employer CPF excluded. Annual pay = monthly × 12
    (no bonus uplift). Top occupations heap at exactly S$20,000/month.
      T4   p25 / median / p75 per SSOC 2024 occupation (5-digit)
      T1   median by sex,  T3  median by age band
    p10 / p90 come from a two-piece lognormal through p25 / p50 / p75 (method 2); sex and age cells
    reuse the occupation's spread around their own median (method 2).

Singapore has no regions. There is no occupation × education table.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

import openpyxl
import requests

from .common import RAW_DIR, WEB_DATA_DIR, write_json, write_national

SG_RAW = RAW_DIR / "sg"
OUT_DIR = WEB_DATA_DIR / "sg"
BASE = "https://stats.mom.gov.sg/iMAS_Tables1"
FILES = {
    "ows4": f"{BASE}/Wages/Wages_2025/mrsd_2025Wages_table4.xlsx",
    "ows1": f"{BASE}/Wages/Wages_2025/mrsd_2025Wages_table1.xlsx",
    "ows3": f"{BASE}/Wages/Wages_2025/mrsd_2025Wages_table3.xlsx",
    "lfsA": f"{BASE}/LabourForce/LabourForce_2025/LFR2025_SectionA.xlsx",
    "lfsC": f"{BASE}/LabourForce/LabourForce_2025/LFR2025_SectionC.xlsx",
}
OCC_JA = json.loads((Path(__file__).parent / "labels" / "sg_occupations_ja.json").read_text())

METHOD_HIST, METHOD_LOGNORMAL, METHOD_SHAPE = 1, 2, 3
TARGETS = [0.10, 0.25, 0.50, 0.75, 0.90]
Z = [-1.2815516, -0.6744898, 0.0, 0.6744898, 1.2815516]

# SSOC 2024 major groups; LFS column headers (prefix match) where the LFS publishes the group
MAJORS = {
    "1": ("Managers", "管理職", "Managers & Administrators"),
    "2": ("Professionals", "専門職", "Professionals"),
    "3": ("Associate professionals and technicians", "准専門職・技術者", "Associate Professionals"),
    "4": ("Clerical support workers", "事務職", "Clerical Support"),
    "5": ("Service and sales workers", "サービス・販売職", "Service & Sales"),
    "6": ("Agricultural and fishery workers", "農林漁業職", None),
    "7": ("Craftsmen and related trades workers", "技能工", "Craftsmen"),
    "8": ("Plant and machine operators and assemblers", "設備・機械の運転・組立", "Plant & Machine"),
    "9": ("Cleaners, labourers and related workers", "清掃・労務・関連職", "Cleaners"),
}
AGES = ["15-19", "20-24", "25-29", "30-39", "40-49", "50-59", "60-69"]
# LFS median-table row label → age band ("60 & Over" is shown as 60-69, like other countries)
LFS_AGE = {"15 - 19": "15-19", "20 - 24": "20-24", "25 - 29": "25-29", "30 - 39": "30-39",
           "40 - 49": "40-49", "50 - 59": "50-59", "60 & Over": "60-69", "Total": "*"}
# Histogram / labour-force columns making up each band
HIST_AGE = {"15-19": ["15 - 24"], "20-24": ["15 - 24"], "25-29": ["25 - 29"], "30-39": ["30 - 34", "35 - 39"],
            "40-49": ["40 - 44", "45 - 49"], "50-59": ["50 - 54", "55 - 59"],
            "60-69": ["60 - 64", "65 - 69", "70 & Over"], "*": ["Total"]}
LF_AGE = {"15-19": ["15 - 19"], "20-24": ["20 - 24"], "25-29": ["25 - 29"], "30-39": ["30 - 34", "35 - 39"],
          "40-49": ["40 - 44", "45 - 49"], "50-59": ["50 - 54", "55 - 59"],
          "60-69": ["60 - 64", "65 - 69", "70 & Over"], "*": ["Total"]}
QUAL = {"Below Secondary": "below", "Secondary": "sec", "Post-Secondary": "upper_secondary",
        "Diploma": "short_tertiary", "Degree": "bachelor", "Total": "*"}
EDUCATIONS = ["lower_secondary", "upper_secondary", "short_tertiary", "bachelor"]
SEX = {"Total": "*", "Male": "M", "Female": "F"}


# ---------------------------------------------------------------- fetching

def path(name: str) -> Path:
    return SG_RAW / FILES[name].rsplit("/", 1)[1]


def fetch() -> None:
    SG_RAW.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        if path(name).exists():
            continue
        print(f"downloading {url}")
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0 (career-map data pipeline)"}, timeout=300)
        r.raise_for_status()
        path(name).write_bytes(r.content)


def sheet_rows(name: str, sheet: str) -> list[tuple]:
    wb = openpyxl.load_workbook(path(name), read_only=True, data_only=True)
    return [tuple(r) for r in wb[sheet].iter_rows(values_only=True)]


def num(v) -> float | None:
    return float(v) if isinstance(v, (int, float)) else None


def clean(v) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()


# ---------------------------------------------------------------- LFS tables

def header_index(rows: list[tuple], first: str) -> tuple[int, list[str]]:
    """Row index and cleaned cells of the column-header row whose first non-empty cell is `first`."""
    for i, r in enumerate(rows):
        cells = [clean(x) for x in r]
        if next((c for c in cells if c), None) == first:
            return i, cells
    raise ValueError(f"header {first!r} not found")


def median_table(rows: list[tuple], header_first: str) -> dict[tuple[str, str, str], float]:
    """{(sex, row label, column header): value} for LFS median tables (C2, C4, C8).

    Rows are grouped by sex ('Total'/'Male'/'Female' in column 0, when present); the row label is the
    last text cell before the numbers."""
    h, head = header_index(rows, header_first)
    out = {}
    sex = "Total"
    for r in rows[h + 1:]:
        if clean(r[0]).startswith("Source"):
            break
        cells = [clean(x) for x in r]
        if cells[0] in SEX:
            sex = cells[0]
        label = next((cells[j] for j in range(len(cells) - 1, -1, -1)
                      if cells[j] and num(r[j]) is None and cells[j] != "s" and j < len(head) and not head[j]), None)
        if label is None:
            continue
        for j, col in enumerate(head):
            if col and j < len(r) and (v := num(r[j])) is not None:
                out[(sex, label, col)] = v
    return out


Hist = tuple[list[tuple[float, float, float]], float, float]  # ([(lo, hi, count)], tail threshold, tail count)


def histograms(rows: list[tuple], header_first: str) -> dict[tuple[str, str], Hist]:
    """{(sex, column header): histogram} for LFS income-band tables (C10–C17)."""
    h, head = header_index(rows, header_first)
    bands: dict[tuple[str, str], list[tuple[str, float]]] = {}
    sex = "Total"
    for r in rows[h + 1:]:
        cells = [clean(x) for x in r]
        if cells[0].startswith("Source"):
            break
        if cells[0] in SEX:
            sex = cells[0]
        label = next((c for c in cells if "$" in c), None)
        if not label:
            continue
        for j, col in enumerate(head):
            if col and j < len(r) and isinstance(r[j], (int, float, str)) and cells[j] not in ("", label):
                bands.setdefault((sex, col), []).append((label, num(r[j]) or 0.0))
    out = {}
    for key, rows_ in bands.items():
        bins, overs = [], []
        for label, v in rows_:
            amounts = [float(x.replace(",", "")) for x in re.findall(r"\$([\d,]+)", label)]
            if label.startswith("Under"):
                bins.append((0.0, amounts[0], v))
            elif "Over" in label:
                overs.append((amounts[0], v))
            else:
                bins.append((amounts[0], amounts[1] + 1, v))
        (lo1, n1), (lo2, n2) = sorted(overs)  # e.g. $12,000 & over, of which $20,000 & over
        bins.append((lo1, lo2, n1 - n2))
        out[key] = (bins, lo2, n2)
    return out


def hist_merge(hs: list[Hist]) -> Hist:
    bins = [(lo, hi, sum(h[0][i][2] for h in hs)) for i, (lo, hi, _) in enumerate(hs[0][0])]
    return bins, hs[0][1], sum(h[2] for h in hs)


def pareto_alpha(c10: Hist) -> float:
    """Tail index from C10's two open-ended bands ($20,000+ and $22,500+)."""
    bins, t2, n2 = c10
    lo, _, n = bins[-1]
    return math.log((n + n2) / n2) / math.log(t2 / lo)


def hist_quantiles(h: Hist, alpha: float) -> tuple[list[float], float]:
    """p10…p90 (linear within bands, Pareto above the tail threshold) and mean."""
    bins, t, nt = h
    total = sum(b[2] for b in bins) + nt
    qs = []
    for q in TARGETS:
        need, cum = q * total, 0.0
        for lo, hi, n in bins:
            if cum + n >= need and n > 0:
                qs.append(lo + (need - cum) / n * (hi - lo))
                break
            cum += n
        else:
            qs.append(t * ((total - need) / nt) ** (-1 / alpha))
    mean = (sum((lo + hi) / 2 * n for lo, hi, n in bins) + nt * t * alpha / (alpha - 1)) / total
    return qs, mean


# ---------------------------------------------------------------- shapes

class Shape:
    """Distribution relative to its median: log(q / median) at p10…p90, and mean / median."""

    def __init__(self, logs: list[float], mean_ratio: float) -> None:
        self.logs, self.mean_ratio = logs, mean_ratio

    @classmethod
    def of(cls, qs: list[float], mean: float) -> Shape:
        return cls([math.log(x / qs[2]) for x in qs], mean / qs[2])

    def corrected(self, k: list[float], mean_k: float) -> Shape:
        return Shape([a * b for a, b in zip(self.logs, k)], self.mean_ratio * mean_k)

    def at(self, median: float) -> tuple[list[float], float]:
        return [median * math.exp(x) for x in self.logs], median * self.mean_ratio


def split_lognormal(p25: float, p50: float, p75: float) -> Shape:
    lo = math.log(p50 / p25) / -Z[1]
    hi = math.log(p75 / p50) / Z[3] or lo  # p75 == median (heaping): borrow the lower spread
    sigma = (lo + hi) / 2
    return Shape([lo * z if z < 0 else hi * z for z in Z], math.exp(sigma**2 / 2))


def mixture(parts: list[tuple[float, list[float]]]) -> list[float]:
    """p10…p90 of a weighted mixture of distributions given by their p10…p90 (piecewise linear in
    normal z vs log pay, extrapolated beyond p10/p90)."""
    def cdf(x: float, qs: list[float]) -> float:
        lx, lq = math.log(x), [math.log(v) for v in qs]
        if lx <= lq[0] or lx >= lq[4]:
            i = 0 if lx <= lq[0] else 3
        else:
            i = next(j for j in range(4) if lq[j] <= lx <= lq[j + 1])
        slope = (Z[i + 1] - Z[i]) / max(lq[i + 1] - lq[i], 1e-9)
        z = Z[i] + (lx - lq[i]) * slope
        return 0.5 * (1 + math.erf(z / math.sqrt(2)))

    total = sum(w for w, _ in parts)
    out = []
    for q in TARGETS:
        lo, hi = min(p[1][0] for p in parts) * 0.3, max(p[1][4] for p in parts) * 3
        for _ in range(80):
            mid = math.sqrt(lo * hi)
            if sum(w * cdf(mid, qs) for w, qs in parts) / total < q:
                lo = mid
            else:
                hi = mid
        out.append(math.sqrt(lo * hi))
    return out


def cell(qs: list[float], mean: float, method: int, n: float = 0) -> list:
    """Monthly values → annual cell [n, mean, p10, p25, p50, p75, p90, method]."""
    r = lambda x: max(100, int(round(x * 12, -2)))
    q = [r(x) for x in qs]
    for i in range(1, 5):  # keep ties from rounding ordered
        q[i] = max(q[i], q[i - 1])
    return [round(n), r(mean)] + q + [method]


# ---------------------------------------------------------------- build

def occupational_wages() -> tuple[dict, dict]:
    """({code: (label, major)}, cells) from the Occupational Wage Survey."""
    occs: dict[str, tuple[str, str]] = {}
    cells: dict[str, list] = {}
    shapes: dict[str, Shape] = {}
    for r in sheet_rows("ows4", "T4"):
        if len(r) < 9 or not isinstance(r[1], int) or r[1] < 10000:
            continue
        code, label = str(r[1]), clean(r[2])
        p25, p50, p75 = (num(x) for x in r[6:9])  # gross wage p25, median, p75
        if not (p25 and p50 and p75):
            continue
        occs[code] = (label, code[0])
        shapes[code] = split_lognormal(p25, p50, p75)
        qs, mean = shapes[code].at(p50)
        cells[f"{code}|*|*|*"] = cell([qs[0], p25, p50, p75, qs[4]], mean, METHOD_LOGNORMAL)

    for sheet, sex in (("T1.1", "M"), ("T1.2", "F")):
        for r in sheet_rows("ows1", sheet):
            if len(r) > 4 and isinstance(r[1], int) and str(r[1]) in shapes and (m := num(r[4])):
                qs, mean = shapes[str(r[1])].at(m)
                cells[f"{r[1]}|*|{sex}|*"] = cell(qs, mean, METHOD_LOGNORMAL)

    rows = sheet_rows("ows3", "T3")
    h, head = header_index(rows, "SSOC 2024")
    age_cols = {}  # gross wage is the second column of each age pair
    for j, c in enumerate(head):
        if m := re.match(r"(\d+) - (\d+) Years", c):
            age_cols[f"{m.group(1)}-{m.group(2)}"] = j + 1
    for r in rows[h + 1:]:
        if len(r) > 3 and isinstance(r[1], int) and str(r[1]) in shapes:
            for age, j in age_cols.items():
                if age in AGES and (m := num(r[j])):
                    qs, mean = shapes[str(r[1])].at(m)
                    cells[f"{r[1]}|{age}|*|*"] = cell(qs, mean, METHOD_LOGNORMAL)
    return occs, cells


def labour_force() -> dict[str, list]:
    c = lambda s: sheet_rows("lfsC", s)
    cells: dict[str, list] = {}

    ft = histograms(c("C10"), "2015")
    ft = {sex: h for (sex, col), h in ft.items() if col == "2025"}
    allemp = {sex: h for (sex, col), h in histograms(c("C11"), "2015").items() if col == "2025"}
    alpha = {sex: pareto_alpha(ft[sex]) for sex in SEX}
    # Part-time correction: all-employed histograms (C12–C17) are rescaled towards full-time spreads
    corr = {}
    for sex in SEX:
        f = Shape.of(*hist_quantiles(ft[sex], alpha[sex]))
        a = Shape.of(*hist_quantiles(allemp[sex], alpha[sex]))
        corr[sex] = ([x / y if y else 1.0 for x, y in zip(f.logs, a.logs)], f.mean_ratio / a.mean_ratio, f.logs)

    def shape(h: Hist, sex: str) -> Shape:
        """Group shape from an all-employed histogram. Where part-timers dominate (the young), the
        rescaled lower tail can still be implausibly long, so it is capped at the national full-time
        spread of the same sex."""
        k, mean_k, ft_logs = corr[sex]
        sh = Shape.of(*hist_quantiles(h, alpha[sex])).corrected(k, mean_k)
        sh.logs[:2] = [max(x, f) for x, f in zip(sh.logs[:2], ft_logs[:2])]
        return sh

    # Median by occupation × sex, excluding employer CPF (C2 columns 4–6: total, male, female)
    c2: dict[str, list[float]] = {}
    for r in c("C2"):
        if len(r) >= 7 and all(num(x) is not None for x in r[4:7]):
            c2[clean(r[0])] = [num(x) for x in r[4:7]]

    # National × sex: full-time histogram, median replaced by the published one
    for i, (sex, s) in enumerate(SEX.items()):
        qs, mean = hist_quantiles(ft[sex], alpha[sex])
        med = c2["Total"][i]
        qs[2] = med
        qs[1], qs[3] = min(qs[1], med), max(qs[3], med)
        n = sum(b[2] for b in ft[sex][0]) + ft[sex][2]
        cells[f"*|*|{s}|*"] = cell(qs, mean, METHOD_HIST, n * 1000)

    # Occupation major × sex (C2) and × age (C4); shape from C12
    c12 = histograms(c("C12"), "Total")
    c12_cols = {col for _, col in c12}

    def major_col(prefix: str) -> str:
        return next(col for col in c12_cols if col.startswith(prefix))

    for label, vals in c2.items():
        for k, (_, _, prefix) in MAJORS.items():
            if prefix and label.startswith(prefix):
                for i, (sex, s) in enumerate(SEX.items()):
                    qs, mean = shape(c12[(sex, major_col(prefix))], sex).at(vals[i])
                    cells[f"M{k}|*|{s}|*"] = cell(qs, mean, METHOD_SHAPE)
    c4 = median_table(c("C4"), "Total")
    for (_, row, col), v in c4.items():
        age = LFS_AGE.get(row)
        k = next((k for k, (_, _, p) in MAJORS.items() if p and col.startswith(p)), None)
        if age and age != "*" and k:
            qs, mean = shape(c12[("Total", major_col(MAJORS[k][2]))], "Total").at(v)
            cells[f"M{k}|{age}|*|*"] = cell(qs, mean, METHOD_SHAPE)

    # Age × sex (C8 total column; shape from C16) and qualification × age × sex (C8; shape from C17)
    c8 = median_table(c("C8"), "Total")
    c16 = histograms(c("C16"), "Total")
    c17 = histograms(c("C17"), "Total")
    a9 = median_table(sheet_rows("lfsA", "A9"), "Total")

    def qual_of(col: str) -> str | None:
        return next((v for k, v in QUAL.items() if col.startswith(k)), None)

    def qual_col(cols, code):
        return next(col for col in cols if qual_of(col) == code)

    comp: dict[tuple[str, str, str], tuple[list[float], float]] = {}  # (sex, age, qual) → (qs, mean)
    for (sex, row, col), v in c8.items():
        age, q = LFS_AGE.get(row), qual_of(col)
        if not age or not q:
            continue
        if q == "*":
            h = hist_merge([c16[(sex, a)] for a in HIST_AGE[age]]) if age != "*" else ft[sex]
            qs, mean = (shape(h, sex) if age != "*" else Shape.of(*hist_quantiles(h, alpha[sex]))).at(v)
            if age != "*":
                cells[f"*|{age}|{SEX[sex]}|*"] = cell(qs, mean, METHOD_SHAPE)
        else:
            qs, mean = shape(c17[(sex, qual_col({c_ for _, c_ in c17}, q))], sex).at(v)
            comp[(sex, age, q)] = (qs, mean)
            if q in EDUCATIONS:
                cells[f"*|{age}|{SEX[sex]}|{q}"] = cell(qs, mean, METHOD_SHAPE)

    # lower_secondary = "Below secondary" + "Secondary", weighted by the labour force (A9)
    a9_cols = {col for _, _, col in a9}
    for (sex, age, q), (qs_sec, mean_sec) in comp.items():
        if q != "sec":
            continue
        w = {qq: sum(a9.get((sex, a, qual_col(a9_cols, qq)), 0) for a in LF_AGE[age]) for qq in ("below", "sec")}
        parts = [(w["sec"], qs_sec, mean_sec)]
        if (below := comp.get((sex, age, "below"))) and w["below"] > 0:
            parts.append((w["below"], *below))
        qs = mixture([(wt, q_) for wt, q_, _ in parts]) if len(parts) > 1 else qs_sec
        mean = sum(wt * m for wt, _, m in parts) / sum(wt for wt, _, _ in parts)
        cells[f"*|{age}|{SEX[sex]}|lower_secondary"] = cell(qs, mean, METHOD_SHAPE)
    return cells


def build() -> None:
    occs, occ_cells = occupational_wages()
    cells = {**labour_force(), **occ_cells}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_national(OUT_DIR, cells, lambda occ: occ[0])
    write_json(OUT_DIR / "meta.json", {
        "country": "SG",
        "currency": "SGD",
        "year": 2025,
        "wageDefinition": {
            "en": "Annual gross income from employment of full-time employed residents (citizens and PRs), June 2025 × 12, "
                  "before employee CPF and tax, excluding employer CPF. Broad occupation groups, age, sex and education "
                  "(Labour Force Survey) include 1/12 of annual bonuses; detailed occupations (Occupational Wage Survey: "
                  "private-sector employees in establishments with 25+ staff) are monthly gross wages × 12 and exclude "
                  "bonuses/AWS, so they run lower. Foreign workers are not covered.",
            "ja": "フルタイムで働く居住者（国民・永住者）の就業所得（2025年6月の月額×12）。従業員CPF・税の控除前、雇用主CPF拠出を除く。"
                  "職業大分類・年齢・性別・学歴（労働力調査）は年間賞与の1/12を含む。詳細職業（職業別賃金調査：従業員25人以上の民間事業所の被用者）は"
                  "月額総賃金×12で賞与（AWS等）を含まないため低めに出る。外国人労働者は対象外。",
        },
        "nKind": "population",
        "source": {
            "id": "mom2025",
            "name": {"en": "Ministry of Manpower, Labour Force in Singapore 2025 and Occupational Wages 2025",
                     "ja": "シンガポール人材開発省（MOM）「Labour Force in Singapore 2025」「Occupational Wages 2025」"},
            "url": "https://stats.mom.gov.sg/Pages/Occupational-Wages-Tables2025.aspx",
        },
        "regions": [],
        "occupationMajor": [{"code": f"M{k}", "label": {"en": en, "ja": ja}} for k, (en, ja, _) in MAJORS.items()],
        "occupations": [{"code": k, "major": major, "label": {"en": en, **({"ja": OCC_JA[k]} if k in OCC_JA else {})}}
                        for k, (en, major) in sorted(occs.items())],
        "ages": AGES,
        "educations": EDUCATIONS,
    })
    print(f"  SG: {len(cells)} cells, {len(occs)} occupations")


if __name__ == "__main__":
    fetch()
    build()
