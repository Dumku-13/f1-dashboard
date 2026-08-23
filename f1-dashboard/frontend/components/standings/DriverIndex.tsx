'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Gauge } from 'lucide-react'
import { TEAM_COLORS } from '@/lib/constants'
import { hexColor } from '@/lib/utils'
import type { DriverStanding } from '@/lib/types'

export interface DriverIndexRow {
  driver: DriverStanding
  index: number
  share: number
  teammate: string | null
}

/**
 * Driver of the Season index — "who is getting the most out of their car".
 * 65% weight: share of the team's points scored by this driver (car-relative,
 * so a driver crushing their teammate in a slow car ranks high). 35% weight:
 * raw points vs the championship leader (so the index still respects results).
 */
export function computeDriverIndex(drivers: DriverStanding[]): DriverIndexRow[] {
  const byTeam = new Map<string, DriverStanding[]>()
  drivers.forEach(d => {
    const arr = byTeam.get(d.team) || []
    arr.push(d)
    byTeam.set(d.team, arr)
  })
  const maxPts = Math.max(1, ...drivers.map(d => d.points))

  return drivers
    .map(d => {
      const squad = byTeam.get(d.team) || [d]
      const teamPts = squad.reduce((s, x) => s + x.points, 0)
      const share = teamPts > 0 ? d.points / teamPts : 1 / Math.max(1, squad.length)
      const perf = d.points / maxPts
      const teammate = squad.find(x => x.abbreviation !== d.abbreviation)?.abbreviation ?? null
      return {
        driver: d,
        share,
        teammate,
        index: Math.round(100 * (0.65 * share + 0.35 * perf)),
      }
    })
    .sort((a, b) => b.index - a.index)
}

export default function DriverIndex({ drivers, limit = 10 }: { drivers: DriverStanding[]; limit?: number }) {
  const rows = useMemo(() => computeDriverIndex(drivers).slice(0, limit), [drivers, limit])
  const top = rows[0]?.index || 100

  return (
    <div className="glass-card" style={{ padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '4px' }}>
        <h2 className="section-title" style={{ ['--bar' as string]: '#BF00FF' }}>
          <Gauge size={14} style={{ marginRight: '-4px', color: '#BF00FF' }} />
          Driver of the Season Index
        </h2>
      </div>
      <div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '18px' }}>
        Who&apos;s extracting the most from their car — weighted 65% share of team points (teammate battle), 35% raw season points.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
        {rows.map((r, i) => {
          const color = hexColor(r.driver.team_color) || TEAM_COLORS[r.driver.team] || '#555'
          return (
            <motion.div
              key={r.driver.abbreviation}
              initial={{ opacity: 0, x: -18 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, type: 'spring', stiffness: 260, damping: 26 }}
              style={{ display: 'grid', gridTemplateColumns: '28px 64px 1fr 46px', alignItems: 'center', gap: '10px' }}
            >
              <span className="font-num" style={{ fontSize: '13px', fontWeight: 800, color: i === 0 ? '#FFD700' : i < 3 ? '#D1D5DB' : 'var(--muted)' }}>
                {i + 1}
              </span>
              <span>
                <span className="font-display" style={{ fontWeight: 800, fontSize: '14px' }}>{r.driver.abbreviation}</span>
                <span style={{ display: 'block', fontSize: '9px', color: 'var(--muted)' }}>
                  {Math.round(r.share * 100)}% of {r.driver.team.split(' ')[0]} pts{r.teammate ? ` vs ${r.teammate}` : ''}
                </span>
              </span>
              <div style={{ height: '10px', borderRadius: '5px', background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                <motion.div
                  initial={{ width: 0 }}
                  whileInView={{ width: `${(r.index / top) * 100}%` }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 + 0.15, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                  style={{ height: '100%', borderRadius: '5px', background: `linear-gradient(90deg, ${color}88, ${color})`, boxShadow: `0 0 10px ${color}66` }}
                />
              </div>
              <span className="font-num" style={{ fontSize: '14px', fontWeight: 800, textAlign: 'right', color: i === 0 ? '#FFD700' : '#E5E7EB' }}>
                {r.index}
              </span>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
