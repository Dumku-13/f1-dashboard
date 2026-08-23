'use client'

/**
 * Phase 8 — Interactive Track Map 2.0.
 *
 * A full-page circuit view: rotated/normalized outline, marshal mini-sectors,
 * AoA (DRS) zones approximated from geometry, corner numbers, live clickable
 * driver dots with a selected-car panel, and a wind compass. Everything except
 * the live dots renders from the /track/{y}/{r}/details endpoint, so it works
 * for any completed round even between sessions.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Thermometer, Wind, Droplets, Gauge, ChevronDown } from 'lucide-react'
import { useLiveSession } from '@/lib/live'
import { useApi } from '@/lib/api/client'
import { useCalendar } from '@/lib/api/hooks'
import CircuitMap, { type YellowSectors } from '@/components/map/CircuitMap'
import CornerReadout, { useFastestLap, buildOverlays } from '@/components/map/LapCompare'
import DriverPanel, { type PaceSample } from '@/components/map/DriverPanel'
import type { DetailsResponse } from '@/components/map/geometry'

const YELLOW_WINDOW_MS = 3 * 60 * 1000  // "recent" flag horizon
const PACE_BUFFER = 40                    // ring buffer length per driver
const POLL_INTERVAL_MS = 4000             // matches the live feed cadence

function StatusPill({ status }: { status: string }) {
  const cfg = {
    live: { label: 'LIVE', color: '#00D131' },
    ended: { label: 'LATEST SESSION', color: '#9CA3AF' },
    upcoming: { label: 'UPCOMING', color: '#FFF200' },
    loading: { label: 'CONNECTING', color: '#FFF200' },
    error: { label: 'BETWEEN SESSIONS', color: '#9CA3AF' },
  }[status] || { label: status.toUpperCase(), color: '#9CA3AF' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '5px 12px', borderRadius: '999px', border: `1px solid ${cfg.color}44`, background: `${cfg.color}14`, fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: cfg.color }}>
      <span className={status === 'live' ? 'live-dot' : ''} style={{ width: '7px', height: '7px', borderRadius: '50%', background: cfg.color, display: 'inline-block' }} />
      {cfg.label}
    </span>
  )
}

function LegendSwatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
      <span style={{ width: '18px', height: '3px', borderRadius: '2px', background: dashed ? 'transparent' : color, borderTop: dashed ? `3px dashed ${color}` : 'none' }} />
      <span style={{ fontSize: '11px', color: '#9CA3AF' }}>{label}</span>
    </div>
  )
}

export default function MapPage() {
  const { status, session, rows, raceControl, weather, trackStatus } = useLiveSession()

  const { data: calendarData } = useCalendar(2026)
  const [round, setRound] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [showCorners, setShowCorners] = useState(true)
  const [showAoA, setShowAoA] = useState(true)

  // Phase 09 — two comparison slots, plus the corner being read.
  const [lapDrivers, setLapDrivers] = useState<[string | null, string | null]>([null, null])
  const [hoverCorner, setHoverCorner] = useState<number | null>(null)
  /** A pinned corner outranks hover, and is the only path that works on touch. */
  const [pinnedCorner, setPinnedCorner] = useState<number | null>(null)
  const activeCorner = pinnedCorner ?? hoverCorner

  const year = 2026
  const live = status === 'live'

  // --- Round list (completed + current rounds), default to latest ---
  const calendar = useMemo(() => {
    const now = Date.now()
    // Completed + current (started within the last day of grace) rounds only.
    return calendarData.filter(ev => new Date(ev.event_date).getTime() <= now + 86400000)
  }, [calendarData])

  const roundInitRef = useRef(false)
  useEffect(() => {
    if (roundInitRef.current || calendar.length === 0) return
    roundInitRef.current = true
    setRound(calendar[calendar.length - 1].round)
  }, [calendar])

  // --- Circuit details for the selected round (SLOW on first fastf1 load) ---
  const { data: detailsRaw, isLoading: detailsIsLoading } = useApi<DetailsResponse>(
    round !== null ? `/api/livetiming/track/${year}/${round}/details` : null,
  )
  // keepPreviousData means detailsRaw can still be the PREVIOUS round's payload
  // right after switching — the round check keeps that from painting as fresh.
  const details = detailsRaw && detailsRaw.round === round && Array.isArray(detailsRaw.points) && detailsRaw.points.length > 10
    ? detailsRaw
    : null
  const detailsLoading = round !== null && detailsIsLoading && !details
  const detailsError = round !== null && !detailsIsLoading && !details

  /**
   * Fastest-lap telemetry for the two comparison slots.
   *
   * Qualifying, not the race: a qualifying lap is the one everybody drove flat
   * out on low fuel, which is the only fair basis for "who was quicker through
   * turn 9". Race fastest laps are set on wildly different fuel and tyre.
   */
  const lapA = useFastestLap(year, round, 'Q', lapDrivers[0])
  const lapB = useFastestLap(year, round, 'Q', lapDrivers[1])
  const lapsLoading = lapA.isLoading || lapB.isLoading

  const lapEntries = useMemo(
    () => [
      ...(lapDrivers[0] ? [{ abbr: lapDrivers[0], lap: lapA.lap }] : []),
      ...(lapDrivers[1] ? [{ abbr: lapDrivers[1], lap: lapB.lap }] : []),
    ],
    [lapDrivers, lapA.lap, lapB.lap],
  )
  const overlays = useMemo(() => buildOverlays(lapEntries), [lapEntries])

  /** Whoever is in the session — falls back to nothing rather than a guess. */
  const driverOptions = useMemo(
    () => [...new Set(rows.map(r => r.driver.name_acronym).filter(Boolean))].sort(),
    [rows],
  )

  // --- Yellow marshal sectors from recent race control ---
  const yellow: YellowSectors = useMemo(() => {
    const now = Date.now()
    const sectors = new Set<number>()
    let all = false
    // Newest first; a CLEAR/GREEN on a sector cancels an earlier yellow.
    const cleared = new Set<number>()
    let clearedAll = false
    for (const m of raceControl) {
      const t = m.date ? new Date(m.date).getTime() : 0
      if (!t || now - t > YELLOW_WINDOW_MS) continue
      const flag = (m.flag || '').toUpperCase()
      const msg = (m.message || '').toUpperCase()
      const isYellow = flag.includes('YELLOW') || msg.includes('YELLOW')
      const isClear = flag.includes('CLEAR') || flag.includes('GREEN') || msg.includes('CLEAR') || msg.includes('TRACK CLEAR')
      if (m.sector != null) {
        if (isClear && !sectors.has(m.sector)) cleared.add(m.sector)
        else if (isYellow && !cleared.has(m.sector)) sectors.add(m.sector)
      } else {
        // No sector number: whole-track yellow fallback.
        if (isClear && !all) clearedAll = true
        else if (isYellow && !clearedAll) all = true
      }
    }
    return { sectors, all }
  }, [raceControl])

  // --- Pace ring buffer per driver, sampled from XY movement ---
  const paceRef = useRef<Map<number, PaceSample[]>>(new Map())
  const lastPosRef = useRef<Map<number, { x: number; y: number; t: number }>>(new Map())
  const [, forcePace] = useState(0)
  useEffect(() => {
    const now = Date.now()
    let changed = false
    rows.forEach(r => {
      if (!r.pos) return
      const prev = lastPosRef.current.get(r.driver.driver_number)
      lastPosRef.current.set(r.driver.driver_number, { x: r.pos.x, y: r.pos.y, t: now })
      if (prev) {
        const dt = (now - prev.t) / 1000
        if (dt > 0.5) {
          const dist = Math.hypot(r.pos.x - prev.x, r.pos.y - prev.y)
          const speed = dist / dt // 1/10-m per second — coarse "relative pace"
          const buf = paceRef.current.get(r.driver.driver_number) || []
          buf.push({ t: now, speed })
          if (buf.length > PACE_BUFFER) buf.splice(0, buf.length - PACE_BUFFER)
          paceRef.current.set(r.driver.driver_number, buf)
          changed = true
        }
      }
    })
    if (changed) forcePace(v => v + 1)
    // rows identity changes every poll; sampling on that cadence is intended.
  }, [rows])

  const selectedRow = useMemo(() => rows.find(r => r.driver.driver_number === selected) || null, [rows, selected])
  const selectedPace = selected != null ? paceRef.current.get(selected) || [] : []

  const currentEvent = calendar.find(e => e.round === round)
  const eventName = details?.name || currentEvent?.name || 'Circuit'

  return (
    <div style={{ maxWidth: '1500px', margin: '0 auto', padding: '24px 16px', position: 'relative', zIndex: 1 }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div className="kicker" style={{ marginBottom: '6px' }}>Circuit Command</div>
          <h1 className="display-title" style={{ fontSize: 'clamp(28px, 5vw, 48px)', margin: 0 }}>{eventName}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px' }}>
            <StatusPill status={status} />
            {session && <span style={{ fontSize: '12px', color: '#9CA3AF' }}>{session.session_name}</span>}
          </div>
        </div>

        {/* Round selector */}
        <div style={{ position: 'relative' }}>
          <label htmlFor="map-round-select" style={{ fontSize: '9px', letterSpacing: '0.12em', color: 'var(--muted)', fontWeight: 700, display: 'block', marginBottom: '5px' }}>ROUND</label>
          <div style={{ position: 'relative' }}>
            <select
              id="map-round-select"
              value={round ?? ''}
              onChange={e => { setRound(Number(e.target.value)); setSelected(null) }}
              style={{ appearance: 'none', background: 'rgba(20,20,22,0.7)', color: '#E5E7EB', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '9px 34px 9px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', minWidth: '210px' }}
            >
              {calendar.map(ev => (
                <option key={ev.round} value={ev.round} style={{ background: '#141416' }}>R{ev.round} · {ev.name}</option>
              ))}
            </select>
            <ChevronDown size={15} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
          </div>
        </div>
      </motion.div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: '16px', alignItems: 'start' }} className="map-grid">
        {/* Map card */}
        <div>
          {detailsLoading && !details ? (
            <div className="glass-card" style={{ height: '75vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', textAlign: 'center', padding: '32px' }}>
              <Gauge size={28} style={{ color: 'var(--accent)' }} className="live-dot" />
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#D1D5DB' }}>Building circuit geometry…</div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', maxWidth: '340px', lineHeight: 1.5 }}>
                First load pulls this round from fastf1 and can take 30–90s. Subsequent loads are instant (cached).
              </div>
            </div>
          ) : details && details.points.length > 10 ? (
            <>
              <CircuitMap
                details={details}
                rows={rows}
                live={live}
                trackStatus={trackStatus}
                weather={weather}
                yellow={yellow}
                selected={selected}
                showCorners={showCorners}
                showAoA={showAoA}
                onSelect={setSelected}
                laps={overlays}
                activeCorner={activeCorner}
                onCornerHover={setHoverCorner}
                onCornerSelect={n => setPinnedCorner(p => (p === n ? null : n))}
              />

              {/* Phase 09 — pick up to two drivers and their fastest laps draw
                  themselves on the circuit; hovering a corner compares them. */}
              <div className="lc-bar">
                <span className="kicker">Fastest laps</span>
                <div className="lc-picker">
                  {lapDrivers.map((abbr, slot) => (
                    <select
                      key={slot}
                      aria-label={slot === 0 ? 'First driver to compare' : 'Second driver to compare'}
                      value={abbr ?? ''}
                      onChange={e => setLapDrivers(prev => {
                        const next = [...prev] as [string | null, string | null]
                        next[slot] = e.target.value || null
                        return next
                      })}
                    >
                      <option value="">{slot === 0 ? 'Select driver' : 'Compare with…'}</option>
                      {driverOptions.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  ))}
                  {lapsLoading && <span className="lc-hint">Loading telemetry…</span>}
                </div>
                <CornerReadout corner={activeCorner} corners={details.corners} entries={lapEntries} />
              </div>
            </>
          ) : (
            <div className="glass-card" style={{ height: '75vh', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '32px', color: 'var(--muted)', fontSize: '13px' }}>
              {detailsError ? 'Circuit geometry unavailable for this round yet. Try another round.' : 'Select a round to load the circuit.'}
            </div>
          )}
        </div>

        {/* Right rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <DriverPanel row={selectedRow} pace={selectedPace} live={live} onClose={() => setSelected(null)} />

          {/* Weather */}
          {weather && (
            <div className="glass-card" style={{ padding: '16px' }}>
              <h2 className="section-title" style={{ fontSize: '12px', marginBottom: '12px' }}>Conditions</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                {[
                  { Icon: Thermometer, label: 'AIR', val: weather.air_temperature != null ? `${weather.air_temperature}°C` : '—' },
                  { Icon: Thermometer, label: 'TRACK', val: weather.track_temperature != null ? `${weather.track_temperature}°C` : '—' },
                  { Icon: Wind, label: 'WIND', val: weather.wind_speed != null ? `${weather.wind_speed} m/s` : '—' },
                  { Icon: Droplets, label: 'RAIN', val: weather.rainfall ? 'YES' : 'NO' },
                ].map((w, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                    <w.Icon size={15} style={{ color: 'var(--muted)' }} />
                    <div>
                      <div className="font-num" style={{ fontSize: '14px', fontWeight: 700 }}>{w.val}</div>
                      <div style={{ fontSize: '9px', color: 'var(--muted)', letterSpacing: '0.1em' }}>{w.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Legend + toggles */}
          <div className="glass-card" style={{ padding: '16px' }}>
            <h2 className="section-title" style={{ fontSize: '12px', marginBottom: '12px' }}>Legend</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <LegendSwatch color="rgba(255,255,255,0.5)" label="Marshal mini-sectors" />
              <LegendSwatch color="#FFF200" label="Yellow-flagged sector (live)" />
              <LegendSwatch color="var(--accent)" label="AoA zones (approx. from geometry)" />
              <button
                onClick={() => setShowAoA(v => !v)}
                style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                <span style={{ width: '30px', height: '16px', borderRadius: '999px', background: showAoA ? 'var(--accent)' : 'rgba(255,255,255,0.14)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                  <span style={{ position: 'absolute', top: '2px', left: showAoA ? '16px' : '2px', width: '12px', height: '12px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                </span>
                <span style={{ fontSize: '11px', color: '#9CA3AF' }}>Show AoA zones</span>
              </button>
              <button
                onClick={() => setShowCorners(v => !v)}
                style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                <span style={{ width: '30px', height: '16px', borderRadius: '999px', background: showCorners ? 'var(--accent)' : 'rgba(255,255,255,0.14)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                  <span style={{ position: 'absolute', top: '2px', left: showCorners ? '16px' : '2px', width: '12px', height: '12px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                </span>
                <span style={{ fontSize: '11px', color: '#9CA3AF' }}>Show corner numbers</span>
              </button>
            </div>
            {details && (
              <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '10px', color: 'var(--muted)', lineHeight: 1.6 }}>
                {details.corners.length} corners · {details.marshal_sectors.length} marshal sectors · rotation {Math.round(details.rotation)}°
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: '16px', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.6 }}>
        Circuit geometry from fastf1 (corners, marshal sectors, rotation). AoA zones are approximated from track
        curvature and are indicative, not the official DRS detection points. Live cars appear only during a session,
        polled every {POLL_INTERVAL_MS / 1000}s from the F1 timing bridge.
      </div>
    </div>
  )
}
