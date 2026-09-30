import { useEffect, useState } from 'react'
import { loadExperience } from '../engine/data'
import { ageBand, findCell } from '../engine/lookup'
import { convert } from '../engine/metric'
import type { Cells, CountryMeta, Profile } from '../engine/types'
import { formatMoney, paren } from '../i18n'
import { Columns } from './BarList'
import { niceTicks, useWidth } from './chartUtils'
import { ageLabel, ctxFor, type Env } from './env'

interface Point {
  band: string
  q: number[]
  current: boolean
}

/** Median and middle-50% range by age band for the profile's other conditions (cross-sectional). */
function AgeLine({ points, format, currentLabel }: { points: Point[]; format: (v: number) => string; currentLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const H = 220
  const M = { top: 16, right: 16, bottom: 28, left: 8 }
  const iw = Math.max(width - M.left - M.right, 10)
  const ih = H - M.top - M.bottom
  const ticks = niceTicks(Math.max(...points.map((p) => p.q[3])) * 1.05, 4)
  const ym = ticks[ticks.length - 1]
  const x = (i: number) => M.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw)
  const y = (v: number) => M.top + ih - (v / ym) * ih
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.q[2]).toFixed(1)}`).join('')
  const band = `${points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.q[3]).toFixed(1)}`).join('')}${[...points].reverse().map((p, j) => `L${x(points.length - 1 - j).toFixed(1)},${y(p.q[1]).toFixed(1)}`).join('')}Z`
  const hp = hover != null ? points[hover] : null
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={points.map((p) => `${p.band} ${format(p.q[2])}`).join(', ')}>
          {ticks.map((v) => (
            <g key={v}>
              <line className="grid" x1={M.left} x2={M.left + iw} y1={y(v)} y2={y(v)} />
              <text className="tick" x={M.left + iw} y={y(v) - 3} textAnchor="end">{format(v)}</text>
            </g>
          ))}
          <path d={band} fill="var(--series-1-wash)" />
          <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
          {points.map((p, i) => (
            <g key={p.band}>
              <circle cx={x(i)} cy={y(p.q[2])} r={p.current ? 6 : 4} fill={p.current ? 'var(--text-primary)' : 'var(--series-1)'} stroke="var(--surface)" strokeWidth={2} />
              <text className="tick" x={x(i)} y={H - 8} textAnchor="middle" style={p.current ? { fill: 'var(--text-primary)', fontWeight: 700 } : undefined}>
                {p.band.split('-')[0]}
              </text>
              <rect x={x(i) - iw / points.length / 2} y={M.top} width={iw / points.length} height={ih} fill="transparent"
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
            </g>
          ))}
        </svg>
      )}
      {hp && hover != null && (
        <div className="tooltip" style={{ left: Math.min(Math.max(x(hover) - 90, 0), width - 200), top: M.top }}>
          <b>{hp.band}{hp.current ? ` (${currentLabel})` : ''}</b>
          <div className="tnum">{format(hp.q[2])}</div>
          <div className="tnum muted">{format(hp.q[1])}–{format(hp.q[3])}</div>
        </div>
      )}
    </div>
  )
}

export function GrowthCard({ env, meta, profile, national, regional }: { env: Env; meta: CountryMeta; profile: Profile; national: Cells; regional: Cells | null }) {
  const { t, lang, metric } = env
  const [experience, setExperience] = useState<Record<string, [string, number, number][]> | null>(null)
  useEffect(() => {
    if (profile.country !== 'JP') return
    loadExperience().then(setExperience).catch(() => setExperience(null))
  }, [profile.country])

  const ctx = ctxFor(env, profile.country, profile.region, profile.age)
  const f = (v: number) => convert(metric, ctx, v)
  const money = (v: number) => formatMoney(v, meta.currency, lang)
  const current = profile.age != null ? ageBand(profile.age, meta.ages) : null
  const points: Point[] = meta.ages.flatMap((band) => {
    const m = findCell(meta, national, regional, { ...profile, age: Number(band.split('-')[0]) })
    return m && !m.dropped.includes('age') ? [{ band, q: m.cell.q.map(f), current: band === current }] : []
  })
  const occ = profile.occupation && !profile.occupation.startsWith('M') ? profile.occupation : null
  const exp = occ && experience ? experience[`${occ}|${profile.sex ?? '*'}`] ?? experience[`${occ}|*`] : null

  if (points.length < 3 && !exp) return null
  return (
    <section className="card">
      <h2>{t.growthTitle}</h2>
      <p className="note">{t.growthLead}</p>
      {points.length >= 3 && (
        <>
          <h3>{paren(t.growthByAge, t.metrics[metric], lang)}</h3>
          <AgeLine points={points} format={money} currentLabel={t.current} />
          <p className="note">{t.growthByAgeNote}</p>
        </>
      )}
      {exp && (
        <div className="goal-section">
          <h3>{t.growthByExperience}</h3>
          <Columns
            ariaLabel={t.growthByExperience}
            format={(v) => money(f(v))}
            columns={exp.filter(([band]) => band !== '*').map(([band, , annual]) => ({
              id: band, label: t.experienceBands[band as keyof typeof t.experienceBands] ?? band, value: annual,
            }))}
          />
          <p className="note">{t.growthByExperienceNote}</p>
        </div>
      )}
      {current && <span className="visually-hidden">{ageLabel(current, lang)}</span>}
    </section>
  )
}
