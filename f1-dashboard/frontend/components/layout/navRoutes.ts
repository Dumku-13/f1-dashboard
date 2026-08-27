/**
 * The app's route map — shared by every navigation surface.
 *
 * This lived inside `GlassDockNav` until the mobile tab bar needed the same 25
 * routes for its More sheet. Two copies of a route list drift the moment either
 * one gains a page, and the drift is silent: the route still works, it just
 * stops being reachable from one of the bars. One definition, two consumers.
 *
 * Not a `.tsx` file and no JSX here on purpose — icons are passed as component
 * references, so this stays importable from anywhere.
 */

import {
  Home, Radio, Trophy, CalendarDays, Users, Car, Gauge, LineChart, MessagesSquare,
  Swords, Target, Gamepad2, Search, CircleUser, Satellite, GitCompareArrows, Map,
  LayoutGrid, Brain, MessageSquareText, Newspaper, MapPinned, ListOrdered, Activity,
  BarChart3, Flag, BookOpen, History, Crosshair, Wrench,
  type LucideIcon,
} from 'lucide-react'

export interface Route { href: string; label: string; desc: string; icon: LucideIcon }
export interface Group { id: string; title: string; icon: LucideIcon; routes: Route[] }

export const ROUTE_GROUPS: Group[] = [
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
export const DIRECT: Route[] = [
  { href: '/dashboard', label: 'Dashboard', desc: 'Your weekend hub', icon: Home },
  { href: '/search', label: 'Search', desc: 'Find anything', icon: Search },
  { href: '/profile', label: 'Profile', desc: 'Your account', icon: CircleUser },
]

/** Which group owns the current path. Longest match first, so `/drivers/4`
 *  isn't claimed by a shorter prefix. Shared so the dock and the tab bar
 *  highlight the same thing. */
export function groupForPath(pathname: string | null): string | null {
  if (!pathname) return null
  for (const g of ROUTE_GROUPS) {
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
