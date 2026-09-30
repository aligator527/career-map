import type { CountryCode, Education } from './types'

/** Countries in display order. */
export const COUNTRIES: CountryCode[] = ['JP', 'US', 'UK', 'CA', 'DE', 'FR', 'IT']

export const CURRENCY: Record<CountryCode, string> = {
  JP: 'JPY', US: 'USD', UK: 'GBP', CA: 'CAD', DE: 'EUR', FR: 'EUR', IT: 'EUR',
}

/** Unit the income field is entered in (Japanese users think in 万円). */
export const INCOME_UNIT: Record<CountryCode, number> = { JP: 10_000, US: 1, UK: 1, CA: 1, DE: 1, FR: 1, IT: 1 }

/** Regions shown in the "Region" comparison tab (the profile's own region is added first). */
export const MAJOR_REGIONS: Record<CountryCode, string[]> = {
  JP: ['13', '14', '23', '27', '40', '01'],
  US: ['06', '36', '48', '53', '17', '12'],
  UK: ['E12000007', 'E12000008', 'E12000002', 'S92000003', 'W92000004', 'N92000002'],
  CA: ['35', '24', '59', '48', '46', '12'],
  DE: ['DE2', 'DE1', 'DEA', 'DE3', 'DE6', 'DED'],
  FR: ['FR1', 'FRK', 'FRL', 'FRJ', 'FRE', 'FRH'],
  IT: ['ITC', 'ITH', 'ITI', 'ITF', 'ITG'],
}

// Closest equivalents when a country uses different education levels, in order of preference.
const EDUCATION_EQUIVALENTS: Record<Education, Education[]> = {
  secondary: ['upper_secondary', 'lower_secondary'],
  short_tertiary: ['tertiary'],
  bachelor: ['tertiary'],
  graduate: ['tertiary'],
  lower_secondary: ['secondary'],
  upper_secondary: ['secondary'],
  tertiary: ['bachelor'],
}

/** The profile's education expressed in another country's levels (null if that country has none). */
export function mapEducation(edu: Education | null, levels: Education[]): Education | null {
  if (!edu || !levels.length) return null
  if (levels.includes(edu)) return edu
  return EDUCATION_EQUIVALENTS[edu].find((e) => levels.includes(e)) ?? null
}

/** Major occupation groups that count as "manager" in each country's classification. */
export const MANAGER_CODES: Record<CountryCode, string[]> = {
  JP: ['MA'], US: ['M11'], UK: ['M11', 'M12'], CA: ['M0'], DE: ['MOC1'], FR: ['MOC1'], IT: ['MOC1'],
}
