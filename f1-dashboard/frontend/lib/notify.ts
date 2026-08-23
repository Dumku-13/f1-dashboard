'use client'

/**
 * Session notifications while the site is open — fires browser notifications
 * at T-30min, T-5min and lights-out for every upcoming session. Calendar
 * (.ics) export covers the site-closed case; this covers browsing the site.
 */

import { useEffect, useState, useCallback } from 'react'
import { useCalendar, SEASON } from '@/lib/api/hooks'
import { BACKEND_URL } from '@/lib/constants'
import type { CalendarEvent } from '@/lib/types'

const ENABLED_KEY = 'f1.notify.enabled'
const FIRED_KEY = 'f1.notify.fired'
const CHECK_MS = 60_000

interface Milestone {
  offsetMs: number
  label: (name: string) => string
}

const MILESTONES: Milestone[] = [
  { offsetMs: 30 * 60_000, label: n => `${n} starts in 30 minutes` },
  { offsetMs: 5 * 60_000, label: n => `${n} starts in 5 minutes — get to /live!` },
  { offsetMs: 0, label: n => `${n} is GO! Live timing is running 🏁` },
]

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationsEnabled(): boolean {
  return (
    notificationsSupported() &&
    Notification.permission === 'granted' &&
    localStorage.getItem(ENABLED_KEY) === '1'
  )
}

export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return false
  localStorage.setItem(ENABLED_KEY, '1')
  new Notification('F1 Dashboard', {
    body: "Session alerts on — you'll hear from us 30 min before every session.",
    icon: '/favicon.ico',
  })
  return true
}

export function disableNotifications() {
  localStorage.setItem(ENABLED_KEY, '0')
}

function firedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FIRED_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

function markFired(id: string) {
  const s = firedSet()
  s.add(id)
  // keep the ledger small — only recent entries matter
  localStorage.setItem(FIRED_KEY, JSON.stringify([...s].slice(-200)))
}

function checkSessions(calendar: CalendarEvent[]) {
  if (!notificationsEnabled()) return
  const now = Date.now()
  const fired = firedSet()

  calendar.forEach(ev => {
    Object.entries(ev.sessions || {}).forEach(([sessionName, dateStr]) => {
      if (!dateStr) return
      const start = new Date(dateStr).getTime()
      if (Number.isNaN(start)) return
      MILESTONES.forEach((m, mi) => {
        const fireAt = start - m.offsetMs
        const id = `${ev.round}-${sessionName}-${mi}`
        // fire when we're within the check window past the milestone
        if (now >= fireAt && now < fireAt + CHECK_MS * 2 && now < start + 60_000 && !fired.has(id)) {
          markFired(id)
          new Notification(`🏁 ${ev.name}`, {
            body: m.label(sessionName),
            icon: '/favicon.ico',
            tag: id,
          })
        }
      })
    })
  })
}

/** Mount once (in the root layout) — polls the calendar and fires alerts. */
export function useSessionNotifications() {
  // Rides the shared SWR calendar entry rather than issuing its own request —
  // this hook is mounted in the root layout, so it ran on EVERY page load.
  // Pinned to the current season on purpose: this is a background alarm for
  // sessions that are about to happen, so browsing a past season in the picker
  // must not silence it (or, worse, schedule alerts for races long finished).
  const { data: calendar } = useCalendar(SEASON)

  useEffect(() => {
    if (!notificationsSupported()) return
    const tick = setInterval(() => checkSessions(calendar), CHECK_MS)
    return () => clearInterval(tick)
  }, [calendar])
}

/** Settings toggle state for the calendar page. */
export function useNotificationToggle() {
  const [enabled, setEnabled] = useState(false)
  const [supported, setSupported] = useState(true)

  useEffect(() => {
    setSupported(notificationsSupported())
    setEnabled(notificationsEnabled())
  }, [])

  const toggle = useCallback(async () => {
    if (notificationsEnabled()) {
      disableNotifications()
      setEnabled(false)
    } else {
      setEnabled(await enableNotifications())
    }
  }, [])

  return { enabled, supported, toggle }
}
