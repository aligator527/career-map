import { useEffect, useMemo, useState } from 'react'
import { CommunityCard } from './components/CommunityCard'
import { CompareCard } from './components/CompareCard'
import type { Env } from './components/env'
import { GoalCard } from './components/GoalCard'
import { InsightsCard } from './components/InsightsCard'
import { GrowthCard } from './components/GrowthCard'
import { MapCard } from './components/MapCard'
import { MobilityCard } from './components/MobilityCard'
import { ProfileForm } from './components/ProfileForm'
import { ResearchCard } from './components/ResearchCard'
import { ResultCard } from './components/ResultCard'
import { defaultScenario, ScenarioCard } from './components/ScenarioCard'
import { VisaCard } from './components/VisaCard'
import { crosswalk, type CommonOccupation } from './engine/compare'
import { COUNTRIES, HAS_PRICES, mapEducation } from './engine/countries'
import { detailMajor } from './engine/data'
import { loadCaTax, loadCommonOccupations, loadFx, loadMeta, loadNational, loadPrices, loadRegion, loadStateTax, type Prices } from './engine/data'
import { findCell } from './engine/lookup'
import type { Metric, TaxTables } from './engine/metric'
import type { Cells, CountryCode, CountryMeta, FxData, Lang, Profile } from './engine/types'
import { detectLang, dictFor, LANG_NAMES, LANGS, loadDict, useShownLang } from './i18n'
import { readUrlState, TABS, writeUrlState, type Tab } from './urlState'

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

type Theme = 'auto' | 'light' | 'dark'
const THEMES: Theme[] = ['auto', 'light', 'dark']

const LANG_KEY = 'career-map:lang'

function readLang(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_KEY)
    return LANGS.includes(v as Lang) ? (v as Lang) : null
  } catch {
    return null
  }
}

function readTheme(): Theme {
  try {
    const v = localStorage.getItem('career-map:theme')
    return THEMES.includes(v as Theme) ? (v as Theme) : 'auto'
  } catch {
    return 'auto'
  }
}

