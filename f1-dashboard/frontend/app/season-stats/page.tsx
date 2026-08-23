'use client'

import { motion } from 'framer-motion'
import { ShieldAlert, ShieldHalf, Flag, Timer, Zap, Gauge, RotateCcw, Info, RefreshCw } from 'lucide-react'
import { formatLapTime } from '@/lib/ist'
import { useApi } from '@/lib/api/client'
import { SEASON } from '@/lib/api/hooks'
import { useSeason } from '@/lib/season'

interface SeasonStats {
  safety_cars: number
  virtual_safety_cars: number
  red_flags: number
  yellow_flags: number
  total_pit_stops: number
  fastest_pit_stop: { driver: string; team: string; time_ms: number; round: number } | null
  fastest_lap: { driver: string; team: string; time: number; circuit: string; round: number } | null
  longest_stint: { driver: string; compound: string; laps: number; circuit: string; round: number } | null
  rounds_complete: number
  total_rounds: number
}

/* ---------- KPI tile ---------- */
function KpiTile({ icon, label, value, sub, accent, delay = 0 }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; accent?: string; delay?: number
}) {
  return (
    <motion.div
      className="glass-card"
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      style={{ padding: '16px 18px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', color: accent || 'var(--muted)' }}>{icon}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      </div>
      <div className="stat-num" style={{ fontSize: 26, color: 'var(--foreground)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{sub}</div>}
    </motion.div>
  )
}

/* ---------- Season record panel ---------- */
function RecordPanel({ icon, title, accent, value, valueColor, context, featured, delay = 0 }: {
  icon: React.ReactNode; title: string; accent: string; value: React.ReactNode; valueColor: string
  context: string; featured?: boolean; delay?: number
}) {
  return (
    <motion.div
      className={featured ? 'featured-card' : 'glass-card'}
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      style={{ padding: 22 }}
    >
      <h2 className="section-title" style={{ marginBottom: 14, ['--bar' as string]: accent }}>
        <span style={{ display: 'inline-flex', color: accent }}>{icon}</span>
        {title}
      </h2>
      <div className="stat-num" style={{ fontSize: 38, color: valueColor, lineHeight: 1 }}>{value}</div>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: '14px 0 0', maxWidth: 480 }}>{context}</p>
    </motion.div>
  )
}

