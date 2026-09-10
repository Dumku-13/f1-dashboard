'use client'

import { useState, type CSSProperties, type KeyboardEvent } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight, Radio, ChevronDown, Crosshair, Trophy, Flag, CalendarDays, Gauge, LineChart, BarChart3, Users, Car, History, MessagesSquare, Swords, Target, Gamepad2, CircleUser } from 'lucide-react'
import DashboardWeekend from '@/components/home/DashboardWeekend'
import DriverPulse from '@/components/home/DriverPulse'
import DriverDuel from '@/components/home/DriverDuel'
import { useCalendar, useStandings, SEASON } from '@/lib/api/hooks'
import { ApiError } from '@/lib/api/client'
import { useLiveStatus } from '@/lib/live'
import { getDriverTheme } from '@/lib/driverAssets'
import { TEAM_COLORS } from '@/lib/constants'
import { hexColor } from '@/lib/utils'
import type { Standings } from '@/lib/types'
import styles from './dashboard.module.css'

const DriverIndex = dynamic(() => import('@/components/standings/DriverIndex'), {
  loading: () => <div className={styles.skeleton} style={{ height: 220 }} aria-label="Loading performance index" />,
})
const ease = [0.22, 1, 0.36, 1] as const

const groups = [
  { name: 'Race day', description: 'Every angle of the weekend.', items: [
    { href: '/follow', name: 'Follow along', description: 'Put your driver at the centre of the race.', Icon: Crosshair },
    { href: '/live', name: 'Live timing', description: 'Gaps, tyres and race control as it happens.', Icon: Radio },
    { href: '/calendar', name: 'Race calendar', description: 'Every session, in your local time.', Icon: CalendarDays },
    { href: '/paddock', name: 'Paddock', description: 'Join the conversation with other fans.', Icon: MessagesSquare },
  ] },
  { name: 'Analysis', description: 'Find the time. Understand the difference.', items: [
    { href: '/analysis', name: 'Race analysis', description: 'Compare pace, tyre life and strategy.', Icon: LineChart },
    { href: '/telemetry', name: 'Telemetry', description: 'See where one driver gains on another.', Icon: Gauge },
    { href: '/season-stats', name: 'Season statistics', description: 'The patterns behind the results.', Icon: BarChart3 },
    { href: '/standings', name: 'Championship', description: 'The complete points picture.', Icon: Trophy },
  ] },
  { name: 'The grid', description: 'Get to know the people and the machines.', items: [
    { href: '/drivers', name: 'Drivers', description: 'Explore the drivers on this season’s grid.', Icon: Users },
    { href: '/teams', name: 'Teams', description: 'The constructors behind the cars.', Icon: Car },
    { href: '/history', name: 'F1 history', description: 'Records and seasons worth revisiting.', Icon: History },
    { href: '/profile', name: 'Your profile', description: 'Your badges, progress and Pit Coins.', Icon: CircleUser },
  ] },
  { name: 'Play', description: 'Bring your own race instinct.', items: [
    { href: '/fantasy', name: 'Fantasy team', description: 'Build the line-up you believe in.', Icon: Swords },
    { href: '/predictor', name: 'Race predictor', description: 'Make your calls before lights out.', Icon: Target },
    { href: '/games', name: 'Games', description: 'Test your knowledge and earn Pit Coins.', Icon: Gamepad2 },
  ] },
]

function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number, count: number, select: (index: number) => void) {
  const next = event.key === 'ArrowRight' ? (index + 1) % count : event.key === 'ArrowLeft' ? (index + count - 1) % count : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null
  if (next == null) return
  event.preventDefault()
  select(next)
  const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  tabs?.[next]?.focus()
}

