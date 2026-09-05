'use client'

import { useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import Greeting from '@/components/home/Greeting'
import CountdownTimer from '@/components/home/CountdownTimer'
import VideoBackground from '@/components/home/VideoBackground'
import { motion } from 'framer-motion'
import { CalendarDays, Trophy, Users, Car, BarChart3, LineChart, Gauge, History, Radio, MessagesSquare, Swords, Gamepad2, Target, CircleUser, Crosshair, ChevronRight } from 'lucide-react'
// Statically imported on purpose: DriverPulse owns the /api/popularity/index
// request, and code-splitting it pushed that fetch behind its own chunk load
// (measured: request start moved 749ms -> 1192ms). Its own weight is trivial.
import DriverPulse from '@/components/home/DriverPulse'
import { useLiveStatus } from '@/lib/live'
import { useCalendar, useStandings, SEASON } from '@/lib/api/hooks'
import { useApiList } from '@/lib/api/client'
import type { Standings, CalendarEvent } from '@/lib/types'

/* ---------------------------------------------------------------------------
   Below-the-fold panels are code-split.

   Everything here used to sit in the landing page's first bundle, so the
   browser had to parse the standings tables, the season index, the pulse strip
   and a WebGL shader library before React could hydrate and fire the very first
   API request (~0.6-0.75s of dead time on a warm dev server). None of it is
   needed to paint the hero, and the standings tabs only ever show one of the
   two tables at a time — so each one loads on demand, in parallel with the data
   it is waiting for, behind its own `.shimmer` skeleton.
   --------------------------------------------------------------------------- */

const SkeletonRows = ({ rows = 8 }: { rows?: number }) => (
  <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="shimmer" style={{ height: '28px', borderRadius: '6px' }} />
    ))}
  </div>
)

const DriverStandingsTable = dynamic(() => import('@/components/standings/DriverStandingsTable'), {
  ssr: false,
  loading: () => <SkeletonRows rows={10} />,
})
const ConstructorStandingsTable = dynamic(() => import('@/components/standings/ConstructorStandingsTable'), {
  ssr: false,
  loading: () => <SkeletonRows rows={11} />,
})
const DriverIndex = dynamic(() => import('@/components/standings/DriverIndex'), {
  ssr: false,
  loading: () => <div className="glass-card shimmer" style={{ height: '260px' }} />,
})
// Pulls in @paper-design/shaders-react (WebGL) for one decorative button.
const LiquidMetalButton = dynamic(
  () => import('@/components/ui/liquid-metal').then(m => m.LiquidMetalButton),
  { ssr: false, loading: () => <div className="shimmer" style={{ height: '34px', width: '150px', borderRadius: '8px' }} /> },
)

