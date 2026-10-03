'use client'

import { useEffect, useState, type KeyboardEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLiveSession, useBroadcastDelay, DELAY_PRESETS_S, fmtLap, fmtGap } from '@/lib/live'
import { COMPOUND_COLORS } from '@/lib/constants'
import RaceControlFeed from '@/components/live/RaceControlFeed'
import TeamRadioPanel from '@/components/live/TeamRadioPanel'
import TimingTower, { type TowerView } from '@/components/live/TimingTower'
import BenchmarksPanel from '@/components/live/BenchmarksPanel'
import { recordLiveWatch } from '@/lib/achievements'
import { useAlertEngine, useAlertSettings } from '@/lib/alerts'
import AlertToaster from '@/components/alerts/AlertToaster'
import AlertSettings from '@/components/alerts/AlertSettings'
import PopOutButton from '@/components/widgets/PopOutButton'
import TrackMap from '@/components/live/TrackMap'
import SessionClock from '@/components/live/SessionClock'
import EngineerDock from '@/components/engineer/EngineerDock'
import { Thermometer, Wind, Droplets, Bell, Clock, Maximize2, Minimize2, ArrowUpRight } from 'lucide-react'
import LastUpdated from '@/components/ui/LastUpdated'
import Link from 'next/link'
import styles from './live.module.css'

/** Timing view: mini-sectors take the width the three sector columns used to. */
function StatusBadge({ status }: { status: string }) {
  const cfg = {
    live: { label: 'LIVE', color: '#00D131' },
    ended: { label: 'SESSION ENDED', color: '#9CA3AF' },
    upcoming: { label: 'UPCOMING', color: '#FFF200' },
    loading: { label: 'CONNECTING', color: '#FFF200' },
    error: { label: 'NO DATA', color: '#E8002D' },
  }[status] || { label: status.toUpperCase(), color: '#9CA3AF' }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '5px 12px', borderRadius: '999px', border: `1px solid ${cfg.color}44`, background: `${cfg.color}14`, fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: cfg.color }}>
      <span className={status === 'live' ? 'live-dot' : ''} style={{ width: '7px', height: '7px', borderRadius: '50%', background: cfg.color, display: 'inline-block' }} />
      {cfg.label}
    </span>
  )
}

