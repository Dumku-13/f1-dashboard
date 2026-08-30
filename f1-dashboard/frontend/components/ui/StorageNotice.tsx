'use client'

/**
 * The "cookie banner" — except this app sets no cookies and runs no
 * third-party analytics, so a consent wall would be theatre. What it actually
 * does is keep things in *your* browser's localStorage: paddock name, wallet,
 * achievements, theme, and the auth token when you sign in. None of that
 * leaves the device except the requests you make by using the site.
 *
 * So this says that, once, and gets out of the way. There is no "reject"
 * button because there is nothing to reject — the storage listed above is what
 * makes the feature work at all, and offering a fake choice is worse than
 * offering none.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Database } from 'lucide-react'

const DISMISSED_KEY = 'f1.storage-notice'

export default function StorageNotice() {
  // Starts hidden and is only shown after mount: reading localStorage during
  // render would mismatch the server's HTML and React would throw it away.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(DISMISSED_KEY)) setVisible(true)
    } catch {
      // Storage disabled entirely (private mode, locked-down browser). Saying
      // "we store things locally" to someone who has turned that off is noise.
    }
  }, [])

  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())) } catch { /* nothing to persist to */ }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="region"
      aria-label="Local storage notice"
      className="f1-card storage-notice"
      style={{
        position: 'fixed',
        left: '16px',
        bottom: 'var(--chrome-bottom)',
        // Above the offline banner (z-90) so a dismissable one-off is never
        // trapped under a persistent status bar.
        zIndex: 95,
        maxWidth: '330px',
        padding: '13px 15px',
        display: 'flex',
        gap: '11px',
        alignItems: 'flex-start',
      }}
    >
      <Database size={15} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: '2px' }} aria-hidden />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: '10px', fontWeight: 700,
          letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--foreground)',
          marginBottom: '5px',
        }}>
          Stays in this browser
        </div>
        <p style={{ margin: 0, fontSize: '12px', lineHeight: 1.5, color: 'var(--muted)' }}>
          No cookies, no trackers. Your paddock name, settings and progress are
          saved locally on this device.{' '}
          <Link href="/faq" style={{ color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: '2px' }}>
            What&apos;s stored
          </Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="pit-chrome-button"
          style={{
            marginTop: '10px', padding: '6px 13px', minHeight: '32px',
            fontFamily: 'var(--font-display)', fontSize: '9px', fontWeight: 700,
            letterSpacing: '0.16em', textTransform: 'uppercase',
          }}
        >
          Understood
        </button>
      </div>
    </div>
  )
}
