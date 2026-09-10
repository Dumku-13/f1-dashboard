'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { X, Download, ExternalLink, CalendarPlus, Check, LoaderCircle } from 'lucide-react'
import { BACKEND_URL } from '@/lib/constants'
import CopyButton from '@/components/ui/CopyButton'
import { useSeason } from '@/lib/season'
import styles from './CalendarSyncModal.module.css'

const SESSION_MINUTES: Record<string, number> = {
  'Practice 1': 60, 'Practice 2': 60, 'Practice 3': 60,
  'Sprint Qualifying': 45, 'Sprint Shootout': 45, Sprint: 60, Qualifying: 60, Race: 120,
}
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export interface SyncTarget {
  year?: number
  round?: number
  eventName?: string
  location?: string
  sessions?: Record<string, string | null>
}

export default function CalendarSyncModal({ target, onClose }: { target: SyncTarget; onClose: () => void }) {
  const [selectedYear] = useSeason()
  const year = target.year ?? selectedYear
  const reduced = useReducedMotion()
  const dialog = useRef<HTMLDialogElement>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const [mounted, setMounted] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'saved' | 'error'>('idle')
  const [origin, setOrigin] = useState('https://f1-dashboard-web.onrender.com')
  const icsUrl = `${BACKEND_URL}/api/sessions/calendar/${year}/ics${target.round ? `?round=${target.round}` : ''}`
  const scope = target.round ? `${target.eventName || `Round ${target.round}`} weekend` : `${year} season`
  const sessions = Object.entries(target.sessions || {})
    .filter((entry): entry is [string, string] => !!entry[1] && Number.isFinite(Date.parse(entry[1])) && Date.parse(entry[1]) > Date.now())
    .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]))

  useEffect(() => { setMounted(true); setOrigin(window.location.origin) }, [])
  useEffect(() => {
    if (!mounted) return
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    dialog.current?.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      activeRequest.current?.abort()
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [mounted])

  async function download() {
    if (activeRequest.current) return
    const controller = new AbortController()
    activeRequest.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 35_000)
    setState('loading')
    try {
      const response = await fetch(icsUrl, { signal: controller.signal })
      if (!response.ok) throw new Error('Calendar unavailable')
      const content = await response.text()
      if (!content.startsWith('BEGIN:VCALENDAR') || !content.includes('BEGIN:VEVENT')) throw new Error('Invalid calendar')
      const objectUrl = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `f1-${year}${target.round ? `-round-${target.round}` : ''}.ics`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
      setState('saved')
    } catch {
      if (dialog.current?.open) setState('error')
    } finally {
      window.clearTimeout(timeout)
      activeRequest.current = null
    }
  }

  if (!mounted) return null
  return createPortal(
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="cal-sync-title" aria-describedby="cal-sync-description"
      onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
      <motion.div className={styles.content} initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.22 }}>
        <header className={styles.header}>
          <span className={styles.icon}><CalendarPlus size={25} aria-hidden="true" /></span>
          <button onClick={onClose} aria-label="Close calendar dialog" className={styles.close}><X size={20} /></button>
        </header>
        <h2 id="cal-sync-title">Make time for race day.</h2>
        <p id="cal-sync-description" className={styles.intro}>Add the {scope} to your calendar. Session times appear in your calendar’s timezone.</p>
        <section className={styles.download} aria-labelledby="calendar-file-title">
          <h3 id="calendar-file-title">{target.round ? 'The whole weekend, one file' : 'The whole season, one file'}</h3>
          <p>Import into Apple Calendar, Outlook or Google Calendar. Includes 30-minute reminders; session durations are estimates.</p>
          <button className={styles.primary} onClick={download} disabled={state === 'loading'}>
            {state === 'loading' ? <LoaderCircle size={17} className={styles.spin} /> : state === 'saved' ? <Check size={17} /> : <Download size={17} />}
            {state === 'loading' ? 'Preparing calendar…' : state === 'saved' ? 'Download again' : state === 'error' ? 'Retry download' : 'Download calendar'}
          </button>
          <div aria-live="polite" className={styles.feedback}>
            {state === 'saved' && <span>File prepared. Open it from Downloads to import your sessions.</span>}
            {state === 'error' && <span role="alert">The calendar could not be downloaded. The server may be waking up. Please retry.</span>}
          </div>
          <a className={styles.textLink} href="https://calendar.google.com/calendar/u/0/r/settings/export" target="_blank" rel="noreferrer">Google Calendar import page <ExternalLink size={14} /></a>
        </section>
        {sessions.length > 0 && <section className={styles.quickAdd} aria-labelledby="google-add-title">
          <h3 id="google-add-title">Just one session?</h3><p>Open a prefilled Google Calendar event, then save it there. Reminders follow your Google Calendar settings.</p>
          <div className={styles.sessions}>{sessions.map(([name, iso]) => {
            const start = new Date(iso)
            const end = new Date(start.getTime() + (SESSION_MINUTES[name] || 60) * 60_000)
            const params = new URLSearchParams({ action: 'TEMPLATE', text: `${target.eventName || 'Formula 1'} — ${name}`, dates: `${stamp(start)}/${stamp(end)}`, location: target.location || '', details: `F1 Dashboard: ${origin}/live\nSession duration is an estimate.` })
            return <a key={name} href={`https://calendar.google.com/calendar/render?${params}`} target="_blank" rel="noreferrer">{name}<ExternalLink size={13} /></a>
          })}</div>
        </section>}
        <details className={styles.subscription}><summary>Keep session times up to date</summary><p>Add this link as a calendar subscription. Your calendar app controls how often it refreshes.</p>
          <div><code>{new URL(icsUrl, origin).toString()}</code><CopyButton value={new URL(icsUrl, origin).toString()} label="Copy link" describes="the calendar subscription link" /></div>
        </details>
      </motion.div>
    </dialog>, document.body,
  )
}
