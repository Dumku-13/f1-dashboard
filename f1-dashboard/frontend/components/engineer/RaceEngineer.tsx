'use client'

/**
 * Race Engineering — plan a tyre strategy and see where it would have put you.
 *
 * The simulation is a MODEL, not a measurement: pace and degradation are fitted
 * from the real race, but fuel effect, traffic and driver variation aren't in
 * it. The backend returns exactly what it measured versus what it assumed, and
 * this surfaces that rather than presenting a projected position as fact.
 *
 * Rendered both at `/race-engineer` and inside Follow Along, so it takes the
 * round and driver as props and owns nothing but the plan itself.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Info, AlertTriangle } from 'lucide-react'
import { BACKEND_URL } from '@/lib/constants'
import StrategyBuilder, { type Stint, compoundColor } from '@/components/engineer/StrategyBuilder'

interface SimResponse {
  available: boolean
  total_laps: number
  planned_laps: number
  total_time_s: number
  stops: number
  pit_loss_total_s: number
  timeline: { lap: number; cumulative_s: number; compound: string; tyre_age: number; lap_time_s: number }[]
  actual: { total_time_s: number | null; finish_position: number | null; stints: Stint[] } | null
  delta_vs_actual_s: number | null
  projected_position: number | null
  field: { abbr: string; total_time_s: number; position: number }[]
  model?: {
    extrapolated_compounds?: string[]
    estimated_compounds?: string[]
    assumptions?: string[]
    deg_s_per_lap?: Record<string, number>
    [k: string]: unknown
  }
  note?: string
  delta_note?: string
}

const fmtGapS = (s: number) => `${s >= 0 ? '+' : ''}${s.toFixed(1)}s`

function Tile({ label, value, sub, accent, delay = 0 }: { label: string; value: string; sub?: string; accent?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3, ease: 'easeOut' }}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, padding: '12px 14px' }}
    >
      <div className="font-display" style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
      <div className="stat-num" style={{ fontSize: 21, marginTop: 3, color: accent || 'var(--foreground)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </motion.div>
  )
}

export default function RaceEngineer({
  year,
  round,
  driver,
  totalLaps = 57,
  compact = false,
}: {
  year: number
  round: number | null
  driver: string | null
  totalLaps?: number
  compact?: boolean
}) {
  const [stints, setStints] = useState<Stint[]>([
    { compound: 'MEDIUM', laps: Math.ceil(totalLaps / 2) },
    { compound: 'HARD', laps: Math.floor(totalLaps / 2) },
  ])
  const [scLaps, setScLaps] = useState<number[]>([])
  const [rainFrom, setRainFrom] = useState<number | null>(null)
  const [result, setResult] = useState<SimResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed the plan when the race length changes (different round).
  useEffect(() => {
    setStints([
      { compound: 'MEDIUM', laps: Math.ceil(totalLaps / 2) },
      { compound: 'HARD', laps: Math.floor(totalLaps / 2) },
    ])
    setResult(null)
  }, [totalLaps, round])

  const planned = useMemo(() => stints.reduce((n, s) => n + s.laps, 0), [stints])


  /** Everything the result depends on. Same key in, same answer out. */
  const planKey = useMemo(
    () => JSON.stringify({ year, round, driver, totalLaps, stints, scLaps: [...scLaps].sort((a, b) => a - b), rainFrom }),
    [year, round, driver, totalLaps, stints, scLaps, rainFrom],
  )
  const cache = useRef(new Map<string, SimResponse>())

  // A result on screen must always describe the plan on screen.
  useEffect(() => { setResult(cache.current.get(planKey) ?? null) }, [planKey])

  const run = async () => {
    if (!round || !driver) return
    const hit = cache.current.get(planKey)
    if (hit) { setResult(hit); setError(null); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${BACKEND_URL}/api/analysis/race-engineer/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year, round_num: round, driver, total_laps: totalLaps,
          stints: stints.map(s => ({ compound: s.compound, laps: s.laps })),
          sc_laps: scLaps,
          rain_from: rainFrom,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `Simulation failed (${res.status})`)
      }
      const json: SimResponse = await res.json()
      // Bounded: a long session of tweaking shouldn't grow this without limit.
      if (cache.current.size > 40) cache.current.clear()
      cache.current.set(planKey, json)
      setResult(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed')
      setResult(null)
    } finally {
      setBusy(false)
    }
  }

  const comparableField = useMemo(
    () => (result?.field || []).filter(f => f.total_time_s > 0),
    [result],
  )
  const excludedFromField = (result?.field?.length || 0) - comparableField.length

  const extrapolated = result?.model?.extrapolated_compounds ?? []
  const estimated = result?.model?.estimated_compounds ?? []

  // SOFT should degrade fastest and HARD slowest. When the fit says otherwise
  // it's fuel burn leaking into the regression, and the user needs telling.
  const degOrderLooksOdd = useMemo(() => {
    const d = result?.model?.deg_s_per_lap
    if (!d) return false
    const soft = d.SOFT, med = d.MEDIUM, hard = d.HARD
    if (soft != null && hard != null && hard > soft) return true
    if (med != null && hard != null && hard > med) return true
    return false
  }, [result])

  const delta = result?.delta_vs_actual_s ?? null
  const faster = delta != null && delta < 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="glass-card" style={{ padding: 18 }}>
        <h2 className="section-title" style={{ marginBottom: 6 }}>Strategy</h2>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
          Drag a compound onto a stint to change it, or use the controls under the bar.
          {driver ? ` Planning for ${driver}.` : ' Pick a driver to simulate.'}
        </div>

        <StrategyBuilder totalLaps={totalLaps} stints={stints} onChange={setStints} />

        {/* Race conditions */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16, alignItems: 'center' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
            <input
              type="checkbox"
              checked={rainFrom != null}
              onChange={e => setRainFrom(e.target.checked ? Math.ceil(totalLaps / 2) : null)}
            />
            Rain from lap
            {rainFrom != null && (
              <input
                type="number"
                min={1}
                max={totalLaps}
                value={rainFrom}
                aria-label="Rain starts on lap"
                onChange={e => setRainFrom(Math.min(totalLaps, Math.max(1, Number(e.target.value) || 1)))}
                style={{ width: 62, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)', padding: '4px 6px', borderRadius: 2 }}
              />
            )}
          </label>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
            Safety car laps
            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 12, 30"
              aria-label="Safety car laps, comma separated"
              defaultValue={scLaps.join(', ')}
              onBlur={e => setScLaps(
                e.target.value.split(',').map(v => parseInt(v.trim(), 10)).filter(n => Number.isFinite(n) && n > 0),
              )}
              style={{ width: 110, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)', padding: '5px 8px', borderRadius: 2 }}
            />
          </label>

          <motion.button
            onClick={run}
            disabled={busy || !round || !driver}
            className="font-display"
            whileHover={(!busy && round && driver) ? { scale: 1.03, boxShadow: '0 0 20px rgba(225,6,0,0.35)' } : {}}
            whileTap={(!busy && round && driver) ? { scale: 0.97 } : {}}
            style={{
              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '10px 18px', border: 'none', borderRadius: 2, minHeight: 40,
              background: (!round || !driver) ? 'var(--surface)' : 'var(--accent)',
              color: (!round || !driver) ? 'var(--muted)' : '#fff',
              cursor: busy || !round || !driver ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
              transition: 'opacity 0.25s ease, background 0.25s ease',
            }}
          >
            <motion.span
              animate={busy ? { rotate: 360 } : { rotate: 0 }}
              transition={busy ? { duration: 1, repeat: Infinity, ease: 'linear' } : {}}
              style={{ display: 'inline-flex' }}
            >
              <Play size={13} />
            </motion.span>
            {busy ? 'Simulating…' : 'Run strategy'}
          </motion.button>
        </div>

        {planned !== totalLaps && (
          <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 10 }}>
            The plan covers {planned} laps, the race is {totalLaps}. It will still run — the result
            is for the laps you planned.
          </div>
        )}
        {error && (
          <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 10 }}>{error}</div>
        )}
      </div>

      {/* Result */}
      <AnimatePresence mode="wait">
      {result?.available && (
        <motion.div
          key="result"
          className="glass-card"
          initial={{ opacity: 0, y: 20, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          style={{ padding: 18 }}
        >
          <h2 className="section-title" style={{ marginBottom: 14, ['--bar' as string]: 'var(--sector-purple)' }}>
            Projected outcome
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 10, marginBottom: 16 }}>
            <Tile
              label="Projected finish"
              value={result.projected_position ? `P${result.projected_position}` : '—'}
              sub={result.actual?.finish_position ? `actually finished P${result.actual.finish_position}` : undefined}
              accent="var(--accent)"
              delay={0.05}
            />
            <Tile
              label="Race time"
              value={`${Math.floor(result.total_time_s / 60)}:${String(Math.round(result.total_time_s % 60)).padStart(2, '0')}`}
              sub={`${result.stops} stop${result.stops === 1 ? '' : 's'}`}
              delay={0.1}
            />
            {delta != null ? (
              <Tile
                label="vs their own strategy"
                value={fmtGapS(delta)}
                sub={faster ? 'this plan is quicker' : 'this plan is slower'}
                accent={faster ? 'var(--sector-green)' : 'var(--accent)'}
                delay={0.15}
              />
            ) : (
              <Tile
                label="vs their own strategy"
                value="n/a"
                sub={result.delta_note ? 'race distance mismatch' : 'not comparable'}
                delay={0.15}
              />
            )}
            <Tile label="Pit loss" value={`${result.pit_loss_total_s.toFixed(1)}s`} sub="total, all stops" delay={0.2} />
          </div>

          {/* Plan vs what they actually ran */}
          {result.actual?.stints?.length ? (
            <div style={{ marginBottom: 14 }}>
              <div className="font-display" style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 7 }}>
                Your plan vs what they ran
              </div>
              {[
                { label: 'Plan', rows: stints },
                { label: 'Actual', rows: result.actual.stints },
              ].map(g => (
                <div key={g.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span className="font-display" style={{ fontSize: 10, color: 'var(--muted)', width: 46 }}>{g.label}</span>
                  <div style={{ display: 'flex', gap: 2, flex: 1, height: 16 }}>
                    {g.rows.map((s, i) => (
                      <div
                        key={i}
                        title={`${s.compound} · ${s.laps} laps`}
                        style={{
                          flex: `${Math.max(s.laps, 1)} 1 0`, background: compoundColor(s.compound),
                          borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9, fontWeight: 800, color: '#0B0C0E',
                        }}
                        className="font-num"
                      >
                        {s.laps}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Where it slots into the real field.
              Lapped runners are classified but covered fewer laps, so their
              total isn't comparable and comes back as 0. Showing "P8 — 0:00"
              just looks broken, so they're held out and counted instead. */}
          {comparableField.length > 0 && !compact && (
            <div>
              <div className="font-display" style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 7 }}>
                Against the real classification
              </div>
              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                {comparableField.slice(0, 12).map(f => {
                  const isMe = result.projected_position != null && f.position === result.projected_position
                  return (
                    <div
                      key={f.abbr}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px',
                        borderBottom: '1px solid var(--hairline)',
                        background: isMe ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                      }}
                    >
                      <span className="font-num" style={{ width: 24, fontSize: 11, color: 'var(--muted)' }}>P{f.position}</span>
                      <span className="font-display" style={{ fontSize: 12, fontWeight: 700 }}>{f.abbr}</span>
                      <span className="font-num" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
                        {Math.floor(f.total_time_s / 60)}:{String(Math.round(f.total_time_s % 60)).padStart(2, '0')}
                      </span>
                    </div>
                  )
                })}
              </div>
              {excludedFromField > 0 && (
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>
                  {excludedFromField} lapped {excludedFromField === 1 ? 'runner is' : 'runners are'} left out —
                  they covered fewer laps, so their race time isn&apos;t comparable.
                </div>
              )}
            </div>
          )}

          {delta == null && result.delta_note && (
            <div style={{ fontSize: 11, color: 'var(--amber)', marginBottom: 12 }}>
              {result.delta_note}
            </div>
          )}

          {/* Loud caveats first — these change how the number should be read,
              so they don't belong buried in a footnote. */}
          {(extrapolated.length > 0 || estimated.length > 0) && (
            <div
              style={{
                display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 14,
                padding: '11px 13px', borderRadius: 2,
                background: 'rgba(255,242,0,0.07)', border: '1px solid rgba(255,242,0,0.4)',
              }}
            >
              <AlertTriangle size={14} style={{ color: '#FFF200', flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 11, color: 'var(--foreground)', lineHeight: 1.55 }}>
                {extrapolated.length > 0 && (
                  <>
                    <strong>Beyond observed data.</strong> This plan runs {extrapolated.join(', ')} longer
                    than any stint actually run in this race, so those laps are extrapolated from the
                    fitted degradation line. Real tyres fall off a cliff; this model doesn&apos;t.{' '}
                  </>
                )}
                {estimated.length > 0 && (
                  <>
                    <strong>No data for {estimated.join(', ')}</strong> in this race — those compounds
                    use assumed constants, not measured pace.
                  </>
                )}
              </div>
            </div>
          )}

          {/* Degradation fitted from a race also contains fuel burn, which can
              invert the expected compound order. Say so where it's visible. */}
          {degOrderLooksOdd && (
            <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 10, padding: '11px 13px', borderRadius: 2, background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <Info size={14} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55 }}>
                In this race the harder compound fits a <em>higher</em> degradation rate than the softer
                one. That&apos;s a fuel-burn artefact, not a property of the tyre: the regression can&apos;t
                separate a car getting lighter from a tyre wearing out, and compounds run late in the race
                look artificially quick. Treat cross-compound comparisons here with suspicion.
              </div>
            </div>
          )}

          {/* What's modelled vs measured — this is a simulation, say so */}
          {(result.note || result.model) && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hairline)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Info size={13} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55 }}>
                {result.note}
                {Array.isArray((result.model as any)?.assumptions) && (
                  <> Not modelled: {((result.model as any).assumptions as string[]).join('; ')}.</>
                )}
              </div>
            </div>
          )}
        </motion.div>
      )}
      </AnimatePresence>

      {result && !result.available && (
        <div className="glass-card" style={{ padding: 18, fontSize: 12, color: 'var(--muted)' }}>
          No race data for this round yet — the simulator fits pace and degradation from the actual
          race, so it needs one that has run.
        </div>
      )}
    </div>
  )
}
