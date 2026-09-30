import type { Cell, Cells, CellTuple, CountryMeta, Dim, Match, Profile } from './types'

export function ageBand(age: number, bands: string[]): string | null {
  for (const b of bands) {
    const [lo, hi] = b.split('-').map(Number)
    if (age >= lo && age <= hi) return b
  }
  return null
}

export function majorOf(meta: CountryMeta, occ: string): string | null {
  if (occ.startsWith('M')) return occ
  const o = meta.occupations.find((x) => x.code === occ)
  return o ? `M${o.major}` : null
}

export function toCell(t: CellTuple): Cell {
  return { n: t[0], pop: t[8] ?? t[0], mean: t[1], q: [t[2], t[3], t[4], t[5], t[6]], method: (t[7] ?? 0) as Cell['method'] }
}

export function cellKey(occ: string, age: string, sex: string, edu: string): string {
  return `${occ}|${age}|${sex}|${edu}`
}

// How much each specified dimension is worth keeping. Occupation matters most for pay,
// then region, age, education, sex.
const WEIGHT = { occDetail: 5, occMajor: 3, region: 4, age: 3, education: 2, sex: 1 }

/**
 * Find the most specific published cell for a profile. Dimensions the user specified are
 * dropped (or the occupation coarsened to its major group) only when no cell exists with them.
 */
export function findCell(meta: CountryMeta, national: Cells, regional: Cells | null, p: Profile): Match | null {
  const age = p.age != null ? ageBand(p.age, meta.ages) : null
  const occOptions: [string, number, boolean][] = [['*', 0, false]]
  if (p.occupation) {
    occOptions.unshift([p.occupation, p.occupation.startsWith('M') ? WEIGHT.occMajor : WEIGHT.occDetail, false])
    const major = majorOf(meta, p.occupation)
    if (major && major !== p.occupation) occOptions.splice(1, 0, [major, WEIGHT.occMajor, true])
  }
  const opt = <T,>(v: T | null, w: number): [T | '*', number][] => (v ? [[v, w], ['*', 0]] : [['*', 0]])
  const tables: [Cells, boolean, number][] = [[national, false, 0]]
  if (regional && p.region) tables.unshift([regional, true, WEIGHT.region])

  let best: { match: Match; score: number } | null = null
  for (const [cells, isRegional, rw] of tables)
    for (const [occ, ow, coarsened] of occOptions)
      for (const [a, aw] of opt(age, WEIGHT.age))
        for (const [s, sw] of opt(p.sex, WEIGHT.sex))
          for (const [e, ew] of opt(p.education, WEIGHT.education)) {
            const key = cellKey(occ, a, s, e)
            const t = cells[key]
            if (!t) continue
            const score = rw + ow + aw + sw + ew
            if (best && (score < best.score || (score === best.score && t[0] <= best.match.cell.n))) continue
            const dropped: Dim[] = []
            if (p.region && !isRegional) dropped.push('region')
            if (p.occupation && occ === '*') dropped.push('occupation')
            if (age && a === '*') dropped.push('age')
            if (p.sex && s === '*') dropped.push('sex')
            if (p.education && e === '*') dropped.push('education')
            best = { score, match: { cell: toCell(t), key, regional: isRegional, dropped, occupationCoarsened: coarsened } }
          }
  return best?.match ?? null
}

/**
 * Pick one cell key to color every region on the map, so all regions show the same kind of
 * group. Takes the most specific key (same weights as findCell) that at least half of the
 * regions publish; regions without it are shown as "no data".
 */
export function mapKey(meta: CountryMeta, regions: Record<string, Cells>, p: Profile): { key: string; dropped: Dim[]; occupationCoarsened: boolean } {
  const age = p.age != null ? ageBand(p.age, meta.ages) : null
  const major = p.occupation ? majorOf(meta, p.occupation) : null
  const occs: [string, number][] = [['*', 0]]
  if (p.occupation) occs.unshift([p.occupation, p.occupation.startsWith('M') ? WEIGHT.occMajor : WEIGHT.occDetail])
  if (major && major !== p.occupation) occs.splice(1, 0, [major, WEIGHT.occMajor])
  const opt = (v: string | null, w: number): [string, number][] => (v ? [[v, w], ['*', 0]] : [['*', 0]])
  const tables = Object.values(regions)
  const candidates: { key: string; score: number; coverage: number; occ: string; a: string; s: string; e: string }[] = []
  for (const [occ, ow] of occs)
    for (const [a, aw] of opt(age, WEIGHT.age))
      for (const [s, sw] of opt(p.sex, WEIGHT.sex))
        for (const [e, ew] of opt(p.education, WEIGHT.education)) {
          const key = cellKey(occ, a, s, e)
          const coverage = tables.filter((t) => t[key]).length / Math.max(tables.length, 1)
          candidates.push({ key, score: ow + aw + sw + ew, coverage, occ, a, s, e })
        }
  const ok = candidates.filter((c) => c.coverage >= 0.5)
  const best = (ok.length ? ok : candidates).sort((x, y) => y.score - x.score || y.coverage - x.coverage)[0]
  const dropped: Dim[] = []
  if (p.occupation && best.occ === '*') dropped.push('occupation')
  if (age && best.a === '*') dropped.push('age')
  if (p.sex && best.s === '*') dropped.push('sex')
  if (p.education && best.e === '*') dropped.push('education')
  return { key: best.key, dropped, occupationCoarsened: !!p.occupation && best.occ !== '*' && best.occ !== p.occupation }
}
