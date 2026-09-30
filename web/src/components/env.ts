import type { Prices } from '../engine/data'
import type { CommonOccupation } from '../engine/compare'
import type { Metric, MetricContext, TaxTables } from '../engine/metric'
import type { CountryCode, CountryMeta, FxData, Lang, Match, Profile } from '../engine/types'
import { label, listSep, type T } from '../i18n'

/** Everything the result cards need besides the profile: loaded once, shared by all cards. */
export interface Env {
  lang: Lang
  t: T
  metric: Metric
  fx: FxData
  /** metadata of every country whose data is published */
  metas: Partial<Record<CountryCode, CountryMeta>>
  prices: Partial<Record<CountryCode, Prices>>
  taxes: TaxTables
  common: CommonOccupation[]
}

/** Metadata of a country the UI already knows is published (the profile's country, comparison rows). */
export function metaOf(env: Env, country: CountryCode): CountryMeta {
  const m = env.metas[country]
  if (!m) throw new Error(`no data for ${country}`)
  return m
}

export function ctxFor(env: Env, country: CountryCode, region: string | null, age: number | null): MetricContext {
  return { country, meta: metaOf(env, country), region, age, prices: env.prices[country] ?? null, taxes: env.taxes }
}

export function describeGroup(env: Env, meta: CountryMeta, key: string, region: string | null): string {
  const { t, lang } = env
  const [occ, age, sex, edu] = key.split('|')
  const parts: string[] = [t.countries[meta.country]]
  if (region) parts.push(label(meta.regions.find((r) => r.code === region)?.label, lang))
  if (occ !== '*') {
    const o = occ.startsWith('M') ? meta.occupationMajor.find((m) => m.code === occ) : meta.occupations.find((x) => x.code === occ)
    parts.push(label(o?.label, lang))
  }
  if (age !== '*') parts.push(lang === 'en' ? `age ${age}` : ageLabel(age, lang))
  if (sex !== '*') parts.push(t.sexes[sex as 'M' | 'F'])
  if (edu !== '*') parts.push(t.educations[edu as keyof T['educations']])
  return parts.join(' · ')
}

export function droppedText(env: Env, match: Pick<Match, 'dropped'>): string {
  return match.dropped.map((d) => env.t.dims[d]).join(listSep(env.lang))
}

export function ageLabel(band: string, lang: Lang): string {
  switch (lang) {
    case 'ja': return `${band.replace('-', '〜')}歳`
    case 'zh': return `${band.replace('-', '～')}岁`
    case 'ko': return `${band.replace('-', '~')}세`
    case 'vi': return `${band.replace('-', '–')} tuổi`
    default: return band
  }
}

export type { Profile }
