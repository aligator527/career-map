/**
 * Anonymous self-reported submissions (Phase 6). The browser talks to Supabase's REST API directly
 * with the public (anon) key, which can only insert rows and call delete_submission — see
 * supabase/migrations/001_submissions.sql and docs/PRIVACY.md.
 */

import { CURRENCY } from './countries'
import type { CountryCode, Education, Profile, Sex } from './types'

const SUPABASE_URL: string | undefined = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY

export const communityEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export type Employment = 'regular' | 'non_regular' | 'self_employed' | 'founder'
export type RoleLevel = 'staff' | 'lead' | 'manager' | 'director' | 'executive'
export type English = 'none' | 'basic' | 'business' | 'fluent' | 'native'
export type Remote = 'none' | 'hybrid' | 'full'

export interface Extra {
  employment: Employment
  roleLevel: RoleLevel | null
  english: English | null
  remote: Remote | null
  changedJob3y: boolean | null
}

export interface Submission {
  country: CountryCode
  region: string | null
  occupation: string | null
  age_band: string
  sex: Sex | null
  education: Education | null
  employment: Employment
  role_level: RoleLevel | null
  english: English | null
  remote: Remote | null
  changed_job_3y: boolean | null
  income: number
  currency: string
}

const AGE_BANDS = ['18-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64', '65-69']

/** Age band stored with a submission (18-24 merged: fewer, larger groups). */
export function submissionAgeBand(age: number): string | null {
  return AGE_BANDS.find((b) => {
    const [lo, hi] = b.split('-').map(Number)
    return age >= lo && age <= hi
  }) ?? null
}

/** Income is rounded before it leaves the browser: ¥100,000 or 1,000 units of other currencies. */
export function roundIncome(income: number, currency: string): number {
  const unit = currency === 'JPY' ? 100_000 : 1_000
  return Math.round(income / unit) * unit
}

export function buildSubmission(p: Profile, extra: Extra): Submission | null {
  if (p.age == null || p.income == null || p.income <= 0) return null
  const age_band = submissionAgeBand(p.age)
  if (!age_band) return null
  const currency = CURRENCY[p.country]
  return {
    country: p.country, region: p.region, occupation: p.occupation, age_band,
    sex: p.sex, education: p.education,
    employment: extra.employment, role_level: extra.roleLevel, english: extra.english,
    remote: extra.remote, changed_job_3y: extra.changedJob3y,
    income: roundIncome(p.income, currency), currency,
  }
}

/** 160-bit random deletion code in Crockford base32 (32 characters, grouped for readability). */
export function newDeletionCode(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return out.match(/.{4}/g)!.join('-')
}

/** Normalise what the user types back in (case, spaces, dashes) to the stored form. */
export function normaliseCode(code: string): string {
  const raw = code.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return raw.match(/.{1,4}/g)?.join('-') ?? ''
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function headers(): HeadersInit {
  return { apikey: SUPABASE_ANON_KEY!, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }
}

export async function submit(s: Submission): Promise<string> {
  if (!communityEnabled) throw new Error('not configured')
  const code = newDeletionCode()
  const res = await fetch(`${SUPABASE_URL}/rest/v1/submissions`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({ ...s, delete_token_hash: await sha256Hex(code) }),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return code
}

export async function deleteSubmission(code: string): Promise<boolean> {
  if (!communityEnabled) throw new Error('not configured')
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_submission`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ token: normaliseCode(code) }),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return (await res.json()) === true
}

// ---------------------------------------------------------------- published aggregates

export interface CommunityData {
  generatedOn: string | null
  kMin: number
  countStep: number
  total: number
  /** cells: "occ|age|sex|edu" → [n, p25, p50, p75]; breakdowns: dimension → value → same */
  countries: Partial<Record<CountryCode, {
    n: number
    currency: string
    cells: Record<string, [number, number, number, number]>
    breakdowns: Partial<Record<'employment' | 'role_level' | 'english' | 'remote' | 'changed_job_3y', Record<string, [number, number, number, number]>>>
  }>>
}

/** Most specific published community cell for the profile (same key scheme as the official data). */
export function communityCell(data: CommunityData, p: Profile, majorOf: (occ: string) => string | null) {
  const c = data.countries[p.country]
  if (!c) return null
  const age = p.age != null ? submissionAgeBand(p.age) : null
  const occs = p.occupation ? [p.occupation, majorOf(p.occupation), '*'] : ['*']
  const opt = (v: string | null) => (v ? [v, '*'] : ['*'])
  for (const o of occs.filter((x, i, a): x is string => !!x && a.indexOf(x) === i))
    for (const a of opt(age))
      for (const e of opt(p.education))
        for (const s of opt(p.sex)) {
          const key = `${o}|${a}|${s}|${e}`
          if (c.cells[key]) return { key, cell: c.cells[key] }
        }
  return null
}
