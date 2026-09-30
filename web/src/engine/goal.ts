/**
 * Goal simulation (Phase 4). Everything here is cross-sectional: "reaching a goal at age A" is
 * estimated from people who are age A today, not by following the same people over time.
 */

import { crosswalk, rate, type CommonOccupation, type Conversion } from './compare'
import { COUNTRIES, MANAGER_CODES, mapEducation } from './countries'
import { ageBand, cellKey, findCell } from './lookup'
import { percentileOf } from './stats'
import type { Cell, Cells, CellTuple, CountryCode, CountryMeta, Dim, Education, FxData, Profile } from './types'

export type Goal = { kind: 'income'; amount: number; age: number } | { kind: 'manager'; age: number }

export interface GoalResult {
  share: number
  /** people the estimate is based on (population estimate) */
  pop: number
  key: string
  regional: boolean
  dropped: Dim[]
}

export interface CountryData {
  meta: CountryMeta
  national: Cells
}

export interface GoalInputs {
  profile: Profile
  home: CountryData
  /** the profile region's cells, if a region is set */
  regional: Cells | null
  /** every region's summary cells (for region options) */
  regions: Record<string, Cells> | null
  others: Partial<Record<CountryCode, CountryData>>
  fx: FxData
  conversion: Conversion
  common: CommonOccupation[]
}

export function shareAbove(cell: Cell, amount: number): number {
  return 1 - percentileOf(amount, cell.q)
}

// ---------------------------------------------------------------- one estimate

function incomeResult(meta: CountryMeta, national: Cells, regional: Cells | null, p: Profile, amount: number): GoalResult | null {
  const m = findCell(meta, national, regional, p)
  if (!m) return null
  return { share: shareAbove(m.cell, amount), pop: m.cell.pop, key: m.key, regional: m.regional, dropped: m.dropped }
}

const WEIGHT = { region: 4, age: 3, education: 2, sex: 1 }

/**
 * Share of people in manager occupations: pop(manager | age, sex, edu) / pop(all | age, sex, edu),
 * using the most specific combination for which both are published in the same table.
 */
function managerResult(meta: CountryMeta, national: Cells, regional: Cells | null, p: Profile): GoalResult | null {
  const codes = MANAGER_CODES[meta.country].filter((c) => meta.occupationMajor.some((m) => m.code === c))
  if (!codes.length) return null
  const age = p.age != null ? ageBand(p.age, meta.ages) : null
  const opt = (v: string | null, w: number): [string, number][] => (v ? [[v, w], ['*', 0]] : [['*', 0]])
  const tables: [Cells, boolean, number][] = [[national, false, 0]]
  if (regional && p.region) tables.unshift([regional, true, WEIGHT.region])
  let best: (GoalResult & { score: number }) | null = null
  for (const [cells, isRegional, rw] of tables)
    for (const [a, aw] of opt(age, WEIGHT.age))
      for (const [s, sw] of opt(p.sex, WEIGHT.sex))
        for (const [e, ew] of opt(p.education, WEIGHT.education)) {
          const total = cells[cellKey('*', a, s, e)]
          const parts = codes.map((c) => cells[cellKey(c, a, s, e)])
          if (!total || parts.some((x) => !x) || (total[8] ?? total[0]) <= 0) continue
          const score = rw + aw + sw + ew
          if (best && score <= best.score) continue
          const pop = (t: typeof total) => t[8] ?? t[0]
          const dropped: Dim[] = []
          if (p.region && !isRegional) dropped.push('region')
          if (age && a === '*') dropped.push('age')
          if (p.sex && s === '*') dropped.push('sex')
          if (p.education && e === '*') dropped.push('education')
          best = {
            score, share: Math.min(parts.reduce((sum, x) => sum + pop(x!), 0) / pop(total), 1), pop: pop(total),
            key: cellKey('*', a, s, e), regional: isRegional, dropped,
          }
        }
  if (!best) return null
  const { score: _score, ...result } = best
  return result
}

