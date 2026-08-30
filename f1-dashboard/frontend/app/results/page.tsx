'use client'

/**
 * Season results browser — round + session picker over the existing
 * `/api/sessions/{year}/{round}/{session}/results` endpoint.
 *
 * Nothing new on the backend; this is the "browse every classification"
 * surface the app was missing.
 */

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Flag, Trophy, Timer, ChevronRight, AlertTriangle } from 'lucide-react'
import { useApiList } from '@/lib/api/client'
import { useCalendar, useLatestCompletedRound } from '@/lib/api/hooks'
import { useSeason } from '@/lib/season'
import { formatLapTime } from '@/lib/ist'
import { TEAM_COLORS } from '@/lib/constants'
import type { SessionResult, CalendarEvent } from '@/lib/types'

const MEDAL = ['#FFD700', '#C0C0C0', '#CD7F32']

/** Session codes the backend accepts, in weekend order. */
const SESSIONS = [
  { id: 'Race', label: 'Race' },
  { id: 'Qualifying', label: 'Qualifying' },
  { id: 'Sprint', label: 'Sprint' },
  { id: 'Sprint Qualifying', label: 'Sprint Quali' },
  { id: 'Practice 3', label: 'FP3' },
  { id: 'Practice 2', label: 'FP2' },
  { id: 'Practice 1', label: 'FP1' },
] as const

function HeaderStat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div style={{ padding: '9px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, minWidth: 96, textAlign: 'center' }}>
      <div className="font-num stat-num" style={{ fontSize: 17, color: accent || 'var(--foreground)' }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 3 }}>{label}</div>
    </div>
  )
}

/**
 * Remounted per season (see `ResultsPage`) so the selected round resets — round
 * 22 of 2025 is a different race from round 22 of 2024, and 2026 has fewer
 * rounds than either.
 */
