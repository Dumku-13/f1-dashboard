'use client'

/**
 * The confirmation step for actions that cannot be undone — deleting a post,
 * clearing a fantasy team, signing out of a session.
 *
 * Controlled rather than imperative (`confirm()`-style promise APIs read
 * nicely and then fight React's rendering model). Rendered through a portal so
 * a parent's `overflow: hidden` or stacking context cannot clip it — the feed
 * card that triggers a delete is exactly such a parent.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const restoreFocusTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    // Remember what had focus so it can be handed back on close; without this
    // a keyboard user is dumped at the top of the document every time.
    restoreFocusTo.current = document.activeElement as HTMLElement | null
    confirmRef.current?.focus()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key !== 'Tab') return
      // Focus trap. Two buttons is a small enough set to handle directly, but
      // query the DOM rather than assume, so adding a link to the body later
      // does not silently break the cycle.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      restoreFocusTo.current?.focus?.()
    }
  }, [open, onCancel])

  // Portals need a DOM to render into, so nothing before mount.
  if (typeof document === 'undefined') return null

  const danger = tone === 'danger'

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
          style={{
            position: 'fixed',
            inset: 0,
            // Above the toasters at z-200: a confirmation is the one thing on
            // screen the user must answer before anything else matters.
            zIndex: 300,
            background: 'rgba(0,0,0,0.78)',
            display: 'grid',
            placeItems: 'center',
            padding: '20px',
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby={body ? 'confirm-dialog-body' : undefined}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
            className="f1-card"
            style={{ width: '100%', maxWidth: '400px', padding: '20px' }}
          >
            <div style={{ display: 'flex', gap: '11px', alignItems: 'flex-start' }}>
              {danger && (
                <AlertTriangle size={17} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '2px' }} aria-hidden />
              )}
              <div style={{ minWidth: 0 }}>
                <h2
                  id="confirm-dialog-title"
                  style={{
                    margin: 0,
                    fontFamily: 'var(--font-display)',
                    fontSize: '15px',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    color: 'var(--foreground)',
                  }}
                >
                  {title}
                </h2>
                {body && (
                  <p
                    id="confirm-dialog-body"
                    style={{ margin: '8px 0 0', fontSize: '13px', lineHeight: 1.55, color: 'var(--muted)' }}
                  >
                    {body}
                  </p>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '18px' }}>
              <button
                type="button"
                onClick={onCancel}
                className="pit-chrome-button"
                style={{
                  padding: '9px 15px', minHeight: '38px',
                  fontFamily: 'var(--font-display)', fontSize: '10px', fontWeight: 700,
                  letterSpacing: '0.16em', textTransform: 'uppercase',
                }}
              >
                {cancelLabel}
              </button>
              <button
                ref={confirmRef}
                type="button"
                onClick={onConfirm}
                className="pit-chrome-button"
                style={{
                  padding: '9px 15px', minHeight: '38px',
                  fontFamily: 'var(--font-display)', fontSize: '10px', fontWeight: 700,
                  letterSpacing: '0.16em', textTransform: 'uppercase',
                  background: danger ? 'var(--accent)' : 'var(--surface)',
                  borderColor: danger ? 'var(--accent)' : 'var(--border)',
                  color: danger ? '#fff' : 'var(--foreground)',
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
