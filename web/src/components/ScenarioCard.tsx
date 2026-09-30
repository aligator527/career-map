import { useEffect, useState } from 'react'
import { crosswalk, rate } from '../engine/compare'
import { COUNTRIES, mapEducation } from '../engine/countries'
import { detailMajor, loadNational, loadRegion, loadRent, type RentData } from '../engine/data'
import { findCell } from '../engine/lookup'
import { priceLevel, takeHome } from '../engine/metric'
import type { Cells, CountryCode, Match, Profile } from '../engine/types'
import { formatMoney, formatPct, label } from '../i18n'
import { InfoIcon } from './ResultCard'
import { ProfileForm } from './ProfileForm'
import { ctxFor, describeGroup, droppedText, metaOf, type Env } from './env'

interface Loaded {
  key: string
  national: Cells
  regional: Cells | null
}

function useCells(env: Env, p: Profile): Loaded | null {
  const major = detailMajor(metaOf(env, p.country), p.occupation)
  const key = `${p.country}|${p.region ?? ''}|${major ?? ''}`
  const [data, setData] = useState<Loaded | null>(null)
  useEffect(() => {
    let live = true
    Promise.all([loadNational(p.country, [major]), p.region ? loadRegion(p.country, p.region).catch(() => null) : Promise.resolve(null)])
      .then(([national, regional]) => live && setData({ key, national, regional }))
      .catch(() => {})
    return () => { live = false }
  }, [key, p.country, p.region, major])
  return data?.key === key ? data : null
}

/** Default second scenario: the same person in another country (occupation and education mapped). */
export function defaultScenario(env: Env, a: Profile): Profile {
  const to: CountryCode = a.country === 'JP' ? 'US' : 'JP'
  const from = metaOf(env, a.country)
  const meta = metaOf(env, to)
  return {
    ...a, country: to, region: null, income: null, facets: {},
    occupation: crosswalk(env.common, from, meta, a.occupation),
    education: mapEducation(a.education, meta.educations),
  }
}

interface Figures {
  match: Match
  gross: number
  net: number
  real: number
  rent: number | null
  currency: string
}

