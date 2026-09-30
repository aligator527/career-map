import { HAS_RENT } from './countries'
import type { Cells, CountryCode, CountryMeta, FxData } from './types'

const base = import.meta.env.BASE_URL
const cache = new Map<string, Promise<unknown>>()

function load<T>(path: string): Promise<T> {
  let p = cache.get(path)
  if (!p) {
    p = fetch(`${base}data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
      return r.json()
    })
    p.catch(() => cache.delete(path))
    cache.set(path, p)
  }
  return p as Promise<T>
}

const dir = (c: CountryCode) => c.toLowerCase()

export const loadMeta = (c: CountryCode) => load<CountryMeta>(`${dir(c)}/meta.json`)
/**
 * National cells: the core file (all occupations and major groups) plus the detailed occupations of
 * the given major groups (occ-<major>.json, split out to keep the first load small).
 */
export async function loadNational(c: CountryCode, majors: (string | null | undefined)[] = []): Promise<Cells> {
  const wanted = [...new Set(majors.filter((m): m is string => !!m))]
  const [core, ...parts] = await Promise.all([
    load<Cells>(`${dir(c)}/national.json`),
    ...wanted.map((m) => load<Cells>(`${dir(c)}/occ-${m}.json`).catch(() => ({}))),
  ])
  return parts.length ? Object.assign({}, core, ...parts) : core
}

/** Major-group key (without "M") of a detailed occupation, for loadNational; null for "*" or a major group. */
export function detailMajor(meta: CountryMeta, occupation: string | null | undefined): string | null {
  if (!occupation || occupation.startsWith('M')) return null
  return meta.occupations.find((o) => o.code === occupation)?.major ?? null
}
export const loadRegion = (c: CountryCode, region: string) => load<Cells>(`${dir(c)}/region-${region}.json`)
export const loadFx = () => load<FxData>('fx.json')

export interface Prices {
  year: number
  source: { name: Record<string, string>; url: string }
  regions: Record<string, { all: number; housing: number }>
}

export interface StateTaxTable {
  _year: number
  _source: string
  states: Record<string, import('./tax').StateTax & { notes?: string }>
}

export const loadPrices = (c: CountryCode) => load<Prices>(`${dir(c)}/prices.json`)
export const loadRegions = (c: CountryCode) => load<Record<string, Cells>>(`${dir(c)}/regions.json`)
export const loadStateTax = () => load<StateTaxTable>('us/tax.json')
export const loadCaTax = () => load<import('./tax').CaTaxTable>('ca/tax.json')
export const loadCommonOccupations = () => load<import('./compare').CommonOccupation[]>('occupations.json')
export const loadJpMobility = () => load<import('./mobility').JpMobility>('jp/mobility.json')
export const loadUsMobility = () => load<import('./mobility').UsMobility>('us/mobility.json')

export interface ResearchEffect {
  id: string
  topic: 'schooling_year' | 'degree_premium' | 'graduate_premium' | 'language' | 'job_change' | 'certification' | 'city'
  countries: string[]
  label: import('./types').Label
  effect: { point: number; low: number | null; high: number | null; unit: 'log wage points' | 'percent' | 'ratio' | 'percentage_points' | 'share' | 'elasticity' }
  design: 'causal' | 'descriptive'
  population: string
  source: { authors: string; year: number; title: string; venue?: string; url: string }
  quote?: string
  notes?: string
}
export const loadResearch = () => load<{ compiled: string; effects: ResearchEffect[] }>('research.json')
export const loadCommunity = () => load<import('./community').CommunityData>('community.json')
export const loadFacets = (c: CountryCode) => load<Cells>(`${dir(c)}/facets.json`)

type L = import('./types').Label
export interface VisaRoute {
  id: string
  name: L
  summary: L
  requirements: L[]
  salaryThreshold?: { amount: number; currency: string; period: 'year'; note?: string }
  processingNote?: L
  source: { title: string; url: string }
  asOf: string
}
export interface VisaData {
  compiled: string
  disclaimer: L
  countries: Partial<Record<CountryCode, { freeMovement: L | null; routes: VisaRoute[] }>>
}
export const loadVisas = () => load<VisaData>('visas.json')
export const loadExperience = () => load<Record<string, [string, number, number][]>>('jp/experience.json')

export interface RentData {
  source: { name: import('./types').Label; url: string }
  period: string
  /** what the figure measures (size, utilities, stock vs new listings) */
  basis: import('./types').Label
  /** typical monthly rent (local currency) nationally and per region code */
  national: number
  regions: Record<string, number>
}
export const loadRent = (c: CountryCode) =>
  HAS_RENT.includes(c) ? load<RentData>(`${dir(c)}/rent.json`) : Promise.reject(new Error(`no rent data for ${c}`))

export interface Insight {
  id: string
  topic: string
  countries: string[]
  occupation: Partial<Record<CountryCode, string>> | null
  claim: import('./types').Label
  quantity: null | {
    kind: string; currency: string | null; low: number; high: number
    ageBand?: string | null; experienceYears?: [number, number] | null; grossLow?: number; grossHigh?: number; region?: string | null
  }
  caveats: import('./types').Label | null
  users: number
  threads: string[]
  period: [string, string]
  counterpoints: number
}
export interface InsightsData {
  published: boolean
  access: import('./types').Label | null
  insights: Insight[]
  pending: number
}
export const loadInsights = () => load<InsightsData>('insights.json')
