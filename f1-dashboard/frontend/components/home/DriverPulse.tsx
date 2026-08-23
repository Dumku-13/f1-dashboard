'use client'

/**
 * Paddock Pulse — compact horizontal "heat strip" of the 8 hottest drivers
 * by popularity score (views/picks/mentions across the site). Self-fetching:
 * pulls /api/popularity/index for scores + /api/standings for team colors,
 * renders null on empty index or fetch failure so it's safe to drop anywhere.
 *
 * NOTE: not mounted anywhere yet — this component is built per Phase 9 spec
 * but the home page is a boundary file this task must not edit. See the
 * task's final report for the exact mount line.
 */

import { motion } from 'framer-motion'
import { Flame } from 'lucide-react'
import { TEAM_COLORS } from '@/lib/constants'
import { useApiList } from '@/lib/api/client'
import { useStandings, SEASON } from '@/lib/api/hooks'
import { hexColor } from '@/lib/utils'
import type { DriverStanding } from '@/lib/types'

interface PulseEntry {
  driver: string
  score_today: number
  score_7d: number
  trend: 'up' | 'down' | 'flat'
}

const TREND_ARROW: Record<PulseEntry['trend'], string> = {
  up: '▲',
  down: '▼',
  flat: '—',
}

const TREND_COLOR: Record<PulseEntry['trend'], string> = {
  up: '#00D131',
  down: '#E8002D',
  flat: 'var(--muted)',
}

export default function DriverPulse() {
  // Shares the standings request with the rest of the app via SWR instead of
  // issuing its own duplicate fetch.
  const { data: entries } = useApiList<PulseEntry>('/api/popularity/index')
  // Home-page widget — pinned to the current season, like the rest of home.
  const { data: standings } = useStandings(SEASON)

  const colors: Record<string, string> = {}
  ;(standings?.drivers || []).forEach(d => {
    colors[d.abbreviation] = hexColor(d.team_color) || TEAM_COLORS[d.team] || 'var(--muted)'
  })

  if (entries.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card"
      style={{ padding: '16px 18px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <Flame size={14} style={{ color: 'var(--accent)' }} />
        <h2 className="section-title" style={{ margin: 0 }}>Paddock Pulse</h2>
      </div>

      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px' }} className="hide-scrollbar">
        {entries.slice(0, 8).map((e, i) => {
          const color = colors[e.driver] || 'var(--muted)'
          return (
            <motion.div
              key={e.driver}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              style={{
                flex: '0 0 auto',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '10px',
                background: `${color}14`,
                border: `1px solid ${color}40`,
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '999px', background: color, flexShrink: 0 }} />
              <span className="font-num" style={{ fontSize: '13px', fontWeight: 800, color: '#fff' }}>{e.driver}</span>
              <span className="font-num" style={{ fontSize: '11px', color: '#9CA3AF' }}>{Math.round(e.score_7d)}</span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: TREND_COLOR[e.trend] }}>{TREND_ARROW[e.trend]}</span>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}
