import { useEffect, useMemo, useState } from 'react'
import { CommunityCard } from './components/CommunityCard'
import { CompareCard } from './components/CompareCard'
import type { Env } from './components/env'
import { GoalCard } from './components/GoalCard'
import { MapCard } from './components/MapCard'
import { MobilityCard } from './components/MobilityCard'
import { ProfileForm } from './components/ProfileForm'
import { ResearchCard } from './components/ResearchCard'
import { ResultCard } from './components/ResultCard'
import { crosswalk, type CommonOccupation } from './engine/compare'
import { COUNTRIES, HAS_PRICES, mapEducation } from './engine/countries'
import { loadCaTax, loadCommonOccupations, loadFx, loadMeta, loadNational, loadPrices, loadRegion, loadStateTax, type Prices } from './engine/data'
import { findCell } from './engine/lookup'
import type { Metric, TaxTables } from './engine/metric'
import type { Cells, CountryCode, CountryMeta, FxData, Lang, Profile } from './engine/types'
import { detectLang, dicts } from './i18n'

const STORAGE_KEY = 'career-map:profile'
const DEFAULT_PROFILE: Profile = {
  country: 'JP', region: null, occupation: null, age: 30, sex: null, education: null, income: null,
}
const METRICS: Metric[] = ['gross', 'net', 'real']

function readStored(): Profile | null {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    return s ? { ...DEFAULT_PROFILE, ...JSON.parse(s) } : null
  } catch {
    return null
  }
}

function writeStored(p: Profile | null) {
  try {
    if (p) localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage unavailable: inputs simply aren't remembered */
  }
}

interface Shared {
  fx: FxData
  metas: Partial<Record<CountryCode, CountryMeta>>
  prices: Partial<Record<CountryCode, Prices>>
  taxes: TaxTables
  common: CommonOccupation[]
}

/** Load what every card needs. A country appears in the app once its meta.json is published. */
async function loadShared(): Promise<Shared> {
  const optional = <T,>(p: Promise<T>) => p.catch(() => null)
  const [fx, metaList, priceList, usTax, caTax, common] = await Promise.all([
    loadFx(),
    Promise.all(COUNTRIES.map((c) => optional(loadMeta(c)))),
    Promise.all(COUNTRIES.map((c) => (HAS_PRICES.includes(c) ? optional(loadPrices(c)) : Promise.resolve(null)))),
    optional(loadStateTax()),
    optional(loadCaTax()),
    optional(loadCommonOccupations()),
  ])
  const metas: Shared['metas'] = {}
  const prices: Shared['prices'] = {}
  COUNTRIES.forEach((c, i) => {
    if (metaList[i]) metas[c] = metaList[i]!
    if (priceList[i]) prices[c] = priceList[i]!
  })
  return { fx, metas, prices, taxes: { us: usTax, ca: caTax }, common: common ?? [] }
}

export default function App() {
  const [lang, setLang] = useState<Lang>(detectLang)
  const t = dicts[lang]
  const stored = useMemo(readStored, [])
  const [profile, setProfile] = useState<Profile>(stored ?? DEFAULT_PROFILE)
  const [remember, setRemember] = useState(stored != null)
  const [metric, setMetric] = useState<Metric>('gross')
  const [shared, setShared] = useState<Shared | null>(null)
  const [national, setNational] = useState<{ country: CountryCode; cells: Cells } | null>(null)
  const [regional, setRegional] = useState<{ key: string; cells: Cells } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = t.appName
  }, [lang, t])

  useEffect(() => writeStored(remember ? profile : null), [remember, profile])

  useEffect(() => {
    loadShared().then(setShared).catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    let live = true
    loadNational(profile.country)
      .then((cells) => live && setNational({ country: profile.country, cells }))
      .catch((e) => live && setError(String(e)))
    return () => { live = false }
  }, [profile.country])

  const regionKey = profile.region ? `${profile.country}-${profile.region}` : null
  useEffect(() => {
    let live = true
    if (profile.region)
      loadRegion(profile.country, profile.region)
        .then((cells) => live && setRegional({ key: `${profile.country}-${profile.region}`, cells }))
        .catch(() => live && setRegional({ key: `${profile.country}-${profile.region}`, cells: {} }))
    return () => { live = false }
  }, [profile.country, profile.region])

  const meta = shared?.metas[profile.country] ?? null
  const nationalCells = national?.country === profile.country ? national.cells : null
  const regionalCells = regionKey && regional?.key === regionKey ? regional.cells : null
  const ready = !!meta && !!nationalCells && (!regionKey || !!regionalCells)
  const match = ready ? findCell(meta!, nationalCells!, regionalCells, profile) : null
  const env: Env | null = shared ? { lang, t, metric, ...shared } : null

  const switchCountry = (c: CountryCode) => {
    if (c === profile.country || !shared) return
    const from = shared.metas[profile.country]
    const to = shared.metas[c]
    if (!from || !to) return
    const occupation = crosswalk(shared.common, from, to, profile.occupation)
    const income = profile.income != null ? Math.round(profile.income * (shared.fx.ppp[to.currency] / shared.fx.ppp[from.currency])) : null
    const education = mapEducation(profile.education, to.educations)
    setProfile({ ...profile, country: c, region: null, occupation, education, income })
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>{t.appName}</h1>
          <p>{t.tagline}</p>
        </div>
        <button className="ghost" type="button" onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')} lang={lang === 'ja' ? 'en' : 'ja'}>
          {t.lang}
        </button>
      </header>

      <div className="layout">
        <ProfileForm
          profile={profile} countries={COUNTRIES.filter((c) => shared?.metas[c])} meta={meta} lang={lang} t={t} remember={remember}
          onChange={setProfile} onCountry={switchCountry} onRemember={setRemember}
        />
        <main>
          <div className="metric-bar">
            <span id="metric-label">{t.metric}</span>
            <div className="seg" role="group" aria-labelledby="metric-label">
              {METRICS.map((m) => (
                <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}>{t.metrics[m]}</button>
              ))}
            </div>
          </div>
          {error ? (
            <section className="card">{t.loadError}: {error}</section>
          ) : !env || !meta || !ready ? (
            <section className="card">{t.loading}</section>
          ) : match ? (
            <>
              <ResultCard env={env} meta={meta} match={match} profile={profile} />
              <CompareCard env={env} profile={profile} />
              <GoalCard env={env} profile={profile} national={nationalCells!} regional={regionalCells} />
              <MobilityCard env={env} profile={profile} />
              <ResearchCard env={env} country={profile.country} median={match.cell.q[2]} currency={meta.currency} />
              <MapCard env={env} profile={profile} onSelectRegion={(region) => setProfile({ ...profile, region })} />
              <CommunityCard env={env} profile={profile} />
            </>
          ) : (
            <section className="card">{t.noData}</section>
          )}
          <section className="card disclaimer">
            <h2>{t.disclaimerTitle}</h2>
            <ul>
              {t.disclaimer.map((d) => <li key={d}>{d}</li>)}
            </ul>
          </section>
        </main>
      </div>
      <footer className="footer">
        {t.footer}{' '}
        <a href="https://github.com/aligator527/career-map/blob/main/docs/PRIVACY.md" target="_blank" rel="noreferrer">{t.privacyPolicy}</a>
        {' · '}
        <a href="https://github.com/aligator527/career-map" target="_blank" rel="noreferrer">GitHub</a>
      </footer>
    </div>
  )
}