function Championship({ standings, loading, failed, retry }: { standings?: Standings; loading: boolean; failed: boolean; retry: () => void }) {
  const [tab, setTab] = useState<'drivers' | 'constructors'>('drivers')
  const [expanded, setExpanded] = useState(false)
  const reduced = useReducedMotion()
  const drivers = standings?.drivers ?? []
  const constructors = standings?.constructors ?? []
  const rows = tab === 'drivers'
    ? drivers.slice(0, 5).map(d => ({ key: d.abbreviation, name: d.name, detail: d.team, points: d.points, position: d.position, color: hexColor(d.team_color) || TEAM_COLORS[d.team] || 'var(--muted)' }))
    : constructors.slice(0, 5).map(t => ({ key: t.id, name: t.name, detail: `${t.wins} ${t.wins === 1 ? 'win' : 'wins'}`, points: t.points, position: t.position, color: hexColor(t.color) || TEAM_COLORS[t.name] || 'var(--muted)' }))
  const lead = rows[0]
  const photo = tab === 'drivers' ? getDriverTheme(drivers[0]?.name)?.image : null
  const gap = lead && rows[1] ? lead.points - rows[1].points : null

  return (
    <section className={styles.championship} aria-labelledby="championship-title">
      <div className={styles.sectionHead}>
        <div><p className={styles.caption}>The title fight</p><h2 id="championship-title">Championship order</h2></div>
        <Link href="/standings" className={styles.textLink}>Full standings <ArrowUpRight size={16} aria-hidden="true" /></Link>
      </div>
      <div role="tablist" aria-label="Championship classification" className={styles.tabs}>
        {(['drivers', 'constructors'] as const).map((value, index) => (
          <button key={value} role="tab" id={`champ-${value}-tab`} aria-controls="champ-panel" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)} onKeyDown={event => moveTab(event, index, 2, i => setTab(i === 0 ? 'drivers' : 'constructors'))}>
            {tab === value && <motion.span layoutId="champ-selection" className={styles.tabSelection} transition={{ duration: reduced ? 0 : 0.22 }} />}
            <span>{value === 'drivers' ? 'Drivers' : 'Constructors'}</span>
          </button>
        ))}
      </div>
      <div id="champ-panel" role="tabpanel" aria-labelledby={`champ-${tab}-tab`} tabIndex={0}>
        {standings && lead ? (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} className={styles.champGrid} initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: reduced ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.16 }}>
              <div className={styles.leader} style={{ '--team': lead.color } as CSSProperties}>
                {photo && <img key={photo} src={photo} alt="" loading="lazy" decoding="async" className={styles.leaderPhoto} />}
                <div className={styles.leaderShade} />
                <div className={styles.leaderTop}><span>Championship leader</span><Trophy size={20} aria-hidden="true" /></div>
                <div className={styles.leaderBottom}>
                  <p className={styles.leaderTeam}>{tab === 'drivers' ? lead.detail : 'Constructors’ championship'}</p>
                  <h3>{lead.name}</h3>
                  <div className={styles.leaderScore}><strong className="font-num">{lead.points}</strong><span>points{gap != null && <small>{gap === 0 ? 'Level on points with P2' : `${gap} ahead of P2`}</small>}</span></div>
                </div>
              </div>
              <div className={styles.order}>
                <div className={styles.orderHead}><span>Classification</span><span>Points</span></div>
                <ol className={styles.orderList}>
                  {rows.map((row, index) => (
                    <li key={row.key} className={styles.orderRow}>
                      <span className={`${styles.position} font-num`}>{String(row.position).padStart(2, '0')}</span>
                      <div className={styles.driverIdentity}><strong>{row.name}</strong><small>{row.detail}</small>
                        <div className={styles.pointsTrack} aria-hidden="true"><motion.div style={{ background: row.color, transformOrigin: 'left', width: `${Math.max(0, row.points / Math.max(1, lead.points) * 100)}%` }} initial={{ scaleX: reduced ? 1 : 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: reduced ? 0 : 0.65, delay: reduced ? 0 : index * 0.06, ease }} /></div>
                      </div>
                      <strong className={`${styles.rowPoints} font-num`}>{row.points}</strong>
                    </li>
                  ))}
                </ol>
                <Link href="/standings" className={styles.orderFooter}>View the full points matrix <ArrowUpRight size={16} aria-hidden="true" /></Link>
              </div>
            </motion.div>
          </AnimatePresence>
        ) : (
          <div className={styles.empty}>
            {loading ? <><div className={styles.skeleton} style={{ width: '60%', height: 26 }} /><p>Connecting to championship data…</p></> : <><Trophy size={26} /><p>{failed ? 'Championship data is unavailable right now.' : 'No championship results to show yet.'}</p><button className={styles.button} onClick={retry}>Retry standings</button></>}
          </div>
        )}
      </div>
      {!!drivers.length && <div className={styles.performance}>
        <button onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls="performance-details" className={styles.performanceToggle}>
          <span><Gauge size={18} aria-hidden="true" /><strong>Who’s getting the most from their car?</strong></span>
          <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: reduced ? 0 : 0.2 }}><ChevronDown size={19} aria-hidden="true" /></motion.span>
        </button>
        <div id="performance-details" hidden={!expanded}>
          {expanded && <motion.div initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.25 }} className={styles.performanceBody}><DriverIndex drivers={drivers} limit={5} /></motion.div>}
        </div>
      </div>}
    </section>
  )
}

