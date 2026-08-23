'use client'

/**
 * Driver story — what has actually happened to one driver, in order.
 *
 * A timing screen is present-tense: it shows the state of the session right now
 * and forgets everything else. If you looked away for two minutes you have no
 * way to find out that your driver lost a place and pitted. This is the record
 * of that, derived by diffing successive snapshots rather than by asking the
 * backend for anything new.
 *
 * It reads the same delayed snapshots the tower does, so it can never narrate
 * an event the rest of the page hasn't shown yet.
 *
 * The derivation lives in `lib/story.ts` — free of JSX so it can be tested:
 * `node scripts/driver-story.test.mjs`.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { TowerRow, LiveRaceControl } from '@/lib/live'
import {
  snapshotOf, deriveEvents, raceControlFor, isBadNews,
  type StorySnap, type StoryTone,
} from '@/lib/story'

interface StoryEvent {
  id: string
  t: number
  lap: number | null
  text: string
  detail?: string
  tone: StoryTone
}

const MAX_EVENTS = 40

const TONE_COLOR: Record<StoryTone, string> = {
  good: 'var(--sector-green)',
  bad: '#FF6B7F',
  purple: 'var(--sector-purple)',
  neutral: 'var(--foreground)',
}

export default function DriverStory({
  rows,
  raceControl,
  following,
}: {
  rows: TowerRow[]
  raceControl: LiveRaceControl[]
  following: string | null
}) {
  const me = useMemo(
    () => rows.find(r => r.driver.name_acronym === following) || null,
    [rows, following],
  )

  const prev = useRef<StorySnap | null>(null)
  const seq = useRef(0)
  const [events, setEvents] = useState<StoryEvent[]>([])

  useEffect(() => { prev.current = null; setEvents([]) }, [following])

  useEffect(() => {
    if (!me) return
    const now = snapshotOf(me, rows)
    const made = deriveEvents(prev.current, now, rows)
    prev.current = now
    if (!made.length) return
    const stamped = made.map(e => ({
      ...e,
      id: `e${seq.current++}`,
      t: Date.now(),
      lap: me.lapsDone || null,
    }))
    setEvents(e => [...stamped.reverse(), ...e].slice(0, MAX_EVENTS))
  }, [rows, me])

  const mine = useMemo(() => {
    if (!me) return []
    return raceControlFor(raceControl, me.driver.name_acronym, me.driver.driver_number)
      .map<StoryEvent>((m, i) => {
        const rc = m as LiveRaceControl
        return {
          id: `rc-${rc.date}-${i}`,
          t: Date.parse(rc.date) || 0,
          lap: rc.lap_number,
          text: rc.message,
          detail: 'race control',
          tone: isBadNews(rc.message, rc.flag) ? 'bad' : 'neutral',
        }
      })
  }, [raceControl, me])

  const feed = useMemo(
    () => [...events, ...mine].sort((a, b) => b.t - a.t).slice(0, MAX_EVENTS),
    [events, mine],
  )

  if (!following) {
    return (
      <div style={{ padding: 22, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
        Pin a driver and everything that happens to them lands here — places won and lost,
        stops, personal bests, and the race-control messages that name them.
      </div>
    )
  }

  if (!feed.length) {
    return (
      <div style={{ padding: 22, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
        Nothing yet for {following}. This fills in as the session runs — it only records
        what changes while you have the page open.
      </div>
    )
  }

  return (
    <div style={{ maxHeight: 420, overflowY: 'auto' }}>
      {feed.map(ev => (
        <div
          key={ev.id}
          style={{
            display: 'grid', gridTemplateColumns: '38px minmax(0, 1fr)', gap: 10,
            padding: '10px 14px', borderBottom: '1px solid var(--hairline)',
            borderLeft: `2px solid ${ev.tone === 'neutral' ? 'transparent' : TONE_COLOR[ev.tone]}`,
          }}
        >
          <span className="font-num" style={{ fontSize: 10, color: 'var(--muted)', paddingTop: 2 }}>
            {ev.lap != null ? `L${ev.lap}` : '—'}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ fontSize: 12, lineHeight: 1.45, color: TONE_COLOR[ev.tone] }}>
              {ev.text}
            </span>
            {ev.detail && (
              <span className="font-num" style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 7 }}>
                {ev.detail}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
