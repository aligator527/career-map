import { useEffect, useState } from 'react'
import type { CountryCode, Lang } from '../engine/types'
import { formatMoney, type T } from '../i18n'
import { useWidth } from './chartUtils'
import { TILES } from './tileLayouts'

export interface TileValue {
  value: number
  label: string
  detail?: string
}

interface Props {
  country: CountryCode
  values: Record<string, TileValue | undefined>
  selected: string | null
  currency: string
  lang: Lang
  t: T
  onSelect: (code: string) => void
}

// Sequential blue ramp, 7 steps, low → high. Dark mode runs from near-surface dark to light.
const RAMP_LIGHT = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b']
const RAMP_DARK = ['#184f95', '#1c5cab', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb']
const INK_ON = (i: number, dark: boolean) => (dark ? (i >= 4 ? '#0b0b0b' : '#ffffff') : i >= 3 ? '#ffffff' : '#0b0b0b')

function useDark(): boolean {
  const q = () =>
    document.documentElement.dataset.theme === 'dark' ||
    (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  const [dark, setDark] = useState(q)
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)')
    const on = () => setDark(q())
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return dark
}

export function TileMap({ country, values, selected, currency, lang, t, onSelect }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const dark = useDark()
  const ramp = dark ? RAMP_DARK : RAMP_LIGHT
  const tiles = TILES[country] ?? []
  const cols = Math.max(...tiles.map((x) => x.col)) + 1
  const rows = Math.max(...tiles.map((x) => x.row)) + 1
  const gap = 3
  const size = Math.min(Math.floor((width - gap * (cols - 1)) / cols), 46)
  const vals = Object.values(values).filter(Boolean).map((v) => v!.value)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const bin = (v: number) => (hi > lo ? Math.min(Math.floor(((v - lo) / (hi - lo)) * ramp.length), ramp.length - 1) : 3)
  const pos = (c: number) => c * (size + gap)
  const hovered = hover ? tiles.find((x) => x.code === hover) : null
  const hv = hover ? values[hover] : undefined

  return (
    <div className="chart tilemap" ref={ref}>
      {width > 0 && size > 0 && (
        <svg width={pos(cols) - gap} height={pos(rows) - gap} role="group" aria-label={t.mapTitle}>
          {tiles.map((tile) => {
            const v = values[tile.code]
            const i = v ? bin(v.value) : -1
            const isSel = tile.code === selected
            return (
              <g
                key={tile.code}
                transform={`translate(${pos(tile.col)},${pos(tile.row)})`}
                onPointerEnter={() => setHover(tile.code)}
                onPointerLeave={() => setHover(null)}
                onClick={() => onSelect(tile.code)}
                style={{ cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                aria-label={`${v?.label ?? tile.abbr[lang]} ${v ? formatMoney(v.value, currency, lang) : t.noDataShort}`}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(tile.code)}
              >
                <rect
                  width={size} height={size} rx={4}
                  fill={v ? ramp[i] : 'var(--surface-2)'}
                  stroke={isSel ? 'var(--text-primary)' : hover === tile.code ? 'var(--text-secondary)' : 'none'}
                  strokeWidth={isSel ? 2.5 : 1.5}
                />
                <text
                  x={size / 2} y={size / 2 + 4} textAnchor="middle"
                  style={{ fill: v ? INK_ON(i, dark) : 'var(--text-muted)', fontSize: size < 34 ? 9 : 11, fontWeight: isSel ? 700 : 500 }}
                >
                  {tile.abbr[lang]}
                </text>
              </g>
            )
          })}
        </svg>
      )}
      {hovered && (
        <div className="tooltip" style={{ left: Math.min(pos(hovered.col) + size + 6, width - 200), top: pos(hovered.row) }}>
          <b>{hv?.label ?? hovered.abbr[lang]}</b>
          <div className="tnum">{hv ? formatMoney(hv.value, currency, lang) : t.noDataShort}</div>
          {hv?.detail && <div className="muted">{hv.detail}</div>}
        </div>
      )}
      {vals.length > 0 && (
        <div className="legend" aria-hidden="true">
          <span className="tnum">{formatMoney(lo, currency, lang)}</span>
          <span className="ramp">
            {ramp.map((c) => <span key={c} style={{ background: c }} />)}
          </span>
          <span className="tnum">{formatMoney(hi, currency, lang)}</span>
          <span className="nodata"><span />{t.noDataShort}</span>
        </div>
      )}
    </div>
  )
}
