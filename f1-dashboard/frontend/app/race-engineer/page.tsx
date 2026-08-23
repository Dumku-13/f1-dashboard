'use client'

/**
 * Race Engineering — the standalone page.
 *
 * Pick a completed round and a driver, plan a tyre strategy, and see where it
 * would have put them against the real classification. The builder itself lives
 * in `components/engineer/RaceEngineer.tsx` so Follow Along can embed the same
 * thing without a second implementation.
 */

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Wrench } from 'lucide-react'
import { useCalendar, useStandings, useLatestCompletedRound, useRaceLaps } from '@/lib/api/hooks'
import { useSeason } from '@/lib/season'
import RaceEngineer from '@/components/engineer/RaceEngineer'

export default function RaceEngineerPage() {
  const [season] = useSeason()
  const { data: calendar } = useCalendar(season)
  const { data: standings } = useStandings(season)
  const { round: latest } = useLatestCompletedRound(season)

  const [round, setRound] = useState<number | null>(null)
  const [driver, setDriver] = useState<string | null>(null)

  useEffect(() => { setRound(null); setDriver(null) }, [season])
  useEffect(() => { if (round === null && latest) setRound(latest) }, [latest, round])

  const completed = useMemo(
    () => calendar.filter(ev => new Date(ev.event_date).getTime() < Date.now()),
    [calendar],
  )
  const drivers = standings?.drivers || []

  useEffect(() => {
    if (!driver && drivers.length) setDriver(drivers[0].abbreviation)
  }, [drivers, driver])

  // Real race distance for this round — the calendar has no lap count, so this
  // resolves it through the circuit record. 57 was wrong for most circuits.
  const totalLaps = useRaceLaps(round, season) ?? 57

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} style={{ marginBottom: 18 }}>
        <div className="kicker" style={{ marginBottom: 8 }}>{season} Season</div>
        <h1 className="display-title" style={{ fontSize: 'clamp(24px, 4vw, 40px)', margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <motion.span initial={{ rotate: -20, scale: 0.7, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} transition={{ delay: 0.2, type: 'spring', stiffness: 260, damping: 18 }} style={{ display: 'inline-flex' }}>
            <Wrench size={30} style={{ color: 'var(--accent)' }} />
          </motion.span>
          Race Engineering
        </h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, duration: 0.5 }} style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 660, lineHeight: 1.55 }}>
          Build a tyre strategy and see where it would have finished. Pace and degradation are
          fitted from the actual race, so the answer is grounded — but it&apos;s still a model,
          not a result.
        </motion.p>
      </motion.div>

      {/* Round */}
      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15, duration: 0.4, ease: 'easeOut' }} style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <span className="font-display" style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--muted)', marginRight: 4 }}>
          Round
        </span>
        {completed.map((ev, i) => (
          <motion.button
            key={ev.round}
            onClick={() => setRound(ev.round)}
            title={ev.name}
            aria-label={`Round ${ev.round} — ${ev.name}`}
            aria-pressed={ev.round === round}
            className="font-num"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 + i * 0.02, duration: 0.3, ease: 'easeOut' }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.95 }}
            style={{
              position: 'relative',
              padding: '6px 10px', borderRadius: 2, cursor: 'pointer', minWidth: 38, minHeight: 40,
              border: `1px solid ${ev.round === round ? 'var(--accent)' : 'var(--border)'}`,
              background: ev.round === round ? 'var(--accent)' : 'transparent',
              color: ev.round === round ? '#fff' : 'var(--foreground)',
              fontSize: 11, fontWeight: 700,
              transition: 'background 0.25s ease, border-color 0.25s ease, color 0.25s ease',
            }}
          >
            R{ev.round}
          </motion.button>
        ))}
      </motion.div>

      {/* Driver */}
      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25, duration: 0.4, ease: 'easeOut' }} style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 18, alignItems: 'center' }}>
        <span className="font-display" style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--muted)', marginRight: 4 }}>
          Driver
        </span>
        {drivers.map((d, i) => {
          const on = d.abbreviation === driver
          const colour = d.team_color ? `#${String(d.team_color).replace('#', '')}` : 'var(--border)'
          return (
            <motion.button
              key={d.abbreviation}
              onClick={() => setDriver(d.abbreviation)}
              aria-pressed={on}
              className="font-display"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.02, duration: 0.3, ease: 'easeOut' }}
              whileHover={{ scale: 1.06, y: -1 }}
              whileTap={{ scale: 0.95 }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 11px', borderRadius: 2, cursor: 'pointer', minHeight: 40,
                border: `1px solid ${on ? colour : 'var(--border)'}`,
                background: on ? `color-mix(in srgb, ${colour} 22%, transparent)` : 'transparent',
                color: 'var(--foreground)', fontSize: 11, fontWeight: 700,
                transition: 'background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease',
                boxShadow: on ? `0 0 12px ${colour}33` : 'none',
              }}
            >
              <motion.span
                style={{ width: 3, height: 13, background: colour, borderRadius: 1 }}
                animate={{ height: on ? 17 : 13 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              />
              {d.abbreviation}
            </motion.button>
          )
        })}
      </motion.div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${round}-${driver}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <RaceEngineer year={season} round={round} driver={driver} totalLaps={totalLaps} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
