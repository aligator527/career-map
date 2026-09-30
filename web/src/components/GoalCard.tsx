import { useEffect, useMemo, useState } from 'react'
import { COUNTRIES, INCOME_UNIT } from '../engine/countries'
import { loadFacets, loadNational, loadRegions } from '../engine/data'
import { achievers, ageCurve, goalOptions, goalResult, selfEmployedShare, type CountryData, type Goal, type GoalInputs, type GoalOption } from '../engine/goal'
import { ageBand } from '../engine/lookup'
import type { Cells, CountryCode, Profile } from '../engine/types'
import { formatCount, formatMoney, formatPct, label, labeled, paren } from '../i18n'
import { BarList, Columns } from './BarList'
import { InfoIcon } from './ResultCard'
import { ageLabel, describeGroup, droppedText, metaOf, type Env } from './env'

type Kind = Goal['kind'] | 'founder'

/** A round default target: the all-worker p90, snapped to 1 / 1.5 / 2 / 2.5 / 3 / 5 / 7.5 × 10^k. */
function niceTarget(x: number): number {
  const mag = 10 ** Math.floor(Math.log10(x))
  const steps = [1, 1.5, 2, 2.5, 3, 5, 7.5, 10]
  return mag * steps.reduce((best, s) => (Math.abs(s * mag - x) < Math.abs(best * mag - x) ? s : best))
}

interface Loaded {
  country: CountryCode
  regions: Record<string, Cells> | null
  others: Partial<Record<CountryCode, CountryData>>
}

