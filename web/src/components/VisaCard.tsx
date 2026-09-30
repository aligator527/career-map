import { useEffect, useState } from 'react'
import { crosswalk, rate } from '../engine/compare'
import { COUNTRIES, mapEducation } from '../engine/countries'
import { detailMajor, loadNational, loadVisas, type VisaData } from '../engine/data'
import { findCell } from '../engine/lookup'
import type { CountryCode, Match, Profile } from '../engine/types'
import { formatDate, formatMoney, label, labeled } from '../i18n'
import { InfoIcon } from './ResultCard'
import { describeGroup, metaOf, type Env } from './env'

/** Main work-visa routes of a destination, with salary thresholds next to the pay of the user's occupation there. */
export function VisaCard({ env, profile }: { env: Env; profile: Profile }) {
  const { t, lang, fx } = env
  const available = COUNTRIES.filter((c) => env.metas[c])
  const [dest, setDest] = useState<CountryCode>(available.find((c) => c !== profile.country) ?? 'US')
  const [visas, setVisas] = useState<VisaData | null>(null)
  const [there, setThere] = useState<{ country: CountryCode; match: Match | null } | null>(null)

  useEffect(() => {
    loadVisas().then(setVisas).catch(() => setVisas(null))
  }, [])

  useEffect(() => {
    let live = true
    const from = metaOf(env, profile.country)
    const to = metaOf(env, dest)
    const occupation = dest === profile.country ? profile.occupation : crosswalk(env.common, from, to, profile.occupation)
    loadNational(dest, [detailMajor(to, occupation)]).then((national) => {
      if (!live) return
      const p: Profile = { ...profile, country: dest, region: null, occupation, education: mapEducation(profile.education, to.educations) }
      setThere({ country: dest, match: findCell(to, national, null, p) })
    }).catch(() => live && setThere({ country: dest, match: null }))
    return () => { live = false }
  }, [dest, profile, env])

  const destMeta = metaOf(env, dest)
  const home = metaOf(env, profile.country)
  const info = visas?.countries[dest]
  const median = there?.country === dest ? there.match?.cell.q[2] ?? null : null
  const inHome = (amount: number, currency: string) => amount * rate(fx, currency, home.currency, 'ppp')

  return (
    <section className="card">
      <h2>{t.visaTitle}</h2>
      <p className="note">{t.visaLead}</p>
      <label className="field visa-dest">
        <span>{t.visaDestination}</span>
        <select value={dest} onChange={(e) => setDest(e.target.value as CountryCode)}>
          {available.map((c) => <option key={c} value={c}>{t.countries[c]}</option>)}
        </select>
      </label>

      {median != null && there?.match && (
        <div className="stats">
          <div className="stat">
            <div className="k">{t.visaMedianThere}</div>
            <div className="v">{formatMoney(median, destMeta.currency, lang)}</div>
          </div>
          <div className="stat">
            <div className="k">{t.visaGroup}</div>
            <div className="v small">{describeGroup(env, destMeta, there.match.key, null)}</div>
          </div>
        </div>
      )}

      {!visas || !info ? <p>{t.loading}</p> : (
        <>
          {info.freeMovement && <div className="notice" role="note"><InfoIcon /><div>{label(info.freeMovement, lang)}</div></div>}
          <ul className="effects visas">
            {info.routes.map((r) => {
              const th = r.salaryThreshold
              return (
                <li key={r.id}>
                  <div className="effect-head">
                    <span className="effect-label"><b>{label(r.name, lang)}</b></span>
                    {th && (
                      <b className="effect-value">
                        {formatMoney(th.amount, th.currency, lang)}
                        {th.currency !== home.currency && <span className="note"> ≈ {formatMoney(inHome(th.amount, th.currency), home.currency, lang)}</span>}
                      </b>
                    )}
                  </div>
                  <p className="visa-summary">{label(r.summary, lang)}</p>
                  {th && median != null && th.currency === destMeta.currency && (
                    <p className={`visa-check ${median >= th.amount ? 'ok' : 'below'}`}>
                      {median >= th.amount ? t.visaAbove : t.visaBelow}
                    </p>
                  )}
                  <ul className="visa-reqs">
                    {r.requirements.map((q) => <li key={q.en}>{label(q, lang)}</li>)}
                  </ul>
                  {r.processingNote && <p className="note">{label(r.processingNote, lang)}</p>}
                  <div className="effect-source">
                    <a href={r.source.url} target="_blank" rel="noreferrer">{r.source.title}</a> — {labeled(t.visaAsOf, formatDate(r.asOf, lang), lang)}
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="note">{label(visas.disclaimer, lang)}</p>
        </>
      )}
    </section>
  )
}
