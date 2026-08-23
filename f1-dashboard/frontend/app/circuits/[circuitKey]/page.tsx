'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { MapPin, Trophy, Flag, Gauge, Ruler, ArrowLeft, CircleOff } from 'lucide-react'
import { useApi } from '@/lib/api/client'
import { CIRCUIT_VIEWBOX } from '@/lib/constants'
import type { Circuit, CircuitRecords } from '@/lib/types'

function FactRow({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) {
  return (
    <tr>
      <td style={{ color: 'var(--muted)' }}>{label}</td>
      <td className="font-num" style={{ textAlign: 'right', fontWeight: 700, color: valueColor || 'var(--foreground)' }}>{value ?? '—'}</td>
    </tr>
  )
}

function RecordRow({ label, driver, count, accent }: { label: string; driver: string; count: number; accent: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--hairline)' }}>
      <div>
        <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3 }}>{driver}</div>
      </div>
      <div className="stat-num" style={{ fontSize: 22, color: accent }}>{count}</div>
    </div>
  )
}

export default function CircuitPage() {
  const params = useParams()
  const circuitKey = params.circuitKey as string

  // The router reuses this component when only the param changes. SWR's
  // keepPreviousData keeps the previous circuit's response around while the
  // new one loads (no full-page flash) — the `.key`/`.circuit_key` checks
  // below stop that stale response from being treated as this circuit's data.
  const { data: circuitRaw, isLoading: circuitIsLoading } = useApi<Circuit>(
    circuitKey ? `/api/circuits/${circuitKey}` : null,
  )
  const { data: recordsRaw, isLoading: recordsIsLoading } = useApi<CircuitRecords>(
    circuitKey ? `/api/circuits/${circuitKey}/records` : null,
  )

  const circuit = circuitRaw && circuitRaw.key === circuitKey ? circuitRaw : null
  const records = recordsRaw && recordsRaw.circuit_key === circuitKey ? recordsRaw : null
  const loading = circuitIsLoading || recordsIsLoading || (circuitRaw != null && circuitRaw.key !== circuitKey)

  if (loading) {
    return (
      <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
        <div className="shimmer" style={{ height: 64, borderRadius: 2, marginBottom: 22, maxWidth: 420 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: 16 }} className="live-grid">
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="shimmer" style={{ height: 340, borderRadius: 2 }} />
            <div className="shimmer" style={{ height: 220, borderRadius: 2 }} />
          </div>
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="shimmer" style={{ height: 180, borderRadius: 2 }} />
            <div className="shimmer" style={{ height: 240, borderRadius: 2 }} />
          </div>
        </div>
      </div>
    )
  }

  if (!circuit) {
    return (
      <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
        <div className="glass-card" style={{ padding: '56px 24px', textAlign: 'center', maxWidth: 480, margin: '40px auto' }}>
          <CircleOff size={24} style={{ color: 'var(--muted)', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Circuit not found</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>
            We don&apos;t have a record for &ldquo;{circuitKey}&rdquo;. It may not be on the 2026 calendar.
          </div>
          <Link href="/calendar" style={{ textDecoration: 'none' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
              background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 2,
              padding: '9px 16px', fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
              fontFamily: 'var(--font-display)',
            }}>
              <ArrowLeft size={13} /> Back to calendar
            </span>
          </Link>
        </div>
      </div>
    )
  }

  const tyrewear = circuit.tyre_wear
  const tyrewearColor = tyrewear === 'high' ? 'var(--accent)' : tyrewear === 'medium' ? 'var(--amber)' : 'var(--sector-green)'

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px', position: 'relative', zIndex: 1 }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <MapPin size={11} /> {circuit.country} {circuit.flag || ''}
          </div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>{circuit.name}</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 620 }}>
            {circuit.location}{circuit.first_gp ? ` · First Grand Prix ${circuit.first_gp}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="glass-card" style={{ padding: '10px 16px', textAlign: 'center', minWidth: 90 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Length</div>
            <div className="stat-num" style={{ fontSize: 18, marginTop: 4 }}>{circuit.length_km} km</div>
          </div>
          <div className="glass-card" style={{ padding: '10px 16px', textAlign: 'center', minWidth: 90 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Race Laps</div>
            <div className="stat-num" style={{ fontSize: 18, marginTop: 4 }}>{circuit.race_laps}</div>
          </div>
        </div>
      </motion.div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }} className="live-grid">
        {/* Main column */}
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Circuit layout — large, prominent */}
          {circuit.svgPath && (
            <motion.div className="glass-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ padding: 24 }}>
              <h2 className="section-title" style={{ marginBottom: 16 }}>Circuit Layout</h2>
              <svg viewBox={CIRCUIT_VIEWBOX} xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', maxWidth: '560px', display: 'block', margin: '0 auto' }}>
                <path d={circuit.svgPath} fill="none" stroke="var(--accent)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.div>
          )}

          {/* Lap record — featured readout */}
          <motion.div className="featured-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} style={{ padding: 22 }}>
            <h2 className="section-title" style={{ marginBottom: 14, ['--bar' as string]: 'var(--sector-purple)' }}>
              <Gauge size={14} style={{ color: 'var(--sector-purple)' }} /> Lap Record
            </h2>
            <div className="stat-num" style={{ fontSize: 42, color: 'var(--sector-purple)', lineHeight: 1 }}>
              {circuit.lap_record_time || '—'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 10 }}>
              {circuit.lap_record_driver || 'Unknown'}{circuit.lap_record_year ? ` · ${circuit.lap_record_year}` : ''}
            </div>
            {circuit.lap_record_pre_2026 && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 10,
                fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'var(--amber)', border: '1px solid color-mix(in srgb, var(--amber) 45%, transparent)',
                background: 'color-mix(in srgb, var(--amber) 10%, transparent)', borderRadius: 2, padding: '3px 8px',
              }}>
                Pre-2026 regulations
              </div>
            )}
          </motion.div>

          {/* Circuit facts — spec table */}
          <motion.div className="glass-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} style={{ padding: 22 }}>
            <h2 className="section-title" style={{ marginBottom: 14 }}>
              <Ruler size={13} /> Circuit Facts
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="f1-table">
                <tbody>
                  <FactRow label="Length" value={`${circuit.length_km} km`} />
                  <FactRow label="Race Laps" value={circuit.race_laps} />
                  <FactRow label="Race Distance" value={`${circuit.race_distance_km} km`} />
                  <FactRow label="Corners" value={circuit.corners} />
                  <FactRow label="AoA Zones" value={circuit.aoa_zones} />
                  <FactRow label="Circuit Type" value={circuit.circuit_type} />
                  <FactRow label="Safety Car Probability" value={`${Math.round((circuit.sc_probability || 0) * 100)}%`} />
                  <FactRow label="Tyre Wear" value={<span style={{ textTransform: 'capitalize' }}>{circuit.tyre_wear}</span>} valueColor={tyrewearColor} />
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: '14px 0 0' }}>
              <span style={{ color: 'var(--foreground)', fontWeight: 600 }}>Overtaking — </span>
              {circuit.overtaking_difficulty === 'easy' ? 'Easy, with long straights and AoA activation zones.' :
               circuit.overtaking_difficulty === 'medium' ? 'Moderate — some opportunities into the braking zones.' :
               'Difficult — limited opportunities, strategy is key.'}
            </p>
          </motion.div>
        </div>

        {/* Rail */}
        <div style={{ display: 'grid', gap: 16 }}>
          {records && (records.most_wins || records.most_poles || records.most_podiums) && (
            <motion.div className="glass-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} style={{ padding: 18 }}>
              <h2 className="section-title" style={{ marginBottom: 8 }}>
                <Trophy size={13} /> All-Time Records
              </h2>
              <div>
                {records.most_wins && <RecordRow label="Most Wins" driver={records.most_wins.driver} count={records.most_wins.count} accent="var(--amber)" />}
                {records.most_poles && <RecordRow label="Most Poles" driver={records.most_poles.driver} count={records.most_poles.count} accent="var(--sector-purple)" />}
                {records.most_podiums && <RecordRow label="Most Podiums" driver={records.most_podiums.driver} count={records.most_podiums.count} accent="var(--sector-green)" />}
              </div>
            </motion.div>
          )}

          {records?.recent_winners && records.recent_winners.length > 0 && (
            <motion.div className="glass-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} style={{ padding: 18 }}>
              <h2 className="section-title" style={{ marginBottom: 12 }}>
                <Flag size={13} /> Recent Winners
              </h2>
              <div style={{ overflowX: 'auto' }}>
                <table className="f1-table">
                  <thead>
                    <tr><th>Year</th><th>Winner</th><th>Team</th></tr>
                  </thead>
                  <tbody>
                    {records.recent_winners.slice(0, 10).map((w, i) => (
                      <tr key={i}>
                        <td className="font-num" style={{ color: 'var(--muted)' }}>{w.year}</td>
                        <td style={{ fontWeight: 600 }}>{w.driver}</td>
                        <td style={{ color: 'var(--muted)', fontSize: 12 }}>{w.team}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