function LiveBanner() {
  const { live, session } = useLiveStatus()
  const router = useRouter()
  if (!live) return null

  return (
    <motion.button
      initial={{ opacity: 0, y: -14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      onClick={() => router.push('/live')}
      className="featured-card"
      style={{
        width: '100%', padding: '18px 24px', marginBottom: '18px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: '16px', textAlign: 'left', border: 'none',
      }}
    >
      <span className="live-dot" style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#00D131', boxShadow: '0 0 14px #00D131', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="font-display" style={{ fontWeight: 900, fontSize: '18px', color: '#fff', letterSpacing: '0.02em' }}>
          LIVE NOW — {session?.country_name} {session?.session_name}
        </div>
        <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>
          Live timing tower, gaps, laps, tyres and race control — updating every 4 seconds.
        </div>
      </div>
      <span className="font-display" style={{ color: '#00D131', fontWeight: 800, fontSize: '14px', flexShrink: 0 }}>WATCH →</span>
    </motion.button>
  )
}

function NextSessionBanner({ calendar, calendarLoading }: { calendar: CalendarEvent[]; calendarLoading: boolean }) {
  const router = useRouter()
  const now = Date.now()
  const upcoming = calendar
    .filter(ev => new Date(ev.event_date).getTime() > now)
    .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
  const next = upcoming[0]
  if (!next) {
    // Hold the slot with a skeleton while the calendar is in flight — the row
    // used to render nothing at all and then shove the rest of the page down.
    if (!calendarLoading) return null
    return (
      <div className="glass-card" style={{ padding: '22px 24px', borderLeft: '3px solid #E10600', height: '100%' }}>
        <div style={{ fontSize: '11px', color: '#9CA3AF', letterSpacing: '0.14em', marginBottom: '10px' }}>NEXT RACE WEEKEND</div>
        <div className="shimmer" style={{ height: '23px', width: '70%', borderRadius: '6px', marginBottom: '10px' }} />
        <div className="shimmer" style={{ height: '13px', width: '45%', borderRadius: '4px' }} />
        <div className="shimmer" style={{ height: '58px', borderRadius: '10px', marginTop: '18px' }} />
      </div>
    )
  }

  const sessions = Object.entries(next.sessions || {}).filter((entry): entry is [string, string] => {
    const d = entry[1]
    return !!d && new Date(d).getTime() > now
  })
  const nextSession = sessions.sort(([, a], [, b]) => new Date(a).getTime() - new Date(b).getTime())[0]

  return (
    <div className="glass-card" style={{ padding: '22px 24px', borderLeft: '3px solid #E10600', height: '100%' }}>
      <div style={{ fontSize: '11px', color: '#9CA3AF', letterSpacing: '0.14em', marginBottom: '10px' }}>NEXT RACE WEEKEND</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ fontSize: '23px', fontWeight: 700 }}>Round {next.round} — {next.name}</div>
          <div style={{ color: '#9CA3AF', fontSize: '13px', marginTop: '4px' }}>{next.country} · {next.location}</div>
          {next.is_sprint && (
            <span style={{ display: 'inline-block', marginTop: '8px', background: 'rgba(255,128,0,0.2)', color: '#FF8000', fontSize: '10px', padding: '2px 8px', borderRadius: '10px', fontWeight: 700, letterSpacing: '0.05em' }}>SPRINT WEEKEND</span>
          )}
        </div>
        <LiquidMetalButton
          size="sm"
          onClick={() => router.push(`/race/${next.round}`)}
          metalConfig={{ colorBack: '#7a1010', colorTint: '#ffb3b3', speed: 0.4 }}
        >
          Weekend Hub →
        </LiquidMetalButton>
      </div>
      {nextSession && (
        <div style={{ marginTop: '18px' }}>
          <CountdownTimer targetUTC={nextSession[1]} label={`NEXT SESSION — ${nextSession[0]}`} sessionName={next.name} />
        </div>
      )}
    </div>
  )
}

