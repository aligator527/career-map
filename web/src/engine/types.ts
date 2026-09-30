export type Lang = 'ja' | 'en'
export type Label = Partial<Record<Lang, string>> & { en?: string }

export type CountryCode = 'JP' | 'US' | 'UK' | 'CA' | 'DE' | 'FR' | 'IT'
export type Sex = 'M' | 'F'
/** JP/US/CA use the first four; the Eurostat countries use ISCED groups (lower/upper secondary, tertiary). */
export type Education =
  | 'secondary' | 'short_tertiary' | 'bachelor' | 'graduate'
  | 'lower_secondary' | 'upper_secondary' | 'tertiary'

export interface Source {
  id: string
  name: Label
  url: string
}

export interface Occupation {
  code: string
  /** code of the major group, without the leading 'M' (JP: 大分類 letter, US: first two SOC digits, …) */
  major: string
  label: Label
  /** JP only: closest US SOC codes */
  us?: string[]
}

export interface CountryMeta {
  country: CountryCode
  currency: string
  year: number
  wageDefinition: Label
  nKind?: 'population'
  source: Source
  regions: { code: string; abbr?: string; label: Label }[]
  occupationMajor: { code: string; label: Label }[]
  occupations: Occupation[]
  ages: string[]
  educations: Education[]
}

/** [n, mean, p10, p25, p50, p75, p90, method?, pop?] — pop (weighted population) only for microdata; otherwise n is already a population estimate */
export type CellTuple = [number, number, number, number, number, number, number, number?, number?]
export type Cells = Record<string, CellTuple>

/** 0 = direct (microdata or published percentiles), 1 = tabulated histogram (scaled), 2 = lognormal fit,
 *  3 = mean with the shape of another year, 4 = published percentiles with gaps interpolated */
export type Method = 0 | 1 | 2 | 3 | 4

export interface Cell {
  n: number
  /** estimated number of people the cell represents */
  pop: number
  mean: number
  q: [number, number, number, number, number]
  method: Method
}

export interface FxData {
  source: Source & { name: Label }
  year: { fx: string; ppp: string }
  fx: Record<string, number>
  ppp: Record<string, number>
}

export interface Profile {
  country: CountryCode
  region: string | null
  occupation: string | null
  age: number | null
  sex: Sex | null
  education: Education | null
  /** annual income in the country's currency */
  income: number | null
}

export type Dim = 'region' | 'occupation' | 'age' | 'sex' | 'education'

export interface Match {
  cell: Cell
  key: string
  regional: boolean
  /** dimensions the user specified that the matched cell does not condition on */
  dropped: Dim[]
  /** occupation matched at major-group level instead of the detailed occupation */
  occupationCoarsened: boolean
}
