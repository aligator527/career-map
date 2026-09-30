/**
 * Shareable state in the URL fragment (#c=JP&o=J012&a=32…). The fragment never reaches the server,
 * so a shared link carries the inputs only to whoever opens it.
 */

import { COUNTRIES } from './engine/countries'
import type { Metric } from './engine/metric'
import type { CountryCode, Education, Lang, Profile, Sex } from './engine/types'

export const TABS = ['position', 'goal', 'career', 'abroad', 'map', 'community'] as const
export type Tab = (typeof TABS)[number]

export interface UrlState {
  profile: Partial<Profile>
  metric?: Metric
  tab?: Tab
  lang?: Lang
}

const METRICS: Metric[] = ['gross', 'net', 'real']
const SEXES: Sex[] = ['M', 'F']
const EDUCATIONS: Education[] = ['secondary', 'short_tertiary', 'bachelor', 'graduate', 'lower_secondary', 'upper_secondary', 'tertiary']

const code = (v: string | null) => (v && /^[A-Za-z0-9_+-]{1,16}$/.test(v) ? v : null)
const int = (v: string | null, lo: number, hi: number) => {
  const n = v == null ? NaN : Number(v)
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null
}
const oneOf = <T extends string>(v: string | null, allowed: readonly T[]) => (allowed.includes(v as T) ? (v as T) : undefined)

/** Facets travel as f.<dim>=<value>, e.g. f.industry=G */
function facetsFrom(q: URLSearchParams): { facets?: Record<string, string> } {
  const facets: Record<string, string> = {}
  for (const [k, v] of q) {
    const dim = k.startsWith('f.') ? k.slice(2) : null
    if (dim && /^[a-z_]{1,20}$/.test(dim) && code(v)) facets[dim] = v
  }
  return Object.keys(facets).length ? { facets } : {}
}

export function readUrlState(hash: string): UrlState | null {
  const q = new URLSearchParams(hash.replace(/^#/, ''))
  const country = oneOf(q.get('c'), COUNTRIES as CountryCode[])
  if (!country) return null
  return {
    profile: {
      country,
      region: code(q.get('r')),
      occupation: code(q.get('o')),
      age: int(q.get('a'), 18, 69),
      sex: oneOf(q.get('s'), SEXES) ?? null,
      education: oneOf(q.get('e'), EDUCATIONS) ?? null,
      income: int(q.get('i'), 1, 1_000_000_000),
      ...facetsFrom(q),
    },
    metric: oneOf(q.get('m'), METRICS),
    tab: oneOf(q.get('t'), TABS),
    lang: oneOf(q.get('l'), ['ja', 'en'] as const),
  }
}

export function writeUrlState(s: { profile: Profile; metric: Metric; tab: Tab; lang: Lang }): string {
  const q = new URLSearchParams()
  const p = s.profile
  q.set('c', p.country)
  if (p.region) q.set('r', p.region)
  if (p.occupation) q.set('o', p.occupation)
  if (p.age != null) q.set('a', String(p.age))
  if (p.sex) q.set('s', p.sex)
  if (p.education) q.set('e', p.education)
  if (p.income != null) q.set('i', String(Math.round(p.income)))
  for (const [dim, v] of Object.entries(p.facets ?? {})) q.set(`f.${dim}`, v)
  if (s.metric !== 'gross') q.set('m', s.metric)
  if (s.tab !== 'position') q.set('t', s.tab)
  q.set('l', s.lang)
  return `#${q.toString()}`
}
