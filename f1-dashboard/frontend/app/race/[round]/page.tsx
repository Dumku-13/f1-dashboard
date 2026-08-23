'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ChevronRight, MapPin } from 'lucide-react'
import { formatISTDate, formatISTTime, parseApiDate } from '@/lib/ist'
import { useApi } from '@/lib/api/client'
import { useCalendar, useCircuits, SEASON } from '@/lib/api/hooks'
import { CIRCUIT_VIEWBOX } from '@/lib/constants'
import CircuitDossier from '@/components/landing/CircuitDossier'
import type { CircuitRecords } from '@/lib/types'

const SESSION_ORDER = ['Practice 1', 'Practice 2', 'Sprint Shootout', 'Sprint Qualifying', 'Sprint', 'Practice 3', 'Qualifying', 'Race']
const SESSION_ROUTE: Record<string, string> = {
  'Practice 1': 'practice/1', 'Practice 2': 'practice/2', 'Practice 3': 'practice/3',
  'Sprint Shootout': 'qualifying', 'Sprint Qualifying': 'qualifying',
  'Sprint': 'sprint', 'Qualifying': 'qualifying', 'Race': 'race',
}

/**
 * One session in the weekend rail.
 *
 * Three states, and only one of them is marked: run sessions recede, the next
 * one carries the accent. Everything ahead of it is plain. Marking every future
 * session "UPCOMING" — which is what this did — told you nothing, because on a
 * race weekend they all are.
 */
function SessionCard({ name, date, roundNum, index, isNext }: {
  name: string; date: string | null; roundNum: string; index: number; isNext: boolean
}) {
  const ts = date ? parseApiDate(date).getTime() : NaN
  const isPast = Number.isFinite(ts) ? ts < Date.now() : false
  const route = SESSION_ROUTE[name] || 'race'

  return (
    <Link
      href={`/race/${roundNum}/${route}`}
      className={`wk-session${isNext ? ' is-next' : ''}${isPast ? ' is-done' : ''}`}
    >
      <motion.span initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(index * 0.03, 0.24) }} className="wk-session-inner">
        <span className="wk-session-n font-num">{String(index + 1).padStart(2, '0')}</span>
        <span className="wk-session-name">{name}</span>
        {date && (
          <span className="wk-session-when font-num">
            {formatISTDate(date)} · {formatISTTime(date)}
          </span>
        )}
        <span className="wk-session-state">
          {isPast ? 'Run' : isNext ? 'Next' : ''}
          <ChevronRight size={12} />
        </span>
      </motion.span>
    </Link>
  )
}

/** Seeded null and filled in an effect — reading the clock during render is a
 *  hydration mismatch. Same pattern as CountdownTimer. */
function useCountdown(target: string | null | undefined) {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!target) { setLeft(null); return }
    const end = parseApiDate(target).getTime()
    if (Number.isNaN(end)) { setLeft(null); return }
    const tick = () => setLeft(Math.max(0, end - Date.now()))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [target])
  if (left == null) return null
  const total = Math.floor(left / 1000)
  return { d: Math.floor(total / 86400), h: Math.floor((total % 86400) / 3600), m: Math.floor((total % 3600) / 60) }
}

