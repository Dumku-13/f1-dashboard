'use client'

/**
 * Bottom dock navigation.
 *
 * This used to be a flat strip of 25 icons — every route in the app, in one
 * row, distinguished only by a lucide glyph and a hover tooltip. Past about a
 * dozen items that stops being navigation and becomes a memory test, and the
 * strip had started to scroll horizontally on a 1280px viewport.
 *
 * Now the dock carries seven controls: three direct destinations (Home, Search,
 * Profile) and four *groups*. Selecting a group opens a labelled panel above
 * the dock listing its routes with names and one-line descriptions, so nothing
 * relies on icon recognition. Every route that used to be in the flat strip is
 * still reachable — see ROUTE_GROUPS below.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Home, Radio, Trophy, CalendarDays, Users, Car, Gauge, LineChart, MessagesSquare,
  Swords, Target, Gamepad2, Search, CircleUser, Satellite, GitCompareArrows, Map,
  LayoutGrid, Brain, MessageSquareText, Newspaper, MapPinned, ListOrdered, Activity,
  BarChart3, Flag, BookOpen, History, X, Crosshair, Wrench, ChevronUp,
  type LucideIcon,
} from 'lucide-react'
import { GlassDock, type DockItem } from '@/components/ui/glass-dock'

interface Route { href: string; label: string; desc: string; icon: LucideIcon }
interface Group { id: string; title: string; icon: LucideIcon; routes: Route[] }

const ROUTE_GROUPS: Group[] = [
  {
    id: 'racing',
    title: 'Racing',
    icon: Flag,
    routes: [
      { href: '/follow', label: 'Follow Along', desc: 'Watch with a driver pinned', icon: Crosshair },
      { href: '/live', label: 'Live', desc: 'Timing + race control', icon: Radio },
      { href: '/map', label: 'Track Map', desc: 'Cars on circuit', icon: Map },
      { href: '/results', label: 'Results', desc: 'Every session', icon: ListOrdered },
      { href: '/standings', label: 'Standings', desc: 'WDC + WCC', icon: Trophy },
      { href: '/schedule', label: 'Schedule', desc: '23 rounds, mapped', icon: MapPinned },
      { href: '/calendar', label: 'Calendar', desc: 'Session times', icon: CalendarDays },
    ],
  },
  {
    id: 'analysis',
    title: 'Analysis',
    icon: LineChart,
    routes: [
      { href: '/analysis', label: 'Analysis', desc: 'Pace, tyres, strategy', icon: Activity },
      { href: '/driver-stats', label: 'Driver Stats', desc: 'Season breakdown', icon: BarChart3 },
      { href: '/season-stats', label: 'Season Stats', desc: 'All aggregates', icon: Trophy },
      { href: '/telemetry', label: 'Telemetry', desc: 'Car data overlay', icon: Gauge },
      { href: '/race-engineer', label: 'Race Engineering', desc: 'Plan a tyre strategy', icon: Wrench },
      { href: '/battle', label: 'Battle', desc: 'Lap-by-lap duel', icon: GitCompareArrows },
    ],
  },
  {
    id: 'reference',
    title: 'Reference',
    icon: BookOpen,
    routes: [
      { href: '/drivers', label: 'Drivers', desc: '22 on the grid', icon: Users },
      { href: '/teams', label: 'Teams', desc: '11 constructors', icon: Car },
      { href: '/news', label: 'News', desc: 'Six feeds, merged', icon: Newspaper },
      { href: '/history', label: 'History', desc: 'All-time records', icon: History },
    ],
  },
  {
    id: 'play',
    title: 'Play',
    icon: Gamepad2,
    routes: [
      { href: '/fantasy', label: 'Fantasy', desc: 'Pick a squad', icon: Swords },
      { href: '/predictor', label: 'Predictor', desc: 'Call the podium', icon: Target },
      { href: '/quiz', label: 'Quiz', desc: 'Test your F1', icon: Brain },
      { href: '/games', label: 'Games', desc: 'Reaction + more', icon: Gamepad2 },
      { href: '/feed', label: 'Feed', desc: 'Community posts', icon: MessageSquareText },
      { href: '/paddock', label: 'Paddock', desc: 'Live chat', icon: MessagesSquare },
      { href: '/engineer', label: 'Engineer', desc: 'Ask the pit wall', icon: Satellite },
      { href: '/battlestation', label: 'Battlestation', desc: 'Multi-pane view', icon: LayoutGrid },
    ],
  },
]

/**
 * Routes reachable straight from the dock, outside any group.
 *
 * Follow Along used to sit here too. It's still in the Racing group above, and
 * still has the home CTA and the Explore card — this only drops the icon-only
 * shortcut, which is the one entry point that relied on recognising a glyph.
 */
