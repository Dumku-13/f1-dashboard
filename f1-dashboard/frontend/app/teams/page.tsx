'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ShieldAlert } from 'lucide-react'
import { SkeletonCard } from '@/components/shared/LoadingSkeleton'
import { useTeams } from '@/lib/api/hooks'
import type { Team } from '@/lib/types'

function HeaderStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass-card" style={{ padding: '10px 18px' }}>
      <div className="kicker" style={{ fontSize: '10px' }}>{label}</div>
      <div className="stat-num" style={{ fontSize: '22px', marginTop: '4px' }}>{value}</div>
    </div>
  )
}

function TeamCard({ team, index }: { team: Team; index: number }) {
  const color = `#${team.color?.replace('#', '') || '555'}`

  const specs = [
    { label: 'Base', value: team.base },
    { label: 'Chassis', value: team.chassis },
    { label: 'Power Unit', value: team.power_unit },
    { label: 'First Entry', value: team.first_entry },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.5) }}
    >
      <Link href={`/teams/${team.id}`} style={{ textDecoration: 'none' }}>
        <div
          className="glass-card glass-card-hover"
          style={{ padding: '18px 20px', borderTop: `3px solid ${color}`, cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ width: '4px', height: '30px', background: color, flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div className="font-display" style={{ fontSize: 17, fontWeight: 700, fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '0.01em' }}>
                  {team.name}
                </div>
                <div className="kicker" style={{ fontSize: 9, marginTop: 4 }}>{team.nationality}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div className="stat-num" style={{ fontSize: 34, color: team.championships > 0 ? 'var(--amber)' : 'var(--muted)', lineHeight: 1 }}>
                {team.championships || 0}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)', marginTop: 4 }}>
                WCC Titles
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
            {specs.map(s => (
              <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: 'var(--muted)' }}>{s.label}</span>
                <span className={typeof s.value === 'number' ? 'font-num' : ''} style={{ fontWeight: 600, textAlign: 'right' }}>{s.value}</span>
              </div>
            ))}
          </div>

          {team.note && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--amber)', background: 'rgba(255,200,0,0.08)', border: '1px solid rgba(255,200,0,0.22)', borderRadius: 2, padding: '7px 10px' }}>
              {team.note}
            </div>
          )}
        </div>
      </Link>
    </motion.div>
  )
}

export default function TeamsPage() {
  const { data: teams, isLoading } = useTeams()
  const loading = isLoading && teams.length === 0

  const totalTitles = teams.reduce((sum, t) => sum + (t.championships || 0), 0)
  const powerUnits = new Set(teams.map(t => t.power_unit).filter(Boolean)).size

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>2026 Season</div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>Teams</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 620 }}>
            Every constructor entry — chassis, power unit and championship pedigree for the grid.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <HeaderStat label="Entries" value={teams.length || '—'} />
          <HeaderStat label="Titles" value={totalTitles} />
          <HeaderStat label="Power Units" value={powerUnits || '—'} />
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 14 }}>
          {Array.from({ length: 11 }).map((_, i) => (
            <SkeletonCard key={i} height="192px" />
          ))}
        </div>
      ) : teams.length === 0 ? (
        <div className="glass-card" style={{ padding: '48px', textAlign: 'center' }}>
          <ShieldAlert size={22} style={{ color: 'var(--muted)', marginBottom: 10 }} />
          <h2 className="section-title" style={{ justifyContent: 'center', marginBottom: 6 }}>No teams available</h2>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Constructor data could not be loaded right now.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 14 }}>
          {teams.map((team, i) => (
            <TeamCard key={team.id} team={team} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
