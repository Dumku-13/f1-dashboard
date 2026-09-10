'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowUpRight,
  CalendarDays,
  Flag,
  MapPin,
  RefreshCw,
  Trophy,
} from 'lucide-react'
import type { CalendarEvent, Circuit, SessionResult, Standings } from '@/lib/types'
import { useApiList } from '@/lib/api/client'
import { SEASON, useCircuits } from '@/lib/api/hooks'
import { CIRCUIT_VIEWBOX, TEAM_COLORS } from '@/lib/constants'
import { countdownTo, formatIST, formatISTDate, parseApiDate } from '@/lib/ist'
import { hexColor } from '@/lib/utils'
import { nextSession, weekendEndsAt, weekendSessions, type WeekendSession } from '@/lib/weekend'
import styles from './DashboardWeekend.module.css'

interface DashboardWeekendProps {
  calendar: CalendarEvent[]
  calendarLoading: boolean
  standings?: Standings
}

const ease = [0.22, 1, 0.36, 1] as const

function eventEnd(event: CalendarEvent): number | null {
  const value = weekendEndsAt(event)
  return Number.isFinite(value) && value > 0 ? value : null
}

function eventYear(event?: CalendarEvent | null): number {
  const sessionTime = weekendSessions(event)[0]?.t
  const eventTime = parseApiDate(event?.event_date).getTime()
  const stamp = sessionTime ?? eventTime
  if (!Number.isFinite(stamp)) return SEASON
  return new Date(stamp).getUTCFullYear()
}

function formatSessionDay(value: number): string {
  return formatIST(new Date(value), { weekday: 'short', day: 'numeric', month: 'short' })
}

function formatSessionTime(value: number): string {
  return formatIST(new Date(value), { hour: '2-digit', minute: '2-digit', hour12: true })
}

function driverName(result: SessionResult): string {
  return result.full_name || result.driver || result.abbreviation || '—'
}

function driverCode(result: SessionResult): string {
  return result.abbreviation || result.driver || '—'
}

function teamColor(result: SessionResult): string | undefined {
  return hexColor(result.team_color) || (result.team ? TEAM_COLORS[result.team] : undefined)
}

function positionOf(result: SessionResult): number | null {
  return typeof result.position === 'number' && Number.isFinite(result.position)
    ? result.position
    : null
}

function BriefingHeader() {
  return (
    <div className={styles.briefingHeader}>
      <div>
        <p className="kicker">Race weekend</p>
        <h2 id="dashboard-weekend-title" className="display-title">The briefing</h2>
      </div>
      <Link href="/calendar" className={styles.headerLink}>
        <span>Full calendar</span>
        <ArrowUpRight size={16} aria-hidden="true" />
      </Link>
    </div>
  )
}

function LoadingBriefing() {
  return (
    <div className={styles.briefingGrid} role="status" aria-live="polite" aria-label="Loading race weekend briefing">
      <div className={`glass-card ${styles.loadingPanel}`}>
        <div className="shimmer" style={{ width: '24%', height: 12 }} />
        <div className="shimmer" style={{ width: '68%', height: 54, marginTop: 16 }} />
        <div className={styles.loadingHero}>
          <div className="shimmer" style={{ width: '100%', height: '100%', minHeight: 220 }} />
          <div className="shimmer" style={{ width: '100%', height: '100%', minHeight: 220 }} />
        </div>
      </div>
      <div className={`glass-card ${styles.loadingPanel}`}>
        <div className="shimmer" style={{ width: '58%', height: 14 }} />
        <div className={styles.loadingRows}>
          {[0, 1, 2].map(row => <div key={row} className="shimmer" style={{ height: 58, width: '100%' }} />)}
        </div>
      </div>
    </div>
  )
}

function CalendarEmptyState() {
  return (
    <div className={`glass-card ${styles.statePanel}`} role="status">
      <CalendarDays size={30} aria-hidden="true" />
      <h3>Weekend data is unavailable</h3>
      <p>The race calendar has not returned any events yet.</p>
      <Link href="/calendar" className={styles.actionLink}>Open calendar <ArrowUpRight size={16} aria-hidden="true" /></Link>
    </div>
  )
}

function SeasonCompletePanel({ lastRace }: { lastRace?: CalendarEvent | null }) {
  return (
    <article className={`glass-card ${styles.upcomingPanel} ${styles.seasonPanel}`}>
      <div className={styles.seasonMark}><Flag size={22} aria-hidden="true" /></div>
      <p className="kicker">Season status</p>
      <h3 className="display-title">Season complete</h3>
      <p className={styles.seasonCopy}>
        Every scheduled weekend has passed. Revisit the final classification or explore the season archive.
      </p>
      <div className={styles.seasonActions}>
        {lastRace && <Link href={`/race/${lastRace.round}/race`} className={styles.actionLink}>Final results <ArrowUpRight size={16} aria-hidden="true" /></Link>}
        <Link href="/history" className={styles.secondaryLink}>Season history <ArrowUpRight size={16} aria-hidden="true" /></Link>
      </div>
    </article>
  )
}

