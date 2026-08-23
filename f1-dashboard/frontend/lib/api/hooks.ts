'use client'

/**
 * Typed hooks for the resources many pages need.
 *
 * These exist so the ~10 components that each fetched the calendar (and the ~13 that
 * fetched standings) now share ONE deduped, cached request instead of firing their own.
 * Always prefer a hook here over a raw fetch.
 */

import type { SWRConfiguration } from 'swr'
import { useApi, useApiList } from './client'
import { SEASON, useSeason } from '@/lib/season'
import type { CalendarEvent, Standings, Driver, Team, Circuit } from '@/lib/types'

/**
 * The current championship year. The literal lives in `lib/season.tsx` — that
 * module is the season store and cannot import this one without a cycle — and
 * is re-exported here because most of the app already imports it from `hooks`.
 */
export { SEASON }
export { SEASONS, useSeason } from '@/lib/season'

/**
 * Year-scoped hooks default to the *selected* season rather than the current
 * one, so the season picker moves every page at once. Passing `year`
 * explicitly still pins a hook to that year (the live panels rely on this).
 *
 * `keepPreviousData` is switched off for these three: the year is the only
 * thing their key varies by, so keeping previous data could ONLY ever mean
 * showing last season's numbers under this season's heading.
 */
export function useCalendar(year?: number, opts?: SWRConfiguration<CalendarEvent[]>) {
  const [season] = useSeason()
  return useApiList<CalendarEvent>(`/api/sessions/calendar/${year ?? season}`, { keepPreviousData: false, ...opts })
}

export function useStandings(year?: number, opts?: SWRConfiguration<Standings>) {
  const [season] = useSeason()
  return useApi<Standings>(`/api/standings/?year=${year ?? season}`, { keepPreviousData: false, ...opts })
}

export function useDrivers(year?: number, opts?: SWRConfiguration<Driver[]>) {
  const [season] = useSeason()
  return useApiList<Driver>(`/api/drivers/?year=${year ?? season}`, { keepPreviousData: false, ...opts })
}

export function useTeams(opts?: SWRConfiguration<Team[]>) {
  return useApiList<Team>('/api/teams/', opts)
}

export function useCircuits(opts?: SWRConfiguration<Circuit[]>) {
  return useApiList<Circuit>('/api/circuits/', opts)
}

/** The most recent round whose race has been scored. Defaults to the selected season. */
export function useLatestCompletedRound(year?: number) {
  const { data: standings, isLoading } = useStandings(year)
  const done = (standings?.rounds || []).filter(r => r.status === 'complete')
  return { round: done.length ? done[done.length - 1].round : null, isLoading }
}

/**
 * The next event that hasn't started yet, from the calendar. Defaults to the
 * selected season — which for a finished season is every round, so `event` is
 * legitimately `null`. Callers must treat that as "season over", not an error.
 */
export function useNextRound(year?: number) {
  const { data: calendar, isLoading } = useCalendar(year)
  const now = Date.now()
  const next = calendar.find(ev => new Date(ev.event_date).getTime() > now) || null
  return { event: next, isLoading }
}

/**
 * Race distance for a round.
 *
 * The calendar doesn't carry a lap count — only `circuit_key` — so the number
 * comes from the circuit record. Returns null rather than a guess when it
 * can't be resolved; a wrong race length silently mis-sizes every strategy.
 */
export function useRaceLaps(round: number | null, year?: number): number | null {
  const { data: calendar } = useCalendar(year)
  const { data: circuits } = useCircuits()
  if (round == null) return null
  const ev = calendar.find(e => e.round === round)
  if (!ev?.circuit_key) return null
  const circuit = circuits.find(c => c.key === ev.circuit_key)
  const laps = Number((circuit as any)?.race_laps)
  return Number.isFinite(laps) && laps > 0 ? laps : null
}