export default function App() {
  // A shared link (URL fragment) wins over inputs remembered on this device
  const fromUrl = useMemo(() => readUrlState(location.hash), [])
  const stored = useMemo(readStored, [])
  // A link's language wins over the one chosen earlier on this device, which wins over the browser's
  const [wantedLang, setWantedLang] = useState<Lang>(() => fromUrl?.lang ?? readLang() ?? detectLang())
  // zh/ko/vi dictionaries load lazily; until then the page renders in English
  const lang = useShownLang(wantedLang)
  const t = dictFor(lang)
  const [profile, setProfile] = useState<Profile>(fromUrl ? { ...DEFAULT_PROFILE, ...fromUrl.profile } : stored ?? DEFAULT_PROFILE)
  const [remember, setRemember] = useState(stored != null)
  const [metric, setMetric] = useState<Metric>(fromUrl?.metric ?? 'gross')
  const [tab, setTab] = useState<Tab>(fromUrl?.tab ?? 'position')
  const [scenario, setScenario] = useState<Profile | null>(
    fromUrl?.scenario ? { ...DEFAULT_PROFILE, income: null, ...fromUrl.scenario } : null,
  )
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [copied, setCopied] = useState(false)
  const [shared, setShared] = useState<Shared | null>(null)
  const [national, setNational] = useState<{ country: CountryCode; cells: Cells; major: string | null } | null>(null)
  const [regional, setRegional] = useState<{ key: string; cells: Cells } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = t.appName
  }, [lang, t])

  useEffect(() => writeStored(remember ? profile : null), [remember, profile])

  useEffect(() => {
    history.replaceState(null, '', writeUrlState({ profile, metric, tab, lang: wantedLang, scenario }))
  }, [profile, metric, tab, wantedLang, scenario])

  const changeLang = (l: Lang) => {
    try {
      localStorage.setItem(LANG_KEY, l)
    } catch {
      /* not remembered */
    }
    // switch once the dictionary is there, so the page doesn't flash English first
    loadDict(l).catch(() => {}).finally(() => setWantedLang(l))
  }

  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('career-map:theme', theme)
    } catch {
      /* not remembered */
    }
  }, [theme])

  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable: the address bar already has the link */
    }
  }

  useEffect(() => {
    loadShared().then(setShared).catch((e) => setError(String(e)))
  }, [])

  const detailMajorKey = shared?.metas[profile.country] ? detailMajor(shared.metas[profile.country]!, profile.occupation) : null
  useEffect(() => {
    let live = true
    loadNational(profile.country, [detailMajorKey])
      .then((cells) => live && setNational({ country: profile.country, cells, major: detailMajorKey }))
      .catch((e) => live && setError(String(e)))
    return () => { live = false }
  }, [profile.country, detailMajorKey])

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
  const nationalCells = national?.country === profile.country && national.major === detailMajorKey ? national.cells : null
  const regionalCells = regionKey && regional?.key === regionKey ? regional.cells : null
  const ready = !!meta && !!nationalCells && (!regionKey || !!regionalCells)
  const match = ready ? findCell(meta!, nationalCells!, regionalCells, profile) : null
  const env: Env | null = useMemo(() => (shared ? { lang, t, metric, ...shared } : null), [lang, t, metric, shared])

  const switchCountry = (c: CountryCode) => {
    if (c === profile.country || !shared) return
    const from = shared.metas[profile.country]
    const to = shared.metas[c]
    if (!from || !to) return
    const occupation = crosswalk(shared.common, from, to, profile.occupation)
    const income = profile.income != null ? Math.round(profile.income * (shared.fx.ppp[to.currency] / shared.fx.ppp[from.currency])) : null
    const education = mapEducation(profile.education, to.educations)
    // keep only conditions the other country publishes (e.g. field of study exists in the US and Canada)
    const facets = Object.fromEntries(
      Object.entries(profile.facets ?? {}).filter(([dim, v]) => to.facets?.[dim]?.values.some((x) => x.code === v)),
    )
    setProfile({ ...profile, country: c, region: null, occupation, education, income, facets })
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>{t.appName}</h1>
          <p>{t.tagline}</p>
        </div>
        <div className="header-actions">
          <button className="ghost" type="button" onClick={share} title={t.shareNote}>{copied ? t.shareCopied : t.share}</button>
          <button className="ghost" type="button" onClick={() => window.print()}>{t.print}</button>
          <button className="ghost" type="button" onClick={() => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])}>
            {t.theme[theme]}
          </button>
          <select
            className="ghost lang-select" value={wantedLang} onChange={(e) => changeLang(e.target.value as Lang)}
            aria-label={lang === 'en' ? t.lang : `${t.lang} / Language`}
          >
            {LANGS.map((l) => <option key={l} value={l} lang={l}>{LANG_NAMES[l]}</option>)}
          </select>
        </div>
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
              <nav className="tabs main-tabs" role="tablist" aria-label={t.appName}>
                {TABS.map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t.tabs[k]}</button>
                ))}
              </nav>
              {/* Only the active tab is rendered, so its data (e.g. other countries for goals) loads on demand */}
              {tab === 'position' && (
                <>
                  <ResultCard env={env} meta={meta} match={match} profile={profile} />
                  <GrowthCard env={env} meta={meta} profile={profile} national={nationalCells!} regional={regionalCells} />
                  <CompareCard env={env} profile={profile} />
                </>
              )}
              {tab === 'scenario' && (
                <ScenarioCard env={env} a={profile} b={scenario ?? defaultScenario(env, profile)} onChangeB={setScenario} />
              )}
              {tab === 'goal' && <GoalCard env={env} profile={profile} national={nationalCells!} regional={regionalCells} />}
              {tab === 'career' && (
                <>
                  <MobilityCard env={env} profile={profile} />
                  <ResearchCard env={env} country={profile.country} median={match.cell.q[2]} currency={meta.currency} />
                  <InsightsCard env={env} country={profile.country} profile={profile} />
                </>
              )}
              {tab === 'abroad' && <VisaCard env={env} profile={profile} />}
              {tab === 'map' && <MapCard env={env} profile={profile} onSelectRegion={(region) => setProfile({ ...profile, region })} />}
              {tab === 'community' && <CommunityCard env={env} profile={profile} />}
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