export default function LivePage() {
  const live = useLiveSession()
  const { status, source, session, rows, raceControl, weather, currentLap, trackStatus, lastUpdate, qualifying } = live

  // Phase 11: custom-alert rules engine (diffs live snapshots, fires toasts)
  useAlertEngine(live)
  const { settings: alertSettings } = useAlertSettings()
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [delayMs, setDelayMs] = useBroadcastDelay()
  const [view, setView] = useState<TowerView>('timing')
  // Full-width tower: the side rail is what squeezes PIT/TYRE off-screen.
  const [expanded, setExpanded] = useState(false)
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null)
  const sessionIdentity = `${session?.session_key ?? ''}:${session?.date_start ?? ''}`
  useEffect(() => { setSelectedDriver(null) }, [sessionIdentity])
  const fastest = rows.reduce<(typeof rows)[number] | null>((best, row) => {
    const time = row.bestLapDuration
    return time != null && time > 0 && (!best || time < best.bestLapDuration!) ? row : best
  }, null)
  const switchView = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'timing' : event.key === 'End' ? 'stints' : view === 'timing' ? 'stints' : 'timing'
    setView(next)
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#live-${next}-tab`)?.focus()
  }
  const selectedRow = rows.find(row => row.driver.driver_number === selectedDriver)
  const focusRow = selectedRow ?? rows.find(row => row.position === 1) ?? rows[0]
  const compounds = Object.entries(rows.reduce<Record<string, number>>((counts, row) => {
    const compound = row.compound?.toUpperCase() || 'UNKNOWN'
    counts[compound] = (counts[compound] || 0) + 1
    return counts
  }, {}))
  const trackLabel = ({ AllClear: 'Track clear', Yellow: 'Yellow flag', SCDeployed: 'Safety car', VSCDeployed: 'Virtual safety car', Red: 'Red flag' } as Record<string, string>)[trackStatus] || 'Track status unavailable'

  // Achievement hook: count distinct live sessions + weekends actually watched
  useEffect(() => {
    if (status !== 'live' || !session) return
    const key = `${session.country_name || 'x'}-${session.session_name || 'x'}-${new Date().toISOString().slice(0, 10)}`
    recordLiveWatch(key, session.country_name || key)
  }, [status, session?.session_name]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // No max width. DESIGN.md's shell rule names 1560px, and this page went
    // 1400 -> 1800 -> uncapped because every fixed number still left a band of
    // dead space on a wide monitor. `/live` is the one page where that is
    // clearly right: it is two columns of live data, and both the tower and the
    // map get better with every pixel. Padding, not a cap, keeps it off the
    // edges. Other routes keep the DESIGN.md cap — don't sweep this across them
    // without checking each one actually has something to do with the width.
    <div className={styles.root}>

      {/* Phase 11: in-app alert toasts (top-left; achievements own top-right) */}
      <AlertToaster />
      {/* Header */}
      <motion.div
        initial={false}
        className={styles.sessionHeader}
      >
        <div className={styles.sessionIdentity}>
          <p className={styles.eyebrow}>Race centre / Live timing</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
            <StatusBadge status={status} />
            {status === 'live' && currentLap > 0 && (
              <span className="font-num" style={{ fontSize: '12px', color: '#9CA3AF' }}>LAP {currentLap}</span>
            )}
          </div>
          <h1 style={{ fontSize: 'clamp(22px, 2.5vw, 32px)', fontWeight: 750, letterSpacing: '-.03em', margin: 0 }}>
            {session ? `${session.country_name} — ${session.session_name}` : 'Live Timing'}
          </h1>
          <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '6px' }}>
            {session ? `${session.circuit_short_name} · ${session.year}` : 'Detecting latest session…'}
            {/* Relative, not a wall-clock time. On a timing screen the
                question is "is this stale?", and "14:32:07" only answers it
                if you happen to know what time it is. The absolute value is
                still there on hover. */}
            {lastUpdate && <> · <LastUpdated timestamp={lastUpdate} style={{ fontSize: '12px', letterSpacing: 'normal', textTransform: 'none', color: 'inherit' }} /></>}
            {status === 'live' && ` · Refreshing every 4s · Source: ${source === 'f1' ? 'F1 Live Timing' : 'OpenF1'}`}
            {delayMs > 0 && ` · Delayed ${Math.round(delayMs / 1000)}s`}
          </div>


        </div>

        <div className={styles.conditions}>
          <span className={styles.trackFlag} data-status={trackStatus}>{trackLabel}</span>
        {weather && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {[
              { Icon: Thermometer, label: 'AIR', val: weather.air_temperature != null ? `${weather.air_temperature}°` : '—' },
              { Icon: Thermometer, label: 'TRACK', val: weather.track_temperature != null ? `${weather.track_temperature}°` : '—' },
              { Icon: Wind, label: 'WIND', val: weather.wind_speed != null ? `${weather.wind_speed} m/s` : '—' },
              { Icon: Droplets, label: 'RAIN', val: weather.rainfall ? 'YES' : 'NO' },
            ].map((w, i) => (
              <div key={i} style={{ padding: '6px 10px', textAlign: 'center', borderLeft: '1px solid #2c3947' }}>
                <w.Icon size={13} style={{ color: '#9CA3AF' }} />
                <div className="font-num" style={{ fontSize: '13px', fontWeight: 700, marginTop: '2px' }}>{w.val}</div>
                <div style={{ fontSize: '9px', color: 'var(--muted)', letterSpacing: '0.1em' }}>{w.label}</div>
              </div>
            ))}
          </div>
        )}
        </div>
      </motion.div>
          {/* Phase 11: alert bell (opens settings) + pop-out widget buttons */}
          <div className={styles.toolbar}>
            <button
              onClick={() => setAlertsOpen(o => !o)}
              title="Custom alerts"
              aria-expanded={alertsOpen}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 11px', borderRadius: '9px',
                cursor: 'pointer', fontSize: '11px', fontWeight: 700, letterSpacing: '0.02em',
                background: alertSettings.enabled ? 'rgba(0,209,49,0.1)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${alertSettings.enabled ? 'rgba(0,209,49,0.35)' : 'rgba(255,255,255,0.1)'}`,
                color: alertSettings.enabled ? '#00D131' : '#D1D5DB',
              }}
            >
              <Bell size={12} />
              Alerts{alertSettings.enabled ? ' ON' : ''}
            </button>
            {/* Broadcast delay — every TV feed runs behind the timing data, so
                without this the tower spoils an overtake before you see it. */}
            <label
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 10px',
                borderRadius: '9px', fontSize: '11px', fontWeight: 700,
                background: delayMs > 0 ? 'rgba(255,128,0,0.1)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${delayMs > 0 ? 'rgba(255,128,0,0.35)' : 'rgba(255,255,255,0.1)'}`,
                color: delayMs > 0 ? '#FF8000' : '#D1D5DB',
              }}
            >
              <Clock size={12} />
              Delay
              <select
                aria-label="Broadcast delay"
                value={delayMs / 1000}
                onChange={e => setDelayMs(Number(e.target.value) * 1000)}
                style={{
                  background: 'transparent', border: 'none', color: 'inherit',
                  fontSize: '11px', fontWeight: 700, cursor: 'pointer', outline: 'none',
                }}
              >
                {DELAY_PRESETS_S.map(sec => (
                  <option key={sec} value={sec} style={{ background: '#14161a', color: '#EDEFF2' }}>
                    {sec === 0 ? 'Off' : sec < 60 ? `${sec}s` : sec % 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec / 60}m`}
                  </option>
                ))}
              </select>
            </label>
            <PopOutButton type="gaps" />
            <PopOutButton type="weather" />
            <PopOutButton type="timer" />
            <AnimatePresence>
              {alertsOpen && <AlertSettings rows={rows} onClose={() => setAlertsOpen(false)} />}
            </AnimatePresence>
          </div>

      {status === 'error' && (
        <div className={styles.notice} role="status">
          Timing is unavailable. Check the backend connection; the feed will retry automatically. <a href="/tactical">Replay a past race</a> while waiting.
        </div>
      )}

      {status === 'ended' && (
        <div className={styles.sessionNote}>
          <span>Final classification · Live timing resumes automatically when a session starts.</span><Link href="/tactical">Replay a race <ArrowUpRight size={14} aria-hidden="true" /></Link>
        </div>
      )}

      <div className={styles.metrics} aria-label="Session summary">
        <div><span>Classification</span><strong>{rows.length ? <>{rows.length}<small> drivers</small></> : '—'}</strong></div>
        <div><span>{status === 'ended' ? 'Final lap' : 'Current lap'}</span><strong className="font-num">{currentLap > 0 ? currentLap : '—'}</strong></div>
        <div><span>Session best</span><strong className="font-num">{fastest ? fmtLap(fastest.bestLapDuration) : '—'}{fastest && <small>{fastest.driver.name_acronym}</small>}</strong></div>
        <div><span>Timing source</span><strong>{lastUpdate ? (source === 'f1' ? 'F1 Timing' : 'OpenF1') : 'Connecting'}<small>{delayMs > 0 ? `${delayMs / 1000}s delay` : 'No added delay'}</small></strong></div>
      </div>
      {live.delayBuffering && <p role="status" className={styles.notice}>Filling your broadcast-delay buffer. Timing and tracking will appear together.</p>}
      <div
        className={styles.broadcast}
        data-expanded={expanded ? 'true' : 'false'}
      >
        {/* Timing tower */}
        <section className={`glass-card ${styles.towerPanel}`} aria-label="Timing tower">
          <div className={styles.towerToolbar}>
            <span className="font-display" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', marginRight: 'auto' }}>
              Timing tower
            </span>
            <button
              onClick={() => setExpanded(e => !e)}
              aria-pressed={expanded}
              title={expanded ? 'Show the side panels again' : 'Expand the tower to full width'}
              className="font-display"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 3, cursor: 'pointer',
                fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                background: expanded ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border)', color: 'var(--foreground)',
                marginRight: 6,
              }}
            >
              {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              {expanded ? 'Collapse' : 'Expand'}
            </button>
            <div role="tablist" aria-label="Leaderboard view" className={styles.viewTabs}>
            {(['timing', 'stints'] as const).map(v => (
              <button
                key={v}
                role="tab"
                id={`live-${v}-tab`}
                aria-controls="live-tower-panel"
                tabIndex={view === v ? 0 : -1}
                onKeyDown={switchView}
                aria-selected={view === v}
                onClick={() => setView(v)}
                className="font-display"
                style={{
                  padding: '6px 15px', border: 'none', borderRadius: 3, cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  background: view === v ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                  color: view === v ? '#fff' : 'var(--muted)',
                }}
              >
                {v}
              </button>
            ))}
            </div>
          </div>
          <div id="live-tower-panel" role="tabpanel" aria-labelledby={`live-${view}-tab`} tabIndex={0}>
          <TimingTower
            rows={rows}
            view={view}
            qualifying={qualifying}
            emptyMessage={status === 'loading' ? 'Connecting to timing feed…' : status === 'error' ? 'Timing is unavailable. The feed will retry automatically.' : live.delayBuffering ? 'Waiting for the broadcast-delay buffer…' : 'Waiting for cars on track…'}
            expanded={expanded}
            broadcast
            selectedDriver={selectedDriver}
            onSelectDriver={setSelectedDriver}
          />
          </div>
          <div className={styles.selection} role="status">{selectedRow ? `Tracking ${selectedRow.driver.full_name || selectedRow.driver.name_acronym} · choose Follow or Chase on the map` : 'Select a driver for timing details and map tracking'}<span>Purple: session best · Green: personal best</span></div>
          {rows.length > 0 && <div className={styles.tyreSummary} aria-label="Field tyre distribution">
            <span>Tyres on field</span>
            {compounds.map(([compound, count]) => <span key={compound}><i style={{ background: COMPOUND_COLORS[compound] || '#6E7681' }} />{compound.toLowerCase()} <strong className="font-num">{count}</strong></span>)}
          </div>}
        </section>

        {/* Keep driver details, map and session context mounted when expanded. */}
        <div className={styles.rail}>
          {focusRow && <section className={styles.driverFocus} aria-label="Driver timing details">
            <header><span>{selectedRow ? 'Selected driver' : 'Classification leader'}</span><strong className="font-num">P{focusRow.position ?? '—'} · #{focusRow.driver.driver_number}</strong></header>
            <h2>{focusRow.driver.full_name || focusRow.driver.name_acronym}</h2>
            <p>{focusRow.driver.team_name || 'Team unavailable'}</p>
            <dl>
              <div><dt>Last lap</dt><dd>{fmtLap(focusRow.lastLap?.lap_duration)}</dd></div>
              <div><dt>Personal best</dt><dd>{fmtLap(focusRow.bestLapDuration)}</dd></div>
              <div><dt>Gap to leader</dt><dd>{fmtGap(focusRow.gapToLeader)}</dd></div>
              <div><dt>Interval ahead</dt><dd>{fmtGap(focusRow.interval)}</dd></div>
              <div><dt>Tyre / age</dt><dd>{focusRow.compound || '—'}{focusRow.tyreAge != null ? ` / ${focusRow.tyreAge}L` : ''}</dd></div>
              <div><dt>Pit stops / laps</dt><dd>{focusRow.pitStops} / {focusRow.lapsDone}</dd></div>
            </dl>
            {focusRow.speeds.some(speed => speed.value != null) && <div className={styles.speedTraps} aria-label="Speed trap readings in kilometres per hour">{focusRow.speeds.filter(speed => speed.value != null).map(speed => <span key={speed.key}>{speed.key} <strong className="font-num">{speed.value}</strong></span>)}<small>km/h</small></div>}
          </section>}
          {/* Top of the rail: mid-session the first thing you want is how long
              is left, and off-session, when the next one starts. */}
          <div className={styles.mapPanel} data-idle={status !== 'live'}>
          <TrackMap rows={rows} live={status === 'live' && !live.delayBuffering} trackStatus={trackStatus} selectedDriver={selectedDriver} onSelectDriver={setSelectedDriver} sessionKey={sessionIdentity} lastUpdate={lastUpdate} />
          </div>
          <div className={styles.support}>
            <SessionClock session={session} live={status === 'live'} />
            <BenchmarksPanel session={session} rows={rows} />
          </div>
        </div>
      </div>
      <div className={styles.lowerDeck}>
        <RaceControlFeed key={sessionIdentity} items={raceControl} />
        <TeamRadioPanel clips={live.teamRadio} rows={rows} />
      </div>

      {/* Say which source is actually feeding the tower — they differ in what
          they can show, and the old copy claimed OpenF1 even when the F1
          bridge was supplying mini-sectors. */}
      <div style={{ marginTop: '16px', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.6 }}>
        {source === 'f1'
          ? 'Data: F1 live timing bridge — official segment, sector and stint feed, including mini-sectors.'
          : 'Data: OpenF1 public feed (≈20–30s behind broadcast). It carries no mini-sector or team-radio data, so those are hidden on this source.'}
        {delayMs > 0 && ` Held back ${Math.round(delayMs / 1000)}s by your broadcast delay.`}
      </div>

      <EngineerDock />
    </div>
  )
}
