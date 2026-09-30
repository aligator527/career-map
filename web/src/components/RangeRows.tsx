import { useState } from 'react'
import type { Lang } from '../engine/types'
import { formatMoney, type T } from '../i18n'
import { niceTicks, useWidth } from './chartUtils'

export interface RangeRow {
  id: string
  label: string
  current: boolean
  /** p10, p25, p50, p75, p90 in display currency */
  q: number[]
  mean: number
  note?: string
}

interface Props {
  rows: RangeRow[]
  currency: string
  lang: Lang
  t: T
  income: number | null
}

const ROW = 40
const BOX = 14

/** One horizontal range per group: whisker p10–p90, box p25–p75, median tick. */
export function RangeRows({ rows, currency, lang, t, income }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const narrow = width < 520
  const labelW = narrow ? 0 : Math.min(180, width * 0.3)
  const rowH = narrow ? ROW + 16 : ROW
  const left = labelW + 8
  const right = 16
  const top = 8
  const H = top + rows.length * rowH + 28
  const max = Math.max(...rows.map((r) => r.q[4]), income ?? 0) * 1.03
  const ticks = niceTicks(max, narrow ? 3 : 5)
  const xm = ticks[ticks.length - 1]
  const iw = Math.max(width - left - right, 10)
  const sx = (v: number) => left + (v / xm) * iw
  const barY = (i: number) => top + i * rowH + (narrow ? 16 : 0) + ROW / 2

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={rows.map((r) => `${r.label} ${t.median} ${formatMoney(r.q[2], currency, lang)}`).join(', ')}>
          {ticks.map((v) => (
            <g key={v}>
              <line className="grid" x1={sx(v)} x2={sx(v)} y1={top} y2={H - 24} />
              <text className="tick" x={sx(v)} y={H - 8} textAnchor={v === 0 ? 'start' : 'middle'}>
                {formatMoney(v, currency, lang)}
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const y = barY(i)
            const dim = hover != null && hover !== i
            return (
              <g key={r.id} opacity={dim ? 0.45 : 1}>
                <text
                  x={narrow ? left : labelW}
                  y={narrow ? y - ROW / 2 + 4 : y + 4}
                  textAnchor={narrow ? 'start' : 'end'}
                  style={{ fill: 'var(--text-primary)', fontWeight: r.current ? 700 : 400 }}
                >
                  {r.label}
                  {r.current ? ` (${t.current})` : ''}
                  {r.note ? ' *' : ''}
                </text>
                <line x1={sx(r.q[0])} x2={sx(r.q[4])} y1={y} y2={y} stroke="var(--series-1)" strokeWidth={2} strokeLinecap="round" />
                <rect
                  x={sx(r.q[1])} y={y - BOX / 2} width={Math.max(sx(r.q[3]) - sx(r.q[1]), 2)} height={BOX} rx={4}
                  fill={r.current ? 'var(--series-1)' : 'var(--series-1-soft)'}
                />
                <line x1={sx(r.q[2])} x2={sx(r.q[2])} y1={y - BOX / 2 - 3} y2={y + BOX / 2 + 3} stroke="var(--surface)" strokeWidth={5} />
                <line x1={sx(r.q[2])} x2={sx(r.q[2])} y1={y - BOX / 2 - 3} y2={y + BOX / 2 + 3} stroke="var(--text-primary)" strokeWidth={2} />
                <rect
                  x={0} y={y - rowH / 2} width={width} height={rowH} fill="transparent"
                  onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
                />
              </g>
            )
          })}
          {income != null && income <= xm && (
            <g pointerEvents="none">
              <line x1={sx(income)} x2={sx(income)} y1={top} y2={H - 24} stroke="var(--text-primary)" strokeWidth={1.5} strokeDasharray="0" />
              <text x={sx(income) + 4} y={top + 8} style={{ fill: 'var(--text-primary)', fontWeight: 600 }}>{t.you}</text>
            </g>
          )}
        </svg>
      )}
      {hover != null && rows[hover] && (
        <div className="tooltip" style={{ left: Math.min(Math.max(sx(rows[hover].q[2]) - 90, 0), width - 200), top: barY(hover) + 16 }}>
          <b>{rows[hover].label}</b>
          <div className="tnum">
            {t.median} {formatMoney(rows[hover].q[2], currency, lang)} · {t.mean} {formatMoney(rows[hover].mean, currency, lang)}
          </div>
          <div className="tnum">
            {t.middleHalf}: {formatMoney(rows[hover].q[1], currency, lang)}–{formatMoney(rows[hover].q[3], currency, lang)}
          </div>
          <div className="tnum">
            {t.middle80}: {formatMoney(rows[hover].q[0], currency, lang)}–{formatMoney(rows[hover].q[4], currency, lang)}
          </div>
          {rows[hover].note && <div className="muted">* {rows[hover].note}</div>}
        </div>
      )}
    </div>
  )
}

export function RangeTable({ rows, currency, lang, t }: Omit<Props, 'income'>) {
  const f = (v: number) => formatMoney(v, currency, lang)
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th></th>
            <th>p10</th>
            <th>p25</th>
            <th>{t.median}</th>
            <th>p75</th>
            <th>p90</th>
            <th>{t.mean}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.current ? 'current' : undefined}>
              <td>
                {r.label}
                {r.note ? ' *' : ''}
              </td>
              {r.q.map((v, i) => (
                <td key={i}>{f(v)}</td>
              ))}
              <td>{f(r.mean)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