function evaluate(goal: Goal, meta: CountryMeta, national: Cells, regional: Cells | null, p: Profile, amount?: number): GoalResult | null {
  return goal.kind === 'income'
    ? incomeResult(meta, national, regional, p, amount ?? goal.amount)
    : managerResult(meta, national, regional, p)
}

/** The goal for the profile at the target age. */
export function goalResult(goal: Goal, g: GoalInputs): GoalResult | null {
  return evaluate(goal, g.home.meta, g.home.national, g.regional, { ...g.profile, age: goal.age })
}

// ---------------------------------------------------------------- by age

export interface AgePoint {
  band: string
  share: number
  target: boolean
}

/** The share at every age band, other conditions unchanged (bands where age had to be dropped are left out). */
export function ageCurve(goal: Goal, g: GoalInputs): AgePoint[] {
  const { meta, national } = g.home
  const target = ageBand(goal.age, meta.ages)
  return meta.ages.flatMap((band) => {
    const lo = Number(band.split('-')[0])
    const r = evaluate(goal, meta, national, g.regional, { ...g.profile, age: lo })
    return r && !r.dropped.includes('age') ? [{ band, share: r.share, target: band === target }] : []
  })
}

// ---------------------------------------------------------------- one condition changed

export type OptionKind = 'occupation' | 'education' | 'region' | 'country'

export interface GoalOption {
  kind: OptionKind
  code: string
  country: CountryCode
  result: GoalResult
}

/**
 * Change one condition at a time and recompute the goal. An option is kept only when the changed
 * condition is reflected in the matched cell and no other condition had to be dropped beyond what the
 * baseline already dropped — otherwise it would compare a different kind of group.
 *
 * Countries are compared only for income goals: what counts as a "manager" differs too much between
 * national occupation classifications for the shares to be comparable.
 */
export function goalOptions(goal: Goal, g: GoalInputs): GoalOption[] {
  const { meta, national } = g.home
  const p = { ...g.profile, age: goal.age }
  const all: GoalOption[] = []
  const home = meta.country
  const base = goalResult(goal, g)

  if (goal.kind === 'income') {
    const codes = [...meta.occupationMajor.map((m) => m.code), ...meta.occupations.map((o) => o.code)]
    for (const code of codes) {
      if (code === p.occupation) continue
      const m = findCell(meta, national, g.regional, { ...p, occupation: code })
      if (m && m.key.split('|')[0] === code) {
        all.push({ kind: 'occupation', code, country: home, result: { share: shareAbove(m.cell, goal.amount), pop: m.cell.pop, key: m.key, regional: m.regional, dropped: m.dropped } })
      }
    }
  }

  for (const edu of meta.educations) {
    if (edu === p.education) continue
    const r = evaluate(goal, meta, national, g.regional, { ...p, education: edu })
    if (r && r.key.split('|')[3] === edu) all.push({ kind: 'education', code: edu, country: home, result: r })
  }

  for (const [code, cells] of Object.entries(g.regions ?? {})) {
    if (code === p.region) continue
    const r = evaluate(goal, meta, national, cells, { ...p, region: code })
    if (r?.regional) all.push({ kind: 'region', code, country: home, result: r })
  }

  for (const c of goal.kind === 'income' ? COUNTRIES : []) {
    const other = g.others[c]
    if (c === home || !other) continue
    const occupation = crosswalk(g.common, meta, other.meta, p.occupation)
    const education = mapEducation(p.education, other.meta.educations)
    const amount = goal.kind === 'income' ? goal.amount * rate(g.fx, meta.currency, other.meta.currency, g.conversion) : undefined
    const r = evaluate(goal, other.meta, other.national, null, { ...p, country: c, region: null, occupation, education }, amount)
    if (r) {
      if (p.occupation && !occupation && !r.dropped.includes('occupation')) r.dropped.push('occupation')
      all.push({ kind: 'country', code: c, country: c, result: r })
    }
  }
  const allowed = new Set<Dim>(base?.dropped ?? [])
  return all.filter((o) =>
    o.result.dropped.every((d) => allowed.has(d) || (o.kind === 'country' && d === 'region') || (o.kind === 'region' && d === 'region')),
  )
}