function RecentResults({ calendar, standings, calendarLoading }: { calendar: CalendarEvent[]; standings?: Standings; calendarLoading: boolean }) {
  const now = Date.now()
  const past = calendar
    .filter(ev => new Date(ev.event_date).getTime() <= now)
    .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime())
  const lastRace = past[0]

  // This request used to be strictly serialised behind the calendar — it could
  // not start until /sessions/calendar had returned and named the round, which
  // cost a whole extra round-trip on top of an already-slow first paint.
  // /standings is fired at the same instant and carries the same round number
  // in `rounds`, so whichever of the two answers first now unblocks the podium.
  const lastScored = (standings?.rounds || []).filter(r => r.status === 'complete').slice(-1)[0]
  const round = lastRace?.round ?? lastScored?.round ?? null
  const year = lastRace ? new Date(lastRace.event_date).getFullYear() : SEASON

  // Deduped + cached via SWR; `null` key means "don't fetch yet" while neither
  // source has told us which race was last.
  const {
    data: rows,
    error: rowsError,
    isLoading: rowsLoading,
    mutate: retryPodium,
  } = useApiList<any>(
    round != null ? `/api/sessions/${year}/${round}/R/results` : null,
    { shouldRetryOnError: true, errorRetryCount: 3, errorRetryInterval: 1500 },
  )
  const failed = !!rowsError || (!rowsLoading && round != null && rows.length === 0)

  // While the calendar is in flight, keep the panel (and its podium, which may
  // already have arrived via the standings fallback) on screen instead of
  // popping the whole row in late. Once the calendar has answered it is the
  // sole source of truth — no past races means no panel, as before.
  if (!lastRace && !calendarLoading) return null
  // time_s is total race time for the winner, gap-to-winner for everyone else
  const podium = rows
    .filter((r: any) => r.position && r.position <= 3)
    .sort((a: any, b: any) => a.position - b.position)

  return (
    <div className="glass-card" style={{ padding: '22px 24px', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        {lastRace ? (
          <div style={{ fontSize: '11px', color: '#9CA3AF', letterSpacing: '0.14em' }}>LAST RACE — {lastRace.name.toUpperCase()}</div>
        ) : (
          <div className="shimmer" style={{ height: '11px', width: '180px', borderRadius: '4px' }} />
        )}
        {lastRace && (
          <Link href={`/race/${lastRace.round}/race`} style={{ fontSize: '12px', color: '#9CA3AF', textDecoration: 'none' }}>Full results →</Link>
        )}
      </div>
      {podium.length > 0 ? (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {podium.map((r: any) => (
            <div key={r.position} style={{
              flex: '1', minWidth: '120px',
              background: r.position === 1 ? 'rgba(255,215,0,0.08)' : 'rgba(255,255,255,0.04)',
              border: r.position === 1 ? '1px solid rgba(255,215,0,0.25)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: '12px', padding: '14px 16px',
            }}>
              <div style={{ fontSize: '20px', marginBottom: '4px' }}>
                {r.position === 1 ? '🥇' : r.position === 2 ? '🥈' : '🥉'}
              </div>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>{r.abbreviation}</div>
              <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '2px' }}>{r.team}</div>
              {r.time_s != null && (
                <div style={{ fontSize: '11px', fontFamily: "'Space Grotesk', monospace", color: '#9CA3AF', marginTop: '4px' }}>
                  {r.position === 1 ? '🏆 Winner' : `+${r.time_s.toFixed(3)}s`}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : failed ? (
        <div style={{ minHeight: '80px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '8px' }}>
          <div style={{ fontSize: '13px', color: '#9CA3AF' }}>Results aren&apos;t available yet.</div>
          <button
            onClick={() => retryPodium()}
            style={{
              alignSelf: 'flex-start', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              color: '#D1D5DB', borderRadius: '8px', padding: '6px 14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        <div style={{ minHeight: '80px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px' }}>
          <div className="shimmer" style={{ height: '14px', width: '60%', borderRadius: '6px', background: 'rgba(255,255,255,0.06)' }} />
          <div className="shimmer" style={{ height: '14px', width: '40%', borderRadius: '6px', background: 'rgba(255,255,255,0.06)' }} />
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>Fetching podium — first load after a restart can take a minute.</div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-card" style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: '10px', color: '#9CA3AF', letterSpacing: '0.12em', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: "'Space Grotesk', monospace" }}>{value}</div>
    </div>
  )
}

export default function HomePage() {
  // SWR: retry/backoff is built in (errorRetryCount), the request is deduped with every
  // other consumer of standings/calendar, and the cache survives navigation.
  const {
    data: standings,
    isLoading: standingsLoading,
    error: standingsError,
    mutate: retryStandings,
  // Home is the current-season dashboard — rounds complete, next session, the
  // live pill. It deliberately does NOT follow the season picker (which it
  // doesn't display), so everything here stays pinned to SEASON.
  } = useStandings(SEASON, { shouldRetryOnError: true, errorRetryCount: 3, errorRetryInterval: 1500 })
  // Pinned, not picker-driven: see the note on useStandings above.
  const { data: calendar, isLoading: calendarLoading } = useCalendar(SEASON)
  const [activeTab, setActiveTab] = useState<'drivers' | 'constructors'>('drivers')

  const loading = standingsLoading && !standings
  const failedAll = !!standingsError && !standings

  const leader = standings?.drivers[0]
  const c1 = standings?.constructors[0]
  const completed = standings?.rounds.filter(r => r.status === 'complete').length || 0
  const total = standings?.rounds.length || 23

  return (
    <>
      <VideoBackground />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: '1400px', margin: '0 auto', padding: '32px 16px' }}>
        <LiveBanner />

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel"
          style={{ borderRadius: '20px', padding: '36px 32px', marginBottom: '22px', position: 'relative', overflow: 'hidden' }}
        >
          <div className="speed-lines" aria-hidden />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '16px', position: 'relative' }}>
            <div>
              <div className="kicker" style={{ marginBottom: '12px' }}>Formula 1 · 2026</div>
              <Greeting />
            </div>
            <div style={{ fontSize: '12px', color: '#9CA3AF', textAlign: 'right' }}>
              <div style={{ fontWeight: 600, color: '#fff', fontSize: '14px' }}>SEASON OVERVIEW</div>
              {/* No numeric fallback: the old `|| 22` printed a wrong round
                  count for the second or so before the calendar landed, then
                  silently corrected itself to 23. An em dash reads as loading. */}
              <div>{calendar.length || '—'} Rounds · 11 Teams · 22 Drivers</div>
              <div style={{ marginTop: '2px' }}>Active Aero Override (AoA) Regulations</div>
            </div>
          </div>

          <Link
            href="/follow"
            style={{
              position: 'relative', marginTop: '22px', textDecoration: 'none',
              display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
              padding: '16px 20px', borderRadius: '14px',
              background: 'linear-gradient(90deg, color-mix(in srgb, var(--accent) 26%, transparent), transparent 70%)',
              border: '1px solid color-mix(in srgb, var(--accent) 55%, transparent)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 22px color-mix(in srgb, var(--accent) 60%, transparent)',
              }}
            >
              <Crosshair size={19} color="#fff" />
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="font-display" style={{ display: 'block', fontSize: '17px', fontWeight: 800, letterSpacing: '0.03em', color: '#fff' }}>
                FOLLOW ALONG
              </span>
              <span style={{ display: 'block', fontSize: '12px', color: '#D1D5DB', marginTop: '2px' }}>
                Live timing, mini-sectors and your driver&apos;s race — one screen, alerts on.
              </span>
            </span>
            <span
              className="font-display"
              style={{
                marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '5px',
                fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                color: '#fff', padding: '9px 15px', borderRadius: '8px',
                background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.22)',
              }}
            >
              Open <ChevronRight size={13} />
            </span>
          </Link>
        </motion.div>

        {/* Quick stats — each panel fills in on its own, so the row reserves its
            space up front instead of appearing only once standings land. */}
        {standings ? (
          <div className="rise-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '22px' }}>
            <StatCard label="ROUNDS COMPLETE" value={`${completed} / ${total}`} />
            <StatCard label="WDC LEADER" value={leader ? `${leader.abbreviation} — ${leader.points} PTS` : '—'} />
            <StatCard label="WCC LEADER" value={c1 ? `${c1.name} — ${c1.points} PTS` : '—'} />
            <StatCard label="MOST WINS 2026" value={leader ? `${standings.drivers.reduce((a, b) => a.wins >= b.wins ? a : b).abbreviation} — ${Math.max(...standings.drivers.map(d => d.wins))}` : '—'} />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '22px' }}>
            {['ROUNDS COMPLETE', 'WDC LEADER', 'WCC LEADER', 'MOST WINS 2026'].map(label => (
              <div key={label} className="glass-card" style={{ padding: '16px 18px' }}>
                <div style={{ fontSize: '10px', color: '#9CA3AF', letterSpacing: '0.12em', marginBottom: '8px' }}>{label}</div>
                <div className="shimmer" style={{ height: '16px', width: '80%', borderRadius: '4px' }} />
              </div>
            ))}
          </div>
        )}

        {/* 2-col layout — both panels mount immediately and resolve independently */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '16px', marginBottom: '22px' }}>
          <NextSessionBanner calendar={calendar} calendarLoading={calendarLoading} />
          <RecentResults calendar={calendar} standings={standings} calendarLoading={calendarLoading} />
        </div>

        {/* Paddock Pulse heat strip (renders null until interactions exist) */}
        <div style={{ marginBottom: '22px' }}>
          <DriverPulse />
        </div>

        {/* Standings */}
        <div className="glass-card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['drivers', 'constructors'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  padding: '6px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                  background: activeTab === tab ? '#E10600' : 'transparent',
                  color: activeTab === tab ? '#fff' : '#9CA3AF',
                  transition: 'all 0.15s',
                }}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
            <Link href="/standings" style={{ fontSize: '12px', color: '#9CA3AF', textDecoration: 'none' }}>
              Full standings →
            </Link>
          </div>
          {loading ? (
            // Was a full-width animated word-cycler, which meant the landing page
            // had to download and hydrate an animation component purely to say
            // "loading". A row skeleton costs nothing and matches the table that
            // replaces it, so there is no layout jump when the data lands.
            <SkeletonRows rows={10} />
          ) : standings ? (
            activeTab === 'drivers' ? (
              <DriverStandingsTable drivers={standings.drivers.slice(0, 10)} rounds={standings.rounds} compact />
            ) : (
              <ConstructorStandingsTable constructors={standings.constructors} rounds={standings.rounds} compact />
            )
          ) : (
            <div style={{ padding: '32px', textAlign: 'center', color: '#9CA3AF', fontSize: '13px' }}>
              <div style={{ marginBottom: '12px' }}>Couldn&apos;t reach the live server. It may be waking up — give it a second.</div>
              <button
                onClick={() => retryStandings()}
                style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '2px', padding: '9px 20px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: "'Chakra Petch', sans-serif", letterSpacing: '0.06em', textTransform: 'uppercase' }}
              >
                Try again
              </button>
            </div>
          )}
        </div>

        {/* Driver of the Season teaser */}
        {standings && (
          <div style={{ marginTop: '22px' }}>
            <DriverIndex drivers={standings.drivers} limit={5} />
          </div>
        )}

        {/* Quick nav */}
        <h2 className="section-title" style={{ marginTop: '28px', marginBottom: '14px', color: '#cbd5e1' }}>Explore</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
          {[
            { href: '/follow', label: 'Follow Along', desc: 'Watch with a driver', Icon: Crosshair, hot: true },
            { href: '/live', label: 'Live Timing', desc: 'Race-day tower', Icon: Radio, hot: true },
            { href: '/paddock', label: 'Paddock', desc: 'Fan race chat', Icon: MessagesSquare, hot: true },
            { href: '/fantasy', label: 'Fantasy', desc: 'Build your team', Icon: Swords, hot: true },
            { href: '/predictor', label: 'Predictor', desc: 'Call the race', Icon: Target, hot: true },
            { href: '/games', label: 'Games', desc: 'Earn Pit Coins', Icon: Gamepad2, hot: true },
            { href: '/profile', label: 'Profile', desc: 'Badges + coins', Icon: CircleUser },
            { href: '/calendar', label: 'Calendar', desc: `${calendar.length || '—'} Rounds`, Icon: CalendarDays },
            { href: '/standings', label: 'Standings', desc: 'Full WDC + WCC', Icon: Trophy },
            { href: '/drivers', label: 'Drivers', desc: '22 on the grid', Icon: Users },
            { href: '/teams', label: 'Teams', desc: '11 Constructors', Icon: Car },
            { href: '/season-stats', label: 'Season Stats', desc: 'All aggregates', Icon: BarChart3 },
            { href: '/analysis', label: 'Analysis', desc: 'Pace, tyres, strategy', Icon: LineChart },
            { href: '/telemetry', label: 'Telemetry', desc: 'Car data overlay', Icon: Gauge },
            { href: '/history', label: 'History', desc: 'All-time records', Icon: History },
          ].map((l, i) => (
            <motion.div
              key={l.href}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ delay: (i % 4) * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <Link href={l.href} className={`${l.hot ? 'featured-card' : 'glass-card'} glass-card-hover`} style={{
                padding: '16px 18px', textDecoration: 'none', display: 'block',
              }}>
                {/* Wraps rather than overflows: at 375px this grid resolves to two
                    ~124px columns, and the phone type floor takes the NEW badge from
                    8px to a legible 12px, which no longer fits beside "Live Timing"
                    on one line. Desktop has the room and is unaffected. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <l.Icon size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <div className="font-display" style={{ fontWeight: 700, fontSize: '14px', color: '#fff', letterSpacing: '0.01em', minWidth: 0 }}>{l.label}</div>
                  {l.hot && <span style={{ fontSize: '8px', fontWeight: 800, letterSpacing: '0.1em', color: '#FFD700', background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '99px', padding: '2px 7px' }}>NEW</span>}
                </div>
                <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '8px' }}>{l.desc}</div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </>
  )
}
