'use client'

/**
 * Viewport breakpoints for a codebase built on inline styles.
 *
 * The app has ~2,800 `style={{}}` props and, before this file, exactly ONE
 * width-based media query in 823 lines of `globals.css` (`max-width: 900px`,
 * covering `.live-grid` and `.map-grid`). A media query cannot reach an inline
 * style, so on a phone every route rendered at desktop density: `/standings`
 * carried 341 text nodes below 12px, `/live` 12 sideways-scrolling panes.
 * Nothing overflowed — it fit and was unreadable, which are different things.
 *
 * This is the single source of truth for width. Three thresholds already
 * existed and disagreed (768 in `HeroFrameScrub`, 700 in `battlestation`, 900
 * in `globals.css`); prefer these and retire those as each is touched.
 *
 * Module-level store rather than per-component listeners, for the same reason
 * `useLiveStatus` is one: the dock, the layout and every panel ask the same
 * question, and one `matchMedia` subscription answers all of them.
 */

import { useSyncExternalStore } from 'react'

export type Breakpoint = 'phone' | 'tablet' | 'desktop'

/** Shared with `globals.css` — the CSS rules there MUST use the same numbers. */
export const PHONE_MAX = 767
export const TABLET_MAX = 1119

const PHONE_QUERY = `(max-width: ${PHONE_MAX}px)`
const TABLET_QUERY = `(min-width: ${PHONE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`

let current: Breakpoint = 'desktop'
let mqls: MediaQueryList[] = []
const subs = new Set<() => void>()

function measure(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop'
  if (window.matchMedia(PHONE_QUERY).matches) return 'phone'
  if (window.matchMedia(TABLET_QUERY).matches) return 'tablet'
  return 'desktop'
}

function onChange() {
  const next = measure()
  // `useSyncExternalStore` compares snapshots by identity. Breakpoint is a
  // string so that is a value compare, but bailing out early still avoids
  // waking every subscriber on the many resize events that don't cross a
  // threshold — a phone fires these on every scroll that moves the URL bar.
  if (next === current) return
  current = next
  subs.forEach(fn => fn())
}

function subscribe(cb: () => void): () => void {
  if (subs.size === 0 && typeof window !== 'undefined') {
    mqls = [window.matchMedia(PHONE_QUERY), window.matchMedia(TABLET_QUERY)]
    mqls.forEach(m => m.addEventListener('change', onChange))
    current = measure()
  }
  subs.add(cb)
  return () => {
    subs.delete(cb)
    if (subs.size === 0) {
      mqls.forEach(m => m.removeEventListener('change', onChange))
      mqls = []
    }
  }
}

function getSnapshot(): Breakpoint {
  return current
}

/**
 * Server render returns `desktop`, so the first client render matches the
 * server HTML and hydration stays clean — the same trade `useBroadcastDelay`
 * makes for localStorage and `useBareMode` makes for frame detection. The cost
 * is one frame of desktop styling on a phone before the store resolves.
 *
 * Because of that frame, ANYTHING THAT WOULD VISIBLY FLASH belongs in CSS, not
 * here: CSS applies at first paint and never lies. That is why the nav swap
 * uses the `.phone-only` / `.desktop-only` classes rather than this hook. Use
 * the hook for inline styles CSS genuinely cannot reach.
 */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'desktop' as const)
}

/** Convenience for the common `bp === 'phone'` test. */
export function useIsPhone(): boolean {
  return useBreakpoint() === 'phone'
}

/**
 * Pick a value per breakpoint, falling back down the chain so callers can
 * supply only what differs: `resp(bp, { phone: 13, desktop: 11 })`.
 */
export function resp<T>(bp: Breakpoint, values: { phone?: T; tablet?: T; desktop: T }): T {
  if (bp === 'phone') return values.phone ?? values.tablet ?? values.desktop
  if (bp === 'tablet') return values.tablet ?? values.desktop
  return values.desktop
}
