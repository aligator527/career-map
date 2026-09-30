import { useEffect, useState } from 'react'
import { loadJpMobility, loadUsMobility } from '../engine/data'
import { ageBand } from '../engine/lookup'
import { jpJobChange, jpRanks, RANKS, usMobility, type JpMobility, type UsMobility } from '../engine/mobility'
import type { Lang, Profile } from '../engine/types'
import { formatCount, formatMoney, formatPct, label, labeled, listSep } from '../i18n'
import { ageLabel, metaOf, type Env } from './env'
import { StackedBar, StackedColumns } from './Stacked'

const PAY_COLORS = {
  up10: 'var(--div-up-strong)', up: 'var(--div-up)', same: 'var(--div-mid)',
  down: 'var(--div-down)', down10: 'var(--div-down-strong)', unknown: 'var(--surface-2)',
}
const RANK_COLORS = {
  bucho: 'var(--rank-1)', kacho: 'var(--rank-2)', kakari: 'var(--rank-3)',
  shokucho: 'var(--rank-4)', other: 'var(--rank-5)', none: 'var(--rank-none)',
}

const EVERYONE: Record<Lang, string> = { ja: '全体', en: 'everyone', zh: '全体', ko: '전체', vi: 'mọi người' }

/** "age|sex(|edu)" key → readable group description */
function groupText(env: Env, key: string): string {
  const [age, sex, edu] = key.split('|')
  const { t, lang } = env
  const parts = [age === '*' ? '' : ageLabel(age, lang), sex === '*' ? '' : t.sexes[sex as 'M' | 'F'], !edu || edu === '*' ? '' : t.educations[edu as keyof typeof t.educations]]
  const s = parts.filter(Boolean).join(lang === 'ja' ? '・' : listSep(lang))
  return s || EVERYONE[lang]
}

