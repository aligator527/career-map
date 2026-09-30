/**
 * Facets: extra dimensions (industry, company size, field of study, citizenship, language, type of work)
 * published separately from the main cells. Key: "<facet>=<value>|<occ>|<age>|<sex>".
 */

import { ageBand, majorOf, toCell } from './lookup'
import type { Cell, Cells, CountryMeta, Dim, Profile } from './types'

export interface FacetMatch {
  key: string
  cell: Cell
  dropped: Dim[]
}

function options(meta: CountryMeta, p: Profile): { occ: [string, number][]; age: [string, number][]; sex: [string, number][]; band: string | null } {
  const band = p.age != null ? ageBand(p.age, meta.ages) : null
  const occ: [string, number][] = [['*', 0]]
  if (p.occupation) {
    const major = majorOf(meta, p.occupation)
    if (major && major !== p.occupation) occ.unshift([major, 3])
    occ.unshift([p.occupation, p.occupation.startsWith('M') ? 3 : 5])
  }
  return {
    occ,
    age: band ? [[band, 3], ['*', 0]] : [['*', 0]],
    sex: p.sex ? [[p.sex, 1], ['*', 0]] : [['*', 0]],
    band,
  }
}

function dropped(p: Profile, band: string | null, occ: string, age: string, sex: string): Dim[] {
  const d: Dim[] = []
  if (p.occupation && occ === '*') d.push('occupation')
  if (band && age === '*') d.push('age')
  if (p.sex && sex === '*') d.push('sex')
  return d
}

/** The most specific published cell for one facet value, relaxing occupation, age and sex. */
export function facetCell(meta: CountryMeta, cells: Cells, p: Profile, dim: string, value: string): FacetMatch | null {
  const o = options(meta, p)
  let best: { score: number; key: string; occ: string; age: string; sex: string } | null = null
  for (const [occ, ow] of o.occ)
    for (const [age, aw] of o.age)
      for (const [sex, sw] of o.sex) {
        const key = `${dim}=${value}|${occ}|${age}|${sex}`
        const score = ow + aw + sw
        if (cells[key] && (!best || score > best.score)) best = { score, key, occ, age, sex }
      }
  if (!best) return null
  return { key: best.key, cell: toCell(cells[best.key]), dropped: dropped(p, o.band, best.occ, best.age, best.sex) }
}

/**
 * One cell per value of a facet, all with the same occupation/age/sex pattern so the rows are comparable:
 * the most specific pattern that at least half of the values publish.
 */
export function facetRows(meta: CountryMeta, cells: Cells, p: Profile, dim: string): { value: string; match: FacetMatch }[] {
  const values = meta.facets?.[dim]?.values.map((v) => v.code) ?? []
  const o = options(meta, p)
  const patterns: { occ: string; age: string; sex: string; score: number; coverage: number }[] = []
  for (const [occ, ow] of o.occ)
    for (const [age, aw] of o.age)
      for (const [sex, sw] of o.sex) {
        const coverage = values.filter((v) => cells[`${dim}=${v}|${occ}|${age}|${sex}`]).length
        patterns.push({ occ, age, sex, score: ow + aw + sw, coverage })
      }
  const ok = patterns.filter((x) => x.coverage >= Math.max(2, values.length / 2))
  const best = (ok.length ? ok : patterns).sort((a, b) => b.score - a.score || b.coverage - a.coverage)[0]
  if (!best) return []
  return values.flatMap((value) => {
    const key = `${dim}=${value}|${best.occ}|${best.age}|${best.sex}`
    return cells[key] ? [{ value, match: { key, cell: toCell(cells[key]), dropped: dropped(p, o.band, best.occ, best.age, best.sex) } }] : []
  })
}
