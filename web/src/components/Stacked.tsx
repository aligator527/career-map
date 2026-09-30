import { useState } from 'react'

export interface Segment {
  id: string
  label: string
  value: number
  /** CSS color (use tokens) */
  color: string
}

/** One 100% bar split into segments, with a legend that carries the labels and values. */
export function StackedBar({ segments, format, ariaLabel }: { segments: Segment[]; format: (v: number) => string; ariaLabel: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  return (
    <div className="stacked">
      <div className="stacked-bar" role="img" aria-label={`${ariaLabel}: ${segments.map((s) => `${s.label} ${format(s.value / total)}`).join(', ')}`}>
        {segments.map((s) => s.value > 0 && <span key={s.id} style={{ flex: s.value, background: s.color }} title={`${s.label} ${format(s.value / total)}`} />)}
      </div>
      <ul className="stacked-legend">
        {segments.map((s) => (
          <li key={s.id}><i style={{ background: s.color }} />{s.label} <b>{format(s.value / total)}</b></li>
        ))}
      </ul>
    </div>
  )
}

export interface StackColumn {
  id: string
  label: string
  highlight?: boolean
  segments: Segment[]
}

/** Columns of 100% height split into ordered segments (bottom = first segment). */
export function StackedColumns({ columns, legend, format, ariaLabel }: {
  columns: StackColumn[]
  legend: { label: string; color: string }[]
  format: (v: number) => string
  ariaLabel: string
}) {
  const [hover, setHover] = useState<string | null>(null)
  const hovered = columns.find((c) => c.id === hover)
  return (
    <div className="stacked-columns-wrap">
      <div className="stacked-columns" role="list" aria-label={ariaLabel}>
        {columns.map((c) => {
          const total = c.segments.reduce((s, x) => s + x.value, 0) || 1
          return (
            <div
              key={c.id} role="listitem" className={`stack-col${c.highlight ? ' highlight' : ''}`}
              aria-label={`${c.label}: ${c.segments.map((s) => `${s.label} ${format(s.value / total)}`).join(', ')}`}
              onPointerEnter={() => setHover(c.id)} onPointerLeave={() => setHover(null)}
            >
              <div className="stack-plot">
                {/* segments under 0.5% would only render as hairlines between the gaps; the tooltip still lists them */}
                {[...c.segments].reverse().map((s) => s.value / total >= 0.005 && (
                  <span key={s.id} style={{ flex: s.value / total, background: s.color }} />
                ))}
              </div>
              <span className="column-label">{c.label}</span>
            </div>
          )
        })}
      </div>
      <ul className="stacked-legend">
        {legend.map((l) => <li key={l.label}><i style={{ background: l.color }} />{l.label}</li>)}
      </ul>
      {hovered && (
        <div className="tooltip stack-tip">
          <b>{hovered.label}</b>
          {hovered.segments.map((s) => {
            const total = hovered.segments.reduce((a, x) => a + x.value, 0) || 1
            return <div key={s.id} className="tnum">{s.label} {format(s.value / total)}</div>
          })}
        </div>
      )}
    </div>
  )
}