function SeasonResults({ year }: { year: number }) {
  const { data: calendar } = useCalendar(year)
  const { round: latestRound, isLoading: roundLoading } = useLatestCompletedRound(year)

  const [round, setRound] = useState<number | null>(null)
  const [session, setSession] = useState<string>('Race')

  // Default to the most recently scored round once standings tell us which it is.
  useEffect(() => {
    if (round === null && latestRound) setRound(latestRound)
  }, [latestRound, round])

  const activeRound = round ?? latestRound
  const event: CalendarEvent | undefined = useMemo(
    () => calendar.find(e => e.round === activeRound),
    [calendar, activeRound],
  )

  const { data: results, isLoading, error } = useApiList<SessionResult>(
    activeRound ? `/api/sessions/${year}/${activeRound}/${encodeURIComponent(session)}/results` : null,
  )

  // Sprint sessions only exist on sprint weekends.
  const sessions = SESSIONS.filter(s =>
    event?.is_sprint ? true : !s.id.startsWith('Sprint'),
  )

  const winner = results[0]
  const fastest = results.find(r => r.fastest_lap)
  const finishers = results.filter(r => r.status === 'Finished').length
  const isRaceLike = session === 'Race' || session === 'Sprint'

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>{year} Season</div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>Results</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0' }}>
            {event ? `${event.name} · ${event.location}` : 'Every classification of the season.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <HeaderStat label="Round" value={activeRound ? String(activeRound).padStart(2, '0') : '—'} />
          <HeaderStat label={isRaceLike ? 'Winner' : 'Fastest'} value={winner ? (winner.abbreviation || winner.driver || '—') : '—'} accent={MEDAL[0]} />
          {isRaceLike && <HeaderStat label="Finishers" value={results.length ? finishers : '—'} />}
        </div>
      </motion.div>

      {/* Round selector */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
        {calendar.map(ev => {
          const active = ev.round === activeRound
          const done = new Date(ev.event_date).getTime() < Date.now()
          return (
            <button
              key={ev.round}
              onClick={() => setRound(ev.round)}
              aria-pressed={active}
              title={ev.name}
              className="font-num"
              style={{
                // `minHeight` explicitly, not left to the `pointer: coarse`
                // floor in globals.css — an inline style beats a media query,
                // which is the exact trap the Phase 13 touch-target pass
                // documented. Measured at 375px these 31 round buttons were
                // 32px tall, under the 40px floor everywhere else obeys.
                padding: '8px 10px', borderRadius: 2, cursor: 'pointer', minWidth: 40, minHeight: 40,
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? '#fff' : done ? 'var(--foreground)' : 'var(--muted)',
                opacity: done || active ? 1 : 0.45,
                fontSize: 11, fontWeight: 700,
              }}
            >
              R{ev.round}{ev.is_sprint ? <span style={{ color: active ? '#fff' : 'var(--amber)' }}>S</span> : ''}
            </button>
          )
        })}
      </div>

      {/* Session selector */}
      <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: 18, flexWrap: 'wrap' }}>
        {sessions.map(s => (
          <button
            key={s.id}
            onClick={() => setSession(s.id)}
            aria-pressed={session === s.id}
            className="font-display"
            style={{
              // Same reason as the round buttons above: an inline style beats
              // the `pointer: coarse` floor, so the session tabs sat at 32px.
              padding: '10px 15px', minHeight: 40, border: 'none', cursor: 'pointer', borderRadius: 2,
              fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
              background: session === s.id ? 'var(--accent)' : 'transparent',
              color: session === s.id ? '#fff' : 'var(--muted)',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Body */}
      {/* `roundLoading` matters on a cold season: the default round comes from
          standings, which take minutes to compute the first time. Without it
          the page would claim "no classification" while it was still working
          out which round to show. */}
      {(isLoading && !results.length) || (!activeRound && roundLoading) ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
            Loading the {year} season… the first load of a season can take a minute.
          </div>
          <div className="shimmer" style={{ height: 520, borderRadius: 2 }} />
        </>
      ) : error || results.length === 0 ? (
        <div className="glass-card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <AlertTriangle size={22} style={{ color: 'var(--muted)', marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No classification for this session</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            The session may not have run yet, or doesn&apos;t exist for this weekend.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.6fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }} className="live-grid">
          {/* Classification */}
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="glass-card" style={{ padding: 18 }}
          >
            <h2 className="section-title" style={{ marginBottom: 14 }}>
              {session} Classification
            </h2>
            <div className="table-scroll">
              <table className="f1-table f1-table--anchored">
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>POS</th>
                    <th>DRIVER</th>
                    <th>TEAM</th>
                    {isRaceLike && <th style={{ textAlign: 'center' }}>GRID</th>}
                    {isRaceLike && <th style={{ textAlign: 'center' }}>+/−</th>}
                    <th style={{ textAlign: 'right' }}>BEST LAP</th>
                    {isRaceLike && <th style={{ textAlign: 'right' }}>PTS</th>}
                    <th>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => {
                    const colour = TEAM_COLORS[r.team || ''] || 'var(--border)'
                    const grid = r.grid_position ?? r.grid
                    const moved = grid != null && r.position != null ? grid - r.position : 0
                    const medal = i < 3 && isRaceLike ? MEDAL[i] : null
                    return (
                      <tr key={r.driver || i} style={{
                        background: i === 0 ? 'linear-gradient(90deg, rgba(255,200,0,0.07), transparent 60%)' : 'transparent',
                      }}>
                        <td className="font-num" style={{ fontWeight: 700, color: medal || 'var(--muted)', fontSize: 12 }}>
                          {r.position ?? '—'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <span style={{ width: 3, height: 16, background: colour, display: 'inline-block', flexShrink: 0 }} />
                            <span className="font-display" style={{ fontWeight: 700, fontSize: 13 }}>{r.abbreviation || r.driver}</span>
                            {r.fastest_lap && (
                              <span className="font-num" style={{ fontSize: 8, background: 'rgba(191,0,255,0.18)', color: 'var(--sector-purple)', padding: '2px 5px', borderRadius: 2, fontWeight: 700 }}>FL</span>
                            )}
                          </div>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>{r.team}</td>
                        {isRaceLike && (
                          <td className="font-num" style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{grid ?? '—'}</td>
                        )}
                        {isRaceLike && (
                          <td className="font-num" style={{
                            textAlign: 'center', fontSize: 12, fontWeight: 700,
                            color: moved > 0 ? 'var(--sector-green)' : moved < 0 ? 'var(--accent)' : 'var(--muted)',
                            opacity: moved === 0 ? 0.4 : 1,
                          }}>
                            {moved > 0 ? `+${moved}` : moved < 0 ? moved : '—'}
                          </td>
                        )}
                        <td className="font-num" style={{ textAlign: 'right', fontSize: 12, color: r.fastest_lap ? 'var(--sector-purple)' : 'var(--foreground)' }}>
                          {r.best_lap_time ? formatLapTime(r.best_lap_time) : '—'}
                        </td>
                        {isRaceLike && (
                          <td className="font-num" style={{
                            textAlign: 'right', fontWeight: 700, fontSize: 13,
                            color: (r.points ?? 0) > 0 ? 'var(--amber)' : 'var(--muted)',
                            opacity: (r.points ?? 0) > 0 ? 1 : 0.4,
                          }}>
                            {(r.points ?? 0) > 0 ? r.points : '—'}
                          </td>
                        )}
                        <td style={{ fontSize: 12, color: r.status === 'Finished' ? 'var(--sector-green)' : 'var(--muted)' }}>
                          {r.status || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>

          {/* Rail */}
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            {isRaceLike && results.length >= 3 && (
              <div className="glass-card" style={{ padding: 18 }}>
                <h2 className="section-title" style={{ marginBottom: 14, ['--bar' as string]: '#FFD700' }}>
                  <Trophy size={13} style={{ marginRight: -4 }} /> Podium
                </h2>
                {results.slice(0, 3).map((r, i) => (
                  <div key={r.driver} style={{
                    display: 'flex', alignItems: 'center', gap: 11, padding: '10px 0',
                    borderBottom: i < 2 ? '1px solid var(--hairline)' : 'none',
                  }}>
                    <span className="font-num" style={{ fontSize: 15, fontWeight: 800, color: MEDAL[i], width: 22 }}>P{i + 1}</span>
                    <span style={{ width: 3, height: 20, background: TEAM_COLORS[r.team || ''] || 'var(--border)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="font-display" style={{ fontWeight: 700, fontSize: 13 }}>{r.abbreviation || r.driver}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.team}</div>
                    </div>
                    <span className="font-num" style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)' }}>{r.points ?? 0}</span>
                  </div>
                ))}
              </div>
            )}

            {fastest && (
              <div className="glass-card" style={{ padding: 18 }}>
                <h2 className="section-title" style={{ marginBottom: 12, ['--bar' as string]: 'var(--sector-purple)' }}>
                  <Timer size={13} style={{ marginRight: -4 }} /> Fastest Lap
                </h2>
                <div className="stat-num" style={{ fontSize: 26, color: 'var(--sector-purple)' }}>
                  {fastest.best_lap_time ? formatLapTime(fastest.best_lap_time) : '—'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 5 }}>
                  {fastest.abbreviation || fastest.driver} · {fastest.team}
                </div>
              </div>
            )}

            {event && (
              <div className="glass-card" style={{ padding: 18 }}>
                <h2 className="section-title" style={{ marginBottom: 12 }}>
                  <Flag size={13} style={{ marginRight: -4 }} /> Weekend
                </h2>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
                  <div>{event.official_name || event.name}</div>
                  <div>{event.country} · {event.location}</div>
                  {event.is_sprint && <div style={{ color: 'var(--amber)', fontWeight: 700 }}>Sprint weekend</div>}
                </div>
                <Link
                  href={`/race/${event.round}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 13,
                    fontSize: 11, color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.05em',
                    textTransform: 'uppercase', fontFamily: 'var(--font-display)', textDecoration: 'none',
                    // The global 40px floor deliberately skips `<a>`, because
                    // most links here sit inside prose and inflating them would
                    // wreck the line boxes. This one is a standalone CTA, not
                    // prose, so it gets the target the rule would have given it.
                    minHeight: 40, paddingRight: 4,
                  }}
                >
                  Weekend hub <ChevronRight size={12} />
                </Link>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  )
}

/**
 * Season-scoped remount: switching year must not carry the previous season's
 * round selection (or its cached classification) into the new one.
 */
export default function ResultsPage() {
  const [season] = useSeason()
  return <SeasonResults key={season} year={season} />
}
