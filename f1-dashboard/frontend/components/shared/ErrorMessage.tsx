import { AlertTriangle, RefreshCw } from 'lucide-react'

export default function ErrorMessage({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div
      className="glass-card"
      style={{
        padding: '28px 32px',
        textAlign: 'center',
        borderLeft: '2px solid var(--accent)',
      }}
    >
      <AlertTriangle size={20} style={{ color: 'var(--accent)', marginBottom: '10px' }} />
      <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: retry ? '16px' : 0 }}>{message}</div>
      {retry && (
        <button
          onClick={retry}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '7px',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 2,
            padding: '8px 18px',
            cursor: 'pointer',
            fontFamily: 'var(--font-display)',
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          <RefreshCw size={12} />
          Retry
        </button>
      )}
    </div>
  )
}
