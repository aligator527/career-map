/** Quantile levels shipped for every cell. */
export const LEVELS = [0.1, 0.25, 0.5, 0.75, 0.9] as const

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2)
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const lo = 0.02425
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - lo) return -normInv(1 - p)
  const q = p - 0.5
  const r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

const Z = LEVELS.map(normInv)

/**
 * Monotone cubic (Fritsch–Carlson) interpolation through (xs, ys), linear beyond the ends.
 * Monotone data stays monotone, and the first derivative is continuous, so a density derived
 * from it has no jumps even when the quantiles are lumpy (e.g. heaped survey answers).
 */
function pchip(xs: number[], ys: number[], x: number): number {
  const n = xs.length
  const h = xs.slice(1).map((v, i) => v - xs[i] || 1e-9)
  const d = h.map((hi, i) => (ys[i + 1] - ys[i]) / hi)
  const m = xs.map((_, i) => {
    if (i === 0) return d[0]
    if (i === n - 1) return d[n - 2]
    if (d[i - 1] * d[i] <= 0) return 0
    const w1 = 2 * h[i] + h[i - 1]
    const w2 = h[i] + 2 * h[i - 1]
    return (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
  })
  if (x <= xs[0]) return ys[0] + (x - xs[0]) * m[0]
  if (x >= xs[n - 1]) return ys[n - 1] + (x - xs[n - 1]) * m[n - 1]
  let i = 0
  while (x > xs[i + 1]) i++
  const t = (x - xs[i]) / h[i]
  const t2 = t * t
  const t3 = t2 * t
  return (
    (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] +
    (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1]
  )
}

/**
 * Share of the group earning less than `x`, from the group's p10..p90: a smooth monotone curve
 * through (log income, normal z) at the known quantiles, extrapolated linearly — exact for a
 * lognormal distribution, a smooth approximation otherwise.
 */
export function percentileOf(x: number, q: readonly number[]): number {
  if (x <= 0) return 0
  return normCdf(pchip(q.map(Math.log), Z, Math.log(x)))
}

/** Income at share `p` of the group (inverse of percentileOf). */
export function incomeAt(p: number, q: readonly number[]): number {
  const z = normInv(Math.min(Math.max(p, 1e-6), 1 - 1e-6))
  return Math.exp(pchip(Z, q.map(Math.log), z))
}

/**
 * Lognormal (μ, σ) fitted to the quantiles by least squares of log income on z.
 * Used to draw the distribution: five quantiles cannot support more shape than this.
 */
export function fitLognormal(q: readonly number[]): { mu: number; sigma: number } {
  const lq = q.map(Math.log)
  const zm = Z.reduce((a, b) => a + b, 0) / Z.length
  const lm = lq.reduce((a, b) => a + b, 0) / lq.length
  const sigma = Z.reduce((a, z, i) => a + (z - zm) * (lq[i] - lm), 0) / Z.reduce((a, z) => a + (z - zm) ** 2, 0)
  return { mu: lm - sigma * zm, sigma }
}

export function lognormalPdf(x: number, mu: number, sigma: number): number {
  if (x <= 0) return 0
  const z = (Math.log(x) - mu) / sigma
  return Math.exp(-(z * z) / 2) / (x * sigma * Math.sqrt(2 * Math.PI))
}