export function GoalCard({ env, profile, national, regional }: { env: Env; profile: Profile; national: Cells; regional: Cells | null }) {
  const { t, lang } = env
  const meta = metaOf(env, profile.country)
  const unit = INCOME_UNIT[profile.country]
  const [kind, setKind] = useState<Kind>('income')
  const [amounts, setAmounts] = useState<Partial<Record<CountryCode, number>>>({})
  const [targetAge, setTargetAge] = useState<number | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  const all = national['*|*|*|*']
  const amount = amounts[profile.country] ?? (all ? niceTarget(all[6]) : 0)
  const age = targetAge ?? Math.min(Math.max((profile.age ?? 30) + 5, 20), 64)

  // Home-country results first; other countries (large files) are added when they arrive
  useEffect(() => {
    let live = true
    setLoaded(null)
    loadRegions(profile.country).catch(() => null).then((regions) => {
      if (live) setLoaded({ country: profile.country, regions, others: {} })
    })
    const others = COUNTRIES.filter((c) => c !== profile.country && env.metas[c])
    Promise.all(others.map((c) => loadNational(c).catch(() => null))).then((nationals) => {
      if (!live) return
      const o: Loaded['others'] = {}
      others.forEach((c, i) => {
        if (nationals[i]) o[c] = { meta: env.metas[c]!, national: nationals[i]! }
      })
      setLoaded((prev) => (prev && prev.country === profile.country ? { ...prev, others: o } : prev))
    })
    return () => { live = false }
  }, [profile.country, env.metas])

  // Self-employment goal: US and Canada publish an `employment` facet
  const [facets, setFacets] = useState<{ country: string; cells: Cells } | null>(null)
  const founderAvailable = !!meta.facets?.employment
  useEffect(() => {
    if (kind !== 'founder' || !founderAvailable) return
    let live = true
    loadFacets(profile.country).then((c) => live && setFacets({ country: profile.country, cells: c })).catch(() => {})
    return () => { live = false }
  }, [kind, founderAvailable, profile.country])
  useEffect(() => {
    if (kind === 'founder' && !founderAvailable) setKind('income')
  }, [kind, founderAvailable])

  const goal: Goal = kind === 'income' ? { kind, amount, age } : { kind: 'manager', age }
  const inputs: GoalInputs | null = loaded && loaded.country === profile.country
    ? { profile, home: { meta, national }, regional, regions: loaded.regions, others: loaded.others, fx: env.fx, conversion: 'ppp', common: env.common }
    : null

  const computed = useMemo(() => {
    if (kind === 'founder') {
      if (!facets || facets.country !== profile.country) return null
      const f = facets.cells
      const at = { ...profile, age }
      return {
        base: selfEmployedShare(meta, f, at),
        curve: meta.ages.flatMap((band) => {
          const r = selfEmployedShare(meta, f, { ...profile, age: Number(band.split('-')[0]) })
          return r && !r.dropped.includes('age') ? [{ band, share: r.share, target: band === ageBand(age, meta.ages) }] : []
        }),
        options: meta.occupationMajor.flatMap((m): GoalOption[] => {
          if (profile.occupation === m.code) return []
          const r = selfEmployedShare(meta, f, { ...at, occupation: m.code })
          return r && r.key.startsWith(`${m.code}|`) ? [{ kind: 'occupation', code: m.code, country: profile.country, result: r }] : []
        }),
        who: null,
      }
    }
    if (!inputs) return null
    return {
      base: goalResult(goal, inputs),
      curve: ageCurve(goal, inputs),
      options: goalOptions(goal, inputs),
      who: goal.kind === 'income' ? achievers(goal, inputs) : null,
    }
  }, [inputs?.home.national, inputs?.regional, inputs?.regions, inputs?.others, profile, kind, amount, age, facets, meta])

  const money = (v: number) => formatMoney(v, meta.currency, lang)
  const pct = (v: number) => formatPct(v, lang)
  const optionLabel = (o: GoalOption): string => {
    const m = metaOf(env, o.country)
    if (o.kind === 'occupation') {
      const x = meta.occupationMajor.find((g) => g.code === o.code) ?? meta.occupations.find((g) => g.code === o.code)
      return label(x?.label, lang)
    }
    if (o.kind === 'education') return t.educations[o.code as keyof typeof t.educations]
    if (o.kind === 'region') return label(m.regions.find((r) => r.code === o.code)?.label, lang)
    return t.countries[o.code as CountryCode]
  }

  return (
    <section className="card">
      <h2>{t.goalTitle}</h2>
      <div className="goal-controls">
        <div className="seg" role="group" aria-label={t.goalTitle}>
          {(['income', 'manager', ...(founderAvailable ? ['founder'] : [])] as Kind[]).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{t.goalKinds[k]}</button>
          ))}
        </div>
        {kind === 'income' && (
          <label className="field">
            <span>{paren(t.goalAmount, profile.country === 'JP' && lang === 'ja' ? '万円' : meta.currency, lang)}</span>
            <input
              type="number" inputMode="numeric" min={0} value={Math.round(amount / unit)}
              onChange={(e) => setAmounts({ ...amounts, [profile.country]: Math.max(Number(e.target.value) || 0, 0) * unit })}
            />
          </label>
        )}
        <label className="field">
          <span>{t.goalAge}</span>
          <input
            type="number" inputMode="numeric" min={18} max={69} value={age}
            onChange={(e) => setTargetAge(e.target.value ? Math.min(69, Math.max(18, Number(e.target.value))) : null)}
          />
        </label>
      </div>

      {!computed ? (
        <p>{t.loading}</p>
      ) : !computed.base ? (
        <p>{t.noData}</p>
      ) : (
        <>
          <div className="hero">
            <span className="lead">{t.goalHeadline[kind](money(amount), age)} — {t.goalShareLead}</span>
            <span className="value">{pct(computed.base.share)}</span>
          </div>
          <dl className="meta">
            <dt>{t.matched}</dt>
            <dd>{describeGroup(env, meta, computed.base.key, computed.base.regional ? profile.region : null)}</dd>
          </dl>
          {computed.base.dropped.length > 0 && (
            <div className="notice" role="note">
              <InfoIcon />
              <div>{labeled(t.dropped, droppedText(env, computed.base), lang)}</div>
            </div>
          )}

          {computed.curve.length > 1 && (
            <div className="goal-section">
              <h3>{t.goalByAge}</h3>
              <p className="note">{t.goalByAgeNote}</p>
              <Columns
                ariaLabel={t.goalByAge}
                format={pct}
                columns={computed.curve.map((c) => ({ id: c.band, label: `${c.band.split('-')[0]}${lang === 'ja' ? '〜' : '–'}`, fullLabel: ageLabel(c.band, lang), value: c.share, highlight: c.target }))}
              />
            </div>
          )}

          {computed.options.length > 0 && (
            <div className="goal-section">
              <h3>{t.goalOptions}</h3>
              <p className="note">{t.goalOptionsNote} {kind === 'income' ? t.goalCountryNote : kind === 'manager' ? t.goalManagerNoCountry : t.goalFounderNote}</p>
              <BarList
                ariaLabel={t.goalOptions}
                format={pct}
                reference={{ value: computed.base.share, label: t.goalCurrent }}
                rows={[...computed.options]
                  .sort((a, b) => b.result.share - a.result.share)
                  // A major group and a detailed occupation can share a name (e.g. 管理的職業従事者); keep one
                  .filter((o, i, arr) => arr.findIndex((x) => x.kind === o.kind && optionLabel(x) === optionLabel(o)) === i)
                  .slice(0, 10)
                  .map((o) => ({
                    id: `${o.kind}-${o.code}`,
                    kicker: t.goalKindLabels[o.kind],
                    label: optionLabel(o),
                    value: o.result.share,
                    detail: [
                      labeled(t.goalPop, formatCount(o.result.pop, lang), lang),
                      ...(o.result.dropped.length ? [labeled(t.dropped, droppedText(env, o.result), lang)] : []),
                    ],
                  }))}
              />
            </div>
          )}

          {computed.who && computed.who.occupations.length > 0 && (
            <div className="goal-section">
              <h3>{t.goalAchievers}</h3>
              <p className="note">{t.goalAchieversNote}</p>
              <h4>{t.goalAchieversOcc}</h4>
              <BarList
                ariaLabel={t.goalAchieversOcc}
                format={pct}
                max={1}
                rows={computed.who.occupations.slice(0, 6).map((o) => ({
                  id: o.code,
                  label: label(meta.occupationMajor.find((m) => m.code === o.code)?.label, lang),
                  value: o.shareOfAchievers,
                  highlight: ageBand(age, meta.ages) != null && profile.occupation != null &&
                    (profile.occupation === o.code || meta.occupations.find((x) => x.code === profile.occupation)?.major === o.code.slice(1)),
                  detail: [t.goalShareOfAchievers(pct(o.shareOfAchievers)), t.goalRate(pct(o.rate))],
                }))}
              />
              {computed.who.educations.length > 0 && (
                <>
                  <h4>{t.goalAchieversEdu}</h4>
                  <BarList
                    ariaLabel={t.goalAchieversEdu}
                    format={pct}
                    max={1}
                    rows={computed.who.educations.map((e) => ({
                      id: e.code,
                      label: t.educations[e.code as keyof typeof t.educations],
                      value: e.shareOfAchievers,
                      highlight: profile.education === e.code,
                      detail: [t.goalShareOfAchievers(pct(e.shareOfAchievers)), t.goalRate(pct(e.rate))],
                    }))}
                  />
                  {computed.who.educationAllAges && <p className="note">{t.goalEduAllAges}</p>}
                </>
              )}
            </div>
          )}

          <ul className="note goal-disclaimer">
            {t.goalDisclaimer.map((d) => <li key={d}>{d}</li>)}
            <li>{t.goalUnsupported}</li>
          </ul>
        </>
      )}
    </section>
  )
}
