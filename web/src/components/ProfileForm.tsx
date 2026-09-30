import { useMemo, useState } from 'react'
import type { CountryCode, CountryMeta, Education, Lang, Profile, Sex } from '../engine/types'
import { CURRENCY, INCOME_UNIT } from '../engine/countries'
import { label, paren, type T } from '../i18n'

interface Props {
  profile: Profile
  /** countries with published data */
  countries: CountryCode[]
  meta: CountryMeta | null
  lang: Lang
  t: T
  remember: boolean
  onChange: (p: Profile) => void
  onCountry: (c: CountryCode) => void
  onRemember: (v: boolean) => void
}

export function ProfileForm({ profile: p, countries, meta, lang, t, remember, onChange, onCountry, onRemember }: Props) {
  const [query, setQuery] = useState('')
  const set = (patch: Partial<Profile>) => onChange({ ...p, ...patch })

  const groups = useMemo(() => {
    if (!meta) return []
    const q = query.trim().toLowerCase()
    return meta.occupationMajor
      .map((m) => {
        const occs = meta.occupations.filter((o) => `M${o.major}` === m.code)
        const hit = (o: { label: typeof m.label }) =>
          !q || Object.values(o.label).some((s) => s?.toLowerCase().includes(q))
        return { major: m, occs: occs.filter(hit), majorHit: hit(m) }
      })
      .filter((g) => g.occs.length || g.majorHit)
  }, [meta, query])

  const incomeUnit = INCOME_UNIT[p.country]
  const incomeUnitLabel = p.country === 'JP' ? (lang === 'ja' ? '万円' : '×10,000 JPY') : CURRENCY[p.country]
  // Japan lists prefectures in the conventional north-to-south order; elsewhere alphabetical
  const sorted = meta ? [...meta.regions].sort((a, b) => (p.country === 'JP' ? 0 : label(a.label, lang).localeCompare(label(b.label, lang)))) : []

  return (
    <form className="card form" onSubmit={(e) => e.preventDefault()} aria-label={t.profile}>
      <h2>{t.profile}</h2>

      <div className="field">
        <span id="country-label">{t.country}</span>
        <select aria-labelledby="country-label" value={p.country} onChange={(e) => onCountry(e.target.value as CountryCode)}>
          {countries.map((c) => (
            <option key={c} value={c}>{t.countries[c]}</option>
          ))}
        </select>
      </div>

      <label className="field">
        <span>{t.region}</span>
        <select value={p.region ?? ''} onChange={(e) => set({ region: e.target.value || null })}>
          <option value="">{t.anyRegion}</option>
          {sorted.filter((r) => r.kind !== 'metro').map((r) => (
            <option key={r.code} value={r.code}>{label(r.label, lang)}</option>
          ))}
          {sorted.some((r) => r.kind === 'metro') && (
            <optgroup label={t.metros}>
              {sorted.filter((r) => r.kind === 'metro').map((r) => (
                <option key={r.code} value={r.code}>{label(r.label, lang)}</option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      <div className="field">
        <label htmlFor="occ-search"><span>{t.occupation}</span></label>
        <input id="occ-search" type="search" placeholder={t.occupationSearch} value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label={t.occupation} value={p.occupation ?? ''} onChange={(e) => set({ occupation: e.target.value || null })}>
          <option value="">{t.anyOccupation}</option>
          {groups.map(({ major, occs }) =>
            // Countries published only at major-group level (Eurostat) get plain options
            meta?.occupations.length ? (
              <optgroup key={major.code} label={label(major.label, lang)}>
                <option value={major.code}>{paren(label(major.label, lang), t.majorGroup, lang)}</option>
                {occs.map((o) => (
                  <option key={o.code} value={o.code}>{label(o.label, lang)}</option>
                ))}
              </optgroup>
            ) : (
              <option key={major.code} value={major.code}>{label(major.label, lang)}</option>
            ),
          )}
        </select>
      </div>

      <div className="row2">
        <label className="field">
          <span>{t.age}</span>
          <input
            type="number" inputMode="numeric" min={18} max={69} value={p.age ?? ''}
            onChange={(e) => set({ age: e.target.value ? Math.min(69, Math.max(18, Number(e.target.value))) : null })}
          />
        </label>
        <label className="field">
          <span>{t.sex}</span>
          <select value={p.sex ?? ''} onChange={(e) => set({ sex: (e.target.value || null) as Sex | null })}>
            <option value="">{t.unspecified}</option>
            <option value="F">{t.sexes.F}</option>
            <option value="M">{t.sexes.M}</option>
          </select>
        </label>
      </div>

      {meta && meta.educations.length > 0 && (
        <label className="field">
          <span>{t.education}</span>
          <select value={p.education ?? ''} onChange={(e) => set({ education: (e.target.value || null) as Education | null })}>
            <option value="">{t.unspecified}</option>
            {meta.educations.map((e) => (
              <option key={e} value={e}>{t.educations[e]}</option>
            ))}
          </select>
        </label>
      )}

      {meta?.facets && Object.keys(meta.facets).length > 0 && (
        <details className="facet-fields" open={Object.keys(p.facets ?? {}).length > 0}>
          <summary>{t.moreConditions}</summary>
          {Object.entries(meta.facets).map(([dim, f]) => (
            <label className="field" key={dim}>
              <span>{label(f.label, lang)}</span>
              <select
                value={p.facets?.[dim] ?? ''}
                onChange={(e) => {
                  const next = { ...(p.facets ?? {}) }
                  if (e.target.value) next[dim] = e.target.value
                  else delete next[dim]
                  set({ facets: next })
                }}
              >
                <option value="">{t.unspecified}</option>
                {f.values.map((v) => <option key={v.code} value={v.code}>{label(v.label, lang)}</option>)}
              </select>
            </label>
          ))}
          <small>{t.moreConditionsHint}</small>
        </details>
      )}

      <label className="field">
        <span>{paren(t.income, incomeUnitLabel, lang)}</span>
        <input
          type="number" inputMode="numeric" min={0}
          value={p.income != null ? Math.round(p.income / incomeUnit) : ''}
          onChange={(e) => set({ income: e.target.value ? Number(e.target.value) * incomeUnit : null })}
        />
        <small>{t.incomeHint}</small>
      </label>

      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => onRemember(e.target.checked)} />
        {t.remember}
      </label>
    </form>
  )
}
