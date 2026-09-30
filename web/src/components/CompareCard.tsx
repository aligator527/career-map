import { useEffect, useState } from 'react'
import { buildComparison, type CompareKind, type CompareRow, type Conversion } from '../engine/compare'
import { COUNTRIES } from '../engine/countries'
import { loadFacets } from '../engine/data'
import { facetRows } from '../engine/facets'
import { convert } from '../engine/metric'
import type { Profile } from '../engine/types'
import { label, labeled } from '../i18n'
import { ageLabel, ctxFor, metaOf, type Env } from './env'
import { RangeRows, RangeTable, type RangeRow } from './RangeRows'

const KINDS: CompareKind[] = ['age', 'education', 'region', 'country']
type Kind = CompareKind | `facet:${string}`

export function CompareCard({ env, profile }: { env: Env; profile: Profile }) {
  const { t, lang, metric, fx } = env
  const [kind, setKind] = useState<Kind>('age')
  const [conv, setConv] = useState<Conversion>('ppp')
  const [rows, setRows] = useState<CompareRow[] | null>(null)
  const [facetRowsState, setFacetRows] = useState<RangeRow[] | null>(null)
  const [asTable, setAsTable] = useState(false)
  const meta = metaOf(env, profile.country)

  const facetDim = kind.startsWith('facet:') ? kind.slice(6) : null

  // A facet tab disappears when the new country does not publish that facet
  useEffect(() => {
    if (facetDim && !meta.facets?.[facetDim]) setKind('age')
  }, [facetDim, meta])

  useEffect(() => {
    let live = true
    if (facetDim) {
      setRows([])
      loadFacets(profile.country).then((cells) => {
        if (!live) return
        const ctx = ctxFor(env, profile.country, profile.region, profile.age)
        const values = meta.facets?.[facetDim]?.values ?? []
        setFacetRows(facetRows(meta, cells, profile, facetDim).map(({ value, match }) => {
          const f = (v: number) => convert(metric, ctx, v)
          return {
            id: value,
            label: label(values.find((v) => v.code === value)?.label, lang),
            current: profile.facets?.[facetDim] === value,
            q: match.cell.q.map(f),
            mean: f(match.cell.mean),
            note: match.dropped.length ? `${t.dropped}：${match.dropped.map((d) => t.dims[d]).join(lang === 'ja' ? '、' : ', ')}` : undefined,
          }
        }))
      }).catch(() => live && setFacetRows([]))
      return () => { live = false }
    }
    setFacetRows(null)
    const countries = COUNTRIES.filter((c) => env.metas[c])
    buildComparison(kind as CompareKind, profile, fx, conv, countries, env.common).then((r) => live && setRows(r))
    return () => { live = false }
  }, [kind, facetDim, profile, fx, conv, env, meta, metric, lang, t])

  // Flag only rows that relaxed more conditions than the current profile's own match did
  const baseDropped = new Set(rows?.find((r) => r.current)?.match.dropped ?? [])
  const baseRows: RangeRow[] = (rows ?? []).map((r) => {
    const m = metaOf(env, r.country)
    const l = r.label
    const text =
      l.kind === 'age' ? ageLabel(l.band, lang)
      : l.kind === 'education' ? t.educations[l.edu]
      : l.kind === 'region' ? label(m.regions.find((x) => x.code === l.code)?.label, lang)
      : t.countries[l.country]
    const relaxed = r.match.dropped.filter((d) => !baseDropped.has(d) && !(kind === 'country' && d === 'region'))
    const note = relaxed.length ? labeled(t.dropped, relaxed.map((d) => t.dims[d]).join(lang === 'ja' ? '、' : ', '), lang) : undefined
    // Convert in the row's own country (its taxes and prices), then into the profile's currency
    const ctx = ctxFor(env, r.country, r.region, profile.age)
    const f = (v: number) => convert(metric, ctx, v) * r.factor
    return { id: r.id, label: text, current: r.current, q: r.match.cell.q.map(f), mean: f(r.match.cell.mean), note }
  })
  const rangeRows = facetDim ? facetRowsState ?? [] : baseRows
  const facetKinds = Object.keys(meta.facets ?? {}).map((d) => `facet:${d}` as Kind)
  const kindLabel = (k: Kind) => (k.startsWith('facet:') ? label(meta.facets?.[k.slice(6)]?.label, lang) : t.compareKinds[k as CompareKind])
  const income = profile.income != null ? convert(metric, ctxFor(env, profile.country, profile.region, profile.age), profile.income) : null

  return (
    <section className="card">
      <h2>{t.compare}</h2>
      <div className="tabs" role="tablist">
        {[...KINDS, ...facetKinds].map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}>
            {kindLabel(k)}
          </button>
        ))}
      </div>
      <div className="toolbar">
        {kind === 'country' ? (
          <div className="seg" role="group" aria-label={t.conversion}>
            {(['ppp', 'fx'] as Conversion[]).map((c) => (
              <button key={c} type="button" aria-pressed={conv === c} onClick={() => setConv(c)}>{t.conversions[c]}</button>
            ))}
          </div>
        ) : <span className="note">{t.metrics[metric]}</span>}
        <button className="ghost" type="button" onClick={() => setAsTable(!asTable)}>{asTable ? t.chart : t.table}</button>
      </div>
      {rows == null || (facetDim && facetRowsState == null) ? (
        <p>{t.loading}</p>
      ) : asTable ? (
        <RangeTable rows={rangeRows} currency={meta.currency} lang={lang} t={t} />
      ) : (
        <RangeRows rows={rangeRows} currency={meta.currency} lang={lang} t={t} income={income} />
      )}
      {kind === 'country' && <p className="note">{t.conversionNote(fx.year[conv])}</p>}
      {rangeRows.some((r) => r.note) && <p className="note">* {t.rowRelaxed}</p>}
    </section>
  )
}
