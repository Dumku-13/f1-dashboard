'use client'

import { useEffect } from 'react'

/** Applies the team accent theme purchased in the Pit Wall Shop (/games). */
export default function ThemeApplier() {
  useEffect(() => {
    const apply = () => {
      const stored = localStorage.getItem('f1.theme') || ''
      const color = stored.includes('|') ? stored.split('|')[1] : '#E10600'
      document.documentElement.style.setProperty('--accent', color)
    }
    apply()
    window.addEventListener('f1-theme-change', apply)
    return () => window.removeEventListener('f1-theme-change', apply)
  }, [])
  return null
}
