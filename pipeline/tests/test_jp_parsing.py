from career_pipeline.jp_wage_census import age_code, hist_quantiles, sigma_from_quantiles


def test_age_code():
    assert age_code("~19歳") == "18-19"
    assert age_code("20~24歳") == "20-24"
    assert age_code("20~24") == "20-24"
    assert age_code("70歳~") == "70+"
    assert age_code("研究者") is None


def test_hist_quantiles_uniform_bins():
    # 26 bins; all mass in the 200.0–219.9 bin (index 6) → quantiles interpolate within it
    counts = [0.0] * 26
    counts[6] = 100.0
    q = hist_quantiles(counts)
    assert q[0.5] == 210.0
    assert q[0.1] == 202.0


def test_sigma_from_quantiles_lognormal():
    import math

    sigma = 0.4
    qs = {0.1: math.exp(-1.2815516 * sigma), 0.9: math.exp(1.2815516 * sigma)}
    assert abs(sigma_from_quantiles(qs) - sigma) < 1e-6