function CircuitTrace({ circuit, event, loading, reduced }: { circuit?: Circuit; event: CalendarEvent; loading: boolean; reduced: boolean }) {
  const path = circuit?.svgPath

  return (
    <div className={styles.trackStage}>
      <div className={styles.trackLabel}>
        <span>Circuit trace</span>
        <span className="font-num">{circuit?.key || event.circuit_key || 'UNMAPPED'}</span>
      </div>
      {path ? (
        <svg
          className={styles.trackSvg}
          viewBox={CIRCUIT_VIEWBOX}
          role="img"
          aria-label={`${circuit?.short_name || event.location || event.name} circuit outline`}
        >
          <motion.path
            d={path}
            className={styles.trackGlow}
            fill="none"
            pathLength={1}
            initial={{ pathLength: reduced ? 1 : 0, opacity: reduced ? 1 : 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.9, ease }}
          />
          <motion.path
            d={path}
            className={styles.trackPath}
            fill="none"
            pathLength={1}
            initial={{ pathLength: reduced ? 1 : 0, opacity: reduced ? 1 : 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.9, ease, delay: reduced ? 0 : 0.08 }}
          />
        </svg>
      ) : (
        <div className={styles.trackFallback}>
          {loading ? <div className="shimmer" style={{ width: '74%', height: 12 }} /> : <MapPin size={34} aria-hidden="true" />}
          <span>{loading ? 'Loading circuit record' : 'Circuit trace unavailable'}</span>
          {!loading && <small>This round has no mapped circuit outline yet.</small>}
        </div>
      )}
      {circuit?.corners != null && <span className={`${styles.trackCornerCount} font-num`}>{circuit.corners} corners</span>}
    </div>
  )
}

function Fact({ label, value, numeric = false }: { label: string; value: string | number; numeric?: boolean }) {
  return (
    <div className={styles.fact}>
      <span>{label}</span>
      <strong className={numeric ? 'font-num' : undefined}>{value}</strong>
    </div>
  )
}