export default function WeekendHubPage() {
  const params = useParams()
  const round = params.round as string

  const { data: calendarData, isLoading: calendarIsLoading } = useCalendar(2026)
  const event = calendarData.find(e => String(e.round) === round) || null
  const loading = calendarIsLoading && calendarData.length === 0

  // Circuit records depend on the round; keepPreviousData can leave the
  // previous round's records around while this one loads — the circuit_key
  // check (the endpoint echoes it back exactly) keeps that from painting as
  // this round's records.
  const { data: recordsRaw } = useApi<CircuitRecords>(
    event?.circuit_key ? `/api/circuits/${event.circuit_key}/records` : null,
  )
  const records = recordsRaw && recordsRaw.circuit_key === event?.circuit_key ? recordsRaw : null

  const { data: circuits } = useCircuits()
  const circuit = useMemo(
    () => (event?.circuit_key ? circuits.find(c => c.key === event.circuit_key) : undefined),
    [circuits, event?.circuit_key],
  )

  const sessionsForCount = event?.sessions || {}
  const orderedForCount = SESSION_ORDER.filter(s => s in sessionsForCount)
  const nextForCount = orderedForCount
    .map(name => ({ name, date: sessionsForCount[name] }))
    .find(s => s.date && parseApiDate(s.date).getTime() >= Date.now())
  const left = useCountdown(nextForCount?.date)

  if (loading) {
    return (
      <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
        <div className="shimmer" style={{ height: 64, borderRadius: 2, marginBottom: 22 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: 16 }} className="live-grid">
          <div className="shimmer" style={{ height: 420, borderRadius: 2 }} />
          <div className="shimmer" style={{ height: 420, borderRadius: 2 }} />
        </div>
      </div>
    )
  }

  if (!event) {
    return (
      <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
        <div className="glass-card" style={{ padding: '40px', textAlign: 'center' }}>
          <MapPin size={22} style={{ color: 'var(--muted)', marginBottom: 10 }} />
          <div style={{ fontSize: 14, color: 'var(--foreground)', fontWeight: 600, marginBottom: 4 }}>Round {round} not found</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Check the calendar for a valid round number.</div>
        </div>
      </div>
    )
  }

  const sessions = event.sessions || {}
  const orderedSessions = SESSION_ORDER.filter(s => s in sessions)
  const now = Date.now()
  const nextSession = orderedSessions
    .map(name => ({ name, date: sessions[name] }))
    .find(s => s.date && parseApiDate(s.date).getTime() >= now)
  const completedCount = orderedSessions.filter(s => {
    const d = sessions[s]
    return d && parseApiDate(d).getTime() < now
  }).length

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '0 clamp(16px, 3vw, 34px) 40px' }}>
      <style>{WEEKEND_CSS}</style>

      {/* ---- Hero. The circuit is the image this page never had — "imagery
           essentially unused" was the audit's first complaint. ---- */}
      <header className="wk-hero">
        {circuit?.svgPath && (
          <div className="wk-hero-track" aria-hidden="true">
            <svg viewBox={CIRCUIT_VIEWBOX}>
              <path d={circuit.svgPath} className="wk-track-glow" />
              <path d={circuit.svgPath} className="wk-track-line" />
            </svg>
          </div>
        )}

        <div className="wk-hero-body">
          <p className="kicker">
            Round {event.round} · {SEASON}{event.is_sprint ? ' · Sprint weekend' : ''}
          </p>
          <h1 className="display-title wk-title">{event.name}</h1>
          <p className="wk-place">{circuit?.short_name || event.location} · {event.country}</p>

          <dl className="wk-hero-stats">
            <div>
              <dt>{nextSession ? `${nextSession.name} in` : 'Weekend'}</dt>
              <dd>{nextSession ? (left ? `${left.d}d ${left.h}h ${left.m}m` : '—') : 'Complete'}</dd>
            </div>
            <div>
              <dt>Sessions run</dt>
              <dd>{completedCount} / {orderedSessions.length}</dd>
            </div>
            <div>
              <dt>Race distance</dt>
              <dd>{circuit?.race_laps ? `${circuit.race_laps} laps` : '—'}</dd>
            </div>
          </dl>
        </div>
      </header>

      {/* ---- Sessions: the page's real navigation, so it takes the full width
           instead of being boxed beside everything else. ---- */}
      <section aria-label="Weekend schedule" className="wk-sessions">
        {orderedSessions.map((name, i) => (
          <SessionCard key={name} name={name} date={sessions[name]} roundNum={round} index={i}
            isNext={nextSession?.name === name} />
        ))}
      </section>

      {/* ---- The circuit itself, from real traced geometry + telemetry. ---- */}
      <section aria-labelledby="wk-circuit-h" className="wk-block">
        <div className="wk-block-head">
          <h2 id="wk-circuit-h" className="section-title">The circuit</h2>
          {event.circuit_key && (
            <Link href={`/circuits/${event.circuit_key}`} className="wk-more">Full page →</Link>
          )}
        </div>
        <CircuitDossier year={SEASON} round={event.round} circuit={circuit} />
      </section>

      {/* ---- Records, as a data row rather than another same-weight card. ---- */}
      {records && (
        <section aria-labelledby="wk-records-h" className="wk-block">
          <div className="wk-block-head">
            <h2 id="wk-records-h" className="section-title">Here before</h2>
          </div>
          <dl className="wk-records">
            {records.most_wins && (
              <div><dt>Most wins</dt><dd>{records.most_wins.driver} <span className="font-num">({records.most_wins.count})</span></dd></div>
            )}
            {records.most_poles && (
              <div><dt>Most poles</dt><dd>{records.most_poles.driver} <span className="font-num">({records.most_poles.count})</span></dd></div>
            )}
            {records.most_podiums && (
              <div><dt>Most podiums</dt><dd>{records.most_podiums.driver} <span className="font-num">({records.most_podiums.count})</span></dd></div>
            )}
            {records.lap_record && (
              <div>
                <dt>Lap record{records.lap_record.pre_2026 ? ' · pre-2026 regs' : ''}</dt>
                <dd className="font-num wk-record-time">{records.lap_record.time}</dd>
                <dd className="wk-record-by">{records.lap_record.driver} · {records.lap_record.year}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      <p className="wk-foot">
        {event.event_format || (event.is_sprint
          ? 'Sprint weekend — practice, sprint qualifying and a sprint ahead of the Grand Prix.'
          : 'Standard weekend — three practice sessions, qualifying, then the Grand Prix.')}
        {' '}Active Aerodynamic Override replaces DRS in 2026; zone activation only appears once a session has run.
      </p>
    </div>
  )
}
/**
 * Weekend hub styles.
 *
 * The audit's complaint about this page was that every panel carried the same
 * visual weight in a uniform grid. The fix is hierarchy, not decoration: one
 * full-bleed hero with the circuit behind it, the session rail at full width
 * because it is the page's actual navigation, then blocks separated by rules
 * rather than boxed into cards of equal size.
 *
 * Scoped here rather than in globals.css — this is one route's layout.
 */
const WEEKEND_CSS = `
.wk-hero {
  position: relative;
  margin: 0 calc(-1 * clamp(16px, 3vw, 34px));
  padding: clamp(26px, 5vh, 54px) clamp(16px, 3vw, 34px) clamp(22px, 4vh, 40px);
  overflow: hidden;
  border-bottom: 1px solid var(--border);
}
.wk-hero-track {
  position: absolute;
  top: 50%; right: clamp(-40px, -2vw, 0px);
  transform: translateY(-50%);
  width: min(560px, 46%);
  pointer-events: none;
  opacity: 0.5;
}
.wk-hero-track svg { width: 100%; height: auto; display: block; overflow: visible; }
/* Two strokes rather than an SVG blur filter — a filter allocates a full-size
   offscreen buffer for what is a background flourish. */
.wk-track-glow { fill: none; stroke: var(--accent); stroke-width: 15; stroke-linecap: round; stroke-linejoin: round; opacity: 0.22; }
.wk-track-line { fill: none; stroke: #FF4A42; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }

.wk-hero-body { position: relative; z-index: 1; max-width: 62%; min-width: 0; }
.wk-title { font-size: clamp(34px, 7vw, 92px); margin: 12px 0 0; }
.wk-place {
  margin: 12px 0 0;
  font-family: var(--font-mono); font-size: 12px;
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted);
}

.wk-hero-stats {
  display: flex; flex-wrap: wrap; gap: clamp(18px, 4vw, 52px);
  margin: clamp(20px, 3.5vh, 38px) 0 0; padding-top: 18px;
  border-top: 1px solid var(--hairline);
}
.wk-hero-stats div { display: flex; flex-direction: column; gap: 5px; }
.wk-hero-stats dt {
  font-family: var(--font-mono); font-size: 10px;
  letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted);
}
.wk-hero-stats dd {
  margin: 0; font-family: var(--font-mono);
  font-size: clamp(16px, 1.8vw, 22px); font-weight: 600; font-variant-numeric: tabular-nums;
}

/* --- session rail ------------------------------------------------------- */
.wk-sessions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr));
  gap: 0;
  margin-top: clamp(20px, 3vh, 34px);
  border-top: 1px solid var(--border);
}
.wk-session {
  display: block; text-decoration: none; color: inherit;
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--hairline);
  padding: 15px 16px;
  border-top: 2px solid transparent;
  transition: background 0.18s ease, border-top-color 0.18s ease;
}
.wk-session:hover { background: var(--surface); }
.wk-session.is-done { opacity: 0.45; }
.wk-session.is-next { border-top-color: var(--accent); background: color-mix(in srgb, var(--accent) 7%, transparent); }
.wk-session-inner { display: flex; flex-direction: column; gap: 6px; }
.wk-session-n { font-size: 10px; color: var(--accent); letter-spacing: 0.14em; }
.wk-session-name {
  font-family: var(--font-display); font-weight: 700; font-stretch: 112%;
  font-size: clamp(14px, 1.5vw, 18px); text-transform: uppercase; letter-spacing: 0.02em;
}
.wk-session-when { font-size: 11px; color: var(--muted); }
.wk-session-state {
  display: inline-flex; align-items: center; gap: 4px;
  font-family: var(--font-mono); font-size: 10px;
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted);
}
.wk-session.is-next .wk-session-state { color: var(--accent); }

/* --- blocks ------------------------------------------------------------- */
.wk-block { margin-top: clamp(34px, 6vh, 72px); }
.wk-block-head {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 16px; flex-wrap: wrap; margin-bottom: clamp(14px, 2.4vh, 26px);
}
.wk-block-head .section-title { font-size: clamp(20px, 3vw, 34px); margin: 0; }
.wk-more {
  font-family: var(--font-mono); font-size: 11px;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--muted); text-decoration: none;
}
.wk-more:hover { color: var(--accent); }

.wk-records {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
  gap: clamp(16px, 3vw, 40px);
  margin: 0; padding-top: 20px; border-top: 1px solid var(--border);
}
.wk-records > div { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.wk-records dt {
  font-family: var(--font-mono); font-size: 10px;
  letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted);
}
.wk-records dd { margin: 0; font-size: clamp(15px, 1.7vw, 19px); font-weight: 600; }
.wk-record-time { color: var(--sector-purple); font-size: clamp(18px, 2vw, 24px) !important; }
.wk-record-by { font-size: 12px !important; font-weight: 400 !important; color: var(--muted); }

.wk-foot {
  margin: clamp(34px, 6vh, 64px) 0 0; max-width: 70ch;
  font-size: 13px; line-height: 1.65; color: var(--muted);
}

@media (max-width: 860px) {
  .wk-hero-body { max-width: 100%; }
  .wk-hero-track { opacity: 0.2; width: 78%; right: -14%; }
}
`
