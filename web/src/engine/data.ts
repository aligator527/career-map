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
export const loadNational = (c: CountryCode) => load<Cells>(`${dir(c)}/national.json`)
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