export function MobilityCard({ env, profile }: { env: Env; profile: Profile }) {
  const { t, lang } = env
  const [jp, setJp] = useState<JpMobility | null>(null)
  const [us, setUs] = useState<UsMobility | null>(null)

  useEffect(() => {
    if (profile.country === 'JP') loadJpMobility().then(setJp).catch(() => setJp(null))
    if (profile.country === 'US') loadUsMobility().then(setUs).catch(() => setUs(null))
  }, [profile.country])

  const pct = (v: number) => formatPct(v, lang)
  const meta = metaOf(env, profile.country)

  if (profile.country !== 'JP' && profile.country !== 'US') {
    return (
      <section className="card">
        <h2>{t.mobilityTitle}</h2>
        <p className="note">{t.mobilityUnavailable}</p>
      </section>
    )
  }

  if (profile.country === 'US') {
    const m = us ? usMobility(us, profile) : null
    return (
      <section className="card">
        <h2>{t.mobilityTitle}</h2>
        {!us ? <p>{t.loading}</p> : !m ? <p>{t.noData}</p> : (
          <>
            <div className="stats">
              <div className="stat"><div className="k">{t.usMultiEmployer}</div><div className="v">{pct(m.multi)}</div></div>
              {m.change != null && <div className="stat"><div className="k">{t.usOccChange}</div><div className="v">{pct(m.change)}</div></div>}
              {m.medOne != null && <div className="stat"><div className="k">{t.usMedOne}</div><div className="v">{formatMoney(m.medOne, 'USD', lang)}</div></div>}
              {m.medMulti != null && <div className="stat"><div className="k">{t.usMedMulti}</div><div className="v">{formatMoney(m.medMulti, 'USD', lang)}</div></div>}
            </div>
            <dl className="meta">
              <dt>{t.groupFor}</dt>
              <dd>{describeUsKey(env, m.key)} · {labeled(t.sample, formatCount(m.n, lang), lang)}</dd>
              <dt>{t.source}</dt>
              <dd><a href={us.source.url} target="_blank" rel="noreferrer">{label(us.source.name, lang)}</a></dd>
            </dl>
            <p className="note">{t.usMobilityNote}</p>
          </>
        )}
      </section>
    )
  }

  const change = jp ? jpJobChange(meta, jp, profile) : null
  const ranks = jp ? jpRanks(meta, jp, profile) : null
  const band = profile.age != null ? ageBand(profile.age, meta.ages) : null
  const current = ranks?.bands.find((b) => b.band === band)

  return (
    <section className="card">
      <h2>{t.mobilityTitle}</h2>
      {!jp ? <p>{t.loading}</p> : (
        <>
          {change && (
            <div className="goal-section">
              <h3>{t.jobChangeTitle}</h3>
              {change.rate != null && change.rateKey && (
                <div className="stats">
                  <div className="stat">
                    <div className="k">{t.jobChangeRate(groupText(env, change.rateKey))}</div>
                    <div className="v">{formatPct(change.rate / 100, lang)}</div>
                  </div>
                </div>
              )}
              <h4>{t.payChangeTitle}（{groupText(env, change.key)}）</h4>
              <StackedBar
                ariaLabel={t.payChangeTitle}
                format={pct}
                segments={(['up10', 'up', 'same', 'down', 'down10', 'unknown'] as const).map((k) => ({
                  id: k, label: t.payChangeCats[k], value: change.dist[k], color: PAY_COLORS[k],
                }))}
              />
              <p className="note">{t.payChangeNote}</p>
            </div>
          )}

          {ranks && (
            <div className="goal-section">
              <h3>{t.promotionTitle}（{groupText(env, `*|${ranks.sex}|${ranks.edu}`)}）</h3>
              {current && band && (
                <div className="stats">
                  <div className="stat">
                    <div className="k">{t.rankManagerShare(ageLabel(band, lang))}</div>
                    <div className="v">{pct(current.shares.bucho + current.shares.kacho)}</div>
                  </div>
                </div>
              )}
              <StackedColumns
                ariaLabel={t.promotionTitle}
                format={pct}
                legend={RANKS.map((r) => ({ label: t.rankLabels[r], color: RANK_COLORS[r] }))}
                columns={ranks.bands.map((b) => ({
                  id: b.band,
                  label: `${b.band.split('-')[0]}${lang === 'ja' ? '〜' : '–'}`,
                  highlight: b.band === band,
                  segments: RANKS.map((r) => ({ id: r, label: t.rankLabels[r], value: b.shares[r], color: RANK_COLORS[r] })),
                }))}
              />
              {current && band && Object.keys(current.pay).length > 0 && (
                <>
                  <h4>{t.rankPayTitle(ageLabel(band, lang))}</h4>
                  <div className="table-wrap">
                    <table className="data">
                      <tbody>
                        {RANKS.filter((r) => current.pay[r]).map((r) => (
                          <tr key={r}><td>{t.rankLabels[r]}</td><td>{formatMoney(current.pay[r]!, 'JPY', lang)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <p className="note">{t.rankNote}</p>
            </div>
          )}

          <dl className="meta">
            <dt>{t.source}</dt>
            <dd>
              <a href={jp.source.payChange.url} target="_blank" rel="noreferrer">{label(jp.source.payChange, lang)}</a><br />
              <a href={jp.source.ranks.url} target="_blank" rel="noreferrer">{label(jp.source.ranks, lang)}</a>
            </dd>
          </dl>
        </>
      )}
    </section>
  )
}

function describeUsKey(env: Env, key: string): string {
  const [occ, age, sex, edu] = key.split('|')
  const meta = metaOf(env, 'US')
  const { t, lang } = env
  const parts = [
    occ === '*' ? '' : label(meta.occupationMajor.find((m) => m.code === occ)?.label, lang),
    age === '*' ? '' : ageLabel(age, lang),
    sex === '*' ? '' : t.sexes[sex as 'M' | 'F'],
    edu === '*' ? '' : t.educations[edu as keyof typeof t.educations],
  ]
  return parts.filter(Boolean).join(' · ') || t.countries.US
}
