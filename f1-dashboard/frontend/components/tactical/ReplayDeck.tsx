'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Crosshair, Upload, Play, Pause, Radio, Navigation } from 'lucide-react'
import { createDemoReplay, fixAt as recordedFixAt, indexAt, latestAt, parseReplay, trailColor, type ReplayData, type Fix } from '@/lib/tactical/replay'
import styles from './ReplayDeck.module.css'
import { historyClient, sessionChunk, type HistoricalSession } from '@/lib/tactical/history'
import dynamic from 'next/dynamic'

const GeographicReplay=dynamic(() => import('./GeographicReplay'),{ssr:false,loading:()=><p role="status" style={{padding:24}}>Loading satellite renderer…</p>})

const button: CSSProperties = { padding: '9px 13px', border: '1px solid #2c3947', background: '#151d26', color: '#e9eef5', borderRadius: 5, cursor: 'pointer', fontSize: 12 }
const mono: CSSProperties = { fontFamily: 'var(--font-mono, monospace)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }
type CameraMode = 'free' | 'follow' | 'chase'
const elapsed = (ms: number) => `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`

export default function ReplayDeck({ initialReplay, feed }: { initialReplay?: { data: ReplayData; label: string; session?: HistoricalSession; startAt?: number }; feed?: { data: ReplayData; label: string; location?: string } }) {
  const maxGap = feed ? 15000 : 2500
  const fixAt = (samples: Fix[], at: number) => recordedFixAt(samples, at, maxGap)
  const [loadedData, setData] = useState<ReplayData | null>(initialReplay?.data ?? feed?.data ?? null)
  const [archive, setArchive] = useState(initialReplay?.session)
  const [time, setTime] = useState(initialReplay?.startAt ?? initialReplay?.data.start ?? feed?.data.end ?? 0); const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(1)
  const [selected, setSelected] = useState<number | null>(null); const [secondary, setSecondary] = useState<number | null>(null)
  const [camera, setCamera] = useState<CameraMode>('free'); const [intervals, setIntervals] = useState(false)
  const [heading, setHeading] = useState(0)
  const [view,setView]=useState<'local'|'geographic'>('local'),[geoError,setGeoError]=useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const fileRef = useRef<HTMLInputElement>(null)
  const [chunkStatus, setChunkStatus] = useState(''); const [chunkError, setChunkError] = useState(''); const [retryChunk, setRetryChunk] = useState(0)
  const chunk = archive ? sessionChunk(archive, time) : null
  const buffering = !!chunk && loadedData?.start !== chunk.from
  const data = buffering ? null : loadedData
  const timelineStart = archive ? Date.parse(archive.date_start) : loadedData?.start ?? 0
  const timelineEnd = archive ? Date.parse(archive.date_end) : loadedData?.end ?? 1
  const load = (next: ReplayData) => { setView('local');setGeoError('');setArchive(undefined); setChunkError(''); setChunkStatus(''); setData(next); setTime(next.start); setPlaying(false); setSelected(next.drivers[0]?.id ?? null); setSecondary(null); setCamera('free'); setError('') }
  const chunkFrom = chunk?.from
  useEffect(() => {
    if (!archive || chunkFrom === undefined || !buffering) return
    const controller = new AbortController()
    setChunkError(''); setChunkStatus('Buffering historical data…')
    // Coalesce rapid scrubbing; old requests cannot overwrite a newer seek/session.
    const timer = setTimeout(() => {
      void historyClient.load(archive, (chunkFrom - Date.parse(archive.date_start)) / 60_000, controller.signal,
        text => { if (!controller.signal.aborted) setChunkStatus(text) }, true)
        .then(next => { if (!controller.signal.aborted) { setData(next); setChunkStatus('') } })
        .catch(e => { if (!controller.signal.aborted) { setChunkError(e instanceof Error ? e.message : 'Unable to load this part of the session.'); setChunkStatus(''); setPlaying(false) } })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [archive, chunkFrom, buffering, retryChunk])
  const prefetchAt = archive && data && playing && data.end - time < 20_000 && data.end < timelineEnd ? data.end : null
  useEffect(() => {
    if (!archive || prefetchAt === null) return
    const controller = new AbortController()
    // One bounded look-ahead chunk. A failed prefetch is retried visibly on demand.
    void historyClient.load(archive, (prefetchAt - Date.parse(archive.date_start)) / 60_000,
      controller.signal, () => {}, true).catch(() => {})
    return () => controller.abort()
  }, [archive, prefetchAt])
  useEffect(() => {
    if (!feed) return
    setData(feed.data); setTime(feed.data.end); setPlaying(false)
  }, [feed])
  useEffect(() => {
    if (!playing || !data) return
    let frame = 0; let last = performance.now(); let accumulated = 0
    const tick = (now: number) => { accumulated += Math.min(now - last, 100); last = now; if (accumulated >= 32) { const delta = accumulated * speed; accumulated = 0; setTime(t => Math.min(data.end, timelineEnd, t + delta)) } frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame)
  }, [playing, data, speed, timelineEnd])
  useEffect(() => { if (time >= timelineEnd) setPlaying(false) }, [time, timelineEnd])
  useEffect(() => { if (selected === secondary) setSecondary(null) }, [selected, secondary])
  useEffect(() => {
    const command = (event: Event) => {
      const d = (event as CustomEvent).detail
      if (d?.type === 'camera' && ['free', 'follow', 'chase'].includes(d.mode)) setCamera(d.mode)
      if (d?.type === 'intervals') setIntervals(Boolean(d.visible))
      if (d?.type === 'track-driver' && typeof d.query === 'string') {
        const query = d.query.trim().toLowerCase(); const matches = data?.drivers.filter(driver => query && (String(driver.id) === query || driver.name.toLowerCase().includes(query) || driver.acronym.toLowerCase() === query)) ?? []
        if (matches.length === 1) { setSelected(matches[0].id); setCamera('follow'); setError('') }
        else setError(matches.length ? 'Driver command is ambiguous. Use the full name or car number.' : 'That driver is not in the loaded replay. Import data or open the demo first.')
      }
    }
    window.addEventListener('f1:tactical-command', command); return () => window.removeEventListener('f1:tactical-command', command)
  }, [data])
  const bounds = useMemo(() => {
    if (!data?.drivers.length) return { x: 0, y: 0, span: 1400 }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const d of data.drivers) for (const f of d.fixes) { minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x); minY = Math.min(minY, f.y); maxY = Math.max(maxY, f.y) }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, span: Math.max(maxX - minX, (maxY - minY) * 1.7, 100) * 1.23 }
  }, [data])
  const track = useMemo(() => {
    const fixes = data?.drivers.length ? data.drivers.reduce((a, b) => a.fixes.length > b.fixes.length ? a : b).fixes : []
    const step = Math.max(1, Math.ceil(fixes.length / 2000))
    let path = ''; let broken = true
    for (let i = 0; i < fixes.length; i++) {
      if (i && fixes[i].t - fixes[i - 1].t > maxGap) broken = true
      if (i % step === 0 || i === fixes.length - 1) { path += `${broken ? 'M' : 'L'}${fixes[i].x},${-fixes[i].y} `; broken = false }
    }
    return path
  }, [data, maxGap])
  const target = data?.drivers.find(d => d.id === selected); const targetFix = target && fixAt(target.fixes, time)
  const before = target && fixAt(target.fixes, time - 150)
  const zoom = camera !== 'free' && targetFix ? 2.3 : 1
  const scale = 1000 / bounds.span * zoom
  const cx = camera !== 'free' && targetFix ? targetFix.x : bounds.x; const cy = camera !== 'free' && targetFix ? targetFix.y : bounds.y
  const desiredHeading = targetFix && before && Math.hypot(targetFix.x - before.x, targetFix.y - before.y) > .01 ? Math.atan2(targetFix.y - before.y, targetFix.x - before.x) * 180 / Math.PI - 90 : null
  useEffect(() => {
    if (desiredHeading !== null) setHeading(previous => previous + (((desiredHeading - previous + 180) % 360 + 360) % 360 - 180) * .35)
  }, [desiredHeading, time])
  const angle = camera === 'chase' ? heading : 0
  const other = data?.drivers.find(d => d.id === secondary); const otherFix = other && fixAt(other.fixes, time)
  const targetCar = target && latestAt(target.car, time)
  const importFile = async (file?: File) => {
    if (!file) return
    setBusy(true); setError('')
    try { if (file.size > 25 * 1024 * 1024) throw new Error('Maximum file size is 25 MB. Export a shorter session window.'); load(parseReplay(JSON.parse(await file.text()))) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to read this file.') }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  return <section aria-label="Historical tactical replay" className={styles.deck}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
      <div><div style={{ fontWeight: 600, fontSize: 14, marginBottom: 5 }}>{feed ? feed.label : data?.synthetic ? 'Practice with sample data' : initialReplay?.label ?? 'Track replay'}</div><div style={{ color: '#91a2b6', fontSize: 12 }}>{feed ? 'Positions from the current timing feed.' : data ? `${data.drivers.length} drivers · Select a driver to follow` : 'Your selected session will appear here.'}</div></div>
      {!feed && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input ref={fileRef} type="file" accept="application/json,.json" aria-label="Import OpenF1 JSON" style={{ display: 'none' }} onChange={e => void importFile(e.target.files?.[0])} />
        <button style={button} disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={13} style={{ verticalAlign: 'middle', marginRight: 7 }} />{busy ? 'Reading…' : 'Import OpenF1 JSON'}</button>
        <button style={button} onClick={() => load(createDemoReplay())}>Load synthetic demo</button>
      </div>}
    </div>
    {error && <p role="alert" style={{ padding: 12, background: '#3b2023', color: '#ffb4ac', borderRadius: 5 }}>{error}</p>}
    {geoError && <p role="status" style={{padding:12,color:'#dfc28b'}}>{geoError}</p>}
    <div role="group" aria-label="Track renderer" style={{display:'flex',gap:8,flexWrap:'wrap',paddingBottom:12}}>
      <button style={button} aria-pressed={view==='local'} onClick={()=>setView('local')}>Local track</button>
      <button style={button} aria-pressed={view==='geographic'} disabled={!loadedData || loadedData.synthetic || !(archive?.location || feed?.location)} onClick={()=>{setGeoError('');setView('geographic')}}>Satellite + terrain</button>
      <span style={{...mono,alignSelf:'center',color:'#91a2b6'}}>Geographic view uses checked, estimated alignment.</span>
    </div>
    {buffering && !chunkError && <p role="status">{chunkStatus || 'Buffering historical data…'} Playback resumes when ready.</p>}
    {chunkError && <p role="alert">{chunkError} <button style={button} onClick={() => setRetryChunk(n => n + 1)}>Retry replay chunk</button></p>}
    {archive && data && !data.drivers.length && <p role="status">No recorded positions in this part of the session. Play through the gap or seek ahead.</p>}
    <div className={styles.layout}>
      <div className={styles.track}>
        <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid #293b47', ...mono }}>
          <span style={{ color: data?.synthetic ? '#efb36d' : '#b9c9db' }}><Radio size={12} style={{ verticalAlign: 'middle' }} /> {feed ? 'Recent feed positions' : data ? data.synthetic ? 'Synthetic demo · Not a real race' : 'Historical replay' : 'No session loaded'}</span>
          <span style={{ color: '#91a2b6' }}>{camera === 'free' ? 'Track overview' : camera === 'follow' ? 'Following driver' : 'Chase camera'}</span>
        </div>
        {view==='geographic' && <GeographicReplay data={data} location={archive?.location ?? feed?.location ?? ''} time={time} selected={selected} camera={camera} maxGap={maxGap} onSelect={id=>{setSelected(id);setCamera('follow')}} onFree={()=>setCamera('free')} onFailure={message=>{setGeoError(message);setView('local')}} />}
        <div style={{ position: 'relative',display:view==='local'?'block':'none' }}>
          <svg className="ops-map-surface" viewBox="0 0 1000 580" role="img" aria-label="Track reconstruction with selectable driver positions and telemetry trails" style={{ width: '100%', display: 'block', background: '#071017', minHeight: 250 }}>
            <defs><pattern id="ops-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#1c3440" strokeWidth=".6" /></pattern></defs>
            <rect width="1000" height="580" fill="url(#ops-grid)" />
            <path d="M470 290H530M500 260V320" stroke="#607c87" opacity=".4" />
            <g transform={`translate(500 290) rotate(${angle}) scale(${scale}) translate(${-cx} ${cy})`}>
              {track && <path d={track} fill="none" stroke="#4b6270" strokeWidth={15 / scale} opacity=".35" strokeLinejoin="round" />}
              {targetFix && otherFix && <line x1={targetFix.x} y1={-targetFix.y} x2={otherFix.x} y2={-otherFix.y} stroke="#f5ce77" strokeDasharray={`${8 / scale} ${5 / scale}`} strokeWidth={2 / scale} />}
              {data?.drivers.map(d => {
                const fix = fixAt(d.fixes, time); if (!fix) return null
                const end = indexAt(d.fixes, time); const start = Math.max(0, end - 100); const trail = d.fixes.slice(start, end + 1).filter(f => time - f.t <= 6500)
                return <g key={d.id}>
                  {trail.slice(1).map((f, i) => f.t - trail[i].t <= 2500 ? <line key={f.t} x1={trail[i].x} y1={-trail[i].y} x2={f.x} y2={-f.y} stroke={trailColor(latestAt(d.car, f.t))} strokeWidth={(selected === d.id ? 4 : 2.5) / scale} opacity={.15 + i / trail.length * .8} strokeLinecap="round" /> : null)}
                  <g transform={`translate(${fix.x} ${-fix.y}) rotate(${-angle}) scale(${1 / scale})`} style={{ cursor: 'pointer' }} onClick={() => { setSelected(d.id); setCamera('follow') }}>
                    {selected === d.id && <circle r="17" fill="none" stroke="#b7e4cf" strokeDasharray="4 3" />}
                    <circle r="7" fill={trailColor(latestAt(d.car, time))} stroke="#e4f4ee" strokeWidth="1.5" />
                    <text x="13" y="-11" fill="#dce8e9" fontSize="12" fontFamily="monospace">{d.acronym}</text>
                  </g>
                </g>
              })}
            </g>
          </svg>
          {!data && !archive && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center', padding: 24 }}><Crosshair size={32} style={{ margin: '0 auto 16px', color: '#91a2b6' }} /><h2 style={{ fontSize: 22, marginBottom: 10 }}>A race, from every angle</h2><p style={{ color: '#91a2b6', fontSize: 13, maxWidth: 340, lineHeight: 1.7 }}>Choose a session above and load the race to see driver positions. Try the synthetic demo to explore the controls.</p></div>}
        </div>
        <div className={styles.legend}><span><i style={{ background: '#64ed9c' }} />Full throttle</span><span><i style={{ background: '#ff635c' }} />Braking</span><span><i style={{ background: '#ffc76a' }} />Partial / coast</span><span><i style={{ background: '#8899aa' }} />No telemetry</span></div>
        {!feed && <div style={{ padding: 14, borderTop: '1px solid #293b47' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <button aria-label={playing ? 'Pause replay' : 'Play replay'} disabled={!loadedData || !!chunkError} style={button} onClick={() => { if (time >= timelineEnd) setTime(timelineStart); setPlaying(p => !p) }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
            <span style={mono}>{loadedData ? elapsed(time - timelineStart) : '00:00'} / {loadedData ? elapsed(timelineEnd - timelineStart) : '00:00'}</span>
            <select aria-label="Playback speed" style={{ ...button, marginLeft: 'auto' }} value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[.25, .5, 1, 2, 4].map(s => <option key={s} value={s}>{s}×</option>)}</select>
          </div>
          <input aria-label="Replay timeline" type="range" min={timelineStart} max={timelineEnd} value={time} step="100" disabled={!loadedData} onChange={e => setTime(Number(e.target.value))} style={{ width: '100%', accentColor: '#bed0e3' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#91a2b6', fontSize: 10, marginTop: 5 }}><span>{archive ? 'Session start' : 'Clip start'}</span><span>Drag to seek{archive ? ' · downloads on demand' : ''}</span><span>{archive ? 'Session end' : 'Clip end'}</span></div>
        </div>}
      </div>
      <aside className={styles.sidebar}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}><Navigation size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />Driver camera</div>
        <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>{(['free', 'follow', 'chase'] as const).map(mode => <button key={mode} aria-pressed={camera === mode} disabled={!data} onClick={() => setCamera(mode)} style={{ ...button, flex: 1, padding: '9px 4px', background: camera === mode ? '#2b3d51' : '#0d1218' }}>{mode === 'chase' ? 'Chase' : mode === 'follow' ? 'Lock' : 'Overview'}</button>)}</div>
        <div className={styles.selected}>
          <div style={{ color: '#91a2b6', fontSize: 10, marginBottom: 6 }}>Selected driver</div>
          <strong style={{ fontSize: 15 }}>{target ? `${target.acronym} / ${target.name}` : 'Choose a driver below'}</strong>
          {target && <><div className={styles.driverDetail}>{targetFix ? 'Position available' : 'Position unavailable at this time'}</div><dl className={styles.telemetry}>
            <div><dt>Speed · km/h</dt><dd>{targetCar?.speed == null ? '—' : Math.round(targetCar.speed)}</dd></div>
            <div><dt>Throttle</dt><dd>{targetCar?.throttle == null ? '—' : `${Math.round(targetCar.throttle)}%`}</dd></div>
            <div><dt>Brake</dt><dd>{targetCar?.brake == null ? '—' : `${Math.round(targetCar.brake)}%`}</dd></div>
          </dl></>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#91a2b6', fontSize: 11, marginBottom: 8 }}><span>Driver targets</span><span>{data?.drivers.length ?? 0} drivers</span></div>
        {!data && <p style={{ color: '#91a2b6', fontSize: 12 }}>Load a replay to select a driver.</p>}
        <div className={styles.targets}>{data?.drivers.map(d => { const car = latestAt(d.car, time); const gap = latestAt(d.intervals, time, 10000); const fix = fixAt(d.fixes, time); return <button key={d.id} aria-pressed={selected === d.id} className={styles.driver} onClick={() => { setSelected(d.id); setCamera('follow') }}><span className={styles.number}>{String(d.id).padStart(2, '0')}</span><span><span className={styles.driverName}>{d.name}</span><span style={{ display: 'block' }} className={styles.driverDetail}>{!fix ? 'Position unavailable' : selected === d.id ? 'Camera target' : d.acronym}{intervals && <span style={{ display: 'block', marginTop: 5 }}>Interval to car ahead: {gap?.interval == null ? 'unavailable' : typeof gap.interval === 'number' ? `${gap.interval.toFixed(3)}s` : gap.interval}</span>}</span></span><span className={styles.speed}>{car?.speed == null ? '—' : Math.round(car.speed)}<span style={{ display: 'block', color: '#91a2b6', fontSize: 9, textAlign: 'right' }}>km/h</span></span></button> })}</div>
        <label style={{ display: 'block', marginTop: 16, fontSize: 12, color: '#b9c9db' }}><input type="checkbox" checked={intervals} onChange={e => setIntervals(e.target.checked)} style={{ accentColor: '#bed0e3', marginRight: 8 }} />Show recorded interval gaps</label>
        <label style={{ display: 'block', marginTop: 16, fontSize: 11, color: '#91a2b6' }}>Compare with<select aria-label="Secondary radar target" value={secondary ?? ''} style={{ ...button, width: '100%', marginTop: 7 }} onChange={e => setSecondary(e.target.value ? Number(e.target.value) : null)}><option value="">None</option>{data?.drivers.filter(d => d.id !== selected).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        {secondary && <p style={{ color: '#cfb779', fontSize: 11, lineHeight: 1.7 }}>The connector shows spatial separation only. Recorded intervals refer to each driver’s car ahead; they are not a pairwise time delta.</p>}
      </aside>
    </div>
    <details className={styles.extras}><summary>About replay data and file imports</summary><p>Accepts an OpenF1 location array or {'{ location, car_data, drivers, intervals }'} JSON. Maximum 25 MB / 250,000 records. Missing or stale telemetry stays unavailable. The track is reconstructed from recorded positions; it is not aligned to satellite imagery.</p></details>
  </section>
}
