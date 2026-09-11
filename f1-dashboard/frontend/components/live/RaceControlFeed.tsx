'use client'

import { useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Flag, Pause, Play, Radio, Search } from 'lucide-react'
import type { LiveRaceControl } from '@/lib/live'
import { FLAG_COLORS } from '@/lib/constants'
import { controlId, filterControl, normalizeControl, unseenControlCount, type ControlFilter } from '@/lib/raceControl'
import styles from './RaceControlFeed.module.css'

export default function RaceControlFeed({ items }: { items: LiveRaceControl[] }) {
  const reducedMotion = useReducedMotion()
  const latest = useMemo(() => normalizeControl(items), [items])
  const [frozen, setFrozen] = useState<LiveRaceControl[] | null>(null)
  const [filter, setFilter] = useState<ControlFilter>('all')
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const visible = filterControl(frozen ?? latest, filter, query)
  const unread = frozen ? unseenControlCount(latest, new Set(frozen.map(controlId))) : 0

  function togglePause() {
    if (frozen) {
      setFrozen(null)
      listRef.current?.scrollTo({ top: 0 })
    } else setFrozen([...latest])
  }

  return (
    <section className={`glass-card ${styles.panel}`} aria-label="Race Control messages">
      <header className={styles.header}>
        <div className={styles.title}><Radio size={15} /><h2 className="section-title">Race Control</h2></div>
        <button className={styles.button} onClick={togglePause} aria-pressed={frozen !== null}>
          {frozen ? <Play size={13} /> : <Pause size={13} />}
          {frozen ? 'Resume feed' : 'Pause to read'}
        </button>
      </header>
      <div className={styles.tools}>
        <div className={styles.filters} role="group" aria-label="Message category">
          {(['all', 'flags', 'incidents'] as const).map(value => (
            <button key={value} className={styles.button} aria-pressed={filter === value} onClick={() => { setFilter(value); listRef.current?.scrollTo({ top: 0 }) }}>
              {{ all: 'All', flags: 'Flags & safety', incidents: 'Incidents' }[value]}
            </button>
          ))}
        </div>
        <label className={styles.search}>
          <Search size={14} aria-hidden="true" />
          <input type="search" aria-label="Search Race Control" placeholder="Search driver number or message…" value={query} onChange={event => setQuery(event.target.value)} />
        </label>
      </div>
      {frozen !== null && <div className={styles.paused}>
        <span role="status">Reading paused · {unread} new {unread === 1 ? 'message' : 'messages'}</span>
        <button className={styles.button} onClick={togglePause}>Catch up <Play size={12} /></button>
        <small>Timing and alerts keep updating. Count includes all categories.</small>
      </div>}
      <div className={styles.meta}>{visible.length} {visible.length === 1 ? 'message' : 'messages'} · Newest first · Times in IST</div>
      <div ref={listRef} className={styles.messages} tabIndex={0} role="region" aria-label="Scrollable Race Control feed">
        {visible.length === 0 && <p className={styles.empty}>{latest.length === 0 && !frozen ? 'Race Control messages will appear here when available.' : 'No matching messages. Try another filter or search.'}</p>}
        {visible.map(item => {
          const timestamp = Date.parse(item.date)
          return <motion.article key={controlId(item)} className={styles.message}
            initial={reducedMotion ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }}>
            <Flag size={14} className={styles.flag} style={{ color: item.flag ? FLAG_COLORS[item.flag.toUpperCase().replaceAll(' ', '_')] : undefined }} aria-hidden="true" />
            <div>
              {item.flag && <span className={styles.flagLabel}>{item.flag.replaceAll('_', ' ')}</span>}
              <p>{item.message}</p>
              <div className={`font-num ${styles.time}`}>
                {item.lap_number != null && `LAP ${item.lap_number} · `}
                {Number.isFinite(timestamp) ? <time dateTime={item.date}>{new Date(timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}</time> : 'Time unavailable'}
              </div>
            </div>
          </motion.article>
        })}
      </div>
    </section>
  )
}
