/**
 * Job changes and promotions (Phase 5). Japan: Survey on Employment Trends + Wage Census job ranks.
 * US: CPS ASEC (employers last year, occupation change). All cross-sectional group statistics.
 */

import { ageBand } from './lookup'
import type { CountryMeta, Label, Profile } from './types'

export interface JpMobility {
  source: Record<'payChange' | 'ranks', Label & { url: string }>
  /** "age|sex": [n (thousand), up10, upLess10, same, downLess10, down10, unknown] (%) */
  payChange: Record<string, number[]>
  /** "age|sex": job-change entry rate (%) */
  changeRate: Record<string, number>
  /** "age|sex|edu": rank → [workers, annual pay | null] */
  ranks: Record<string, Partial<Record<Rank, [number, number | null]>>>
}

export const RANKS = ['bucho', 'kacho', 'kakari', 'shokucho', 'other', 'none'] as const
export type Rank = (typeof RANKS)[number]

export interface UsMobility {
  source: { name: Label; url: string }
  ages: string[]
  /** "occ|age|sex|edu": [n, multiEmployer, occupationChange | null, medianOne | null, medianMulti | null] */
  cells: Record<string, [number, number, number | null, number | null, number | null]>
}

/** First existing key when relaxing sex, then age. */
function relax<T>(table: Record<string, T>, age: string | null, sex: string | null): { key: string; value: T } | null {
  for (const a of [age ?? '*', '*']) {
    for (const s of [sex ?? '*', '*']) {
      const key = `${a}|${s}`
      if (table[key] !== undefined) return { key, value: table[key] }
    }
  }
  return null
}

export function jpJobChange(meta: CountryMeta, data: JpMobility, p: Profile) {
  const age = p.age != null ? ageBand(p.age, meta.ages) : null
  const pay = relax(data.payChange, age, p.sex)
  const rate = relax(data.changeRate, age, p.sex)
  if (!pay) return null
  const [n, up10, up, same, down, down10, unknown] = pay.value
  return { key: pay.key, n: n * 1000, dist: { up10, up, same, down, down10, unknown }, rate: rate?.value ?? null, rateKey: rate?.key ?? null }
}

export interface RankShares {
  band: string
  total: number
  shares: Record<Rank, number>
  pay: Partial<Record<Rank, number>>
}

/** Rank composition by age for the profile's sex and education (relaxing education, then sex). */
export function jpRanks(meta: CountryMeta, data: JpMobility, p: Profile): { bands: RankShares[]; sex: string; edu: string } | null {
  for (const edu of [p.education ?? '*', '*']) {
    for (const sex of [p.sex ?? '*', '*']) {
      const bands = meta.ages.flatMap((band) => {
        const cell = data.ranks[`${band}|${sex}|${edu}`]
        if (!cell) return []
        const total = RANKS.reduce((s, r) => s + (cell[r]?.[0] ?? 0), 0)
        if (total <= 0) return []
        const shares = Object.fromEntries(RANKS.map((r) => [r, (cell[r]?.[0] ?? 0) / total])) as Record<Rank, number>
        const pay = Object.fromEntries(RANKS.flatMap((r) => (cell[r]?.[1] ? [[r, cell[r]![1]!]] : []))) as Partial<Record<Rank, number>>
        return [{ band, total, shares, pay }]
      })
      if (bands.length >= 3) return { bands, sex, edu }
    }
  }
  return null
}

const US_WEIGHT = { occ: 4, age: 3, education: 2, sex: 1 }

/** The most specific published US mobility cell for the profile (occupation at SOC major-group level). */
export function usMobility(data: UsMobility, p: Profile) {
  const occ = p.occupation ? (p.occupation.startsWith('M') ? p.occupation : `M${p.occupation.slice(0, 2)}`) : null
  const age = p.age != null ? ageBand(p.age, data.ages) : null
  const opt = (v: string | null, w: number): [string, number][] => (v ? [[v, w], ['*', 0]] : [['*', 0]])
  let best: { key: string; score: number; cell: UsMobility['cells'][string] } | null = null
  for (const [o, ow] of opt(occ, US_WEIGHT.occ))
    for (const [a, aw] of opt(age, US_WEIGHT.age))
      for (const [s, sw] of opt(p.sex, US_WEIGHT.sex))
        for (const [e, ew] of opt(p.education, US_WEIGHT.education)) {
          const key = `${o}|${a}|${s}|${e}`
          const cell = data.cells[key]
          const score = ow + aw + sw + ew
          if (cell && (!best || score > best.score)) best = { key, score, cell }
        }
  if (!best) return null
  const [n, multi, change, medOne, medMulti] = best.cell
  return { key: best.key, n, multi, change, medOne, medMulti }
}
