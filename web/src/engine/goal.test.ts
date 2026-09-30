import { describe, expect, it } from 'vitest'
import { achievers, ageCurve, goalOptions, goalResult, shareAbove, type GoalInputs } from './goal'
import { LEVELS, normInv } from './stats'
import type { CellTuple, CountryMeta, FxData, Profile } from './types'

// A lognormal cell with the given median and spread, population `pop`
const cell = (median: number, pop: number, sigma = 0.4): CellTuple =>
  [pop, median, ...LEVELS.map((p) => Math.round(median * Math.exp(sigma * normInv(p))))] as unknown as CellTuple

const meta = {
  country: 'JP', currency: 'JPY', ages: ['25-29', '30-34'], educations: ['secondary', 'bachelor'],
  regions: [{ code: '13', label: {} }],
  occupationMajor: [{ code: 'MA', label: {} }, { code: 'MB', label: {} }],
  occupations: [{ code: 'J012', major: 'B', label: {} }],
} as unknown as CountryMeta

const national = {
  '*|*|*|*': cell(5_000_000, 1000),
  '*|25-29|*|*': cell(4_000_000, 400),
  '*|30-34|*|*': cell(5_000_000, 600),
  'MA|30-34|*|*': cell(9_000_000, 60),
  'MB|30-34|*|*': cell(6_000_000, 200),
  'J012|30-34|*|*': cell(5_500_000, 50),
  '*|30-34|*|bachelor': cell(6_000_000, 300),
  '*|30-34|*|secondary': cell(4_000_000, 300),
}

const profile: Profile = { country: 'JP', region: null, occupation: 'J012', age: 27, sex: null, education: null, income: null }
const inputs: GoalInputs = {
  profile, home: { meta, national }, regional: null, regions: null, others: {},
  fx: { ppp: { JPY: 100 }, fx: { JPY: 150 } } as unknown as FxData, conversion: 'ppp', common: [],
}

describe('goal simulation', () => {
  it('shareAbove is 50% at the median', () => {
    const c = { n: 1, pop: 1, mean: 1, q: cell(5_000_000, 1).slice(2, 7) as [number, number, number, number, number], method: 0 as const }
    expect(shareAbove(c, 5_000_000)).toBeCloseTo(0.5, 6)
  })

  it('evaluates the income goal at the target age', () => {
    const r = goalResult({ kind: 'income', amount: 5_500_000, age: 32 }, inputs)!
    expect(r.key).toBe('J012|30-34|*|*')
    expect(r.share).toBeCloseTo(0.5, 6)
  })

  it('computes the manager share from populations', () => {
    const r = goalResult({ kind: 'manager', age: 32 }, inputs)!
    expect(r.share).toBeCloseTo(60 / 600, 6)
  })

  it('draws the curve only over bands where age is used', () => {
    const curve = ageCurve({ kind: 'income', amount: 5_000_000, age: 32 }, { ...inputs, profile: { ...profile, occupation: null } })
    expect(curve.map((p) => p.band)).toEqual(['25-29', '30-34'])
    expect(curve[1].target).toBe(true)
    expect(curve[0].share).toBeLessThan(curve[1].share)
  })

  it('lists single-condition changes that are reflected in the data', () => {
    const opts = goalOptions({ kind: 'income', amount: 7_000_000, age: 32 }, inputs)
    const occ = opts.filter((o) => o.kind === 'occupation').map((o) => o.code)
    expect(occ).toEqual(['MA', 'MB'])
    expect(opts.find((o) => o.code === 'MA')!.result.share).toBeGreaterThan(opts.find((o) => o.code === 'MB')!.result.share)
  })

  it('splits achievers by occupation group, weighting by population', () => {
    const a = achievers({ kind: 'income', amount: 8_000_000, age: 32 }, inputs)
    // MB: 200 people × 24% ≈ 47 achievers; MA: 60 × 62% ≈ 37 — more achievers, lower rate
    expect(a.occupations.map((o) => o.code)).toEqual(['MB', 'MA'])
    expect(a.occupations[1].rate).toBeGreaterThan(a.occupations[0].rate)
    expect(a.occupations.reduce((s, x) => s + x.shareOfAchievers, 0)).toBeCloseTo(1, 6)
    expect(a.educations.map((e) => e.code)).toEqual(['bachelor', 'secondary'])
  })
})

describe('goal options consistency', () => {
  it('drops options that had to relax a condition the baseline kept', () => {
    // Regional table has no age breakdown → region options would compare all ages against age 30-34
    const regions = { '13': { '*|*|*|*': cell(6_000_000, 100), 'MA|*|*|*': cell(9_000_000, 10) } }
    const opts = goalOptions({ kind: 'manager', age: 32 }, { ...inputs, regions })
    expect(opts.filter((o) => o.kind === 'region')).toEqual([])
  })
})