function SeasonStatsView({ year }: { year: number }) {
  const { data: stats, isLoading, mutate: load } = useApi<SeasonStats>(`/api/season-stats/?year=${year}`, { keepPreviousData: false })
  const loading = isLoading && !stats

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px', position: 'relative', zIndex: 1 }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>{year} Season</div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>Season Statistics</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 620 }}>
            Incidents, pit work and headline records aggregated across every completed round of {year}.
          </p>
        </div>
        {stats && (
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="glass-card" style={{ padding: '10px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Rounds Complete</div>
              <div className="stat-num" style={{ fontSize: 18, marginTop: 4 }}>{stats.rounds_complete} / {stats.total_rounds}</div>
            </div>
          </div>
        )}
      </motion.div>

      {loading ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            Aggregating the {year} season… the first load of a season can take a minute.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="shimmer" style={{ height: 96, borderRadius: 2 }} />)}
          </div>
        </>
      ) : !stats ? (
        <div className="glass-card" style={{ padding: '48px 24px', textAlign: 'center', borderLeft: '2px solid var(--accent)' }}>
          <Info size={22} style={{ color: 'var(--accent)', marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Couldn&apos;t load season stats</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>The server may still be waking up.</div>
          <button
            onClick={() => load()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
              background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 2,
              padding: '8px 16px', fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
              fontFamily: 'var(--font-display)',
            }}
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : (
        <>
          {/* Race incidents + pit stops — one KPI grid */}
          <h2 className="section-title" style={{ marginBottom: 12 }}>Incidents &amp; Pit Work</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 28 }}>
            <KpiTile icon={<ShieldAlert size={13} />} label="Safety Cars" value={stats.safety_cars} accent="var(--amber)" delay={0} />
            <KpiTile icon={<ShieldHalf size={13} />} label="Virtual Safety Cars" value={stats.virtual_safety_cars} accent="var(--sector-yellow)" delay={0.03} />
            <KpiTile icon={<Flag size={13} />} label="Red Flags" value={stats.red_flags} accent="var(--accent)" delay={0.06} />
            <KpiTile icon={<Flag size={13} />} label="Yellow Flags" value={stats.yellow_flags} accent="var(--sector-yellow)" delay={0.09} />
            <KpiTile icon={<Timer size={13} />} label="Total Pit Stops" value={stats.total_pit_stops} delay={0.12} />
            {stats.fastest_pit_stop && (
              <KpiTile
                icon={<Zap size={13} />} label="Fastest Pit Stop"
                value={`${(stats.fastest_pit_stop.time_ms / 1000).toFixed(3)}s`}
                sub={`${stats.fastest_pit_stop.driver} · ${stats.fastest_pit_stop.team} · R${stats.fastest_pit_stop.round}`}
                accent="var(--sector-green)" delay={0.15}
              />
            )}
          </div>

          {/* Records (main) + regulations (rail) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }} className="live-grid">
            <div style={{ display: 'grid', gap: 16 }}>
              <h2 className="section-title">Season Records</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                {stats.fastest_lap && (
                  <RecordPanel
                    icon={<Gauge size={14} />} title="Fastest Lap of Season" accent="var(--sector-purple)"
                    value={formatLapTime(stats.fastest_lap.time)} valueColor="var(--sector-purple)"
                    context={`Set by ${stats.fastest_lap.driver} (${stats.fastest_lap.team}) at ${stats.fastest_lap.circuit}, round ${stats.fastest_lap.round} — the single quickest lap posted anywhere in ${year}${year === SEASON ? ', under the 2026 AoA-enabled aero rules' : ''}.`}
                    featured delay={0.05}
                  />
                )}
                {stats.longest_stint && (
                  <RecordPanel
                    icon={<RotateCcw size={14} />} title="Longest Tyre Stint" accent="var(--sector-green)"
                    value={`${stats.longest_stint.laps} laps`} valueColor="var(--sector-green)"
                    context={`${stats.longest_stint.driver} ran ${stats.longest_stint.laps} laps on ${stats.longest_stint.compound.toLowerCase()} tyres at ${stats.longest_stint.circuit}, round ${stats.longest_stint.round} — the longest single stint before a mandatory pit stop this season.`}
                    delay={0.1}
                  />
                )}
                {!stats.fastest_lap && !stats.longest_stint && (
                  <div className="glass-card" style={{ padding: '32px 20px', textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
                    No records yet — check back once more rounds are complete.
                  </div>
                )}
              </div>
            </div>

            {/* Rail */}
            <div style={{ display: 'grid', gap: 16 }}>
              {/* The regulation notes describe the 2026 reset specifically, so
                  they are wrong for any earlier season — show them only there. */}
              {year === SEASON && (
                <div className="glass-card" style={{ padding: 18, ['--bar' as string]: 'var(--accent)' }}>
                  <h2 className="section-title" style={{ marginBottom: 12 }}>
                    <Info size={13} /> {SEASON} Regulations
                  </h2>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.9 }}>
                    <li><span style={{ color: 'var(--foreground)', fontWeight: 600 }}>Active Aero Override (AoA)</span> replaces DRS as the overtaking aid.</li>
                    <li><span style={{ color: 'var(--foreground)', fontWeight: 600 }}>Hybrid power units</span> move to a 50/50 electric-ICE split.</li>
                    <li><span style={{ color: 'var(--foreground)', fontWeight: 600 }}>11 teams</span> on the grid, with Cadillac joining as a new constructor.</li>
                    <li>Lap records set before this reset are flagged separately — they were run under the old aero package.</li>
                  </ul>
                </div>
              )}

              <div className="glass-card" style={{ padding: 18 }}>
                <h2 className="section-title" style={{ marginBottom: 10 }}>How this is calculated</h2>
                <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, margin: 0 }}>
                  Figures are aggregated from FastF1 session data across every completed {year} round — race control
                  messages for flags and safety cars, pit-lane timing loops for stops, and lap/stint data for the
                  season records above. Totals update as new rounds finish.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function SeasonStatsPage() {
  const [season] = useSeason()
  return <SeasonStatsView key={season} year={season} />
}