function BriefingCountdown({ session, reduced }: { session: WeekendSession; reduced: boolean }) {
  const [tick, setTick] = useState<ReturnType<typeof countdownTo> | null>(null)
  useEffect(() => {
    const update = () => setTick(countdownTo(session.iso))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [session.iso])
  return <div className={styles.timer}>
    <p>Next session <strong>{session.name}</strong></p>
    {tick?.past ? <strong>Session underway</strong> : <div className={styles.timerDigits}>
      {(['days', 'hours', 'minutes', 'seconds'] as const).map((unit, i) => <div key={unit}>
        <motion.strong className="font-num" key={tick?.[unit] ?? unit} initial={{ opacity: reduced ? 1 : 0.5, y: reduced ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.18 }}>{tick ? String(tick[unit]).padStart(2, '0') : '—'}</motion.strong>
        <span>{['Days', 'Hrs', 'Min', 'Sec'][i]}</span>
      </div>)}
    </div>}
    <small>{formatSessionDay(session.t)} · {formatSessionTime(session.t)} IST</small>
  </div>
}

function SessionRail({ event, now, reduced }: { event: CalendarEvent; now: number; reduced: boolean }) {
  const sessions = weekendSessions(event)
  const upcomingSession = nextSession(event, now)
  const sessionName = upcomingSession?.name

  return (
    <div className={styles.sessionArea}>
      <div>
        <div className={styles.sessionHeading}>
          <span>Weekend run sheet</span>
          <span className="font-num">{sessions.length} sessions</span>
        </div>
        {sessions.length ? (
          <ol className={styles.sessionList}>
            {sessions.map((session: WeekendSession) => {
              const isNext = sessionName === session.name
              const isDone = session.t <= now
              return (
                <li key={`${session.name}-${session.iso}`} className={styles.sessionRow} data-state={isNext ? 'next' : isDone ? 'done' : 'scheduled'}>
                  <span className={styles.sessionState} aria-hidden="true" />
                  <span className={styles.sessionName}>{session.name}</span>
                  <span className={styles.sessionDate}>{formatSessionDay(session.t)}</span>
                  <span className={`${styles.sessionTime} font-num`}>{formatSessionTime(session.t)} IST</span>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className={styles.mutedLine}>Session times have not been published for this round.</p>
        )}
      </div>
      {upcomingSession ? (
        <motion.div
          className={styles.countdown}
          initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0 : 0.3, ease }}
        >
          <BriefingCountdown session={upcomingSession} reduced={reduced} />
        </motion.div>
      ) : (
        <div className={styles.noCountdown}>
          <span className="kicker">Timing status</span>
          <strong>Weekend timing is complete</strong>
        </div>
      )}
    </div>
  )
}

function UpcomingPanel({ event, circuit, circuitLoading, now, reduced }: { event: CalendarEvent; circuit?: Circuit; circuitLoading: boolean; now: number; reduced: boolean }) {
  const date = formatISTDate(event.event_date)
  const showTrace = !!circuit?.svgPath || circuitLoading

  return (
    <motion.article
      className={`glass-card ${styles.upcomingPanel}`}
      initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.52, ease }}
    >
      <div className={styles.panelTopline}>
        <p className="kicker">Up next · round {event.round}</p>
        <span className={styles.eventDate}>{date}</span>
      </div>
      <div className={`${styles.raceHero} ${showTrace ? '' : styles.raceHeroSolo}`}>
        <div className={styles.raceCopy}>
          <h3 className={`${styles.raceName} display-title`}>{event.name.replace(/\s+Grand Prix$/i, '')}</h3>
          <p className={styles.raceDescriptor}>Grand Prix</p>
          <div className={styles.locationLine}>
            <MapPin size={16} aria-hidden="true" />
            <span>{event.location || event.country}</span>
            {event.country && event.location && <span className={styles.country}>{event.country}</span>}
          </div>
          {event.is_sprint && <span className={styles.sprintTag}>Sprint weekend</span>}
          <Link href={`/race/${event.round}`} className={styles.primaryLink}>Weekend hub <ArrowUpRight size={17} aria-hidden="true" /></Link>
        </div>
        {showTrace && <CircuitTrace event={event} circuit={circuit} loading={circuitLoading} reduced={reduced} />}
      </div>
      {circuit && <div className={styles.factGrid}>
        <Fact label="Track length" value={circuit?.length_km != null ? `${circuit.length_km} km` : '—'} />
        <Fact label="Race laps" value={circuit?.race_laps ?? '—'} numeric />
        <Fact label="Race distance" value={circuit?.race_distance_km != null ? `${circuit.race_distance_km} km` : '—'} />
        <Fact label="Circuit type" value={circuit?.circuit_type || '—'} />
      </div>}
      <SessionRail event={event} now={now} reduced={reduced} />
    </motion.article>
  )
}

function resultGap(result: SessionResult): string {
  const value = result.time_s
  if (positionOf(result) === 1) return 'Winner'
  if (typeof value === 'number' && Number.isFinite(value)) return `+${value.toFixed(3)} s`
  return result.status || 'Classified'
}

function ResultsPanel({
  lastRace,
  resultRound,
  rows,
  rowsLoading,
  rowsError,
  retry,
  reduced,
}: {
  lastRace?: CalendarEvent | null
  resultRound: number | null
  rows: SessionResult[]
  rowsLoading: boolean
  rowsError?: unknown
  retry: () => void
  reduced: boolean
}) {
  const podium = rows
    .filter(result => {
      const position = positionOf(result)
      return position != null && position >= 1 && position <= 3
    })
    .sort((a, b) => (positionOf(a) || 99) - (positionOf(b) || 99))
  const failed = !!rowsError || (!rowsLoading && resultRound != null && rows.length === 0)
  const title = lastRace?.name || (resultRound != null ? `Round ${resultRound}` : 'Recent race')

  return (
    <motion.article
      className={`glass-card ${styles.resultsPanel}`}
      initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.52, delay: reduced ? 0 : 0.08, ease }}
    >
      <div className={styles.resultsHeader}>
        <div>
          <p className="kicker">Last classified</p>
          <h3>{title}</h3>
        </div>
        {lastRace && <span className={`${styles.resultsRound} font-num`}>R{lastRace.round}</span>}
      </div>
      {podium.length ? (
        <ol className={styles.resultList} aria-label={`Top three from ${title}`}>
          {podium.map((result, index) => {
            const position = positionOf(result) || index + 1
            const color = teamColor(result)
            return (
              <motion.li
                key={`${position}-${result.driver_number || result.abbreviation || result.driver || index}`}
                className={styles.resultRow}
                style={{ '--team-color': color || 'var(--muted)' } as CSSProperties}
                initial={{ opacity: reduced ? 1 : 0, x: reduced ? 0 : 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: reduced ? 0 : 0.34, delay: reduced ? 0 : 0.1 + index * 0.07, ease }}
              >
                <span className={`${styles.resultPosition} font-num`}>{String(position).padStart(2, '0')}</span>
                <span className={styles.resultDriver}>
                  <strong>{driverName(result)}</strong>
                  <small>{result.team || driverCode(result)}</small>
                </span>
                <span className={`${styles.resultGap} font-num`}>{resultGap(result)}</span>
              </motion.li>
            )
          })}
        </ol>
      ) : rowsLoading ? (
        <div className={styles.resultLoading} role="status" aria-label="Loading last race results">
          {[0, 1, 2].map(row => <div key={row} className="shimmer" style={{ height: 58, width: '100%' }} />)}
          <p>Fetching the last classification…</p>
        </div>
      ) : failed ? (
        <div className={`${styles.resultState} ${styles.resultError}`} role="alert">
          <RefreshCw size={22} aria-hidden="true" />
          <p>Race results are unavailable right now.</p>
          <button type="button" onClick={retry} className={styles.retryButton}>Retry results</button>
        </div>
      ) : resultRound == null ? (
        <div className={styles.resultState}>
          <Trophy size={24} aria-hidden="true" />
          <p>No race has been completed yet.</p>
        </div>
      ) : (
        <div className={styles.resultState}>
          <Trophy size={24} aria-hidden="true" />
          <p>The latest classification has no podium rows yet.</p>
        </div>
      )}
      {lastRace && (
        <Link href={`/race/${lastRace.round}/race`} className={styles.resultsFooter}>
          Full race classification <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      )}
    </motion.article>
  )
}

