'use client'

import { useEffect } from 'react'
import { applyTheme, getAppearance, resolveTheme } from '@/lib/theme'

/**
 * Keeps the document's appearance in sync at runtime.
 *
 * Two independent axes, both applied here:
 *
 *  - **Light/dark**, from `f1.appearance`. The inline script in the document
 *    head already set `data-theme` before first paint; this re-asserts it
 *    after hydration and is what a `setTheme()` call elsewhere flows through.
 *  - **Team accent**, from `f1.theme` — the livery colour bought in the Pit
 *    Wall Shop (/games), stored as `"name|#RRGGBB"`.
 *
 * Order matters. The accent is written *after* the theme, because switching
 * theme swaps the whole token block including `--accent`; applying it the
 * other way round would reset a purchased livery to the default red every
 * time someone flipped the toggle.
 */
export default function ThemeApplier() {
  useEffect(() => {
    const applyAccent = () => {
      const stored = localStorage.getItem('f1.theme') || ''
      const color = stored.includes('|') ? stored.split('|')[1] : ''
      // Empty means "no livery bought" — leave the theme's own accent alone
      // rather than pinning it to the dark default in both modes.
      if (color) document.documentElement.style.setProperty('--accent', color)
      else document.documentElement.style.removeProperty('--accent')
    }

    const applyAll = () => {
      applyTheme(resolveTheme(getAppearance()))
      applyAccent()
    }

    applyAll()
    window.addEventListener('f1-theme-change', applyAccent)
    window.addEventListener('f1-appearance-change', applyAll)
    return () => {
      window.removeEventListener('f1-theme-change', applyAccent)
      window.removeEventListener('f1-appearance-change', applyAll)
    }
  }, [])
  return null
}
