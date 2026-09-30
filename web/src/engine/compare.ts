import { findCell } from './lookup'
import { detailMajor, loadMeta, loadNational, loadRegion } from './data'
import { MAJOR_REGIONS, mapEducation } from './countries'
import type { CountryCode, CountryMeta, Education, FxData, Label, Match, Profile } from './types'

export type CompareKind = 'age' | 'education' | 'region' | 'country'

export interface CompareRow {
  id: string
  /** i18n key or literal label resolved by the UI */
  label: { kind: 'age'; band: string } | { kind: 'education'; edu: Education } | { kind: 'region'; country: CountryCode; code: string } | { kind: 'country'; country: CountryCode }
  current: boolean
  match: Match
  country: CountryCode
  /** where the group lives, for take-home tax and price adjustments (null = national) */
  region: string | null
  /** multiply cell values by this to express them in the profile's currency */
  factor: number
}

export type Conversion = 'ppp' | 'fx'

/** Local-currency units of `to` per unit of `from`. */
export function rate(fx: FxData, from: string, to: string, conv: Conversion): number {
  const t = conv === 'ppp' ? fx.ppp : fx.fx
  return t[to] / t[from]
}

/** Roles defined in every country's own classification, for comparing the same job across countries. */
export interface CommonOccupation {
  id: string
  label: Label
  codes: Partial<Record<CountryCode, string[]>>
}

/**
 * Map an occupation to the closest one in another country: first through the shared role list,
 * then (Japan ↔ US) through the detailed SOC crosswalk. Returns null when there is no reasonable match.
 */
export function crosswalk(common: CommonOccupation[], fromMeta: CountryMeta, toMeta: CountryMeta, occ: string | null): string | null {
  if (!occ) return null
  const exists = (code: string) => code.startsWith('M')
    ? toMeta.occupationMajor.some((m) => m.code === code)
    : toMeta.occupations.some((o) => o.code === code)
  // A code shared by several roles (e.g. an ISCO major group) says nothing about which role it is
  const roles = common.filter((r) => r.codes[fromMeta.country]?.includes(occ))
  const viaRole = roles.length === 1 ? roles[0].codes[toMeta.country]?.find(exists) : undefined
  if (viaRole) return viaRole
  if (occ.startsWith('M')) return null
  if (fromMeta.country === 'JP' && toMeta.country === 'US') {
    const soc = fromMeta.occupations.find((o) => o.code === occ)?.us?.[0]
    return soc && exists(soc) ? soc : null
  }
  if (fromMeta.country === 'US' && toMeta.country === 'JP') {
    return toMeta.occupations.find((o) => o.us?.[0] === occ)?.code ?? toMeta.occupations.find((o) => o.us?.includes(occ))?.code ?? null
  }
  return null
}

export async function buildComparison(
  kind: CompareKind, p: Profile, fx: FxData, conv: Conversion, countries: CountryCode[], common: CommonOccupation[],
): Promise<CompareRow[]> {
  const meta = await loadMeta(p.country)
  const national = await loadNational(p.country, [detailMajor(meta, p.occupation)])
  const regional = p.region ? await loadRegion(p.country, p.region) : null
  const rows: CompareRow[] = []
  const push = (
    id: string, label: CompareRow['label'], current: boolean, match: Match | null,
    country = p.country, factor = 1, region = p.region,
  ) => {
    if (match) rows.push({ id, label, current, match, country, region, factor })
  }

  if (kind === 'age') {
    for (const band of meta.ages) {
      if (band === '18-19' || band === '65-69') continue
      const lo = Number(band.split('-')[0])
      const current = p.age != null && p.age >= lo && p.age <= lo + 4
      push(band, { kind: 'age', band }, current, findCell(meta, national, regional, { ...p, age: lo + 2 }))
    }
  } else if (kind === 'education') {
    for (const edu of meta.educations)
      push(edu, { kind: 'education', edu }, p.education === edu, findCell(meta, national, regional, { ...p, education: edu }))
  } else if (kind === 'region') {
    const codes = [...new Set([...(p.region ? [p.region] : []), ...MAJOR_REGIONS[p.country]])]
    const tables = await Promise.all(codes.map((c) => loadRegion(p.country, c).catch(() => null)))
    codes.forEach((code, i) =>
      push(code, { kind: 'region', country: p.country, code }, code === p.region,
        findCell(meta, national, tables[i], { ...p, region: code }), p.country, 1, code),
    )
  } else {
    for (const c of countries) {
      if (c === p.country) {
        push(c, { kind: 'country', country: c }, true, findCell(meta, national, null, { ...p, region: null }), c, 1, null)
        continue
      }
      const otherMeta = await loadMeta(c)
      const occupation = crosswalk(common, meta, otherMeta, p.occupation)
      const other = await loadNational(c, [detailMajor(otherMeta, occupation)])
      const education = mapEducation(p.education, otherMeta.educations)
      const match = findCell(otherMeta, other, null, { ...p, country: c, region: null, occupation, education })
      if (match && p.occupation && !occupation && !match.dropped.includes('occupation')) match.dropped.push('occupation')
      push(c, { kind: 'country', country: c }, false, match, c, rate(fx, otherMeta.currency, meta.currency, conv), null)
    }
  }
  return rows
}
