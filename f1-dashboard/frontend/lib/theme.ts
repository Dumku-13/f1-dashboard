'use client'

/**
 * Appearance — system / light / dark.
 *
 * Three states, not two. "Dark" and "light" are choices; "system" is the
 * absence of one, and it has to keep tracking the OS afterwards or it is just
 * a third fixed value. Default is system, so a first-time visitor gets what
 * their machine already asked for.
 *
 * Storage key is `f1.appearance`, deliberately NOT `f1.theme` — that one is
 * already taken by the team accent colour bought in the Pit Wall Shop, which
 * is a different axis entirely. Both are applied by ThemeApplier, and the
 * accent wins over the theme's default red in either mode.
 *
 * Follows the custom-event pattern in lib/wallet.ts and lib/auth.ts: writes go
 * through the setter, which fires an event every mounted hook listens for, so
 * two toggles on screen never disagree.
 */

import { useCallback, useEffect, useState } from 'react'

import { APPEARANCE_KEY, DARK_QUERY } from './themeScript'

// Re-exported so callers have one import for the whole theme surface; the
// definitions live in themeScript.ts because app/layout.tsx is a server
// component and cannot import them through this `'use client'` module.
export { APPEARANCE_KEY, THEME_INIT_SCRIPT } from './themeScript'

export type Appearance = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const EVT = 'f1-appearance-change'

export function getAppearance(): Appearance {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = localStorage.getItem(APPEARANCE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

export function resolveTheme(appearance: Appearance): ResolvedTheme {
  return appearance === 'system' ? systemTheme() : appearance
}

/** Write `data-theme` and keep the Tailwind `.dark` class in step with it. */
export function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.classList.toggle('dark', theme === 'dark')
  // Tells the browser which way to render form controls, scrollbars and the
  // canvas behind the page — without it a light page keeps dark scrollbars.
  root.style.colorScheme = theme
}

export function setAppearance(next: Appearance) {
  try {
    if (next === 'system') localStorage.removeItem(APPEARANCE_KEY)
    else localStorage.setItem(APPEARANCE_KEY, next)
  } catch {
    /* Unstorable — the choice still applies for this page's lifetime. */
  }
  applyTheme(resolveTheme(next))
  window.dispatchEvent(new CustomEvent(EVT))
}

/** `{ appearance, theme, setTheme }` — kept in sync across every consumer. */
export function useTheme() {
  const [appearance, setLocal] = useState<Appearance>('system')
  const [theme, setResolved] = useState<ResolvedTheme>('dark')

  const sync = useCallback(() => {
    const a = getAppearance()
    setLocal(a)
    setResolved(resolveTheme(a))
  }, [])

  useEffect(() => {
    sync()
    window.addEventListener(EVT, sync)
    // Another tab changing the preference should not leave this one stale.
    window.addEventListener('storage', sync)

    // While on 'system', follow the OS live — someone whose machine flips at
    // sunset expects the page to flip with it, not on next reload.
    const media = window.matchMedia(DARK_QUERY)
    const onSystemChange = () => { if (getAppearance() === 'system') { applyTheme(systemTheme()); sync() } }
    media.addEventListener('change', onSystemChange)

    return () => {
      window.removeEventListener(EVT, sync)
      window.removeEventListener('storage', sync)
      media.removeEventListener('change', onSystemChange)
    }
  }, [sync])

  return { appearance, theme, setTheme: setAppearance }
}
