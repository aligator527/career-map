import { useEffect, useState } from 'react'
import { loadFacets } from '../engine/data'
import { facetCell } from '../engine/facets'
import { convert } from '../engine/metric'
import type { Cells, CountryMeta, Profile } from '../engine/types'
import { formatCount, formatMoney, label, labeled } from '../i18n'
import { BarList } from './BarList'
import { ctxFor, droppedText, type Env } from './env'

/** Pay for each facet the user selected (industry, company size, …), next to their main group's median. */
export function FacetPanel({ env, meta, profile, groupMedian }: { env: Env; meta: CountryMeta; profile: Profile; groupMedian: number }) {
  const { t, lang, metric } = env
  const selected = Object.entries(profile.facets ?? {}).filter(([dim]) => meta.facets?.[dim])
  const [cells, setCells] = useState<{ country: string; cells: Cells } | null>(null)

  useEffect(() => {
    if (!selected.length) return
    let live = true
    loadFacets(profile.country).then((c) => live && setCells({ country: profile.country, cells: c })).catch(() => {})
    return () => { live = false }
  }, [profile.country, selected.length])

  if (!selected.length || !cells || cells.country !== profile.country) return null
  const ctx = ctxFor(env, profile.country, profile.region, profile.age)
  const f = (v: number) => convert(metric, ctx, v)
  const rows = selected.flatMap(([dim, value]) => {
    const m = facetCell(meta, cells.cells, profile, dim, value)
    if (!m) return []
    const facet = meta.facets![dim]
    const valueLabel = label(facet.values.find((v) => v.code === value)?.label, lang)
    return [{
      id: dim,
      kicker: label(facet.label, lang),
      label: valueLabel,
      value: f(m.cell.q[2]),
      detail: [
        `${t.middleHalf}: ${formatMoney(f(m.cell.q[1]), meta.currency, lang)}–${formatMoney(f(m.cell.q[3]), meta.currency, lang)}`,
        ...(m.cell.n > 0 ? [labeled(meta.nKind === 'population' ? t.population : t.sample, formatCount(m.cell.n, lang), lang)] : []),
        ...(m.dropped.length ? [labeled(t.dropped, droppedText(env, m), lang)] : []),
      ],
    }]
  })
  if (!rows.length) return null
  return (
    <div className="goal-section">
      <h3>{t.facetTitle}</h3>
      <p className="note">{t.facetLead}</p>
      <BarList
        ariaLabel={t.facetTitle}
        format={(v) => formatMoney(v, meta.currency, lang)}
        reference={{ value: f(groupMedian), label: t.median }}
        rows={rows}
      />
    </div>
  )
}
