'use client'

/**
 * Shown when the API can't be reached at all.
 *
 * Every page here reads from the backend, so if that process isn't running the
 * whole site renders as empty shells — which looks like the website is broken
 * rather than like a server that simply isn't up. This says which it is.
 *
 * Two different audiences, so two messages. A refused connection is the local
 * shape and the developer wants the command. A 502 from a proxy is the hosted
 * shape: the free instance sleeps after ~15 minutes idle and takes ~50s to
 * wake, and a visitor needs to know it is coming back — not be handed a
 * uvicorn command they cannot run. Showing the dev copy in production was the
 * old behaviour, and it never even appeared, because a 502 was being counted
 * as healthy.
 */

import { useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useBackendStatus, revalidateAll } from '@/lib/api/client'

const START_CMD = 'python -m uvicorn main:app --port 8000'

export default function BackendOfflineBanner() {
  const status = useBackendStatus()
  const [retrying, setRetrying] = useState(false)

  if (status === 'online') return null

  const waking = status === 'waking'

  const retry = async () => {
    setRetrying(true)
    try { await revalidateAll() } finally { setRetrying(false) }
  }

  return (
    <div
      role="alert"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 90,
        background: 'color-mix(in srgb, var(--accent) 16%, #14090a)',
        borderTop: '2px solid var(--accent)',
        padding: '12px clamp(14px, 3vw, 26px)',
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      }}
    >
      <AlertTriangle size={17} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 220 }}>
        <div
          className="font-display"
          style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}
        >
          {waking ? 'Waking the data server' : 'Backend not running'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
          {waking ? (
            <>
              The site is fine — the data server went to sleep and is starting back up.
              This takes about a minute, and the page fills in on its own. No need to reload.
            </>
          ) : (
            <>
              The site is fine — the data server on port 8000 isn&apos;t up, so every page is empty.
              Start it from <code className="font-num" style={{ color: 'var(--foreground)' }}>f1-dashboard/backend</code>:{' '}
              <code
                className="font-num"
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  padding: '1px 6px', borderRadius: 2, color: 'var(--foreground)',
                  display: 'inline-block', marginTop: 2,
                }}
              >
                {START_CMD}
              </code>
            </>
          )}
        </div>
      </div>
      <button
        onClick={retry}
        disabled={retrying}
        className="font-display"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '9px 16px', border: 'none', borderRadius: 2,
          background: 'var(--accent)', color: '#fff',
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          cursor: retrying ? 'wait' : 'pointer', opacity: retrying ? 0.6 : 1,
          minHeight: 40, flexShrink: 0,
        }}
      >
        <RefreshCw
          size={13}
          style={waking && !retrying ? { animation: 'spin 1.4s linear infinite' } : undefined}
        />
        {retrying ? 'Retrying…' : waking ? 'Check now' : 'Retry'}
      </button>
    </div>
  )
}