// ---------------------------------------------------------------- who reaches it

export interface Composition {
  code: string
  /** share of all achievers at the target age */
  shareOfAchievers: number
  /** achievement rate within the group */
  rate: number
}

/**
 * Among everyone at the target age (any occupation / education) who reaches the income goal:
 * which occupation groups and education levels they come from. Uses population × share.
 */
export function achievers(goal: Extract<Goal, { kind: 'income' }>, g: GoalInputs): { occupations: Composition[]; educations: Composition[]; educationAllAges: boolean } {
  const { meta, national } = g.home
  const age = ageBand(goal.age, meta.ages) ?? '*'
  const compose = (keys: [string, string][]) => {
    const rows = keys.flatMap(([code, key]) => {
      const t = national[key]
      if (!t) return []
      const cell: Cell = { n: t[0], pop: t[8] ?? t[0], mean: t[1], q: [t[2], t[3], t[4], t[5], t[6]], method: 0 }
      const r = shareAbove(cell, goal.amount)
      return [{ code, rate: r, achievers: cell.pop * r }]
    })
    const total = rows.reduce((s, x) => s + x.achievers, 0)
    return rows
      .map((x) => ({ code: x.code, rate: x.rate, shareOfAchievers: total > 0 ? x.achievers / total : 0 }))
      .sort((a, b) => b.shareOfAchievers - a.shareOfAchievers)
  }
  const occupations = compose(meta.occupationMajor.map((m) => [m.code, cellKey(m.code, age, '*', '*')]))
  let educationAllAges = false
  let educations = compose(meta.educations.map((e: Education) => [e, cellKey('*', age, '*', e)]))
  if (!educations.length) {
    educationAllAges = true
    educations = compose(meta.educations.map((e: Education) => [e, cellKey('*', '*', '*', e)]))
  }
  return { occupations, educations, educationAllAges }
}


// ---------------------------------------------------------------- self-employment (US, Canada)

/**
 * Share of full-time, full-year workers who are self-employed or run their own business, from the
 * `employment` facet: pop(self_employed) / (pop(employee) + pop(self_employed)) for the same group.
 */
export function selfEmployedShare(meta: CountryMeta, facets: Cells, p: Profile): GoalResult | null {
  const band = p.age != null ? ageBand(p.age, meta.ages) : null
  const major = p.occupation ? (p.occupation.startsWith('M') ? p.occupation : majorOfCode(meta, p.occupation)) : null
  const opts = (v: string | null, w: number): [string, number][] => (v ? [[v, w], ['*', 0]] : [['*', 0]])
  let best: (GoalResult & { score: number }) | null = null
  for (const [occ, ow] of opts(major, 3))
    for (const [age, aw] of opts(band, 3))
      for (const [sex, sw] of opts(p.sex, 1)) {
        const se = facets[`employment=self_employed|${occ}|${age}|${sex}`]
        const em = facets[`employment=employee|${occ}|${age}|${sex}`]
        if (!se || !em) continue
        const score = ow + aw + sw
        if (best && score <= best.score) continue
        const pop = (t: CellTuple) => t[8] ?? t[0]
        const dropped: Dim[] = []
        if (p.occupation && occ === '*') dropped.push('occupation')
        if (band && age === '*') dropped.push('age')
        if (p.sex && sex === '*') dropped.push('sex')
        best = { score, share: pop(se) / (pop(se) + pop(em)), pop: pop(se) + pop(em), key: `${occ}|${age}|${sex}|*`, regional: false, dropped }
      }
  if (!best) return null
  const { score: _score, ...r } = best
  return r
}

function majorOfCode(meta: CountryMeta, occ: string): string | null {
  const o = meta.occupations.find((x) => x.code === occ)
  return o ? `M${o.major}` : null
}
