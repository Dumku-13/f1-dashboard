'use client'

/**
 * Follow Along — the "I'm watching the race right now" page.
 *
 * One click from anywhere, optionally pinned to a driver. Everything on screen
 * is what you actually want while a session is running: how long is left, where
 * your driver is, what they're on, what they've done here before, and the tower
 * underneath for context.
 *
 * Choosing a driver also switches the alert engine to them (`myDriver`), which
 * is why there's no separate alert setup here — following IS the setup.
 */

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { Timer, Swords, ScrollText, Flag, ChevronRight, UserRound, X } from 'lucide-react'
import { useLiveSession, fmtLap, fmtGap, type TowerRow } from '@/lib/live'
import { useAlertSettings } from '@/lib/alerts'
import { useApi } from '@/lib/api/client'
import { useCalendar, useRaceLaps, SEASON } from '@/lib/api/hooks'
import MiniSectors from '@/components/live/MiniSectors'
import StintBar from '@/components/live/StintBar'
import BattleView from '@/components/live/BattleView'
import { battleNeighbours } from '@/lib/battle'
import DriverStory from '@/components/live/DriverStory'
import TrackMap from '@/components/live/TrackMap'
import TeamRadioPanel from '@/components/live/TeamRadioPanel'
import RoundFlag from '@/components/shared/RoundFlag'

const RaceEngineer = dynamic(() => import('@/components/engineer/RaceEngineer'), {
  ssr: false,
  loading: () => <div className="shimmer" style={{ height: 280, borderRadius: 2 }} />,
})

const EngineerChat = dynamic(() => import('@/components/engineer/EngineerChat'), {
  ssr: false,
  loading: () => <div className="shimmer" style={{ height: 320, borderRadius: 2 }} />,
})

const FOLLOW_KEY = 'f1.follow.driver'

/* ------------------------------- session clock ---------------------------- */

function useCountdown(target: string | null | undefined) {
  // Seeded null and filled in an effect: reading Date.now() during render gives
  // the server a different value from the client, which React 19 reports as a
  // hydration mismatch.
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!target) { setLeft(null); return }
    const end = new Date(target).getTime()
    if (Number.isNaN(end)) { setLeft(null); return }
    const tick = () => setLeft(Math.max(0, end - Date.now()))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [target])
  return left
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function Stat({ label, value, accent, delay = 0 }: { label: string; value: string; accent?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35, ease: 'easeOut' }}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, padding: '10px 13px', minWidth: 92 }}
    >
      <div className="font-display" style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
      <div className="stat-num" style={{ fontSize: 19, marginTop: 3, color: accent || 'var(--foreground)' }}>{value}</div>
    </motion.div>
  )
}

/* --------------------------------- page ----------------------------------- */

