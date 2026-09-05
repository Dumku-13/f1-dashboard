'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useSeason } from '@/lib/season'
import Link from 'next/link'
import { BACKEND_URL } from '@/lib/constants'
import { TEAM_COLORS } from '@/lib/constants'
import { isClassifiedFinish } from '@/lib/utils'
import { getDriverTheme } from '@/lib/driverAssets'
import { FlipFadeText } from '@/components/ui/flip-fade-text'
import CountUp from '@/components/ui/CountUp'
import { logPulse } from '@/lib/pulse'
import { useStandings } from '@/lib/api/hooks'

interface DriverSeasonResult {
  round: number
  race_name: string
  grid_position: number | null
  finish_position: number | null
  points: number
  fastest_lap: boolean
  status: string
}

interface DriverCareer {
  wins: number
  podiums: number
  poles: number
  championships: number
  seasons: number
  first_season: number
}

interface DriverInfo {
  full_name: string
  abbreviation: string
  driver_number: number
  team: string
  nationality: string
}

export default function DriverProfilePage() {
  const params = useParams()
  // Follow the season picker — /drivers is picker-driven, so a 2024 card must
  // open a 2024 profile, not a 2026 one.
  const [season] = useSeason()
  const driverNum = params.driverNum as string

  const [info, setInfo] = useState<DriverInfo | null>(null)
  const [seasonResults, setSeasonResults] = useState<DriverSeasonResult[]>([])
  const [career, setCareer] = useState<DriverCareer | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'season' | 'career'>('season')

  useEffect(() => {
    // The season store hydrates from localStorage after mount, so this effect
    // runs once for the SSR season and again for the real one. Without this
    // guard the first (wrong-year) responses can resolve last and overwrite
    // the correct ones — which showed Perez on his 2026 team with 0 points
    // while viewing 2024.
    let cancelled = false
    setLoading(true)

    // Career is fetched alongside but NOT waited on. It comes from Jolpica,
    // which is queried serially with retries and is the slowest of the three by
    // a wide margin — gating the page on it meant the whole profile sat on
    // "Retrieving" while the name, photo, championship position and points were
    // already in hand. It settles into its own tab when it arrives.
    Promise.all([
      fetch(`${BACKEND_URL}/api/drivers/?year=${season}`).then(r => r.ok ? r.json() : []),
      fetch(`${BACKEND_URL}/api/drivers/${driverNum}/season/${season}`).then(r => r.ok ? r.json() : []),
    ]).then(([allDrivers, seasonData]) => {
      if (cancelled) return
      const driver = Array.isArray(allDrivers) ? allDrivers.find((d: DriverInfo) => String(d.driver_number) === driverNum) : null
      setInfo(driver || null)
      setSeasonResults(Array.isArray(seasonData) ? seasonData : [])
      setLoading(false)
      if (driver?.abbreviation) logPulse('view', driver.abbreviation)
    }).catch(() => { if (!cancelled) setLoading(false) })

    setCareer(null)
    fetch(`${BACKEND_URL}/api/drivers/${driverNum}/career`)
      .then(r => (r.ok ? r.json() : null))
      .then(careerData => { if (!cancelled) setCareer(careerData) })
      .catch(() => { /* the Career tab shows its own empty state */ })

    return () => { cancelled = true }
  }, [driverNum, season])

  const winsSeason = seasonResults.filter(r => r.finish_position === 1).length
  const podiumsSeason = seasonResults.filter(r => r.finish_position !== null && r.finish_position <= 3).length
  const pointsSeason = seasonResults.reduce((sum, r) => sum + (r.points || 0), 0)
  const fastestLapsSeason = seasonResults.filter(r => r.fastest_lap).length
  // A DNF is the complement of a classified finish. Spelling out the
  // retirement cases missed "Lapped", which counted most of the field's
  // lapped-but-classified runners as retirements.
  const dnfsSeason = seasonResults.filter(r => r.status && !isClassifiedFinish(r.status)).length

  const theme = getDriverTheme(info?.full_name)
  const accent = theme?.accent || TEAM_COLORS[info?.team || ''] || '#E10600'

  /**
   * Championship position — the number the spec puts at hero scale, and the one
   * this page never showed. Taken from the standings rather than counted here:
   * position depends on the whole grid, not on one driver's results.
   */
  const { data: standings } = useStandings(season)
  const standing = standings?.drivers?.find(d => d.abbreviation === info?.abbreviation) ?? null

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
  if (!info) return (
    <div style={{ textAlign: 'center', padding: '80px', color: '#9CA3AF' }}>
      Driver #{driverNum} not found · <Link href="/drivers" style={{ color: '#E10600' }}>Back to drivers</Link>
    </div>
  )

  return (
    <>
      {/* Per-driver themed background (only for drivers with a photo) */}
      {theme && (
        <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url(${theme.image})`,
              backgroundSize: 'cover',
              backgroundPosition: 'top center',
            }}
          />
          {/* Moderate darkening — driver stays clearly visible */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(8,8,10,0.45) 0%, rgba(8,8,10,0.68) 55%, rgba(8,8,10,0.92) 100%)' }} />
          {/* Team-color wash */}
          <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(110% 90% at 80% 0%, ${theme.gradient[0]}55 0%, transparent 55%), linear-gradient(to top, ${theme.gradient[1]}cc 0%, transparent 60%)`, mixBlendMode: 'soft-light' }} />
        </div>
      )}

      <div
        className="dr-env"
        data-tab={tab}
        style={{ position: 'relative', zIndex: 1, maxWidth: '1100px', margin: '0 auto', padding: '32px 16px', '--accent': accent } as React.CSSProperties}
      >
        <Link href="/drivers" style={{ fontSize: '12px', color: '#cbd5e1', textDecoration: 'none', display: 'inline-block', marginBottom: '16px' }}>← All drivers</Link>

        {/* ---- Hero. The spec asks for the name, a huge championship position
             and a huge points total. The page previously showed neither — the
             92px number was the car number, which tells you nothing about how
             the season is going. Standing and points now carry the scale, and
             the car number drops back to a watermark. ---- */}
        <header className="dr-hero rise-in" style={{ '--accent': accent } as React.CSSProperties}>
          <span className="dr-num" aria-hidden="true">{info.driver_number}</span>

          <div className="dr-hero-body">
            <p className="kicker">{info.nationality} · {info.team}</p>
            <h1 className="display-title dr-name">{info.full_name}</h1>

            <div className="dr-headline">
              <span className="dr-standing">
                <span className="dr-standing-val">
                  {standing ? `P${standing.position}` : '—'}
                </span>
                <span className="dr-standing-lab">{season} championship</span>
              </span>
              <span className="dr-standing">
                <CountUp value={pointsSeason} className="dr-standing-val" />
                <span className="dr-standing-lab">Points</span>
              </span>
            </div>
          </div>
        </header>

        {/* Secondary season numbers — deliberately smaller than the two above. */}
        <div className="dr-stats">
          {[
            { label: 'Wins', value: winsSeason },
            { label: 'Podiums', value: podiumsSeason },
            { label: 'Fastest laps', value: fastestLapsSeason },
            { label: 'DNFs', value: dnfsSeason },
          ].map(s => (
            <div key={s.label}>
              <span className="dr-stat-lab">{s.label}</span>
              <CountUp value={s.value} className="dr-stat-val" />
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="glass-panel" style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderRadius: '10px', padding: '4px', width: 'fit-content' }}>
          {(['season', 'career'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '7px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
              background: tab === t ? accent : 'transparent',
              color: tab === t ? '#fff' : '#cbd5e1',
              transition: 'all 0.15s',
            }}>
              {t === 'season' ? `${season} Season` : 'Career'}
            </button>
          ))}
        </div>

        {tab === 'season' ? (
          seasonResults.length === 0 ? (
            <div className="glass-card" style={{ textAlign: 'center', padding: '40px', color: '#9CA3AF' }}>No {season} season results yet</div>
          ) : (
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="f1-table">
                  <thead>
                    <tr><th>R</th><th>RACE</th><th>GRID</th><th>RESULT</th><th>PTS</th><th>STATUS</th></tr>
                  </thead>
                  <tbody>
                    {seasonResults.map(r => (
                      <tr key={r.round}>
                        <td style={{ fontFamily: "'Space Grotesk', monospace", color: '#9CA3AF', fontWeight: 600 }}>{r.round}</td>
                        <td>
                          <Link href={`/race/${r.round}/race`} style={{ color: '#fff', textDecoration: 'none', fontWeight: 600 }}>
                            {r.race_name}
                          </Link>
                        </td>
                        <td style={{ fontFamily: "'Space Grotesk', monospace", color: '#9CA3AF' }}>{r.grid_position ?? '—'}</td>
                        <td style={{ fontFamily: "'Space Grotesk', monospace", fontWeight: 700, color: r.finish_position === 1 ? '#FFD700' : r.finish_position && r.finish_position <= 3 ? '#cbd5e1' : '#fff' }}>
                          {r.finish_position ? `P${r.finish_position}` : '—'}
                          {r.fastest_lap && <span style={{ fontSize: '9px', background: 'rgba(191,0,255,0.2)', color: '#BF00FF', padding: '1px 5px', borderRadius: '4px', marginLeft: '4px' }}>FL</span>}
                        </td>
                        <td style={{ fontFamily: "'Space Grotesk', monospace", fontWeight: 600 }}>{r.points ?? '—'}</td>
                        <td style={{ fontSize: '12px', color: r.status === 'Finished' ? '#00D131' : r.status?.includes('Ret') ? '#E10600' : '#9CA3AF' }}>
                          {r.status || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : (
          <div>
            {career ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
                {[
                  { label: 'Championships', value: career.championships, color: '#FFD700' },
                  { label: 'Race Wins', value: career.wins, color: '#00D131' },
                  { label: 'Podiums', value: career.podiums, color: '#cbd5e1' },
                  { label: 'Pole Positions', value: career.poles, color: '#BF00FF' },
                  { label: 'Seasons', value: career.seasons, color: '#fff' },
                ].map(s => (
                  <div key={s.label} className="glass-card" style={{ padding: '18px' }}>
                    <div style={{ fontSize: '10px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
                    <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: '28px', fontWeight: 700, color: s.color, marginTop: '6px' }}>{s.value}</div>
                    {s.label === 'Seasons' && career.first_season && (
                      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>Since {career.first_season}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass-card" style={{ textAlign: 'center', padding: '40px', color: '#9CA3AF' }}>Career stats loading… (Ergast API)</div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
