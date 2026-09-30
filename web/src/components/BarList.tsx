import { useState } from 'react'

export interface BarRow {
  id: string
  label: string
  /** secondary text shown under the label (e.g. the kind of change) */
  kicker?: string
  /** 0..1 */
  value: number
  /** tooltip lines */
  detail?: string[]
  highlight?: boolean
}

interface Props {
  rows: BarRow[]
  format: (v: number) => string
  /** vertical reference line, e.g. the current profile's value */
  reference?: { value: number; label: string }
  max?: number
  ariaLabel: string
}

/** Horizontal bars on a shared 0..max scale, value at the tip, optional reference line. */
export function BarList({ rows, format, reference, max, ariaLabel }: Props) {
  const [hover, setHover] = useState<string | null>(null)
  const top = max ?? Math.max(...rows.map((r) => r.value), reference?.value ?? 0, 1e-9)
  const pct = (v: number) => `${Math.min((v / top) * 100, 100)}%`
  return (
    <div className="barlist" role="list" aria-label={ariaLabel}>
      {rows.map((r) => (
        <div
          key={r.id}
          className={`barlist-row${r.highlight ? ' highlight' : ''}`}
          role="listitem"
          onPointerEnter={() => setHover(r.id)}
          onPointerLeave={() => setHover(null)}
        >
          <div className="barlist-label">
            {r.kicker && <span className="kicker">{r.kicker}</span>}
            <span>{r.label}</span>
          </div>
          <div className="barlist-track">
            <span className="barlist-bar" style={{ width: pct(r.value) }} />
            {reference && <span className="barlist-ref" style={{ left: pct(reference.value) }} aria-hidden="true" />}
            <span className="barlist-value" style={{ left: pct(r.value) }}>{format(r.value)}</span>
          </div>
          {hover === r.id && r.detail && (
            <div className="tooltip barlist-tip">
              <b>{r.label}</b>
              {r.detail.map((d) => <div key={d} className="tnum">{d}</div>)}
            </div>
          )}
        </div>
      ))}
      {reference && (
        <div className="barlist-legend"><span className="ref-key" aria-hidden="true" />{reference.label}: {format(reference.value)}</div>
      )}
    </div>
  )
}

export interface Column {
  id: string
  /** short axis label */
  label: string
  /** full label for assistive tech */
  fullLabel?: string
  value: number
  highlight?: boolean
}

/** Vertical columns from a shared baseline; the highlighted and the highest column are labelled. */
export function Columns({ columns, format, ariaLabel }: { columns: Column[]; format: (v: number) => string; ariaLabel: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const top = Math.max(...columns.map((c) => c.value), 1e-9)
  const maxId = columns.reduce((a, b) => (b.value > a.value ? b : a), columns[0])?.id
  return (
    <div className="columns" role="list" aria-label={ariaLabel}>
      {columns.map((c) => {
        const labelled = c.highlight || c.id === maxId || hover === c.id
        return (
          <div
            key={c.id} className={`column${c.highlight ? ' highlight' : ''}`} role="listitem"
            aria-label={`${c.fullLabel ?? c.label} ${format(c.value)}`}
            onPointerEnter={() => setHover(c.id)} onPointerLeave={() => setHover(null)}
          >
            <div className="column-plot">
              <span className="column-value" style={{ bottom: `${(c.value / top) * 100}%`, visibility: labelled ? 'visible' : 'hidden' }}>
                {format(c.value)}
              </span>
              <span className="column-bar" style={{ height: `${(c.value / top) * 100}%` }} />
            </div>
            <span className="column-label">{c.label}</span>
          </div>
        )
      })}
    </div>
  )
}
