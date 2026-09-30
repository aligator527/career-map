import { describe, expect, it } from 'vitest'
import { ageBand, findCell } from './lookup'
import { LEVELS, fitLognormal, incomeAt, medianCI, normCdf, normInv, percentileOf } from './stats'
import type { Cells, CountryMeta, Profile } from './types'

describe('stats', () => {
  it('normInv inverts normCdf', () => {
    for (const p of [0.01, 0.1, 0.5, 0.9, 0.99]) expect(normCdf(normInv(p))).toBeCloseTo(p, 6)
  })

  it('percentileOf is exact for a lognormal distribution, including extrapolation', () => {
    const mu = Math.log(5_000_000)
    const sigma = 0.4
    const q = LEVELS.map((p) => Math.exp(mu + sigma * normInv(p)))
    for (const p of [0.02, 0.1, 0.37, 0.5, 0.8, 0.97]) {
      const x = Math.exp(mu + sigma * normInv(p))
      expect(percentileOf(x, q)).toBeCloseTo(p, 4)
      expect(incomeAt(p, q)).toBeCloseTo(x, -2)
    }
  })

  it('percentileOf hits the published quantiles exactly', () => {
    const q = [3_200_000, 3_800_000, 4_750_000, 6_250_000, 8_500_000]
    q.forEach((x, i) => expect(percentileOf(x, q)).toBeCloseTo(LEVELS[i], 6))
  })
})

const meta = {
  country: 'JP',
  ages: ['25-29', '30-34'],
  occupations: [{ code: 'J012', major: 'B', label: { en: 'Software developers' } }],
} as unknown as CountryMeta

const cell = (n: number): [number, number, number, number, number, number, number] => [n, 1, 1, 1, 1, 1, 1]

const national: Cells = {
  '*|*|*|*': cell(1000),
  'J012|30-34|M|*': cell(100),
  'J012|*|*|*': cell(500),
  'MB|*|*|*': cell(700),
  '*|30-34|M|bachelor': cell(200),
}
const tokyo: Cells = { '*|30-34|M|*': cell(50), 'MB|*|M|*': cell(60) }

const profile: Profile = {
  country: 'JP', region: '13', occupation: 'J012', age: 32, sex: 'M', education: 'bachelor', income: null,
}

describe('findCell', () => {
  it('maps ages to bands', () => {
    expect(ageBand(32, meta.ages)).toBe('30-34')
    expect(ageBand(70, meta.ages)).toBeNull()
  })

  it('prefers the detailed occupation over region and education', () => {
    const m = findCell(meta, national, tokyo, profile)!
    expect(m.key).toBe('J012|30-34|M|*')
    expect(m.regional).toBe(false)
    expect(m.dropped).toEqual(['region', 'education'])
  })

  it('coarsens the occupation to its major group before dropping it', () => {
    const m = findCell(meta, { '*|*|*|*': cell(1), 'MB|*|*|*': cell(1) }, null, { ...profile, region: null })!
    expect(m.key).toBe('MB|*|*|*')
    expect(m.occupationCoarsened).toBe(true)
    expect(m.dropped).toEqual(['age', 'sex', 'education'])
  })

  it('uses the regional table when it is the most specific match', () => {
    const m = findCell(meta, national, tokyo, { ...profile, occupation: null, education: null })!
    expect(m.key).toBe('*|30-34|M|*')
    expect(m.regional).toBe(true)
  })

  it('falls back to the all-worker cell when nothing is specified', () => {
    const m = findCell(meta, national, null, { ...profile, region: null, occupation: null, age: null, sex: null, education: null })!
    expect(m.key).toBe('*|*|*|*')
    expect(m.dropped).toEqual([])
  })
})

describe('fitLognormal', () => {
  it('recovers the parameters of lognormal quantiles', () => {
    const q = LEVELS.map((p) => Math.exp(15 + 0.5 * normInv(p)))
    const { mu, sigma } = fitLognormal(q)
    expect(mu).toBeCloseTo(15, 6)
    expect(sigma).toBeCloseTo(0.5, 6)
  })
})

describe('medianCI', () => {
  it('narrows with sample size and contains the median', () => {
    const q = LEVELS.map((p) => Math.exp(Math.log(5e6) + 0.4 * normInv(p)))
    const small = medianCI(q, 50)!
    const large = medianCI(q, 5000)!
    expect(small[0]).toBeLessThan(q[2])
    expect(small[1]).toBeGreaterThan(q[2])
    expect(large[1] - large[0]).toBeLessThan((small[1] - small[0]) / 5)
  })
})
