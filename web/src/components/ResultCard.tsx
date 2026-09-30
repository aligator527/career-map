import { convert, takeHome } from '../engine/metric'
import { percentileOf } from '../engine/stats'
import type { Cell, CountryMeta, Match, Profile } from '../engine/types'
import { formatCount, formatMoney, formatPct, label, labeled, paren } from '../i18n'
import { DistributionChart } from './DistributionChart'
import { FacetPanel } from './FacetPanel'
import { ctxFor, describeGroup, droppedText, type Env } from './env'

export function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7v4M8 4.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// Categorical slots 1–4 of the reference palette; identity is also carried by the labelled legend.
const PART_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)']

export function ResultCard({ env, meta, match, profile }: { env: Env; meta: CountryMeta; match: Match; profile: Profile }) {
  const { t, lang, metric } = env
  const cur = meta.currency
  const ctx = ctxFor(env, profile.country, profile.region, profile.age)
  const f = (x: number) => convert(metric, ctx, x)
  const raw = match.cell
  // The transform is monotone, so quantiles map directly; the mean is an approximation.
  const cell: Cell = { ...raw, mean: f(raw.mean), q: raw.q.map(f) as Cell['q'] }
  const income = profile.income != null && profile.income > 0 ? profile.income : null
  const pct = income != null ? percentileOf(income, raw.q) : null
  const th = takeHome(ctx, raw.q[2])
  const parts = [
    { key: 'net', v: th.net }, { key: 'social', v: th.social }, { key: 'incomeTax', v: th.incomeTax }, { key: 'localTax', v: th.localTax },
  ] as const
  const stateTaxMissing = profile.country === 'US' && profile.region && !env.taxes.us

  return (
    <section className="card" aria-live="polite">
      <h2>{t.resultTitle}</h2>
      <div className="hero">
        {pct != null ? (
          <>
            <span className="lead">{t.topShareLead}</span>
            <span className="value">{t.topShare(formatPct(Math.max(1 - pct, 0.001), lang))}</span>
            <span className="sub">{paren(t.median, t.metrics[metric], lang)} {formatMoney(cell.q[2], cur, lang)}</span>
          </>
        ) : (
          <>
            <span className="lead">{paren(t.medianLead, t.metrics[metric], lang)}</span>
            <span className="value">{formatMoney(cell.q[2], cur, lang)}</span>
          </>
        )}
      </div>

      <DistributionChart cell={cell} currency={cur} lang={lang} t={t} income={income != null ? f(income) : null} />

      <div className="stats">
        <div className="stat"><div className="k">{t.middleHalf}</div><div className="v">{formatMoney(cell.q[1], cur, lang)}–{formatMoney(cell.q[3], cur, lang)}</div></div>
        <div className="stat"><div className="k">{t.middle80}</div><div className="v">{formatMoney(cell.q[0], cur, lang)}–{formatMoney(cell.q[4], cur, lang)}</div></div>
        <div className="stat"><div className="k">{t.mean}</div><div className="v">{formatMoney(cell.mean, cur, lang)}</div></div>
        <div className="stat">
          <div className="k">{meta.nKind === 'population' ? t.population : t.sample}</div>
          <div className="v">{cell.n > 0 ? `${formatCount(cell.n, lang)}${t.people}` : '—'}</div>
        </div>
      </div>

      <FacetPanel env={env} meta={meta} profile={profile} groupMedian={raw.q[2]} />

      <div className="breakdown">
        <h3>{labeled(t.takeHomeTitle, formatMoney(th.gross, cur, lang), lang)}</h3>
        <div className="bar" aria-hidden="true">
          {parts.map((p, i) => p.v > 0 && <span key={p.key} style={{ flex: p.v, background: PART_COLORS[i] }} />)}
        </div>
        <ul>
          {parts.map((p, i) => p.v > 0 && (
            <li key={p.key}>
              <i style={{ background: PART_COLORS[i] }} />
              {t.takeHomeParts[p.key]} <b>{formatMoney(p.v, cur, lang)}</b> ({formatPct(p.v / th.gross, lang)})
            </li>
          ))}
        </ul>
        <p className="note">{t.taxNote[profile.country]}{stateTaxMissing ? ` ${t.stateTaxMissing}` : ''}</p>
      </div>

      {(match.dropped.length > 0 || match.occupationCoarsened) && (
        <div className="notice" role="note">
          <InfoIcon />
          <div>
            {match.dropped.length > 0 && <div>{labeled(t.dropped, droppedText(env, match), lang)}</div>}
            {match.occupationCoarsened && <div>{t.coarsened}</div>}
          </div>
        </div>
      )}

      <dl className="meta">
        <dt>{t.matched}</dt>
        <dd>{describeGroup(env, meta, match.key, match.regional ? profile.region : null)}</dd>
        <dt>{t.metric}</dt>
        <dd>{t.metricNotes[metric]}</dd>
        <dt>{t.method}</dt>
        <dd>{t.methods[raw.method]}</dd>
        <dt>{t.definition}</dt>
        <dd>{label(meta.wageDefinition, lang)}</dd>
        <dt>{t.source}</dt>
        <dd>
          <a href={meta.source.url} target="_blank" rel="noreferrer">{label(meta.source.name, lang)}</a>
          {metric === 'real' && env.prices[profile.country] && (
            <>
              <br />
              {labeled(t.priceSource, '', lang)}
              <a href={env.prices[profile.country]!.source.url} target="_blank" rel="noreferrer">
                {label(env.prices[profile.country]!.source.name, lang)}
              </a>
            </>
          )}
        </dd>
      </dl>
    </section>
  )
}
