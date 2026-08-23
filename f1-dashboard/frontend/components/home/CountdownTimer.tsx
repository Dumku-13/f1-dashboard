'use client'

import { useState, useEffect } from 'react'
import { countdownTo, formatISTDateTime } from '@/lib/ist'

interface CountdownProps {
  targetUTC: string
  label: string
  sessionName?: string
}

function Segment({ n, u }: { n: number; u: string }) {
  return (
    <div style={{ textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, padding: '10px clamp(6px, 2vw, 12px)', minWidth: 'clamp(44px, 13vw, 56px)' }}>
      <div className="stat-num" style={{ fontSize: 'clamp(28px, 5vw, 52px)', lineHeight: 1 }}>
        {String(n).padStart(2, '0')}
      </div>
      <div className="kicker" style={{ fontSize: '9px', marginTop: '6px', justifyContent: 'center' }}>{u}</div>
    </div>
  )
}

const Sep = () => (
  <div className="stat-num" style={{ fontSize: 'clamp(20px, 3vw, 36px)', color: 'var(--accent)', alignSelf: 'center', padding: '0 2px' }}>:</div>
)

export default function CountdownTimer({ targetUTC, label, sessionName }: CountdownProps) {
  // Seeded null, not countdownTo(): reading Date.now() during render produces a
  // different value on the server than on the client, which React 19 reports as
  // a hydration mismatch and re-renders the subtree over.
  const [tick, setTick] = useState<ReturnType<typeof countdownTo> | null>(null)

  useEffect(() => {
    setTick(countdownTo(targetUTC))
    const interval = setInterval(() => setTick(countdownTo(targetUTC)), 1000)
    return () => clearInterval(interval)
  }, [targetUTC])

  if (!tick) {
    return (
      <div className="glass-card" style={{ padding: 'clamp(14px, 4vw, 20px) clamp(14px, 5vw, 24px)', borderLeft: '2px solid var(--accent)' }}>
        <div className="kicker" style={{ marginBottom: '4px' }}>{label}</div>
        {sessionName && <div className="font-display" style={{ fontSize: '13px', fontWeight: 700, marginBottom: '16px', textTransform: 'uppercase' }}>{sessionName}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(4px, 1.5vw, 10px)', flexWrap: 'wrap' }}>
          <Segment n={0} u="DAYS" /><Sep /><Segment n={0} u="HRS" /><Sep /><Segment n={0} u="MIN" /><Sep /><Segment n={0} u="SEC" />
        </div>
      </div>
    )
  }

  if (tick.past) {
    return (
      <div className="glass-card" style={{ padding: 'clamp(14px, 4vw, 20px) clamp(14px, 5vw, 24px)', borderLeft: '2px solid var(--accent)' }}>
        <div className="kicker" style={{ marginBottom: '8px' }}>{label}</div>
        <div className="font-display" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--sector-green)' }}>Session underway / complete</div>
      </div>
    )
  }

  return (
    <div className="glass-card" style={{ padding: 'clamp(14px, 4vw, 20px) clamp(14px, 5vw, 24px)', borderLeft: '2px solid var(--accent)' }}>
      <div className="kicker" style={{ marginBottom: '4px' }}>{label}</div>
      {sessionName && <div className="font-display" style={{ fontSize: '13px', fontWeight: 700, marginBottom: '16px', textTransform: 'uppercase' }}>{sessionName}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(4px, 1.5vw, 10px)', flexWrap: 'wrap' }}>
        <Segment n={tick.days} u="DAYS" />
        <Sep />
        <Segment n={tick.hours} u="HRS" />
        <Sep />
        <Segment n={tick.minutes} u="MIN" />
        <Sep />
        <Segment n={tick.seconds} u="SEC" />
      </div>
      <div className="font-num" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '12px' }}>
        {formatISTDateTime(targetUTC)}
      </div>
    </div>
  )
}
