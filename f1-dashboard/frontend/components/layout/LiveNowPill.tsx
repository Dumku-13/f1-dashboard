'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useLiveStatus } from '@/lib/live'

/** Floating "LIVE NOW" console chip — appears on every page while a session is running. */
export default function LiveNowPill() {
  const { live, session } = useLiveStatus()
  const pathname = usePathname()
  const show = live && pathname !== '/live'

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -18 }}
          style={{ position: 'fixed', top: '14px', right: '16px', zIndex: 60 }}
        >
          <Link
            href="/live"
            className="glass-card"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              background: 'color-mix(in srgb, var(--accent) 14%, var(--card))',
              border: '1px solid var(--accent)',
              padding: '7px 14px',
              textDecoration: 'none',
              boxShadow: '0 8px 20px rgba(0,0,0,0.4)',
              maxWidth: 'calc(100vw - 190px)',
              overflow: 'hidden',
            }}
          >
            <span className="live-dot" style={{ width: '7px', height: '7px', background: 'var(--accent)', display: 'inline-block', flexShrink: 0 }} />
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: '11px', fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--amber)',
            }}>
              Live
            </span>
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: '11px', fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--foreground)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              — {session?.session_name?.toUpperCase() || 'SESSION'}
            </span>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
