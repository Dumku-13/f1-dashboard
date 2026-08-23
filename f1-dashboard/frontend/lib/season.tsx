'use client'

/**
 * Which championship year the app is showing.
 *
 * The season used to be one frozen constant (`SEASON`), so every page could
 * only ever render the current year. This turns it into a shared, persisted
 * selection covering the current season and the two before it.
 *
 * Deliberately a module-level store read through `useSyncExternalStore` rather
 * than a context provider: `app/layout.tsx` would otherwise need a wrapper, and
 * this matches how `useBroadcastDelay` in `lib/live.ts` already shares state
 * across unrelated trees. Every consumer sees the same value with no provider.
 *
 * `SEASON` lives here (not in `lib/api/hooks.ts`) purely to keep the import
 * graph acyclic — `hooks.ts` needs `useSeason`, so `season.tsx` must not import
 * `hooks.ts`. `hooks.ts` re-exports `SEASON`, so every existing
 * `import { SEASON } from '@/lib/api/hooks'` keeps working and the literal
 * still exists in exactly one place.
 */

import { useSyncExternalStore } from 'react'

/** The current championship year — the newest season the app knows about. */
export const SEASON = 2026

/** Selectable seasons, newest first. Current year plus the two before it. */
export const SEASONS: readonly number[] = [SEASON, SEASON - 1, SEASON - 2]

const KEY = 'f1.season'

let season: number = SEASON
let loaded = false
const subs = new Set<() => void>()

/** Guards against a stale or hand-edited localStorage value selecting a year we don't offer. */
export function isSelectableSeason(year: unknown): year is number {
  return typeof year === 'number' && SEASONS.includes(year)
}

function load(): number {
  // Read lazily and only in the browser. `useSyncExternalStore` hands React the
  // server snapshot during hydration too, so this can never desync the markup.
  if (loaded || typeof window === 'undefined') return season
  loaded = true
  try {
    const raw = Number(window.localStorage.getItem(KEY))
    if (isSelectableSeason(raw)) season = raw
  } catch {
    /* private mode / storage disabled — stay on the current season */
  }
  return season
}

/** The selected season, without subscribing. */
export function getSeason(): number {
  return load()
}

export function setSeason(year: number) {
  if (!isSelectableSeason(year)) return
  load()
  if (year === season) return
  season = year
  try {
    window.localStorage.setItem(KEY, String(year))
  } catch {
    /* the choice just won't survive a reload */
  }
  subs.forEach(fn => fn())
}

function subscribe(onChange: () => void): () => void {
  subs.add(onChange)
  return () => { subs.delete(onChange) }
}

// Server render (and hydration) always report the current season — there is no
// localStorage there, and returning a stored value would mismatch the markup.
const getServerSeason = () => SEASON

/** The selected season and a setter. Shared by every consumer, no provider needed. */
export function useSeason(): [number, (year: number) => void] {
  const year = useSyncExternalStore(subscribe, getSeason, getServerSeason)
  return [year, setSeason]
}