export default function FollowPage() {
  const live = useLiveSession()
  const { status, session, rows, raceControl, trackStatus } = live
  const { settings, update } = useAlertSettings()
  const { data: calendar } = useCalendar(SEASON)

  const [following, setFollowing] = useState<string | null>(null)

  // Restore the pinned driver after mount (localStorage is client-only).
  useEffect(() => {
    const saved = window.localStorage.getItem(FOLLOW_KEY)
    if (saved) setFollowing(saved)
  }, [])

  /**
   * Following a driver IS the alert setup — point the existing engine at them
   * and switch it on, so overtakes, pit stops and fastest laps arrive without
   * a second configuration step.
   */
  useEffect(() => {
    if (!following) return
    if (settings.myDriver === following && settings.enabled) return
    update({ enabled: true, myDriver: following })
  }, [following]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (abbr: string | null) => {
    setFollowing(abbr)
    if (abbr) window.localStorage.setItem(FOLLOW_KEY, abbr)
    else window.localStorage.removeItem(FOLLOW_KEY)
  }

  const me: TowerRow | undefined = useMemo(
    () => rows.find(r => r.driver.name_acronym === following),
    [rows, following],
  )

  /**
   * Radio for the pinned driver only. With nobody pinned there's no "yours" to
   * filter to, so the whole grid's clips are still the right answer.
   */
  /**
   * The same window the fight panel shows, reused to light up the map. Derived
   * from one source so the two can't disagree about who the rivals are.
   */
  const fightAbbrs = useMemo(
    () => battleNeighbours(rows, following).map(n => n.row.driver.name_acronym),
    [rows, following],
  )

  const myRadio = useMemo(
    () => (me ? live.teamRadio.filter(c => c.driverNumber === me.driver.driver_number) : live.teamRadio),
    [live.teamRadio, me],
  )

  const sessionLeft = useCountdown(session?.date_end)
  const nextEvent = useMemo(() => {
    const now = Date.now()
    return calendar.find(ev => new Date(ev.event_date).getTime() > now) || null
  }, [calendar])
  const untilNext = useCountdown(nextEvent?.event_date)

  // The live feed has no round number, so match this weekend out of the
  // calendar the same way the benchmarks panel does.
  const wanted = (session?.circuit_short_name || session?.country_name || '').toLowerCase()
  const engineerEvent = wanted
    ? calendar.find(ev => `${ev.location || ''} ${ev.name || ''} ${ev.country || ''}`.toLowerCase().includes(wanted))
    : undefined

  // Rounds you can actually engineer: the sim fits pace from a race that has
  // run, so upcoming rounds aren't offered.
  const engineerRounds = useMemo(
    () => calendar.filter(ev => new Date(ev.event_date).getTime() < Date.now()),
    [calendar],
  )
  const [engineerRound, setEngineerRound] = useState<number | null>(null)
  // Default to this weekend's round when it's raceable, else the latest one.
  useEffect(() => {
    if (engineerRound !== null || !engineerRounds.length) return
    const live = engineerEvent && engineerRounds.some(e => e.round === engineerEvent.round)
      ? engineerEvent.round
      : engineerRounds[engineerRounds.length - 1].round
    setEngineerRound(live)
  }, [engineerRounds, engineerEvent, engineerRound])

  const engineerLaps = useRaceLaps(engineerRound, SEASON) ?? 57

  // Career/season context for the followed driver.
  const { data: driverStats } = useApi<any>(following ? `/api/analysis/driver/${following}/${SEASON}` : null)

  // Median tyre age across everyone currently running, so the followed
  // driver's rubber can be read in context rather than as a bare number.
  const tyreVsField = useMemo(() => {
    if (me?.tyreAge == null) return null
    const ages = rows.map(r => r.tyreAge).filter((a): a is number => a != null).sort((a, b) => a - b)
    if (ages.length < 3) return null
    const median = ages[Math.floor(ages.length / 2)]
    return me.tyreAge - median
  }, [rows, me])

  const myPos = me?.position ?? null
  const ahead = myPos != null && myPos > 1 ? rows.find(r => r.position === myPos - 1) : null
  const behind = myPos != null ? rows.find(r => r.position === myPos + 1) : null

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} style={{ marginBottom: 18 }}>
        <div className="kicker" style={{ marginBottom: 8 }}>Follow Along</div>
        <h1 className="display-title" style={{ fontSize: 'clamp(24px, 4vw, 40px)', margin: 0 }}>
          {session ? `${session.country_name} · ${session.session_name}` : 'Waiting for a session'}
        </h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }} style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 640, lineHeight: 1.55 }}>
          {status === 'live'
            ? 'One driver’s race, not the whole session. Pin someone and this becomes their fight, their story and their strategy.'
            : 'Nothing running right now — this page goes live automatically when a session starts.'}
          {' '}
          <a href="/live" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            Watching the whole session instead? That’s Live Timing →
          </a>
        </motion.p>
      </motion.div>

      {/* Session clock */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <Stat
          label={status === 'live' ? 'Session ends in' : 'Session'}
          value={status === 'live' ? fmtDuration(sessionLeft) : (session?.session_name || '—')}
          accent={status === 'live' ? 'var(--sector-green)' : undefined}
          delay={0.1}
        />
        <Stat label="Next session" value={nextEvent?.name ? fmtDuration(untilNext) : '—'} delay={0.18} />
        <Stat label="Track" value={trackStatus ? trackStatus.toUpperCase() : '—'} delay={0.26} />
        <Stat label="Cars" value={rows.length ? String(rows.length) : '—'} delay={0.34} />
      </div>

      {/* Driver picker */}
      <motion.div className="glass-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.4, ease: 'easeOut' }} style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: following ? 10 : 0, flexWrap: 'wrap' }}>
          <UserRound size={14} style={{ color: 'var(--accent)' }} />
          <span className="font-display" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {following ? `Following ${following}` : 'Pick a driver to follow'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {following ? '· alerts are on for them' : '· optional'}
          </span>
          {following && (
            <motion.button
              onClick={() => pick(null)}
              aria-label="Stop following this driver"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.92 }}
              style={{
                marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 2, color: 'var(--muted)', cursor: 'pointer', fontSize: 11, minHeight: 40,
              }}
            >
              <X size={11} /> Clear
            </motion.button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {rows.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Driver list appears once timing data is flowing.
            </span>
          )}
          {rows.map((r, i) => {
            const on = r.driver.name_acronym === following
            const colour = r.driver.team_colour ? `#${r.driver.team_colour.replace('#', '')}` : 'var(--border)'
            return (
              <motion.button
                key={r.driver.driver_number}
                onClick={() => pick(on ? null : r.driver.name_acronym)}
                aria-pressed={on}
                className="font-display"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.25 + i * 0.015, duration: 0.3, ease: 'easeOut' }}
                whileHover={{ scale: 1.08, y: -1 }}
                whileTap={{ scale: 0.93 }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 11px', borderRadius: 2, cursor: 'pointer', minHeight: 40,
                  border: `1px solid ${on ? colour : 'var(--border)'}`,
                  background: on ? `color-mix(in srgb, ${colour} 22%, transparent)` : 'transparent',
                  color: 'var(--foreground)', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                  transition: 'background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease',
                  boxShadow: on ? `0 0 14px ${colour}33` : 'none',
                }}
              >
                <motion.span
                  style={{ width: 3, height: 13, background: colour, borderRadius: 1 }}
                  animate={{ height: on ? 17 : 13 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                />
                {r.driver.name_acronym}
              </motion.button>
            )
          })}
        </div>
      </motion.div>

      {/* Focused driver */}
      <AnimatePresence mode="wait">
      {following && (
        <motion.div
          key={`focused-${following}`}
          className="glass-card"
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.98 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          style={{ padding: 18, marginBottom: 16 }}
        >
          <h2 className="section-title" style={{ marginBottom: 14 }}>{following} — right now</h2>

          {!me ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              No live data for {following} in this session yet.
            </div>
          ) : (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.35 }}
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))', gap: 10, marginBottom: 16 }}
              >
                <Stat label="Position" value={me.position ? `P${me.position}` : '—'} accent="var(--accent)" delay={0.1} />
                <Stat label="Gap to leader" value={fmtGap(me.gapToLeader)} delay={0.15} />
                <Stat label="Interval" value={fmtGap(me.interval)} delay={0.2} />
                <Stat label="Last lap" value={fmtLap(me.lastLap?.lap_duration)} delay={0.25} />
                <Stat label="Best lap" value={fmtLap(me.bestLapDuration)} accent={me.isOverallBestLap ? 'var(--sector-purple)' : undefined} delay={0.3} />
                <Stat label="Tyre" value={me.compound ? `${me.compound[0]}${me.tyreAge != null ? ` · ${me.tyreAge}L` : ''}` : '—'} delay={0.35} />
              </motion.div>

              <div style={{ marginBottom: 14 }}>
                <div className="font-display" style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 7 }}>
                  Sectors this lap
                </div>
                <MiniSectors miniSectors={me.miniSectors} sectors={me.sectors} />
              </div>

              {/* Speed traps. The feed has carried these all along (I1/I2 are
                  the intermediate points, FL the finish line, ST the trap) with
                  their own personal/session-best flags — they were parsed and
                  never shown. Purple = fastest in the session, green = this
                  driver's own best. */}
              {me.speeds.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div className="font-display" style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 7 }}>
                    Speed traps
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {me.speeds.map(sp => (
                      <div
                        key={sp.key}
                        title={sp.key === 'ST' ? 'Speed trap' : sp.key === 'FL' ? 'Finish line' : `Intermediate ${sp.key[1]}`}
                        style={{
                          display: 'flex', alignItems: 'baseline', gap: 6,
                          background: 'var(--surface)', border: '1px solid var(--border)',
                          borderRadius: 2, padding: '6px 11px',
                        }}
                      >
                        <span className="font-display" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--muted)' }}>{sp.key}</span>
                        <span
                          className="font-num"
                          style={{
                            fontSize: 13, fontWeight: 700,
                            color: sp.value == null ? 'var(--muted)'
                              : sp.color === 'purple' ? 'var(--sector-purple)'
                              : sp.color === 'green' ? 'var(--sector-green)'
                              : 'var(--foreground)',
                          }}
                        >
                          {sp.value != null ? sp.value : '—'}
                        </span>
                        {sp.value != null && <span style={{ fontSize: 9, color: 'var(--muted)' }}>km/h</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tyre age against the rest of the field — the number that tells
                  you whether they're about to have pace, or about to lose it. */}
              {tyreVsField != null && me.tyreAge != null && (
                <div style={{ marginBottom: 14 }}>
                  <div className="font-display" style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 7 }}>
                    Tyre age vs field
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                    <span className="stat-num" style={{ fontSize: 19 }}>{me.tyreAge}L</span>
                    <span
                      className="font-num"
                      style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
                        background: tyreVsField <= 0 ? 'rgba(0,209,49,0.14)' : 'rgba(232,0,45,0.14)',
                        color: tyreVsField <= 0 ? 'var(--sector-green)' : '#FF6B7F',
                      }}
                    >
                      {tyreVsField === 0 ? 'level with' : tyreVsField < 0 ? `${-tyreVsField}L fresher than` : `${tyreVsField}L older than`} the median
                    </span>
                  </div>
                </div>
              )}

              {me.stints.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div className="font-display" style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 7 }}>
                    Stints
                  </div>
                  <StintBar stints={me.stints} maxLaps={Math.max(1, me.stints.reduce((n, s) => n + Math.max(s.laps, 1), 0))} />
                </div>
              )}

              {(ahead || behind) && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3, duration: 0.35 }}
                  style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}
                >
                  {ahead && (
                    <div style={{ flex: '1 1 200px', background: 'var(--surface)', border: '1px solid var(--border)', padding: '9px 12px' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>Ahead — P{ahead.position}</div>
                      <div className="font-display" style={{ fontSize: 13, fontWeight: 700 }}>{ahead.driver.name_acronym}</div>
                      <div className="font-num" style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtLap(ahead.bestLapDuration)}</div>
                    </div>
                  )}
                  {behind && (
                    <div style={{ flex: '1 1 200px', background: 'var(--surface)', border: '1px solid var(--border)', padding: '9px 12px' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>Behind — P{behind.position}</div>
                      <div className="font-display" style={{ fontSize: 13, fontWeight: 700 }}>{behind.driver.name_acronym}</div>
                      <div className="font-num" style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtLap(behind.bestLapDuration)}</div>
                    </div>
                  )}
                </motion.div>
              )}
            </>
          )}

          {/* Season form for the followed driver */}
          {driverStats && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25, duration: 0.4 }}
              style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--hairline)' }}
            >
              <div className="font-display" style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 9 }}>
                {SEASON} form
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(120px, 100%), 1fr))', gap: 9 }}>
                <Stat label="Wins" value={String(driverStats.wins ?? '—')} accent="var(--sector-green)" delay={0.3} />
                <Stat label="Podiums" value={String(driverStats.podiums ?? '—')} delay={0.35} />
                <Stat label="Points" value={String(driverStats.points ?? '—')} delay={0.4} />
                <Stat label="Best finish" value={driverStats.best_finish ? `P${driverStats.best_finish}` : '—'} delay={0.45} />
                <Stat label="Laps led" value={String(driverStats.laps_led ?? '—')} delay={0.5} />
                <Stat label="DNFs" value={String(driverStats.dnfs ?? '—')} accent={driverStats.dnfs ? 'var(--accent)' : undefined} delay={0.55} />
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
      </AnimatePresence>

      {/* Tower + engineer */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.9fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }} className="live-grid">
        {/* The full 22-row tower deliberately isn't here — it's identical for
            every pinned driver, so it belongs on /live. These two panels are
            the ones that change when you change who you're following. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div className="glass-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.09)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Swords size={13} style={{ color: 'var(--accent)' }} />
              <span className="font-display" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em' }}>
                The fight{following ? ` — ${following}` : ''}
              </span>
              <a
                href="/live"
                className="font-display"
                style={{ marginLeft: 'auto', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}
              >
                Full timing <ChevronRight size={11} />
              </a>
            </div>
            <BattleView rows={rows} following={following} live={status === 'live'} />
          </div>

          <div className="glass-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.09)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <ScrollText size={13} style={{ color: 'var(--sector-purple)' }} />
              <span className="font-display" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em' }}>
                {following ? `${following}'s session` : 'Session story'}
              </span>
            </div>
            <DriverStory rows={rows} raceControl={raceControl} following={following} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Benchmarks and the unfiltered race-control feed moved out: both are
              session-level, identical whoever you follow, and already on /live.
              Race control that names your driver is folded into the story feed. */}
          <TrackMap
            rows={rows}
            live={status === 'live'}
            trackStatus={trackStatus}
            focus={following}
            highlight={fightAbbrs}
          />
          <TeamRadioPanel clips={myRadio} rows={rows} />

          <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Timer size={13} style={{ color: 'var(--sector-purple)' }} />
              <span className="font-display" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ask the pit wall</span>
            </div>
            <EngineerChat compact />
          </div>
        </div>
      </div>

      {/* Race Engineering, scoped to the followed driver and this weekend's round. */}
      <AnimatePresence mode="wait">
      {following && (
        <motion.div
          key={`engineer-${following}`}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginTop: 16 }}
        >
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            Race Engineering — {following}
          </h2>

          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15, duration: 0.35 }}
            style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}
          >
            <span className="font-display" style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--muted)', marginRight: 4 }}>
              Round
            </span>
            {engineerRounds.length === 0 && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>No completed rounds this season yet.</span>
            )}
            {engineerRounds.map((ev, i) => (
              <motion.button
                key={ev.round}
                onClick={() => setEngineerRound(ev.round)}
                title={ev.name}
                aria-label={`Round ${ev.round} — ${ev.name}`}
                aria-pressed={ev.round === engineerRound}
                className="font-num"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 + i * 0.02, duration: 0.25 }}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.95 }}
                style={{
                  padding: '5px 9px', borderRadius: 2, cursor: 'pointer', minWidth: 56, minHeight: 44,
                  border: `1px solid ${ev.round === engineerRound ? 'var(--accent)' : 'var(--border)'}`,
                  background: ev.round === engineerRound ? 'var(--accent)' : 'transparent',
                  color: ev.round === engineerRound ? '#fff' : 'var(--foreground)',
                  fontSize: 11, fontWeight: 700,
                  transition: 'background 0.25s ease, border-color 0.25s ease, color 0.25s ease',
                }}
              >
                <RoundFlag event={ev} active={ev.round === engineerRound} />
              </motion.button>
            ))}
          </motion.div>
          <RaceEngineer
            year={SEASON}
            round={engineerRound}
            driver={following}
            totalLaps={engineerLaps}
            compact
          />
        </motion.div>
      )}
      </AnimatePresence>

      <div style={{ marginTop: 16, fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Flag size={12} />
        Alerts follow your pinned driver. Broadcast delay set on the live page applies here too.
      </div>
    </div>
  )
}
