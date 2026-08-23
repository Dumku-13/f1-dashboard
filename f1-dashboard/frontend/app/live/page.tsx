'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLiveSession, useBroadcastDelay, DELAY_PRESETS_S, fmtLap, fmtGap, type TowerRow, type TowerSector, type LiveRaceControl } from '@/lib/live'
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
import { COMPOUND_COLORS, FLAG_COLORS } from '@/lib/constants'
import { Flag, Thermometer, Wind, Droplets, Radio, Bell, Clock, Maximize2, Minimize2 } from 'lucide-react'

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

function RaceControlFeed({ items }: { items: LiveRaceControl[] }) {
  return (
    <div className="glass-card" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '640px' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Radio size={14} style={{ color: 'var(--accent)' }} />
        <h2 className="section-title" style={{ fontSize: '12px' }}>Race Control</h2>
      </div>
      <div className="hide-scrollbar" style={{ overflowY: 'auto', padding: '6px 0' }}>
        <AnimatePresence initial={false}>
          {items.length === 0 && (
            <div style={{ padding: '24px 18px', fontSize: '12px', color: 'var(--muted)' }}>No messages yet.</div>
          )}
          {items.map((m, i) => {
            const flagColor = m.flag ? FLAG_COLORS[m.flag.toUpperCase().replace(' ', '_')] : undefined
            return (
              <motion.div
                key={`${m.date}-${i}`}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.3) }}
                style={{ padding: '9px 18px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: '10px', alignItems: 'flex-start' }}
              >
                <Flag size={12} style={{ color: flagColor || 'var(--muted)', marginTop: '2px', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '12px', lineHeight: 1.45, color: '#D1D5DB' }}>{m.message}</div>
                  <div className="font-num" style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '3px' }}>
                    {m.lap_number ? `LAP ${m.lap_number} · ` : ''}{new Date(m.date).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
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

  // Achievement hook: count distinct live sessions + weekends actually watched
  useEffect(() => {
    if (status !== 'live' || !session) return
    const key = `${session.country_name || 'x'}-${session.session_name || 'x'}-${new Date().toISOString().slice(0, 10)}`
    recordLiveWatch(key, session.country_name || key)
  }, [status, session?.session_name]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px 16px', position: 'relative', zIndex: 1 }}>

      {/* Phase 11: in-app alert toasts (top-left; achievements own top-right) */}
      <AlertToaster />
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-strong"
        style={{ padding: '24px 28px', marginBottom: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '16px' }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
            <StatusBadge status={status} />
            {status === 'live' && currentLap > 0 && (
              <span className="font-num" style={{ fontSize: '12px', color: '#9CA3AF' }}>LAP {currentLap}</span>
            )}
          </div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.5vw, 42px)', margin: 0 }}>
            {session ? `${session.country_name} — ${session.session_name}` : 'Live Timing'}
          </h1>
          <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '6px' }}>
            {session ? `${session.circuit_short_name} · ${session.year}` : 'Detecting latest session…'}
            {lastUpdate && ` · Updated ${lastUpdate.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST`}
            {status === 'live' && ` · Refreshing every 4s · Source: ${source === 'f1' ? 'F1 Live Timing' : 'OpenF1'}`}
            {delayMs > 0 && ` · Delayed ${Math.round(delayMs / 1000)}s`}
          </div>

          {/* Phase 11: alert bell (opens settings) + pop-out widget buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px', flexWrap: 'wrap', position: 'relative' }}>
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
        </div>

        {weather && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {[
              { Icon: Thermometer, label: 'AIR', val: weather.air_temperature != null ? `${weather.air_temperature}°` : '—' },
              { Icon: Thermometer, label: 'TRACK', val: weather.track_temperature != null ? `${weather.track_temperature}°` : '—' },
              { Icon: Wind, label: 'WIND', val: weather.wind_speed != null ? `${weather.wind_speed} m/s` : '—' },
              { Icon: Droplets, label: 'RAIN', val: weather.rainfall ? 'YES' : 'NO' },
            ].map((w, i) => (
              <div key={i} className="glass-panel" style={{ borderRadius: '12px', padding: '8px 14px', textAlign: 'center' }}>
                <w.Icon size={13} style={{ color: '#9CA3AF' }} />
                <div className="font-num" style={{ fontSize: '13px', fontWeight: 700, marginTop: '2px' }}>{w.val}</div>
                <div style={{ fontSize: '9px', color: 'var(--muted)', letterSpacing: '0.1em' }}>{w.label}</div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {status === 'error' && (
        <div className="glass-card" style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF', fontSize: '13px' }}>
          Couldn&apos;t reach the OpenF1 live feed. Check your connection and refresh.
        </div>
      )}

      {status === 'ended' && (
        <div style={{ marginBottom: '14px', fontSize: '12px', color: '#9CA3AF' }}>
          Showing the final state of the most recent session. This page goes fully live automatically during any F1 session.
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: expanded ? 'minmax(0, 1fr)' : 'minmax(0, 2.2fr) minmax(260px, 1fr)',
          gap: '16px', alignItems: 'start',
        }}
        className="live-grid"
      >
        {/* Timing tower */}
        <div className="glass-card" style={{ overflow: 'hidden' }}>
          <div
            role="tablist"
            aria-label="Leaderboard view"
            style={{
              display: 'flex', alignItems: 'center', gap: 3, padding: '10px 14px',
              borderBottom: '1px solid rgba(255,255,255,0.09)',
            }}
          >
            <span className="font-display" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', marginRight: 'auto' }}>
              Leaderboard
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
            {(['timing', 'stints'] as const).map(v => (
              <button
                key={v}
                role="tab"
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
          <TimingTower
            rows={rows}
            view={view}
            qualifying={qualifying}
            emptyMessage={status === 'loading' ? 'Connecting to timing feed…' : 'Waiting for cars on track…'}
          />
        </div>

        {!expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Top of the rail: mid-session the first thing you want is how long
              is left, and off-session, when the next one starts. */}
          <SessionClock session={session} live={status === 'live'} />
          <TrackMap rows={rows} live={status === 'live'} trackStatus={trackStatus} />
          <BenchmarksPanel session={session} rows={rows} />
          <RaceControlFeed items={raceControl} />
          <TeamRadioPanel clips={live.teamRadio} rows={rows} />
        </div>
        )}
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
