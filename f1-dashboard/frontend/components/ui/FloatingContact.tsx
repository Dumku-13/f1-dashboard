'use client'

/**
 * A small always-there way to reach the person who built this.
 *
 * Stacks directly above `BackToTop` in the bottom-right column — both read
 * `--chrome-bottom` from globals.css, this one offset by one button height.
 *
 * The destinations are real: the repository comes from the project's git
 * remote. If you fork this, change CONTACT_LINKS — a contact control that
 * points at someone else's inbox is worse than no contact control.
 *
 * No mailto here on purpose. A personal address on a public page is a
 * spam magnet and is not mine to publish; add one to CONTACT_LINKS if you
 * want direct email, ideally an alias rather than your main inbox.
 */

import { useEffect, useRef, useState } from 'react'
import { Bug, Lightbulb, MessageSquare, HelpCircle, X } from 'lucide-react'
import Link from 'next/link'

const REPO_URL = 'https://github.com/Dumku-13/f1-dashboard'

const CONTACT_LINKS = [
  { href: `${REPO_URL}/issues/new`, label: 'Report a bug', icon: Bug, external: true },
  { href: `${REPO_URL}/discussions`, label: 'Suggest a feature', icon: Lightbulb, external: true },
  { href: '/faq', label: 'Read the FAQ', icon: HelpCircle, external: false },
]

export default function FloatingContact() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus() }
    }
    // `mousedown`, not `click`: a click listener fires after the panel's own
    // link handler and would close before navigation is registered on touch.
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

  return (
    <div ref={rootRef} style={{ position: 'fixed', right: '16px', bottom: 'var(--chrome-bottom-row2)', zIndex: 57 }}>
      {open && (
        <div
          className="f1-card"
          style={{
            position: 'absolute',
            right: 0,
            bottom: '50px',
            width: '212px',
            padding: '7px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: '9px', fontWeight: 700,
            letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--muted)',
            padding: '7px 9px 8px',
          }}>
            Pit Wall Radio
          </div>
          {CONTACT_LINKS.map(({ href, label, icon: Icon, external }) => {
            const content = (
              <>
                <Icon size={14} aria-hidden style={{ flexShrink: 0 }} />
                <span>{label}</span>
              </>
            )
            const style: React.CSSProperties = {
              display: 'flex', alignItems: 'center', gap: '9px',
              padding: '9px', minHeight: '38px', borderRadius: '2px',
              fontSize: '12px', color: 'var(--foreground)', textDecoration: 'none',
            }
            return external ? (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="contact-link"
                style={style}
                onClick={() => setOpen(false)}
              >
                {content}
              </a>
            ) : (
              <Link key={href} href={href} className="contact-link" style={style} onClick={() => setOpen(false)}>
                {content}
              </Link>
            )
          })}
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        className="pit-chrome-button"
        aria-expanded={open}
        aria-label={open ? 'Close contact menu' : 'Contact and feedback'}
        style={{ width: '42px', height: '42px', display: 'grid', placeItems: 'center' }}
      >
        {open ? <X size={17} aria-hidden /> : <MessageSquare size={17} aria-hidden />}
      </button>
    </div>
  )
}
