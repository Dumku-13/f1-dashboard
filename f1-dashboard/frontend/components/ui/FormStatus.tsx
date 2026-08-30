'use client'

/**
 * One status strip for form feedback, so success and failure look like two
 * states of the same control rather than two unrelated inventions per page.
 *
 * The roles matter more than the styling here. An error uses `role="alert"`,
 * which interrupts a screen reader immediately — right when a submit has just
 * failed and the user is about to try again. Success and info use
 * `role="status"`, which waits for a pause, because "signed in" is news, not
 * an emergency.
 */

import { motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'

export type StatusTone = 'error' | 'success' | 'info'

interface FormStatusProps {
  tone: StatusTone
  message: string | null
  /** Set on the strip so a caller can move focus to it after a failure. */
  id?: string
}

const TONES: Record<StatusTone, { color: string; icon: typeof Info }> = {
  error: { color: 'var(--accent)', icon: AlertCircle },
  success: { color: 'var(--sector-green)', icon: CheckCircle2 },
  info: { color: 'var(--amber)', icon: Info },
}

export default function FormStatus({ tone, message, id }: FormStatusProps) {
  if (!message) return null

  const { color, icon: Icon } = TONES[tone]

  return (
    <motion.div
      id={id}
      // -1 so `focus()` can move here after a failed submit without adding the
      // strip to the tab order, where it would be a dead stop for everyone else.
      tabIndex={-1}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '9px',
        marginBottom: '14px',
        padding: '10px 12px',
        // Livery stripe down the left edge — the house way of colour-coding a
        // panel without tinting the whole thing.
        borderLeft: `3px solid ${color}`,
        border: '1px solid var(--border)',
        borderLeftWidth: '3px',
        borderLeftColor: color,
        borderRadius: '2px',
        background: 'var(--surface)',
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--foreground)',
        outline: 'none',
      }}
    >
      <Icon size={14} style={{ color, flexShrink: 0, marginTop: '1px' }} aria-hidden />
      <span>{message}</span>
    </motion.div>
  )
}
