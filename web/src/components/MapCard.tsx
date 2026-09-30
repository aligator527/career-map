import { useEffect, useState } from 'react'
import { loadRegions } from '../engine/data'
import { mapKey } from '../engine/lookup'
import { convert } from '../engine/metric'
import type { Cells, Profile } from '../engine/types'
import { formatCount, label, labeled, paren } from '../i18n'
import { InfoIcon } from './ResultCard'
import { ctxFor, describeGroup, droppedText, metaOf, type Env } from './env'
import { TileMap, type TileValue } from './TileMap'
import { TILES } from './tileLayouts'

export function MapCard({ env, profile, onSelectRegion }: { env: Env; profile: Profile; onSelectRegion: (code: string) => void }) {
  const { t, lang, metric } = env
  const meta = metaOf(env, profile.country)
  const [regions, setRegions] = useState<{ country: string; cells: Record<string, Cells> } | null>(null)

  useEffect(() => {
    let live = true
    loadRegions(profile.country).then((cells) => live && setRegions({ country: profile.country, cells }))
    return () => { live = false }
  }, [profile.country])

  if (!TILES[profile.country] || !meta.regions.length) return null
  if (!regions || regions.country !== profile.country) {
    return <section className="card"><h2>{t.mapTitle}</h2><p>{t.loading}</p></section>
  }

  const pick = mapKey(meta, regions.cells, profile)
  const values: Record<string, TileValue | undefined> = {}
  for (const r of meta.regions) {
    const cell = regions.cells[r.code]?.[pick.key]
    if (!cell) continue
    const ctx = ctxFor(env, profile.country, r.code, profile.age)
    values[r.code] = {
      value: convert(metric, ctx, cell[4]),
      label: label(r.label, lang),
      detail: `${meta.nKind === 'population' ? t.population : t.sample} ${formatCount(cell[0], lang)}${t.people}`,
    }
  }

  return (
    <section className="card">
      <h2>{paren(t.mapTitle, t.metrics[metric], lang)}</h2>
      <TileMap
        country={profile.country} values={values} selected={profile.region}
        currency={meta.currency} lang={lang} t={t} onSelect={onSelectRegion}
      />
      <dl className="meta">
        <dt>{t.mapGroup}</dt>
        <dd>{describeGroup(env, meta, pick.key, null)}</dd>
      </dl>
      {(pick.dropped.length > 0 || pick.occupationCoarsened) && (
        <div className="notice" role="note">
          <InfoIcon />
          <div>
            {pick.dropped.length > 0 && <div>{labeled(t.dropped, droppedText(env, pick), lang)}</div>}
            {pick.occupationCoarsened && <div>{t.coarsened}</div>}
          </div>
        </div>
      )}
      <p className="note">{t.mapHint}</p>
    </section>
  )
}
