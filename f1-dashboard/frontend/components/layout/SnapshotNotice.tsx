'use client'

import { useActiveSnapshots } from '@/lib/api/snapshot-status'

export default function SnapshotNotice() {
  const snapshots = useActiveSnapshots()
  if (!snapshots.length) return null
  return <aside aria-label="Static snapshot provenance" role="status" style={{ padding: '12px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', fontSize: 12, lineHeight: 1.6 }}>
    <strong>Saved snapshot · awaiting live API data</strong>
    <div>{snapshots.map(s => <div key={s.label}>{s.label} · recorded <time dateTime={s.capturedAt}>{s.capturedAt.slice(0, 19).replace('T', ' ')} UTC</time> <span style={{ color: 'var(--muted)' }}>({s.source})</span></div>)}</div>
    <div>May be out of date. Each panel updates automatically when its API responds. Telemetry and authenticated features are live-only and are not included.</div>
  </aside>
}
