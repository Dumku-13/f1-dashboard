'use client'

import { useState } from 'react'
import { Radio, RefreshCw, WifiOff, X } from 'lucide-react'
import { useBackendStatus, retryBackendConnection } from '@/lib/api/client'

export default function BackendOfflineBanner() {
  const status = useBackendStatus()
  const [dismissed, setDismissed] = useState(false)
  const [previous, setPrevious] = useState(status)
  if (previous !== status) {
    setPrevious(status)
    setDismissed(false)
  }
  if (status === 'online' || dismissed) return null

  const waking = status === 'waking'
  const title = waking ? 'Connecting to race data' : status === 'down' ? 'Local API is offline' : 'Data is temporarily unavailable'
  const detail = waking
    ? 'The server may be waking up. We’ll reconnect automatically; you can keep exploring.'
    : status === 'down'
      ? 'Start the backend on port 8000, then retry.'
      : 'Check your connection and try again. You can still browse the site.'

  return (
    <aside className="backend-connection" aria-label="Data connection">
      <div role="status" aria-live="polite" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
        {waking ? <Radio size={18} aria-hidden="true" style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} /> : <WifiOff size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />}
        <div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{title}</p>
          <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--muted)' }}>{detail}</p>
        </div>
      </div>
      <button onClick={retryBackendConnection} aria-label="Retry data connection" className="backend-connection-button">
        <RefreshCw size={16} aria-hidden="true" />
      </button>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss connection notice" className="backend-connection-button">
        <X size={16} aria-hidden="true" />
      </button>
      <style>{`
        .backend-connection {
          position: fixed; left: 16px; bottom: max(100px, var(--chrome-bottom)); z-index: 80;
          width: min(520px, calc(100vw - 32px)); box-sizing: border-box;
          display: flex; align-items: center; gap: 4px; padding: 16px;
          background: var(--surface); color: var(--foreground);
          border: 1px solid var(--border); border-left: 3px solid var(--accent);
          border-radius: 12px; box-shadow: 0 8px 32px #0003;
        }
        .backend-connection-button {
          display: inline-flex; justify-content: center; align-items: center;
          flex-shrink: 0; width: 44px; height: 44px; padding: 0;
          border: 0; border-radius: 8px; background: transparent;
          color: inherit; cursor: pointer;
        }
        .backend-connection-button:hover { background: var(--border); }
        .backend-connection-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        @media (max-width: 480px) {
          .backend-connection { left: 12px; width: calc(100vw - 24px); padding: 12px; }
        }
      `}</style>
    </aside>
  )
}
