'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { historyClient, sessionLabel, type HistoricalSession } from '@/lib/tactical/history'
import type { ReplayData } from '@/lib/tactical/replay'

const control: CSSProperties = { width: '100%', minHeight: 40, padding: '9px 11px', border: '1px solid #2c3947', borderRadius: 5, background: '#0d1218', color: '#e9eef5', fontSize: 13 }
const label: CSSProperties = { display: 'grid', gap: 7, fontSize: 11, color: '#a6bbc7' }

export default function RacePicker({ onLoad }: { onLoad: (data: ReplayData, label: string, session: HistoricalSession, startAt: number) => void }) {
  const currentYear = new Date().getUTCFullYear()
  const [year, setYear] = useState(currentYear); const [sessions, setSessions] = useState<HistoricalSession[]>([])
  const [selected, setSelected] = useState(''); const [minute, setMinute] = useState(5)
  const [listing, setListing] = useState(true); const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(''); const [error, setError] = useState(''); const [retry, setRetry] = useState(0)
  const pending = useRef<AbortController | null>(null)
  const session = sessions.find(s => String(s.session_key) === selected)
  const maxMinute = session ? Math.max(0, Math.floor((Date.parse(session.date_end) - Date.parse(session.date_start) - 1) / 60_000)) : 0
  const cancel = () => { pending.current?.abort(); pending.current = null; setLoading(false); setStatus(''); setError('') }
  useEffect(() => {
    const controller = new AbortController(); pending.current?.abort(); setLoading(false); setStatus(''); setListing(true); setError(''); setSessions([]); setSelected('')
    historyClient.sessions(year, controller.signal).then(items => {
      if (controller.signal.aborted) return
      setSessions(items); const initial = items.find(s => s.session_name === 'Race') ?? items[0]
      setSelected(initial ? String(initial.session_key) : ''); setMinute(5)
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to reach OpenF1. Check your connection and retry.') })
      .finally(() => { if (!controller.signal.aborted) setListing(false) })
    return () => { controller.abort(); pending.current?.abort() }
  }, [year, retry])
  async function load() {
    if (!session) return
    cancel(); const controller = new AbortController(); pending.current = controller; setLoading(true)
    const startMinute = Math.min(maxMinute, Math.max(0, minute)); setMinute(startMinute)
    try {
      const data = await historyClient.load(session, startMinute, controller.signal, setStatus, true)
      if (!controller.signal.aborted) {
        onLoad(data, sessionLabel(session), session, Date.parse(session.date_start) + startMinute * 60_000)
        const missing = [!data.drivers.some(d => d.car.length) && 'Car telemetry unavailable.', !data.drivers.some(d => d.intervals.length) && 'Interval gaps unavailable.'].filter(Boolean).join(' ')
        setStatus(`${sessionLabel(session)} ready. Full session timeline; data loads in two-minute chunks as you play or seek. ${missing}`)
      }
    } catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : 'Unable to reach OpenF1. Check your connection and retry.'); setStatus('') } }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }
  return <section aria-label="Choose a historical race" style={{ padding: 16, marginBottom: 14, border: '1px solid #2c3947', borderRadius: 7, background: '#151d26' }}>
    <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}><h2 style={{ fontSize: 15, margin: 0 }}>Race archive</h2><p style={{ fontSize: 12, color: '#91a2b6', margin: 0 }}>Full-session replay · Sessions from 2023</p></div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
      <label style={{ ...label, flex: '0 1 100px' }}>Season<select aria-label="Season" value={year} style={control} onChange={e => { cancel(); setYear(Number(e.target.value)) }}>{Array.from({ length: Math.max(1, currentYear - 2022) }, (_, i) => currentYear - i).map(y => <option key={y} value={y}>{y}</option>)}</select></label>
      <label style={{ ...label, flex: '1 1 280px', minWidth: 0 }}>Race / session<select aria-label="Race / session" value={selected} disabled={listing || !sessions.length} style={control} onChange={e => { cancel(); setSelected(e.target.value); setMinute(5) }}>
        {!sessions.length && <option value="">{listing ? 'Finding completed sessions…' : 'No completed sessions available'}</option>}
        {[...new Set(sessions.map(s => s.meeting_key))].map(meeting => { const group = sessions.filter(s => s.meeting_key === meeting); return <optgroup key={meeting} label={`${group[0].country_name} · ${group[0].location}`}>{group.map(s => <option key={s.session_key} value={s.session_key}>{s.session_name} · {s.date_start.slice(0, 10)}</option>)}</optgroup> })}
      </select></label>
      <label style={{ ...label, flex: '0 1 130px' }}>Start at minute<input aria-label="Replay starting minute" type="number" min={0} max={maxMinute} step={1} disabled={!session} value={Math.min(minute, maxMinute)} style={control} onChange={e => { cancel(); setMinute(Math.min(maxMinute, Math.max(0, Math.floor(Number(e.target.value) || 0)))) }} /></label>
      <button disabled={!session || listing || loading} onClick={() => void load()} style={{ ...control, width: 'auto', cursor: loading ? 'wait' : 'pointer', background: '#e9eef5', color: '#0d1218', fontWeight: 700, paddingInline: 20, opacity: !session || listing || loading ? .5 : 1 }}>{loading ? 'Loading race…' : 'Load race'}</button>
      {loading && <button onClick={cancel} style={{ ...control, width: 'auto', cursor: 'pointer' }}>Cancel</button>}
    </div>
    <div role="status" aria-live="polite" style={{ color: '#91a2b6', fontSize: 12, marginTop: 10 }}>{listing ? 'Loading the race archive…' : status || 'Load a session, then press Play on the timeline.'}</div>
    {error && <div role="alert" style={{ color: '#ffc1b6', fontSize: 12, marginTop: 12 }}>{error} <button style={{ ...control, width: 'auto', marginLeft: 8, cursor: 'pointer' }} onClick={() => session ? void load() : setRetry(r => r + 1)}>Retry</button></div>}
    {!listing && !sessions.length && !error && <p style={{ color: '#c9b886', fontSize: 12 }}>No completed sessions found for this year. Choose an earlier season.</p>}
  </section>
}
