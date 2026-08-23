'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useApi } from '@/lib/api/client'
import { getTeamInfo, getTeamVideo } from '@/lib/teamInfo'
import { FlipFadeText } from '@/components/ui/flip-fade-text'
import CountUp from '@/components/ui/CountUp'
import type { Team } from '@/lib/types'

export default function TeamPage() {
  const params = useParams()
  const teamId = params.teamId as string

  // The router reuses this component across /teams/:id navigations. The
  // endpoint fuzzy-matches team names to ids, so the response's own `.id`
  // isn't a reliable "is this stale?" check the way it is elsewhere — instead
  // we simply don't look at `data` while `isLoading` is true for the current
  // teamId, which is what keeps SWR's keepPreviousData from painting the
  // previous team as this one while the new fetch is in flight.
  const { data: teamRaw, isLoading } = useApi<Team>(teamId ? `/api/teams/${teamId}` : null)
  const team = isLoading ? null : (teamRaw ?? null)
  const loading = isLoading

  if (loading) {
    return (
      <div style={{ padding: '80px 16px' }}>
        <FlipFadeText
          words={['LOADING', 'COMPUTING', 'RETRIEVING']}
          interval={1500}
          textClassName="text-2xl font-bold tracking-[0.25em] text-white/80"
        />
      </div>
    )
  }
  if (!team) return (
    <div style={{ textAlign: 'center', padding: '80px', color: '#9CA3AF' }}>
      Team not found · <Link href="/teams" style={{ color: '#E10600' }}>Back to teams</Link>
    </div>
  )

  const teamColor = `#${team.color?.replace('#', '') || '555'}`
  const info = getTeamInfo(team.id)
  const video = getTeamVideo(team.id)

  const honours = [
    { label: "Constructors' Titles", value: info ? info.wcc : team.championships, color: '#FFD700' },
    { label: "Drivers' Titles", value: info ? info.wdc : '—', color: '#FFD700' },
    { label: 'Race Wins', value: info ? info.raceWins : '—', color: '#00D131' },
    { label: 'Pole Positions', value: info ? info.poles : '—', color: '#BF00FF' },
  ]

  return (
    <>
      {/* Team video background (currently Red Bull only) */}
      {video && (
        <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <video autoPlay muted loop playsInline preload="auto" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}>
            <source src={video} type="video/mp4" />
          </video>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(8,8,10,0.5) 0%, rgba(8,8,10,0.7) 55%, rgba(8,8,10,0.92) 100%)' }} />
          <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(110% 90% at 80% 0%, ${teamColor}44 0%, transparent 55%)`, mixBlendMode: 'soft-light' }} />
        </div>
      )}

      <div style={{ position: 'relative', zIndex: 1, maxWidth: '1100px', margin: '0 auto', padding: '32px 16px' }}>
        <Link href="/teams" style={{ fontSize: '12px', color: '#cbd5e1', textDecoration: 'none', display: 'inline-block', marginBottom: '16px' }}>← All teams</Link>

        {/* Header */}
        <div className="glass-strong rise-in" style={{ padding: '32px', marginBottom: '20px', borderTop: `4px solid ${teamColor}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <div className="kicker" style={{ color: teamColor, marginBottom: '10px' }}>Constructor</div>
              <h1
                className="display-title"
                style={{
                  fontSize: 'clamp(30px, 4.6vw, 52px)',
                  margin: '0 0 8px',
                  background: `linear-gradient(105deg, #ffffff 40%, ${teamColor} 110%)`,
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'transparent',
                  filter: 'drop-shadow(0 3px 14px rgba(0,0,0,0.55))',
                }}
              >
                {team.full_name || team.name}
              </h1>
              <div className="font-display" style={{ fontSize: '13px', color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{team.nationality} · {info?.founded || `Est. ${team.first_entry}`}</div>
            </div>
            {(info ? info.wcc : team.championships) > 0 && (
              <span className="font-display" style={{ background: 'rgba(255,215,0,0.14)', border: '1px solid rgba(255,215,0,0.3)', color: '#FFD700', fontSize: '13px', padding: '8px 16px', borderRadius: '999px', fontWeight: 700, backdropFilter: 'blur(6px)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {info ? info.wcc : team.championships}× World Constructor Champion
              </span>
            )}
          </div>

          {team.note && (
            <div style={{ marginTop: '16px', background: 'rgba(255,128,0,0.1)', border: '1px solid rgba(255,128,0,0.25)', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#FF8000' }}>
              {team.note}
            </div>
          )}
        </div>

        {/* Honours */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          {honours.map(h => (
            <div key={h.label} className="glass-card" style={{ padding: '16px 18px' }}>
              <div className="kicker" style={{ color: '#9CA3AF', fontSize: '10px', letterSpacing: '0.14em' }}>{h.label}</div>
              {typeof h.value === 'number' ? (
                <CountUp value={h.value} className="stat-num" style={{ display: 'block', fontSize: '32px', color: h.color, marginTop: '6px' }} />
              ) : (
                <div className="stat-num" style={{ fontSize: '32px', color: h.color, marginTop: '6px' }}>{h.value}</div>
              )}
            </div>
          ))}
        </div>

        {/* History */}
        {info && (
          <div className="glass-card" style={{ padding: '24px', marginBottom: '20px' }}>
            <h2 className="section-title" style={{ ['--bar' as string]: teamColor, marginBottom: '14px' } as React.CSSProperties}>History</h2>
            <p style={{ fontSize: '14px', lineHeight: 1.7, color: '#e2e8f0', margin: 0 }}>{info.history}</p>
            {info.principal && (
              <div style={{ marginTop: '16px', fontSize: '13px', color: '#cbd5e1' }}>
                <span style={{ color: '#9CA3AF' }}>Team Principal · </span>
                <span style={{ fontWeight: 600 }}>{info.principal}</span>
              </div>
            )}
          </div>
        )}

        {/* Details + notable drivers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', marginBottom: '20px' }}>
          <div className="glass-card" style={{ padding: '22px' }}>
            <h2 className="section-title" style={{ ['--bar' as string]: teamColor, marginBottom: '14px' } as React.CSSProperties}>Constructor Info</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
              {[
                { label: 'Base / HQ', value: team.base },
                { label: 'Chassis', value: team.chassis },
                { label: 'Power Unit', value: team.power_unit },
                { label: 'First Entry', value: info?.founded || team.first_entry },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <span style={{ color: '#9CA3AF', flexShrink: 0 }}>{item.label}</span>
                  <span style={{ fontWeight: 600, textAlign: 'right' }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {info && info.notableDrivers.length > 0 && info.notableDrivers[0] !== '—' && (
            <div className="glass-card" style={{ padding: '22px' }}>
              <h2 className="section-title" style={{ ['--bar' as string]: teamColor, marginBottom: '14px' } as React.CSSProperties}>Notable Drivers</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {info.notableDrivers.map(d => (
                  <span key={d} style={{ fontSize: '12px', fontWeight: 600, background: `${teamColor}22`, border: `1px solid ${teamColor}55`, color: '#fff', padding: '6px 12px', borderRadius: '999px' }}>
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 2026 regulations */}
        <div className="glass-card" style={{ padding: '22px', marginBottom: '20px' }}>
          <h2 className="section-title" style={{ ['--bar' as string]: teamColor, marginBottom: '14px' } as React.CSSProperties}>2026 Regulations</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px', color: '#9CA3AF' }}>
            <div>Power Unit: <span style={{ color: '#fff' }}>Hybrid Electric-ICE (50/50 split)</span></div>
            <div>Active Aero: <span style={{ color: '#00D131' }}>AoA (replaces DRS)</span></div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', lineHeight: 1.5 }}>
              Battery SoC not available in public F1 data. AoA activation status available via telemetry.
            </div>
          </div>
        </div>

        {/* Team identity */}
        <div className="glass-card" style={{ padding: '22px' }}>
          <h2 className="section-title" style={{ ['--bar' as string]: teamColor, marginBottom: '14px' } as React.CSSProperties}>Team Identity</h2>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '10px', background: teamColor }} title={teamColor} />
            {team.color_secondary && (
              <div style={{ width: '48px', height: '48px', borderRadius: '10px', background: `#${team.color_secondary?.replace('#', '')}` }} title={team.color_secondary} />
            )}
            <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
              Primary: {teamColor}<br />
              {team.color_secondary && `Secondary: #${team.color_secondary?.replace('#', '')}`}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