function Explore() {
  const [active, setActive] = useState(0)
  const reduced = useReducedMotion()
  const group = groups[active]
  return (
    <section className={styles.explore} aria-labelledby="explore-title">
      <div className={styles.sectionHead}><div><p className={styles.caption}>Make it your weekend</p><h2 id="explore-title">Explore the paddock</h2></div><p className={styles.sectionNote}>Watch. Understand. Get involved.</p></div>
      <div role="tablist" aria-label="Explore dashboard tools" className={styles.exploreTabs}>
        {groups.map((item, i) => <button key={item.name} id={`explore-tab-${i}`} role="tab" aria-selected={active === i} aria-controls="explore-panel" tabIndex={active === i ? 0 : -1} onClick={() => setActive(i)} onKeyDown={e => moveTab(e, i, groups.length, setActive)}>
          {active === i && <motion.span layoutId="explore-selection" className={styles.exploreSelection} transition={{ duration: reduced ? 0 : 0.25, ease }} />}
          <span>{item.name}</span>
        </button>)}
      </div>
      <div id="explore-panel" role="tabpanel" aria-labelledby={`explore-tab-${active}`} tabIndex={0}>
        <p className={styles.groupDescription}>{group.description}</p>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={group.name} className={styles.toolGrid} initial={{ opacity: reduced ? 1 : 0, x: reduced ? 0 : 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: reduced ? 1 : 0, x: reduced ? 0 : -8 }} transition={{ duration: reduced ? 0 : 0.2 }}>
            {group.items.map(({ href, name, description, Icon }) => <Link href={href} key={href} className={styles.tool}>
              <div className={styles.toolTop}><Icon size={25} strokeWidth={1.5} aria-hidden="true" /><ArrowUpRight size={18} className={styles.toolArrow} aria-hidden="true" /></div>
              <h3>{name}</h3><p>{description}</p>
            </Link>)}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}

export default function DashboardPage() {
  const { data: standings, isLoading: standingsLoading, error: standingsError, mutate: retryStandings } = useStandings(SEASON)
  const { data: calendar, isLoading: calendarLoading } = useCalendar(SEASON)
  const { live, session } = useLiveStatus()
  const reduced = useReducedMotion()
  const completed = standings?.rounds.filter(round => round.status === 'complete').length
  const total = calendar.length || standings?.rounds.length || null
  const constructors = standings?.constructors ?? []
  const mostWins = standings?.drivers.reduce<(typeof standings.drivers)[number] | null>((best, driver) => !best || driver.wins > best.wins ? driver : best, null)
  const waiting = standingsLoading || (standingsError instanceof ApiError && standingsError.unreachable)

  return (
    <div className={styles.page}>
      <motion.header className={styles.header} initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.45 }}>
        <div className={styles.headerCopy}><p className={styles.seasonLabel}><Flag size={15} aria-hidden="true" /> Formula 1 / {SEASON}</p><h1>Your pit wall.</h1><p className={styles.intro}>The weekend ahead. The fight so far. Your next move.</p></div>
        <div className={styles.seasonProgress}>
          <div><span>Season progress</span><strong className="font-num">{completed ?? '—'} <small>/ {total ?? '—'}</small></strong></div>
          <div className={styles.roundMarkers} aria-label={completed != null && total ? `${completed} of ${total} rounds complete` : 'Season progress loading'}>
            {Array.from({ length: total ?? 23 }, (_, i) => <motion.i key={i} className={completed != null && i < completed ? styles.roundComplete : ''} initial={{ scaleY: reduced ? 1 : 0 }} animate={{ scaleY: 1 }} transition={{ delay: reduced ? 0 : Math.min(i * 0.015, 0.35), duration: reduced ? 0 : 0.35 }} />)}
          </div>
          <Link href="/calendar" className={styles.textLink}>Season calendar <ArrowUpRight size={14} aria-hidden="true" /></Link>
        </div>
      </motion.header>

      <Link href={live ? '/live' : '/follow'} className={styles.followStrip}>
        <span className={styles.followIcon}>{live ? <Radio size={23} aria-hidden="true" /> : <Crosshair size={23} aria-hidden="true" />}</span>
        <span><strong>{live ? `${session?.country_name ?? 'F1'} ${session?.session_name ?? 'session'} is live` : 'A front-row seat to your driver’s race.'}</strong><small>{live ? 'Open timing, tyre strategy and race control.' : 'Follow along with timing, alerts and the details that matter.'}</small></span>
        <span className={styles.followAction}>{live ? 'Open timing' : 'Follow along'}<ArrowUpRight size={19} aria-hidden="true" /></span>
      </Link>

      <DashboardWeekend calendar={calendar} calendarLoading={calendarLoading} standings={standings} />

      <div className={styles.summaryRail} aria-label="Season highlights">
        <div><span>Leading constructor</span><strong>{constructors[0]?.name ?? '—'}</strong><small>{constructors[0] ? `${constructors[0].points} championship points` : 'Waiting for standings'}</small></div>
        <div><span>Most race wins</span><strong>{mostWins?.name ?? '—'}</strong><small>{mostWins ? `${mostWins.wins} ${mostWins.wins === 1 ? 'victory' : 'victories'} this season` : 'Waiting for standings'}</small></div>
        <div><span>Still to race</span><strong className="font-num">{total && completed != null ? String(Math.max(0, total - completed)).padStart(2, '0') : '—'}</strong><small>Grand Prix weekends</small></div>
      </div>

      <Championship standings={standings} loading={!standings && waiting} failed={!!standingsError} retry={() => { void retryStandings() }} />
      <DriverPulse />
      <DriverDuel standings={standings} />
      <Explore />
      <footer className={styles.footer}><span className={styles.finishLine} aria-hidden="true" /><p>Every detail. Every lap.</p><Link href="/faq" className={styles.textLink}>About the data <ArrowUpRight size={14} aria-hidden="true" /></Link></footer>
    </div>
  )
}
