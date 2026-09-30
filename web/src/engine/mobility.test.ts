import { describe, expect, it } from 'vitest'
import { jpJobChange, jpRanks, usMobility, type JpMobility, type UsMobility } from './mobility'
import type { CountryMeta, Profile } from './types'

const meta = { ages: ['25-29', '30-34', '35-39'] } as unknown as CountryMeta
const p: Profile = { country: 'JP', region: null, occupation: null, age: 32, sex: 'F', education: 'bachelor', income: null }

const jp: JpMobility = {
  source: {} as JpMobility['source'],
  payChange: { '30-34|*': [500, 30, 15, 20, 10, 20, 5], '*|*': [4000, 28, 12, 25, 9, 22, 4] },
  changeRate: { '30-34|F': 13.1, '30-34|*': 12.2 },
  ranks: {
    '25-29|F|bachelor': { bucho: [0, null], kacho: [10, 5e6], kakari: [40, 4e6], shokucho: [0, null], other: [10, null], none: [940, 3.5e6] },
    '30-34|F|bachelor': { bucho: [5, 8e6], kacho: [45, 6e6], kakari: [100, 5e6], shokucho: [0, null], other: [50, null], none: [800, 4e6] },
    '35-39|F|bachelor': { bucho: [20, 9e6], kacho: [100, 7e6], kakari: [150, 6e6], shokucho: [0, null], other: [30, null], none: [700, 5e6] },
  },
}

describe('Japan job change and ranks', () => {
  it('relaxes sex when the pay-change table has no sex split for the age', () => {
    const c = jpJobChange(meta, jp, p)!
    expect(c.key).toBe('30-34|*')
    expect(c.dist.up10).toBe(30)
    expect(c.rate).toBe(13.1) // the rate table does have women aged 30-34
  })

  it('computes rank shares by age', () => {
    const r = jpRanks(meta, jp, p)!
    expect(r.bands.map((b) => b.band)).toEqual(['25-29', '30-34', '35-39'])
    const b = r.bands[1]
    expect(b.shares.bucho + b.shares.kacho).toBeCloseTo(50 / 1000, 6)
    expect(Object.values(b.shares).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6)
  })
})

describe('US mobility', () => {
  const us: UsMobility = {
    source: {} as UsMobility['source'], ages: ['25-34', '35-44'],
    cells: { '*|*|*|*': [1000, 0.09, 0.03, 60000, 55000], 'M15|25-34|*|*': [300, 0.08, 0.028, 100000, 96000] },
  }
  it('maps a detailed SOC code to its major group and uses the most specific cell', () => {
    const m = usMobility(us, { ...p, country: 'US', occupation: '151252', sex: null, education: null })!
    expect(m.key).toBe('M15|25-34|*|*')
    expect(m.multi).toBe(0.08)
  })
})
