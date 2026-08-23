'use client'

import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { useSeason, SEASONS } from '@/lib/season'
import { useLiveStatus } from '@/lib/live'

/**
 * Floating season switcher — the current championship year plus the two before
 * it (`SEASONS`). Mounted from `HomeButton`, which the root layout already
 * renders on every non-bare page, so no layout change was needed.
 *
 * Only shown on the routes that actually read season-scoped data; offering it
 * on /games or /quiz would just be a control that appears to do nothing.
 */
const SEASON_ROUTES = new Set([
  '/standings',
  '/results',
  '/schedule',
  '/driver-stats',
  '/analysis',
  '/drivers',
  '/calendar',
  '/season-stats',
])

export default function SeasonPicker() {
  const pathname = usePathname()
  const [season, setSeason] = useSeason()
  // The LIVE NOW pill owns the top-right corner while a session is running,
  // so drop below it rather than collide — both are `right: 16px`.
  const { live } = useLiveStatus()

  if (!pathname || !SEASON_ROUTES.has(pathname)) return null

  return (
    <motion.div
      className="glass-card"
      role="group"
      aria-label="Season"
      initial={{ opacity: 0, y: -18 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        position: 'fixed',
        top: live ? '58px' : '14px',
        right: '16px',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: '3px',
        padding: '5px 6px',
        boxShadow: '0 8px 20px rgba(0,0,0,0.4)',
      }}
    >
      {SEASONS.map(year => {
        const active = year === season
        return (
          <button
            key={year}
            type="button"
            className="font-num"
            onClick={() => setSeason(year)}
            aria-pressed={active}
            title={
              active
                ? `Showing the ${year} season`
                : `Switch to the ${year} season — the first load of a season can take a minute`
            }
            style={{
              padding: '4px 7px',
              borderRadius: 2,
              cursor: active ? 'default' : 'pointer',
              border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#fff' : 'var(--muted)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.02em',
              lineHeight: 1.2,
            }}
          >
            {year}
          </button>
        )
      })}
    </motion.div>
  )
}
