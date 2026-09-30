import { describe, expect, it } from 'vitest'
import { readUrlState, writeUrlState } from './urlState'
import type { Profile } from './engine/types'

const profile: Profile = { country: 'JP', region: '13', occupation: 'J012', age: 32, sex: 'F', education: 'bachelor', income: 6_500_000 }

describe('url state', () => {
  it('round-trips profile, metric, tab and language', () => {
    const hash = writeUrlState({ profile, metric: 'net', tab: 'goal', lang: 'ja' })
    expect(readUrlState(hash)).toEqual({ profile, metric: 'net', tab: 'goal', lang: 'ja' })
  })

  it('round-trips facets', () => {
    const p = { ...profile, facets: { industry: 'G', size: '1000+' } }
    expect(readUrlState(writeUrlState({ profile: p, metric: 'gross', tab: 'position', lang: 'en' }))!.profile.facets).toEqual(p.facets)
  })

  it('omits defaults and empty fields', () => {
    const hash = writeUrlState({ profile: { ...profile, region: null, income: null }, metric: 'gross', tab: 'position', lang: 'en' })
    expect(hash).not.toMatch(/[#&](r|i|m|t)=/)
  })

  it('rejects unknown or malformed values instead of trusting the URL', () => {
    expect(readUrlState('#c=XX')).toBeNull()
    const s = readUrlState('#c=US&a=200&s=Z&e=phd&o=<script>&m=weird&t=nope')!
    expect(s.profile).toMatchObject({ country: 'US', age: null, sex: null, education: null, occupation: null })
    expect(s.metric).toBeUndefined()
    expect(s.tab).toBeUndefined()
  })
})
