'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { fmtGap, fmtLap, useLiveSession } from '@/lib/live'
import type { ReplayData, ReplayDriver } from '@/lib/tactical/replay'
import ReplayDeck from './ReplayDeck'

const panel: CSSProperties = { background: '#0c151e', border: '1px solid #293b47', borderRadius: 8, padding: 18 }
const small: CSSProperties = { color: '#91a5b3', fontSize: 12, lineHeight: 1.7 }
const MAX_AGE = 15_000

/** Live timing shares the existing engine and broadcast-delay policy. No separate requests. */
export default function LiveRace() {
  const live = useLiveSession()
  const [now, setNow] = useState(0)
  const [data, setData] = useState<ReplayData | null>(null)
  const history = useRef<{ session: string; at: number; drivers: Map<number, ReplayDriver> }>({ session: '', at: 0, drivers: new Map() })
  const session = live.session
  const identity = session ? `${session.session_key}:${session.date_start}:${session.session_name}` : ''
  const at = live.lastUpdate?.getTime() ?? 0
  const delay = live.delayMs ?? 0
  const stale = !!at && !!now && now - delay - at > 30_000
  // A bridge can retain its last session payload; never advertise it as live after its window.
  const outsideWindow = !!session && !!now && now > Date.parse(session.date_end) + 30 * 60_000
  const isLive = live.status === 'live' && !outsideWindow && !stale && !live.delayBuffering
  const status = live.delayBuffering ? 'BUFFERING DELAY' : live.status === 'error' ? 'FEED UNAVAILABLE' : outsideWindow || live.status === 'ended' ? 'SESSION ENDED' : live.status === 'upcoming' ? 'UPCOMING SESSION' : stale ? 'FEED STALE' : isLive ? delay ? 'LIVE · DELAYED' : 'LIVE SESSION' : 'CONNECTING'

  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const previous = history.current
    if (previous.session !== identity || at < previous.at || !isLive || !at) {
      history.current = { session: identity, at: 0, drivers: new Map() }
      setData(null)
      if (!isLive || !at) return
    }
    const current = history.current
    // Positions have snapshot timestamps only. Do not manufacture a moving sample
    // from an unchanged retained fix; expire it if the source stops reporting motion.
    if (at === current.at) return
    current.at = at
    const present = new Set<number>()
    for (const row of live.rows) {
      const id = row.driver.driver_number
      const pos = row.pos
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || (!pos.x && !pos.y)) {
        current.drivers.delete(id)
        continue
      }
      present.add(id)
      const driver = current.drivers.get(id) ?? { id, name: row.driver.full_name, acronym: row.driver.name_acronym, fixes: [], car: [], intervals: [] }
      const last = driver.fixes[driver.fixes.length - 1]
      if (!last || last.x !== pos.x || last.y !== pos.y) driver.fixes.push({ t: at, x: pos.x, y: pos.y, z: 0 })
      driver.fixes = driver.fixes.filter(f => at - f.t <= 60_000).slice(-100)
      driver.intervals = [...driver.intervals, { t: at, interval: row.interval }].filter(f => at - f.t <= 60_000).slice(-100)
      current.drivers.set(id, driver)
    }
    for (const id of current.drivers.keys()) if (!present.has(id)) current.drivers.delete(id)
    const drivers = [...current.drivers.values()].filter(d => d.fixes.length && at - d.fixes[d.fixes.length - 1].t <= MAX_AGE).map(d => ({ ...d, fixes: [...d.fixes], intervals: [...d.intervals] }))
    setData(drivers.length ? { drivers, start: Math.min(...drivers.map(d => d.fixes[0].t)), end: at, synthetic: false } : null)
  }, [at, identity, isLive, live.rows])

  const visibleData = isLive && history.current.session === identity ? data : null
  const track = (id: number) => window.dispatchEvent(new CustomEvent('f1:tactical-command', { detail: { type: 'track-driver', query: String(id) } }))

  return <section aria-label="Live race timing" style={{ color: '#dce7ed', display: 'grid', gap: 18 }}>
    <div style={panel}>
      <div role="status" style={{ fontFamily: 'var(--font-mono, monospace)', color: isLive ? '#8cc9b5' : '#e0bc82', fontSize: 12, marginBottom: 10 }}>{status}</div>
      <h2 style={{ margin: '0 0 10px', fontSize: 24 }}>{session ? `${session.country_name || session.circuit_short_name} · ${session.session_name}` : 'Finding the current session'}</h2>
      <div style={small}>
        {session && <div>{session.circuit_short_name} · {new Date(session.date_start).toLocaleString()}</div>}
        <div>{live.source === 'f1' ? 'Existing F1 timing bridge' : 'OpenF1 timing'}{live.currentLap > 0 ? ` · Lap ${live.currentLap}` : ''}{live.trackStatus ? ` · ${live.trackStatus}` : ''}</div>
        <div>{at ? `Snapshot received ${new Date(at).toLocaleString()}` : 'Awaiting first snapshot'}{delay > 0 ? ` · Broadcast delay ${Math.round(delay / 1000)}s` : ''}</div>
      </div>
      {!isLive && <p style={{ ...small, marginBottom: 0 }}>{live.delayBuffering ? 'Filling your broadcast-delay buffer. Timing and positions will appear together when ready.' : status === 'SESSION ENDED' ? 'This is the last reported session, which has ended. Choose Past races to replay a recorded session.' : live.status === 'upcoming' ? 'The session has not started. Timing will appear when the source begins reporting.' : stale ? 'Updates have stopped. Last known timing is shown below; camera positions are hidden until the feed recovers.' : live.status === 'error' ? 'The timing source could not be reached. The existing engine will retry automatically; past races remain available.' : 'Waiting for the timing source. Live availability depends on the existing backend bridge and the session schedule.'}</p>}
    </div>
    {visibleData ? <ReplayDeck key={identity} feed={{ data: visibleData, label: delay ? 'LIVE POSITIONS · DELAYED' : 'LIVE POSITIONS',location:session?.circuit_short_name }} /> : <div style={{ ...panel, ...small }}>No fresh driver coordinates are available. Timing works independently; the map appears when the feed reports real positions.</div>}
    <div style={{ ...panel, overflowX: 'auto' }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 15 }}>{isLive ? 'Session timing' : 'Last reported timing'}</h3>
      {!live.rows.length ? <p style={small}>{live.delayBuffering ? 'Waiting for delayed timing.' : 'No driver timing received yet.'}</p> : <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 510, fontSize: 13 }}>
        <thead><tr>{['Pos', 'Driver', 'Leader gap', 'Interval', 'Laps', 'Last lap'].map(label => <th key={label} scope="col" style={{ textAlign: 'left', padding: '10px 8px', color: '#91a5b3', fontWeight: 400 }}>{label}</th>)}</tr></thead>
        <tbody>{live.rows.map(row => <tr key={row.driver.driver_number} style={{ borderTop: '1px solid #24323d' }}>
          <td style={{ padding: 8 }}>{row.position ?? '—'}</td>
          <td style={{ padding: 8 }}><button disabled={!visibleData?.drivers.some(d => d.id === row.driver.driver_number)} onClick={() => track(row.driver.driver_number)} title="Track this driver's available position" style={{ border: 0, background: 'none', color: '#dce7ed', padding: '6px 0', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>{row.driver.full_name || row.driver.name_acronym}<span style={{ display: 'block', ...small }}>{row.driver.team_name} · #{row.driver.driver_number}</span></button></td>
          <td style={{ padding: 8 }}>{fmtGap(row.gapToLeader)}</td><td style={{ padding: 8 }}>{row.interval === 0 ? '0.000' : fmtGap(row.interval)}</td><td style={{ padding: 8 }}>{row.lapsDone}</td><td style={{ padding: 8 }}>{fmtLap(row.lastLap?.lap_duration)}</td>
        </tr>)}</tbody>
      </table>}
    </div>
    <p style={{ ...small, margin: 0 }}>Position history uses received snapshots in native circuit XY coordinates. It is not satellite GPS. No speed, throttle or brake values are inferred from timing. Stationary or retained coordinates expire after 15 seconds without a change.</p>
  </section>
}
