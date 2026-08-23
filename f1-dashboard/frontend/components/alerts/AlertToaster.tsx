'use client'

/**
 * In-app alert toaster. Listens for the 'f1-alert' window event fired by the
 * alerts engine and stacks toasts in the TOP-LEFT corner (the achievement
 * toaster owns top-right). Each toast auto-dismisses after 6s.
 */

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, Flag, TrendingUp, Info } from 'lucide-react'
import { ALERT_EVT, type AlertPayload, type AlertTone } from '@/lib/alerts'

interface Toast extends AlertPayload {
  id: number
}

const TONE: Record<AlertTone, { color: string; Icon: typeof Info }> = {
  info: { color: 'var(--muted)', Icon: Info },
  good: { color: 'var(--sector-green)', Icon: TrendingUp },
  bad: { color: 'var(--accent)', Icon: Flag },
  warn: { color: 'var(--amber)', Icon: AlertTriangle },
}

let seq = 0

export default function AlertToaster() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const onAlert = (e: Event) => {
      const detail = (e as CustomEvent<AlertPayload>).detail
      if (!detail) return
      const id = ++seq
      setToasts(q => [...q, { ...detail, id }])
      setTimeout(() => setToasts(q => q.filter(t => t.id !== id)), 6000)
    }
    window.addEventListener(ALERT_EVT, onAlert)
    return () => window.removeEventListener(ALERT_EVT, onAlert)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        top: '16px',
        left: '16px',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none',
        maxWidth: 'min(340px, calc(100vw - 32px))',
      }}
    >
      <AnimatePresence>
        {toasts.map(t => {
          const cfg = TONE[t.tone] || TONE.info
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: -60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -60 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className="glass-card"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '11px',
                padding: '12px 15px',
                minWidth: '240px',
                borderLeft: `2px solid ${cfg.color}`,
              }}
            >
              <cfg.Icon size={16} style={{ color: cfg.color, marginTop: '2px', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div className="font-display" style={{ fontSize: '12px', fontWeight: 700, color: cfg.color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {t.title}
                </div>
                <div className="font-num" style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '3px', lineHeight: 1.4 }}>
                  {t.body}
                </div>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
