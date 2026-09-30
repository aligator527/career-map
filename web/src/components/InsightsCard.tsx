import { useEffect, useState } from 'react'
import { detailMajor, loadInsights, loadNational, loadRent, type Insight, type InsightsData, type RentData } from '../engine/data'
import { findCell } from '../engine/lookup'
import { takeHome } from '../engine/metric'
import type { Cells, CountryCode, Profile } from '../engine/types'
import { formatMoney, formatPct, label } from '../i18n'
import { ctxFor, metaOf, type Env } from './env'

type Verdict = { kind: 'consistent' | 'partly' | 'inconsistent' | 'none'; detail?: string }

/**
 * Compare a claim's quantity with the site's own statistics for the same group:
 * a salary range against the group's percentiles, a net/gross share against the tax model.
 */
function verdictFor(env: Env, ins: Insight, country: CountryCode, national: Cells | null, rent: RentData | null): Verdict {
  const q = ins.quantity
  if (!q) return { kind: 'none' }
  const meta = env.metas[country]
  if (!meta) return { kind: 'none' }
  const money = (v: number) => formatMoney(v, meta.currency, env.lang)
  if (q.kind === 'annual_salary' && national && q.currency === meta.currency) {
    const occupation = ins.occupation?.[country] ?? null
    const age = q.ageBand ? Number(q.ageBand.split('-')[0]) : null
    const m = findCell(meta, national, null, { country, region: null, occupation, age, sex: null, education: null, income: null })
    if (!m) return { kind: 'none' }
    const [p10, p25, , p75, p90] = m.cell.q
    const detail = `${money(p25)}–${money(p75)} (p10–p90 ${money(p10)}–${money(p90)})`
    const mid = (q.low + q.high) / 2
    if (q.low <= p75 && q.high >= p25 && mid >= p10 && mid <= p90) return { kind: 'consistent', detail }
    if (q.low <= p90 && q.high >= p10) return { kind: 'partly', detail }
    return { kind: 'inconsistent', detail }
  }
  if (q.kind === 'monthly_rent' && rent && q.currency === meta.currency) {
    // Claims are about new lets, official figures mostly about existing tenancies: allow a wide band
    const official = (q.region && rent.regions[q.region]) || rent.national
    const detail = `${money(official)} (${label(rent.basis, env.lang)}, ${rent.period})`
    const high = q.high ?? q.low
    if (q.low <= official * 1.3 && high >= official * 0.8) return { kind: 'consistent', detail }
    if (q.low <= official * 1.8 && high >= official * 0.6) return { kind: 'partly', detail }
    return { kind: 'inconsistent', detail }
  }
  if (q.kind === 'net_share' && country) {
    const ctx = ctxFor(env, country, null, 30)
    const grossRange = q.grossLow != null && q.grossHigh != null ? [q.grossLow, q.grossHigh] : null
    if (!grossRange) return { kind: 'none' }
    const shares = grossRange.map((g) => takeHome(ctx, g).net / g)
    const lo = Math.min(...shares)
    const hi = Math.max(...shares)
    const detail = `${formatPct(lo, env.lang)}–${formatPct(hi, env.lang)}`
    if (q.low <= hi && q.high >= lo) return { kind: 'consistent', detail }
    return { kind: 'inconsistent', detail }
  }
  return { kind: 'none' }
}

export function InsightsCard({ env, country, profile }: { env: Env; country: CountryCode; profile: Profile }) {
  const { t, lang } = env
  const [data, setData] = useState<InsightsData | null>(null)
  const [national, setNational] = useState<{ country: CountryCode; cells: Cells } | null>(null)
  useEffect(() => {
    loadInsights().then(setData).catch(() => setData(null))
  }, [])
  const items = (data?.insights ?? []).filter((i) => i.countries.includes(country))
  const needsCells = items.some((i) => i.quantity?.kind === 'annual_salary')
  const needsRent = items.some((i) => i.quantity?.kind === 'monthly_rent')
  const [rent, setRent] = useState<{ country: CountryCode; data: RentData } | null>(null)
  useEffect(() => {
    if (!needsRent) return
    let live = true
    loadRent(country).then((data) => live && setRent({ country, data })).catch(() => {})
    return () => { live = false }
  }, [country, needsRent])
  useEffect(() => {
    if (!needsCells || !env.metas[country]) return
    const meta = metaOf(env, country)
    const majors = items.map((i) => detailMajor(meta, i.occupation?.[country]))
    let live = true
    loadNational(country, majors).then((cells) => live && setNational({ country, cells })).catch(() => {})
    return () => { live = false }
  }, [country, needsCells, env.metas])

  if (!data?.published || !items.length) return null
  const cells = national?.country === country ? national.cells : null
  void profile
  return (
    <section className="card insights">
      <h2>{t.insightsTitle(t.countries[country as keyof typeof t.countries] ?? country)}</h2>
      <p className="note">{t.insightsLead}</p>
      <ul className="effects">
        {items.map((ins) => {
          const v = verdictFor(env, ins, country, cells, rent?.country === country ? rent.data : null)
          return (
            <li key={ins.id}>
              <div className="effect-head">
                {v.kind !== 'none' && <span className={`badge verdict-${v.kind}`}>{t.verdicts[v.kind]}</span>}
                <span className="effect-label">{label(ins.claim, lang)}</span>
              </div>
              <p className="note">{t.insightsCorroboration(ins.users, ins.threads.length, ins.period[0], ins.period[1])}
                {ins.counterpoints > 0 ? ` · ${t.insightsCounterpoints(ins.counterpoints)}` : ''}</p>
              {v.detail && <p className="visa-check">{t.insightsOfficial}: {v.detail}</p>}
              {ins.caveats && <p className="note">{label(ins.caveats, lang)}</p>}
              <div className="effect-source">
                {ins.threads.map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer">{`${t.insightsThread} ${i + 1}`}</a>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ' · ', el] : [el]), [])}
              </div>
            </li>
          )
        })}
      </ul>
      {data.access && <p className="note">{label(data.access, lang)}</p>}
    </section>
  )
}