export default function DashboardWeekend({ calendar, calendarLoading, standings }: DashboardWeekendProps) {
  const [now, setNow] = useState<number | null>(null)
  const reducedMotion = useReducedMotion()
  const reduced = reducedMotion === true
  const { data: circuits, isLoading: circuitsLoading } = useCircuits({ revalidateIfStale: false })

  useEffect(() => {
    const update = () => setNow(Date.now())
    update()
    const timer = window.setInterval(update, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const orderedEvents = useMemo(
    () => calendar
      .map(event => ({ event, end: eventEnd(event) }))
      .filter((item): item is { event: CalendarEvent; end: number } => item.end != null)
      .sort((a, b) => a.end - b.end),
    [calendar],
  )

  const upcoming = now == null ? null : orderedEvents.find(item => item.end > now)?.event || null
  const calendarLastRace = now == null
    ? null
    : orderedEvents.filter(item => item.end <= now).map(item => item.event).slice(-1)[0] || null
  const lastScored = standings?.rounds.filter(round => round.status === 'complete').slice(-1)[0]
  const standingsRace = lastScored
    ? orderedEvents.find(item => item.event.round === lastScored.round)?.event || null
    : null
  const lastRace = standingsRace || calendarLastRace
  const resultRound = lastScored?.round ?? lastRace?.round ?? null
  const resultYear = eventYear(lastRace)
  const resultPath = resultRound != null ? `/api/sessions/${resultYear}/${resultRound}/R/results` : null
  const {
    data: resultRows,
    isLoading: resultsLoading,
    error: resultsError,
    mutate: retryResults,
  } = useApiList<SessionResult>(resultPath, {
    shouldRetryOnError: true,
    errorRetryCount: 3,
    errorRetryInterval: 1500,
  })

  const circuit = upcoming?.circuit_key ? circuits.find(item => item.key === upcoming.circuit_key) : undefined
  const allEventsKnown = calendar.length > 0 && orderedEvents.length === calendar.length
  const seasonComplete = now != null && allEventsKnown && orderedEvents.length > 0 && upcoming == null

  return (
    <section className={styles.briefing} aria-labelledby="dashboard-weekend-title">
      <BriefingHeader />
      {calendarLoading || now == null ? (
        <LoadingBriefing />
      ) : orderedEvents.length === 0 ? (
        <CalendarEmptyState />
      ) : (
        <div className={styles.briefingGrid}>
          {upcoming ? (
            <UpcomingPanel event={upcoming} circuit={circuit} circuitLoading={circuitsLoading} now={now} reduced={reduced} />
          ) : seasonComplete ? (
            <SeasonCompletePanel lastRace={lastRace} />
          ) : (
            <div className={`glass-card ${styles.statePanel}`} role="status">
              <Flag size={30} aria-hidden="true" />
              <h3>Weekend timing is incomplete</h3>
              <p>The calendar has events, but their session boundaries are not available yet.</p>
              <Link href="/calendar" className={styles.actionLink}>Open calendar <ArrowUpRight size={16} aria-hidden="true" /></Link>
            </div>
          )}
          <ResultsPanel
            lastRace={lastRace}
            resultRound={resultRound}
            rows={resultRows}
            rowsLoading={resultsLoading}
            rowsError={resultsError}
            retry={() => { void retryResults() }}
            reduced={reduced}
          />
        </div>
      )}
    </section>
  )
}
