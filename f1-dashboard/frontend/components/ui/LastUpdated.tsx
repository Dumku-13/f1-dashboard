'use client'

/**
 * "Updated 4 min ago" — a freshness stamp for data that arrives on a poll.
 *
 * On a race weekend the difference between a timing screen that is four
 * seconds old and one that is four minutes old is the whole point, and a table
 * gives no sign of which it is showing. This says so.
 *
 * Absolute time goes in the `title` and in a real `<time dateTime>` so the
 * exact value is one hover (or one screen reader) away, and it is rendered in
 * IST via lib/ist to match every other timestamp in the app.
 */

import { useEffect, useState } from 'react'
import { formatISTDateTime, parseApiDate } from '@/lib/ist'

interface LastUpdatedProps {
  timestamp: number | string | Date | null | undefined
  /** Leading word, e.g. "Data from". Defaults to "Updated". */
  prefix?: string
  style?: React.CSSProperties
}

/** Seconds-resolution while it matters, then coarser — nobody needs
 *  "updated 3,847 seconds ago". */
function relative(from: Date, now: number): string {
  const seconds = Math.max(0, Math.round((now - from.getTime()) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** How often to re-render, chosen from how old the value already is: a stamp
 *  that says "2d ago" does not need a tick every second. */
function intervalFor(ageMs: number): number {
  if (ageMs < 60_000) return 1_000
  if (ageMs < 3_600_000) return 30_000
  return 300_000
}

export default function LastUpdated({ timestamp, prefix = 'Updated', style }: LastUpdatedProps) {
  const [now, setNow] = useState(() => Date.now())

  // Numbers from the backend are epoch *seconds* (time.time()); Date and ISO
  // strings go through the app's shared parser, which handles FastF1's
  // space-separated, offset-less format.
  const date =
    timestamp == null
      ? null
      : typeof timestamp === 'number'
        ? new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp)
        : parseApiDate(timestamp)

  const valid = date !== null && !Number.isNaN(date.getTime())
  const ageMs = valid ? Date.now() - date.getTime() : 0

  useEffect(() => {
    if (!valid) return
    const id = setInterval(() => setNow(Date.now()), intervalFor(ageMs))
    return () => clearInterval(id)
  }, [valid, ageMs])

  // Nothing to say beats "Updated Invalid Date".
  if (!valid || !date) return null

  const absolute = formatISTDateTime(date)

  return (
    <time
      dateTime={date.toISOString()}
      title={`${absolute} IST`}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--muted)',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {prefix} {relative(date, now)}
    </time>
  )
}
