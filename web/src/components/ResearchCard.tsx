import { useEffect, useState } from 'react'
import { loadResearch, type ResearchEffect } from '../engine/data'
import type { CountryCode, Lang } from '../engine/types'
import { formatMoney, label } from '../i18n'
import type { Env } from './env'

const TOPICS = ['schooling_year', 'degree_premium', 'graduate_premium', 'language', 'certification', 'job_change', 'city'] as const

const POINTS: Record<Lang, string> = { ja: 'ポイント', en: ' pp', zh: '个百分点', ko: '%p', vi: ' điểm %' }
const ELASTICITY: Record<Lang, string> = { ja: '弾力性', en: 'elasticity', zh: '弹性', ko: '탄력성', vi: 'độ co giãn' }

function formatEffect(e: ResearchEffect, lang: Lang): string {
  const { point, low, high, unit } = e.effect
  const pct = (x: number, digits = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`
  const range = (f: (x: number) => string) => (low != null && high != null ? ` (${f(low)} – ${f(high)})` : '')
  switch (unit) {
    case 'log wage points': {
      const f = (x: number) => pct(Math.exp(x) - 1)
      return `${f(point)}${range(f)}`
    }
    case 'percent':
      return `${pct(point)}${range((x) => pct(x))}`
    case 'ratio':
      return `×${point.toFixed(2)} (${pct(point - 1, 0)})`
    case 'percentage_points':
      return `${point >= 0 ? '+' : ''}${(point * 100).toFixed(1)}${POINTS[lang]}`
    case 'share':
      return `${(point * 100).toFixed(0)}%`
    case 'elasticity':
      return `${ELASTICITY[lang]} ${point}`
  }
}

/** Only causal estimates of a proportional wage effect are applied to the user's own pay. */
function applied(e: ResearchEffect, median: number): number | null {
  if (e.design !== 'causal') return null
  if (e.effect.unit === 'log wage points') return median * (Math.exp(e.effect.point) - 1)
  if (e.effect.unit === 'percent') return median * e.effect.point
  return null
}

export function ResearchCard({ env, country, median, currency }: { env: Env; country: CountryCode; median: number; currency: string }) {
  const { t, lang } = env
  const [effects, setEffects] = useState<ResearchEffect[] | null>(null)
  useEffect(() => {
    loadResearch().then((r) => setEffects(r.effects)).catch(() => setEffects([]))
  }, [])

  const relevant = (effects ?? []).filter((e) => e.countries.includes(country) || e.countries.includes('ALL'))
  const byTopic = TOPICS.map((topic) => ({
    topic,
    items: relevant
      .filter((e) => e.topic === topic)
      // this country first, then causal before descriptive
      .sort((a, b) => Number(b.countries.includes(country)) - Number(a.countries.includes(country)) || Number(b.design === 'causal') - Number(a.design === 'causal')),
  })).filter((g) => g.items.length)

  return (
    <section className="card research">
      <h2>{t.researchTitle}</h2>
      <p className="note">{t.researchLead}</p>
      {effects == null ? <p>{t.loading}</p> : byTopic.map(({ topic, items }) => (
        <div key={topic} className="goal-section">
          <h3>{t.researchTopics[topic]}</h3>
          <ul className="effects">
            {items.map((e) => {
              const amount = applied(e, median)
              return (
                <li key={e.id}>
                  <div className="effect-head">
                    <span className={`badge ${e.design}`}>{t.researchDesign[e.design]}</span>
                    <span className="effect-label">{label(e.label, lang)}</span>
                    <b className="effect-value">{formatEffect(e, lang)}</b>
                  </div>
                  {amount != null && (
                    <div className="effect-applied">{t.researchApplied(formatMoney(median, currency, lang), formatMoney(amount, currency, lang))}</div>
                  )}
                  <div className="effect-source">
                    <a href={e.source.url} target="_blank" rel="noreferrer">
                      {e.source.authors} ({e.source.year}) {e.source.title}
                    </a>
                    {e.source.venue ? ` — ${e.source.venue}` : ''}
                  </div>
                  <details>
                    <summary>{t.researchDetails}</summary>
                    <p><b>{t.researchPopulation}</b> {e.population}</p>
                    {e.quote && <blockquote>“{e.quote}”</blockquote>}
                    {e.notes && <p>{e.notes}</p>}
                  </details>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}
