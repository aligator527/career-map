import type { Prices, StateTaxTable } from './data'
import { takeHomeCA, takeHomeDE, takeHomeFR, takeHomeIT, takeHomeJP, takeHomeUK, takeHomeUS, type CaTaxTable, type TakeHome } from './tax'
import type { CountryCode, CountryMeta } from './types'

/** Which amount to show: gross pay, take-home pay, or take-home adjusted for regional prices. */
export type Metric = 'gross' | 'net' | 'real'

export interface MetricContext {
  country: CountryCode
  meta: CountryMeta
  region: string | null
  age: number | null
  prices: Prices | null
  taxes: TaxTables
}

/** Sub-national tax tables loaded from data files (null when unavailable). */
export interface TaxTables {
  us: StateTaxTable | null
  ca: CaTaxTable | null
}

export function takeHome(ctx: MetricContext, gross: number): TakeHome {
  const abbr = ctx.region ? ctx.meta.regions.find((r) => r.code === ctx.region)?.abbr ?? null : null
  switch (ctx.country) {
    case 'JP': return takeHomeJP(gross, ctx.age)
    case 'US': return takeHomeUS(gross, abbr ? ctx.taxes.us?.states[abbr] ?? null : null)
    case 'UK': return takeHomeUK(gross, abbr === 'SCT')
    case 'CA': return ctx.taxes.ca ? takeHomeCA(gross, abbr ?? 'ON', ctx.taxes.ca) : { gross, social: 0, incomeTax: 0, localTax: 0, net: gross }
    case 'DE': return takeHomeDE(gross)
    case 'FR': return takeHomeFR(gross)
    case 'IT': return takeHomeIT(gross)
  }
}

/** Regional price level relative to the national average (1 = average). */
export function priceLevel(ctx: MetricContext): number {
  if (!ctx.region || !ctx.prices) return 1
  let p: number | undefined = ctx.prices.regions[ctx.region]?.all
  if (p == null) {
    // Metropolitan areas have no index of their own: use the state / province they belong to
    const metro = ctx.meta.regions.find((r) => r.code === ctx.region)
    const parent = metro?.kind === 'metro' ? ctx.meta.regions.find((r) => r.kind !== 'metro' && r.abbr === metro.abbr) : null
    p = parent ? ctx.prices.regions[parent.code]?.all : undefined
  }
  return p ? p / 100 : 1
}

/**
 * Convert a gross annual amount to the chosen metric. Monotone in gross pay, so it can be
 * applied to quantiles directly (the median of take-home pay = take-home of the median).
 */
export function convert(metric: Metric, ctx: MetricContext, gross: number): number {
  if (metric === 'gross') return gross
  const net = takeHome(ctx, gross).net
  return metric === 'net' ? net : net / priceLevel(ctx)
}
