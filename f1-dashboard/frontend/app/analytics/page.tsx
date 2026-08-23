'use client'

/**
 * `/analytics` was folded into `/analysis` — the two hubs overlapped (both were
 * "pick a round, look at race pace") and split the analysis surface in two.
 * The four views that lived here are now the Pace Ranking / Tyre Deg /
 * Strategy Sim / Championship tabs there.
 *
 * Kept as a redirect so bookmarks, the ⌘K search index and any old links
 * still land somewhere sensible.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const TARGET = '/analysis?tab=pace-ranking'

export default function AnalyticsRedirect() {
  const router = useRouter()

  useEffect(() => { router.replace(TARGET) }, [router])

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '80px clamp(16px, 3vw, 34px)', textAlign: 'center' }}>
      <div className="kicker" style={{ marginBottom: 10 }}>Moved</div>
      <h1 className="display-title" style={{ fontSize: 'clamp(22px, 3.4vw, 34px)', margin: 0 }}>
        Analytics is now part of Analysis
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '10px 0 20px' }}>
        Taking you there…
      </p>
      <a
        href={TARGET}
        className="font-display"
        style={{
          display: 'inline-block', padding: '9px 18px', background: 'var(--accent)', color: '#fff',
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          textDecoration: 'none', borderRadius: 2,
        }}
      >
        Open Analysis
      </a>
    </div>
  )
}
