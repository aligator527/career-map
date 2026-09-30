from career_pipeline.community import K_MIN, aggregate, quartiles


def row(income, occupation="J012", age="30-34", sex="M", english="business"):
    return {"country": "JP", "occupation": occupation, "age_band": age, "sex": sex, "education": "bachelor",
            "employment": "regular", "role_level": "staff", "english": english, "remote": "hybrid",
            "changed_job_3y": False, "income": income, "currency": "JPY"}


def test_quartiles_are_rounded():
    assert quartiles([5_000_000, 6_000_000, 7_000_000, 8_000_000], 100_000) == [6_000_000, 7_000_000, 8_000_000]


def test_small_groups_are_not_published():
    rows = [row(5_000_000 + i * 100_000) for i in range(K_MIN)] + [row(9_000_000, occupation="J015", sex="F")]
    out = aggregate(rows)["countries"]["JP"]
    assert out["n"] == 10                             # counts are published rounded down to a multiple of 5
    assert out["cells"]["J012|30-34|M|bachelor"][0] == K_MIN
    assert "J015|*|*|*" not in out["cells"]          # a single doctor: suppressed
    assert out["cells"]["*|*|*|*"][0] == K_MIN        # 11 → 10, so the lone extra row is not revealed by the count


def test_breakdowns_respect_k():
    rows = [row(5_000_000) for _ in range(K_MIN)] + [row(9_000_000, english="native") for _ in range(K_MIN - 1)]
    b = aggregate(rows)["countries"]["JP"]["breakdowns"]["english"]
    assert "business" in b and "native" not in b
