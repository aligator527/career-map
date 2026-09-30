import { useEffect, useState } from 'react'
import {
  buildSubmission, communityCell, communityEnabled, deleteSubmission, submit,
  type CommunityData, type English, type Employment, type Extra, type Remote, type RoleLevel,
} from '../engine/community'
import { loadCommunity } from '../engine/data'
import { majorOf } from '../engine/lookup'
import type { Profile } from '../engine/types'
import { formatDate, formatMoney, label, labeled } from '../i18n'
import { BarList } from './BarList'
import { InfoIcon } from './ResultCard'
import { describeGroup, metaOf, type Env } from './env'

const PRIVACY_URL = 'https://github.com/aligator527/career-map/blob/main/docs/PRIVACY.md'
const EMPLOYMENT: Employment[] = ['regular', 'non_regular', 'self_employed', 'founder']
const ROLES: RoleLevel[] = ['staff', 'lead', 'manager', 'director', 'executive']
const ENGLISH: English[] = ['none', 'basic', 'business', 'fluent', 'native']
const REMOTE: Remote[] = ['none', 'hybrid', 'full']

export function CommunityCard({ env, profile }: { env: Env; profile: Profile }) {
  const { t, lang } = env
  const meta = metaOf(env, profile.country)
  const [data, setData] = useState<CommunityData | null>(null)
  const [extra, setExtra] = useState<Extra>({ employment: 'regular', roleLevel: null, english: null, remote: null, changedJob3y: null })
  const [consent, setConsent] = useState(false)
  const [state, setState] = useState<{ kind: 'idle' | 'sending' | 'error' } | { kind: 'sent'; code: string }>({ kind: 'idle' })
  const [deleteCode, setDeleteCode] = useState('')
  const [deleteState, setDeleteState] = useState<'idle' | 'deleted' | 'notfound' | 'error'>('idle')

  useEffect(() => {
    loadCommunity().then(setData).catch(() => setData(null))
  }, [])

  const money = (v: number) => formatMoney(v, meta.currency, lang)
  const country = data?.countries[profile.country]
  const mine = data ? communityCell(data, profile, (o) => majorOf(meta, o)) : null
  const submission = buildSubmission(profile, extra)
  const set = (patch: Partial<Extra>) => setExtra({ ...extra, ...patch })

  const onSubmit = async () => {
    if (!submission || !consent) return
    setState({ kind: 'sending' })
    try {
      setState({ kind: 'sent', code: await submit(submission) })
    } catch {
      setState({ kind: 'error' })
    }
  }
  const onDelete = async () => {
    try {
      setDeleteState((await deleteSubmission(deleteCode)) ? 'deleted' : 'notfound')
    } catch {
      setDeleteState('error')
    }
  }

  const breakdown = (dim: 'role_level' | 'english' | 'employment', labels: Record<string, string>) => {
    const b = country?.breakdowns[dim]
    if (!b) return null
    const rows = Object.entries(b).map(([k, [n, , median]]) => ({ id: k, label: labels[k] ?? k, value: median, detail: [labeled(t.communityN, `≈${n}`, lang)] }))
    return (
      <>
        <h4>{t.communityBy[dim]}</h4>
        <BarList ariaLabel={t.communityBy[dim]} format={money} rows={rows.sort((a, b2) => b2.value - a.value)} />
      </>
    )
  }

  return (
    <section className="card">
      <h2>{t.communityTitle}</h2>
      <p className="note">{t.communityLead}</p>

      {data && (
        <div className="goal-section">
          {!country || !mine ? (
            <p>{t.communityEmpty(data.kMin, country?.n ?? 0)}</p>
          ) : (
            <>
              <div className="stats">
                <div className="stat"><div className="k">{t.median}</div><div className="v">{money(mine.cell[2])}</div></div>
                <div className="stat"><div className="k">{t.middleHalf}</div><div className="v">{money(mine.cell[1])}–{money(mine.cell[3])}</div></div>
                <div className="stat"><div className="k">{t.communityN}</div><div className="v">≈{mine.cell[0]}</div></div>
              </div>
              <dl className="meta">
                <dt>{t.matched}</dt>
                <dd>{describeGroup(env, meta, mine.key, null)}</dd>
              </dl>
              {country.breakdowns && Object.keys(country.breakdowns).length > 0 && <p className="note">{t.communityByScope(t.countries[profile.country])}</p>}
              {breakdown('role_level', t.roleLevels)}
              {breakdown('english', t.englishLevels)}
              {breakdown('employment', t.employmentTypes)}
            </>
          )}
          <div className="notice" role="note"><InfoIcon /><div>{t.communityBias}</div></div>
          {data.generatedOn && <p className="note">{labeled(t.communityUpdated, formatDate(data.generatedOn, lang), lang)}</p>}
        </div>
      )}

      <details className="goal-section contribute">
        <summary><b>{t.contributeTitle}</b></summary>
        {!communityEnabled ? (
          <p className="note">{t.contributeDisabled}</p>
        ) : state.kind === 'sent' ? (
          <div className="sent" role="status">
            <p>{t.contributeThanks}</p>
            <p className="code-label">{t.deletionCode}</p>
            <code className="deletion-code">{state.code}</code>
            <button type="button" className="ghost" onClick={() => navigator.clipboard?.writeText(state.code)}>{t.copy}</button>
            <p className="note">{t.deletionCodeNote}</p>
          </div>
        ) : (
          <>
            <p className="note">{t.contributeLead}</p>
            <div className="contribute-grid">
              <label className="field"><span>{t.employment}</span>
                <select value={extra.employment} onChange={(e) => set({ employment: e.target.value as Employment })}>
                  {EMPLOYMENT.map((v) => <option key={v} value={v}>{t.employmentTypes[v]}</option>)}
                </select>
              </label>
              <label className="field"><span>{t.roleLevel}</span>
                <select value={extra.roleLevel ?? ''} onChange={(e) => set({ roleLevel: (e.target.value || null) as RoleLevel | null })}>
                  <option value="">{t.unspecified}</option>
                  {ROLES.map((v) => <option key={v} value={v}>{t.roleLevels[v]}</option>)}
                </select>
              </label>
              <label className="field"><span>{t.english}</span>
                <select value={extra.english ?? ''} onChange={(e) => set({ english: (e.target.value || null) as English | null })}>
                  <option value="">{t.unspecified}</option>
                  {ENGLISH.map((v) => <option key={v} value={v}>{t.englishLevels[v]}</option>)}
                </select>
              </label>
              <label className="field"><span>{t.remote}</span>
                <select value={extra.remote ?? ''} onChange={(e) => set({ remote: (e.target.value || null) as Remote | null })}>
                  <option value="">{t.unspecified}</option>
                  {REMOTE.map((v) => <option key={v} value={v}>{t.remoteTypes[v]}</option>)}
                </select>
              </label>
              <label className="field"><span>{t.changedJob}</span>
                <select value={extra.changedJob3y == null ? '' : String(extra.changedJob3y)} onChange={(e) => set({ changedJob3y: e.target.value === '' ? null : e.target.value === 'true' })}>
                  <option value="">{t.unspecified}</option>
                  <option value="true">{t.yes}</option>
                  <option value="false">{t.no}</option>
                </select>
              </label>
            </div>

            {!submission ? (
              <p className="notice"><InfoIcon />{t.contributeNeedsProfile}</p>
            ) : (
              <>
                <h4>{t.contributePreview}</h4>
                <table className="data preview">
                  <tbody>
                    <tr><td>{t.country}</td><td>{t.countries[submission.country]}</td></tr>
                    <tr><td>{t.region}</td><td>{submission.region ? label(meta.regions.find((r) => r.code === submission.region)?.label, lang) : '—'}</td></tr>
                    <tr><td>{t.occupation}</td><td>{submission.occupation ? label((meta.occupations.find((o) => o.code === submission.occupation) ?? meta.occupationMajor.find((m) => m.code === submission.occupation))?.label, lang) : '—'}</td></tr>
                    <tr><td>{t.age}</td><td>{submission.age_band}</td></tr>
                    <tr><td>{t.sex}</td><td>{submission.sex ? t.sexes[submission.sex] : '—'}</td></tr>
                    <tr><td>{t.education}</td><td>{submission.education ? t.educations[submission.education] : '—'}</td></tr>
                    <tr><td>{t.income}</td><td>{money(submission.income)}</td></tr>
                  </tbody>
                </table>
                <label className="check consent">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>{t.consent} <a href={PRIVACY_URL} target="_blank" rel="noreferrer">{t.privacyPolicy}</a></span>
                </label>
                <button type="button" className="primary" disabled={!consent || state.kind === 'sending'} onClick={onSubmit}>
                  {state.kind === 'sending' ? t.sending : t.submit}
                </button>
                {state.kind === 'error' && <p className="notice" role="alert"><InfoIcon />{t.submitError}</p>}
              </>
            )}
          </>
        )}

        {communityEnabled && (
          <div className="goal-section">
            <h4>{t.deleteTitle}</h4>
            <div className="delete-row">
              <input type="text" aria-label={t.deletionCode} placeholder="XXXX-XXXX-…" value={deleteCode} onChange={(e) => setDeleteCode(e.target.value)} />
              <button type="button" className="ghost" onClick={onDelete} disabled={deleteCode.replace(/[^0-9a-z]/gi, '').length < 20}>{t.delete}</button>
            </div>
            {deleteState !== 'idle' && <p className="note" role="status">{t.deleteResult[deleteState]}</p>}
          </div>
        )}
      </details>
    </section>
  )
}
