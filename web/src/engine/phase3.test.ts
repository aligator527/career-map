import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { crosswalk, type CommonOccupation } from './compare'
import { mapEducation } from './countries'
import { takeHomeCA, type CaTaxTable } from './tax'
import type { CountryMeta } from './types'

const caTax: CaTaxTable = JSON.parse(readFileSync('public/data/ca/tax.json', 'utf8'))

describe('takeHomeCA', () => {
  it('Ontario at C$80,000: CPP/EI, federal and provincial tax', () => {
    const t = takeHomeCA(80_000, 'ON', caTax)
    // CPP (71,300 − 3,500) × 5.95% + CPP2 (80,000 − 71,300) × 4% + EI 65,700 × 1.64%
    expect(t.social).toBeCloseTo(4_034.1 + 348 + 1_077.48, 1)
    expect(t.net).toBeGreaterThan(59_000)
    expect(t.net).toBeLessThan(61_000)
  })

  it('Quebec pays QPP/QPIP and gets the federal abatement', () => {
    const qc = takeHomeCA(80_000, 'QC', caTax)
    const on = takeHomeCA(80_000, 'ON', caTax)
    expect(qc.social).toBeGreaterThan(on.social)
    expect(qc.incomeTax).toBeLessThan(on.incomeTax)
  })

  it('net pay increases with gross pay in every province', () => {
    for (const p of Object.keys(caTax.provinces)) {
      let prev = -Infinity
      for (let g = 10_000; g <= 400_000; g += 2_500) {
        const n = takeHomeCA(g, p, caTax).net
        expect(n, `${p} at ${g}`).toBeGreaterThan(prev)
        prev = n
      }
    }
  })
})

const meta = (country: string, occs: string[], majors: string[] = []) =>
  ({ country, occupations: occs.map((code) => ({ code, major: '', label: {} })), occupationMajor: majors.map((code) => ({ code, label: {} })) }) as unknown as CountryMeta

describe('crosswalk', () => {
  const roles: CommonOccupation[] = [
    { id: 'dev', label: {}, codes: { JP: ['J012'], UK: ['2134'], DE: ['MOC2'] } },
  ]
  const jp = meta('JP', ['J012', 'J099'])
  const uk = meta('UK', ['2134'])
  const de = meta('DE', [], ['MOC2'])

  it('maps through the shared role table, including to major groups', () => {
    expect(crosswalk(roles, jp, uk, 'J012')).toBe('2134')
    expect(crosswalk(roles, uk, de, '2134')).toBe('MOC2')
  })

  it('does not guess when a code belongs to several roles', () => {
    const two: CommonOccupation[] = [...roles, { id: 'eng', label: {}, codes: { JP: ['J004'], DE: ['MOC2'] } }]
    expect(crosswalk(two, de, jp, 'MOC2')).toBeNull()
  })

  it('returns null for occupations outside the table', () => {
    expect(crosswalk(roles, jp, uk, 'J099')).toBeNull()
  })
})

describe('mapEducation', () => {
  it('keeps levels the other country uses and maps the rest', () => {
    expect(mapEducation('bachelor', ['secondary', 'short_tertiary', 'bachelor', 'graduate'])).toBe('bachelor')
    expect(mapEducation('graduate', ['lower_secondary', 'upper_secondary', 'tertiary'])).toBe('tertiary')
    expect(mapEducation('tertiary', ['secondary', 'short_tertiary', 'bachelor', 'graduate'])).toBe('bachelor')
    expect(mapEducation('bachelor', [])).toBeNull()
  })
})
