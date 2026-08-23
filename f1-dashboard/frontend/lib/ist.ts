// IST = UTC+5:30 (Asia/Kolkata)
export const IST_TIMEZONE = 'Asia/Kolkata'

/**
 * Parse a timestamp as emitted by the backend.
 *
 * FastF1 timestamps are stringified with `str(pd.Timestamp)`, which yields
 * `"2026-03-06 12:30:00+11:00"` (space separator, not ISO `T`) for session
 * times and `"2026-03-08 00:00:00"` (no offset at all) for `event_date`.
 * `new Date()` handles neither reliably: the space form is engine-dependent,
 * and the offset-less form is read as *local* time, so every countdown drifts
 * by the viewer's UTC offset. Normalise both here.
 */
export function parseApiDate(value: string | Date | null | undefined): Date {
  if (!value) return new Date(NaN)
  if (value instanceof Date) return value
  const iso = value.trim().replace(' ', 'T')
  // Already carries an offset (or Z)? Trust it. Otherwise it's naive UTC.
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`)
}

export function toIST(utcString: string | Date): Date {
  return parseApiDate(utcString)
}

export function formatIST(utcString: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = parseApiDate(utcString)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-IN', {
    timeZone: IST_TIMEZONE,
    ...options,
  })
}

export function formatISTDate(utcString: string | Date): string {
  return formatIST(utcString, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatISTTime(utcString: string | Date): string {
  return formatIST(utcString, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatISTDateTime(utcString: string | Date): string {
  return formatIST(utcString, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function countdownTo(targetUTC: string): { days: number; hours: number; minutes: number; seconds: number; past: boolean } {
  const now = Date.now()
  const target = parseApiDate(targetUTC).getTime()
  const diff = target - now

  if (Number.isNaN(diff) || diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, past: true }
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((diff % (1000 * 60)) / 1000)
  return { days, hours, minutes, seconds, past: false }
}

export function getGreeting(): string {
  // hourCycle h23 explicitly: with hour12:false some ICU builds use h24 and
  // return "24" at midnight, which falls through every branch below.
  const hour = new Date().toLocaleString('en-GB', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    hourCycle: 'h23',
  })
  const h = parseInt(hour, 10)
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  if (h >= 17 && h < 21) return 'Good evening'
  return 'Burning the midnight oil'
}

export function formatLapTime(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '—'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toFixed(3).padStart(6, '0')}`
}

export function formatGap(seconds: number | null, reference?: number | null): string {
  if (seconds === null || seconds === undefined) return '—'
  if (reference !== undefined && reference !== null) {
    const gap = seconds - reference
    if (gap === 0) return 'LEADER'
    return `+${gap.toFixed(3)}`
  }
  return `+${seconds.toFixed(3)}`
}
