'use client'

/**
 * "Add to calendar" dialog. A bare .ics download is a dead end on Windows —
 * the OS hands the file to Outlook even when the user's calendar is Google —
 * so each calendar app gets its own explicit flow:
 *  - Google: quick-add links (no file involved) or download + import page
 *  - Apple / Outlook: download the .ics and open it
 */

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Download, ExternalLink, CalendarPlus, Check } from 'lucide-react'
import { BACKEND_URL } from '@/lib/constants'
import { useSeason } from '@/lib/season'

const GOOGLE_IMPORT_URL = 'https://calendar.google.com/calendar/u/0/r/settings/export'

// Mirrors _SESSION_DURATION_MIN in backend/routers/sessions.py
const SESSION_MINUTES: Record<string, number> = {
  'Practice 1': 60, 'Practice 2': 60, 'Practice 3': 60,
  'Sprint Qualifying': 45, 'Sprint Shootout': 45, 'Sprint': 60,
  'Qualifying': 60, 'Race': 120,
}

function toGoogleStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** Prefilled Google Calendar "create event" link — works without any file. */
function googleQuickAddUrl(title: string, startIso: string, minutes: number, location: string): string {
  const start = new Date(startIso)
  const end = new Date(start.getTime() + minutes * 60000)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${toGoogleStamp(start)}/${toGoogleStamp(end)}`,
    location,
    details: 'F1 Dashboard — live timing at http://localhost:3000/live',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export interface SyncTarget {
  /** undefined = whole season */
  round?: number
  eventName?: string
  location?: string
  sessions?: Record<string, string | null>
}

interface Props {
  target: SyncTarget
  onClose: () => void
}

export default function CalendarSyncModal({ target, onClose }: Props) {
  const [downloaded, setDownloaded] = useState(false)
  // Follows the season picker: round numbers are only meaningful inside a
  // season, so exporting round 5 of the year on screen must not hand back
  // round 5 of a different year.
  const [year] = useSeason()
  const icsUrl = `${BACKEND_URL}/api/sessions/calendar/${year}/ics${target.round ? `?round=${target.round}` : ''}`
  const scope = target.round ? `${target.eventName} weekend` : `full ${year} season`

  const download = () => {
    // Anchor with download attr keeps the browser from navigating away;
    // the backend already sends Content-Disposition: attachment.
    const a = document.createElement('a')
    a.href = icsUrl
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
    setDownloaded(true)
  }

  // Escape closes, matching the backdrop click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const upcomingSessions = Object.entries(target.sessions || {}).filter(
    (entry): entry is [string, string] => !!entry[1] && new Date(entry[1]).getTime() > Date.now()
  )

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.78)',
          display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: '16px',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cal-sync-title"
          className="glass-card"
          style={{
            width: '100%', maxWidth: '440px', maxHeight: '85vh', overflowY: 'auto',
            padding: '22px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
            <div>
              <h2 id="cal-sync-title" className="section-title" style={{ marginBottom: '6px' }}>Add to calendar</h2>
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                Every session of the {scope}, with 30-minute reminders
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '4px' }}>
              <X size={18} />
            </button>
          </div>

          {/* Google Calendar */}
          <div style={{ marginTop: '18px', padding: '14px', borderRadius: '2px', background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h2 className="section-title" style={{ fontSize: '11px', marginBottom: '8px' }}>Google Calendar</h2>
            <ol style={{ margin: '0 0 12px', paddingLeft: '18px', fontSize: '12px', color: 'var(--muted)', lineHeight: 1.7 }}>
              <li>Download the calendar file{downloaded && <Check size={12} style={{ color: 'var(--sector-green)', marginLeft: '6px', verticalAlign: '-2px' }} />}</li>
              <li>Open Google Calendar&apos;s import page</li>
              <li>Click <b style={{ color: 'var(--foreground)' }}>Select file from your computer</b>, pick the file, hit <b style={{ color: 'var(--foreground)' }}>Import</b></li>
            </ol>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={download} style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                background: 'var(--accent)', color: '#fff', border: 'none',
                borderRadius: '2px', padding: '8px 13px', fontSize: '11px', fontWeight: 700,
                fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>
                <Download size={13} /> 1. Download file
              </button>
              <a href={GOOGLE_IMPORT_URL} target="_blank" rel="noreferrer" style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: 'var(--surface)', color: 'var(--foreground)', textDecoration: 'none',
                border: '1px solid var(--border)',
                borderRadius: '2px', padding: '8px 13px', fontSize: '11px', fontWeight: 700,
                fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>
                <ExternalLink size={13} /> 2. Open import page
              </a>
            </div>
          </div>

          {/* Per-session quick add — no file, one click per session */}
          {upcomingSessions.length > 0 && (
            <div style={{ marginTop: '10px', padding: '14px', borderRadius: '2px', background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="section-title" style={{ fontSize: '11px', marginBottom: '4px' }}>Google quick add</h2>
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '10px' }}>
                No file needed — each link opens a prefilled Google Calendar event, one session at a time.
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {upcomingSessions.map(([name, date]) => (
                  <a
                    key={name}
                    href={googleQuickAddUrl(
                      `🏁 ${target.eventName} — ${name}`,
                      date,
                      SESSION_MINUTES[name] || 60,
                      target.location || '',
                    )}
                    target="_blank" rel="noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                      background: 'var(--card)', border: '1px solid var(--border)',
                      color: 'var(--foreground)', textDecoration: 'none', borderRadius: '2px',
                      padding: '5px 10px', fontSize: '11px', fontWeight: 600,
                      fontFamily: 'var(--font-display)',
                    }}
                  >
                    <CalendarPlus size={11} /> {name}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Apple / Outlook */}
          <div style={{ marginTop: '10px', padding: '14px', borderRadius: '2px', background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h2 className="section-title" style={{ fontSize: '11px', marginBottom: '4px' }}>Apple Calendar / Outlook</h2>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '10px', lineHeight: 1.6 }}>
              Download the file, then open it — your calendar app will offer to import all the events.
              On iPhone, open the file from Files/Downloads and tap <b style={{ color: 'var(--foreground)' }}>Add All</b>.
            </div>
            <button onClick={download} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
              background: 'var(--surface)', color: 'var(--foreground)', border: '1px solid var(--border)',
              borderRadius: '2px', padding: '8px 13px', fontSize: '11px', fontWeight: 700,
              fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              <Download size={13} /> Download .ics file
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