export function ScenarioCard({ env, a, b, onChangeB }: { env: Env; a: Profile; b: Profile; onChangeB: (p: Profile) => void }) {
  const { t, lang, fx } = env
  const cellsA = useCells(env, a)
  const cellsB = useCells(env, b)
  const [rent, setRent] = useState<Partial<Record<CountryCode, RentData>>>({})
  useEffect(() => {
    for (const c of [a.country, b.country]) {
      if (!rent[c]) loadRent(c).then((r) => setRent((prev) => ({ ...prev, [c]: r }))).catch(() => {})
    }
  }, [a.country, b.country, rent])

  const homeCurrency = metaOf(env, a.country).currency
  const figures = (p: Profile, cells: Loaded | null): Figures | null => {
    if (!cells) return null
    const meta = metaOf(env, p.country)
    const match = findCell(meta, cells.national, cells.regional, p)
    if (!match) return null
    const ctx = ctxFor(env, p.country, p.region, p.age)
    const toHome = rate(fx, meta.currency, homeCurrency, 'ppp')
    const gross = match.cell.q[2]
    const net = takeHome(ctx, gross).net
    const r = rent[p.country]
    const annualRent = r ? (r.regions[p.region ?? ''] ?? r.national) * 12 : null
    return { match, gross, net, real: (net / priceLevel(ctx)) * toHome, rent: annualRent, currency: meta.currency }
  }
  const fa = figures(a, cellsA)
  const fb = figures(b, cellsB)

  const switchCountry = (c: CountryCode) => {
    const from = metaOf(env, b.country)
    const to = metaOf(env, c)
    onChangeB({ ...b, country: c, region: null, occupation: crosswalk(env.common, from, to, b.occupation), education: mapEducation(b.education, to.educations) })
  }

  const money = (v: number, cur: string) => formatMoney(v, cur, lang)
  const diff = (x: number, y: number) => {
    const d = y / x - 1
    return <span className={d >= 0 ? 'delta up' : 'delta down'}>{d >= 0 ? '+' : ''}{formatPct(d, lang)}</span>
  }
  const toHome = (v: number, cur: string) => v * rate(fx, cur, homeCurrency, 'ppp')
  const rows: { label: string; a: string; b: string; d?: React.ReactNode }[] = []
  if (fa && fb) {
    rows.push({ label: t.scenarioGross, a: money(fa.gross, fa.currency), b: money(fb.gross, fb.currency),
      d: diff(toHome(fa.gross, fa.currency), toHome(fb.gross, fb.currency)) })
    rows.push({ label: t.scenarioNet, a: money(fa.net, fa.currency), b: money(fb.net, fb.currency),
      d: diff(toHome(fa.net, fa.currency), toHome(fb.net, fb.currency)) })
    rows.push({ label: t.scenarioReal(homeCurrency), a: money(fa.real, homeCurrency), b: money(fb.real, homeCurrency), d: diff(fa.real, fb.real) })
    if (fa.rent != null && fb.rent != null) {
      rows.push({ label: t.scenarioRent, a: money(fa.rent, fa.currency), b: money(fb.rent, fb.currency) })
      const leftA = toHome(fa.net - fa.rent, fa.currency)
      const leftB = toHome(fb.net - fb.rent, fb.currency)
      rows.push({ label: t.scenarioAfterRent(homeCurrency), a: money(leftA, homeCurrency), b: money(leftB, homeCurrency), d: diff(leftA, leftB) })
    }
  }

  const describe = (p: Profile, f: Figures | null) => f ? describeGroup(env, metaOf(env, p.country), f.match.key, f.match.regional ? p.region : null) : '…'

  return (
    <section className="card">
      <h2>{t.scenarioTitle}</h2>
      <p className="note">{t.scenarioLead}</p>
      <div className="scenario-grid">
        <div className="scenario-a">
          <h3>{t.scenarioA}</h3>
          <p className="note">{t.scenarioAHint}</p>
          <p>{describe(a, fa)}</p>
        </div>
        <ProfileForm
          variant="scenario" title={t.scenarioB} profile={b} countries={COUNTRIES.filter((c) => env.metas[c])}
          meta={metaOf(env, b.country)} lang={lang} t={t} remember={false}
          onChange={onChangeB} onCountry={switchCountry} onRemember={() => {}}
        />
      </div>

      {fa && fb ? (
        <div className="table-wrap">
          <table className="data scenario-table">
            <thead>
              <tr><th></th><th>{t.scenarioA}</th><th>{t.scenarioB}</th><th>{t.scenarioDiff}</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}><td>{r.label}</td><td>{r.a}</td><td>{r.b}</td><td>{r.d ?? ''}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p>{t.loading}</p>}

      {fb && (
        <dl className="meta">
          <dt>{t.scenarioB}</dt>
          <dd>{describe(b, fb)}</dd>
        </dl>
      )}
      {[fa, fb].some((f) => f && f.match.dropped.length) && (
        <div className="notice" role="note">
          <InfoIcon />
          <div>
            {fa && fa.match.dropped.length > 0 && <div>{t.scenarioA}: {t.dropped} — {droppedText(env, fa.match)}</div>}
            {fb && fb.match.dropped.length > 0 && <div>{t.scenarioB}: {t.dropped} — {droppedText(env, fb.match)}</div>}
          </div>
        </div>
      )}
      <p className="note">{t.scenarioNote}</p>
      {Object.values(rent).length > 0 && (
        <p className="note">{t.rentSource}: {[...new Set([a.country, b.country])].map((c) => rent[c] && `${label(rent[c]!.source.name, lang)} (${rent[c]!.period}) — ${label(rent[c]!.basis, lang)}`).filter(Boolean).join(' / ')}. {t.rentCaveat}</p>
      )}
    </section>
  )
}
