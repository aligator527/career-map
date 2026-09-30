import { useMemo, useState } from 'react'
import { fitLognormal, incomeAt, lognormalPdf, percentileOf } from '../engine/stats'
import type { Cell, Lang } from '../engine/types'
import { formatMoney, formatPct, type T } from '../i18n'
import { niceTicks, useWidth } from './chartUtils'

interface Props {
  cell: Cell
  currency: string
  lang: Lang
  t: T
  income: number | null
}

const H = 220
const M = { top: 28, right: 16, bottom: 28, left: 16 }

/** Approximate density of the group's annual pay, with the median and the user's position. */
export function DistributionChart({ cell, currency, lang, t, income }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const { points, xMax } = useMemo(() => {
    // The curve is a smooth lognormal fitted to p10..p90; percentiles themselves use the exact quantiles.
    const { mu, sigma } = fitLognormal(cell.q)
    const lo = incomeAt(0.005, cell.q)
    const hi = incomeAt(0.985, cell.q)
    const n = 160
    const pts = Array.from({ length: n + 1 }, (_, i) => {
      const x = lo + ((hi - lo) * i) / n
      return { x, d: lognormalPdf(x, mu, sigma) }
    })
    return { points: pts, xMax: Math.max(hi, income ?? 0) * 1.02 }
  }, [cell, income])

  const iw = Math.max(width - M.left - M.right, 10)
  const ih = H - M.top - M.bottom
  const ticks = niceTicks(xMax, width < 480 ? 3 : 5)
  const xm = ticks[ticks.length - 1]
  const dMax = Math.max(...points.map((p) => p.d))
  const sx = (x: number) => M.left + (x / xm) * iw
  const sy = (d: number) => M.top + ih - (d / dMax) * ih * 0.92

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.d).toFixed(1)}`).join('')
  const area = `${line}L${sx(points[points.length - 1].x).toFixed(1)},${M.top + ih}L${sx(points[0].x).toFixed(1)},${M.top + ih}Z`
  const median = cell.q[2]

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * xm
    setHover(Math.min(Math.max(x, 0), xm))
  }

  const incomeLabelX = income != null ? sx(Math.min(income, xm)) : 0
  const anchor = (x: number) => (x > M.left + iw - 40 ? 'end' : x < M.left + 40 ? 'start' : 'middle')

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`${t.median} ${formatMoney(median, currency, lang)}`}>
          {ticks.map((v) => (
            <g key={v}>
              <line className="grid" x1={sx(v)} x2={sx(v)} y1={M.top} y2={M.top + ih} />
              <text className="tick" x={sx(v)} y={H - 8} textAnchor={v === 0 ? 'start' : 'middle'}>
                {formatMoney(v, currency, lang)}
              </text>
            </g>
          ))}
          <path d={area} fill="var(--series-1-wash)" />
          <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <line className="baseline" x1={M.left} x2={M.left + iw} y1={M.top + ih} y2={M.top + ih} />

          <line x1={sx(median)} x2={sx(median)} y1={M.top + 6} y2={M.top + ih} stroke="var(--series-1)" strokeWidth={1} />
          <text x={sx(median)} y={M.top} textAnchor={anchor(sx(median))}>
            {t.median} {formatMoney(median, currency, lang)}
          </text>

          {income != null && (
            <g>
              <line x1={incomeLabelX} x2={incomeLabelX} y1={M.top + 18} y2={M.top + ih} stroke="var(--text-primary)" strokeWidth={2} />
              <circle cx={incomeLabelX} cy={M.top + 18} r={5} fill="var(--text-primary)" stroke="var(--surface)" strokeWidth={2} />
              <text x={incomeLabelX} y={M.top + 10} textAnchor={anchor(incomeLabelX)} style={{ fill: 'var(--text-primary)', fontWeight: 600 }}>
                {t.you}
              </text>
            </g>
          )}

          {hover != null && (
            <line x1={sx(hover)} x2={sx(hover)} y1={M.top} y2={M.top + ih} stroke="var(--text-muted)" strokeWidth={1} />
          )}
          <rect
            x={M.left} y={M.top} width={iw} height={ih} fill="transparent"
            onPointerMove={onMove} onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hover != null && (
        <div className="tooltip" style={{ left: Math.min(sx(hover) + 12, width - 200), top: M.top }}>
          <span className="tnum">
            {t.shareBelow(formatMoney(hover, currency, lang), formatPct(percentileOf(Math.max(hover, 1), cell.q), lang))}
          </span>
        </div>
      )}
    </div>
  )
}
