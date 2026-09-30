import { describe, expect, it } from 'vitest'
import { buildSubmission, communityCell, newDeletionCode, normaliseCode, roundIncome, sha256Hex, submissionAgeBand, type CommunityData } from './community'
import type { Profile } from './types'

const p: Profile = { country: 'JP', region: '13', occupation: 'J012', age: 32, sex: null, education: 'bachelor', income: 6_540_000 }

describe('community submissions', () => {
  it('stores coarse values only', () => {
    expect(submissionAgeBand(19)).toBe('18-24')
    expect(submissionAgeBand(70)).toBeNull()
    expect(roundIncome(6_540_000, 'JPY')).toBe(6_500_000)
    expect(roundIncome(84_499, 'USD')).toBe(84_000)
    const s = buildSubmission(p, { employment: 'regular', roleLevel: null, english: 'basic', remote: null, changedJob3y: false })!
    expect(s).toMatchObject({ age_band: '30-34', income: 6_500_000, currency: 'JPY', sex: null })
    expect(Object.keys(s)).not.toContain('age')
  })

  it('needs age and income', () => {
    expect(buildSubmission({ ...p, income: null }, { employment: 'regular', roleLevel: null, english: null, remote: null, changedJob3y: null })).toBeNull()
  })

  it('makes unguessable deletion codes that survive retyping', () => {
    const a = newDeletionCode()
    expect(a).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(newDeletionCode()).not.toBe(a)
    expect(normaliseCode(a.toLowerCase().replace(/-/g, ' '))).toBe(a)
  })

  it('hashes like Postgres sha256(convert_to(token, UTF8))', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('finds the most specific published cell', () => {
    const data: CommunityData = {
      generatedOn: '2026-10-01', kMin: 10, countStep: 5, total: 40,
      countries: { JP: { n: 40, currency: 'JPY', breakdowns: {}, cells: { '*|*|*|*': [40, 1, 2, 3], 'MB|30-34|*|*': [10, 4, 5, 6] } } },
    }
    expect(communityCell(data, p, () => 'MB')!.key).toBe('MB|30-34|*|*')
    expect(communityCell(data, { ...p, age: 50 }, () => 'MB')!.key).toBe('*|*|*|*')
  })
})