const DIRECT: Route[] = [
  { href: '/dashboard', label: 'Dashboard', desc: 'Your weekend hub', icon: Home },
  { href: '/search', label: 'Search', desc: 'Find anything', icon: Search },
  { href: '/profile', label: 'Profile', desc: 'Your account', icon: CircleUser },
]

/** Remembered across visits, so a collapsed dock stays collapsed. */
const DOCK_COLLAPSED_KEY = 'f1.dock.collapsed'
/** Scroll past this before auto-hide engages, so short pages never flicker. */
const AUTOHIDE_AFTER_PX = 140

/** Which group owns the current path — used to light up the dock. */
function groupForPath(pathname: string | null): string | null {
  if (!pathname) return null
  for (const g of ROUTE_GROUPS) {
    // longest match first so /drivers/4 doesn't get claimed by /
    const hit = [...g.routes]
      .sort((a, b) => b.href.length - a.href.length)
      .find(r => pathname === r.href || pathname.startsWith(r.href + '/'))
    if (hit) return g.id
  }
  // section routes that have no dock entry of their own
  if (pathname.startsWith('/race/') || pathname.startsWith('/session/')) return 'racing'
  if (pathname.startsWith('/circuits/')) return 'reference'
  return null
}

export default function GlassDockNav() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  /** The user's own choice — sticky across visits. */
  const [collapsed, setCollapsed] = useState(false)
  /** Transient, from scroll direction. */
  const [autoHidden, setAutoHidden] = useState(false)
  const lastY = useRef(0)

  const activeGroup = groupForPath(pathname)

  // Restored after mount: localStorage is client-only and reading it during
  // render is a hydration mismatch.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(DOCK_COLLAPSED_KEY) === '1')
    lastY.current = window.scrollY
  }, [])

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      window.localStorage.setItem(DOCK_COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
    // Reaching for the handle means you want it now, whatever the scroll said.
    setAutoHidden(false)
  }

  /**
   * Slide away on the way down, come back on the way up.
   *
   * Held open while a group panel is showing — yanking the nav out from under
   * an open panel reads as a glitch, not a feature.
   */
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      const delta = y - lastY.current
      if (Math.abs(delta) < 6) return
      lastY.current = y
      if (open) { setAutoHidden(false); return }
      setAutoHidden(delta > 0 && y > AUTOHIDE_AFTER_PX)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [open])

  const hidden = collapsed || autoHidden

  // Close the panel whenever the route actually changes.
  useEffect(() => { setOpen(null) }, [pathname])

  // Escape closes; click outside closes.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const go = (href: string) => {
    setOpen(null)
    router.push(href)
  }

  // Home first (the dock's morphing house icon keys off the title 'Home'),
  // then the four groups, then the remaining direct links.
  const [home, ...restDirect] = DIRECT
  const items: DockItem[] = [
    { title: home.label, icon: home.icon, onClick: () => go(home.href) },
    ...ROUTE_GROUPS.map(g => ({
      title: g.title,
      icon: g.icon,
      onClick: () => setOpen(prev => (prev === g.id ? null : g.id)),
    })),
    ...restDirect.map(d => ({ title: d.label, icon: d.icon, onClick: () => go(d.href) })),
  ]

  const openGroup = ROUTE_GROUPS.find(g => g.id === open) ?? null

  return (
    <nav
      ref={wrapRef}
      aria-label="Main"
      /* Which group panel is open, mirrored onto the DOM. Framer-motion exit
         animations don't complete in a headless/hidden tab, so panels linger at
         opacity 0 and you cannot tell open from closed by querying the DOM.
         This attribute is the reliable probe. */
      data-open-group={open ?? 'none'}
      /* Same reason as data-open-group: the slide is a transform, so whether
         the dock is up or down isn't readable from the DOM without this. */
      data-dock-hidden={hidden ? 'true' : 'false'}
      style={{
        position: 'fixed',
        bottom: '20px',
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '10px',
        zIndex: 50,
        pointerEvents: 'none',
        padding: '0 12px',
      }}
    >
      <AnimatePresence>
        {openGroup && (
          <motion.div
            key={openGroup.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            role="dialog"
            aria-label={`${openGroup.title} navigation`}
            style={{
              pointerEvents: 'auto',
              width: 'min(720px, calc(100vw - 24px))',
              maxHeight: 'min(58vh, 460px)',
              overflowY: 'auto',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderTop: '2px solid var(--accent)',
              borderRadius: '2px',
              boxShadow: '0 18px 48px rgba(0,0,0,0.55)',
              padding: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span
                className="font-display"
                style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--muted)' }}
              >
                {openGroup.title}
              </span>
              <button
                onClick={() => setOpen(null)}
                aria-label="Close navigation panel"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 26, height: 26, background: 'transparent', border: '1px solid var(--border)',
                  borderRadius: 2, color: 'var(--muted)', cursor: 'pointer',
                }}
              >
                <X size={13} />
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '6px',
              }}
            >
              {openGroup.routes.map(r => {
                const RIcon = r.icon
                const on = pathname === r.href || (r.href !== '/' && !!pathname?.startsWith(r.href + '/'))
                return (
                  <button
                    key={r.href}
                    onClick={() => go(r.href)}
                    aria-current={on ? 'page' : undefined}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                      padding: '9px 11px', cursor: 'pointer', borderRadius: 2,
                      background: on ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
                      border: '1px solid transparent',
                      borderLeft: `2px solid ${on ? 'var(--accent)' : 'var(--hairline)'}`,
                      color: 'var(--foreground)',
                      minHeight: 44,
                    }}
                    onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'color-mix(in srgb, var(--foreground) 6%, transparent)' }}
                    onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}
                  >
                    <RIcon size={16} color={on ? 'var(--accent)' : 'var(--muted)'} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                      <span
                        className="font-display"
                        style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}
                      >
                        {r.label}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.desc}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={toggleCollapsed}
        aria-expanded={!hidden}
        aria-label={hidden ? 'Show navigation' : 'Hide navigation'}
        title={hidden ? 'Show navigation' : 'Hide navigation'}
        style={{
          pointerEvents: 'auto',
          position: 'absolute',
          right: 'max(14px, calc(50% - 360px))',
          bottom: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 34, height: 26,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 2,
          color: 'var(--muted)',
          cursor: 'pointer',
          // Stays put while the dock slides, so there is always something to
          // click to bring it back.
          zIndex: 2,
        }}
      >
        <ChevronUp
          size={14}
          style={{
            transform: hidden ? 'none' : 'rotate(180deg)',
            transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      </button>

      <div
        style={{
          pointerEvents: hidden ? 'none' : 'auto',
          maxWidth: '100%',
          overflowX: 'auto',
          paddingTop: '64px',
          marginTop: '-64px',
          position: 'relative',
          transform: hidden ? 'translateY(calc(100% + 26px))' : 'none',
          opacity: hidden ? 0 : 1,
          transition: 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease',
        }}
        className="hide-scrollbar"
        inert={hidden || undefined}
      >
        <GlassDock items={items} />
        {/* Section marker under whichever group owns the current route. The dock
            items are 40px wide with a 16px gap, in a 24px-padded shell. */}
        {activeGroup && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              bottom: 6,
              left: 24 + (1 + ROUTE_GROUPS.findIndex(g => g.id === activeGroup)) * 56 + 16,
              width: 8,
              height: 2,
              background: 'var(--accent)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
    </nav>
  )
}
