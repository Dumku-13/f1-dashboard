'use client'

import { useActiveSnapshots } from '@/lib/api/snapshot-status'
import styles from './SnapshotNotice.module.css'

export default function SnapshotNotice() {
  const snapshots = useActiveSnapshots()
  if (!snapshots.length) return null
  return <aside aria-label="Static snapshot provenance" className={styles.notice}>
    <details>
      <summary><strong>Saved snapshot · may be out of date</strong><span>Awaiting live API · dates & sources</span></summary>
      <div className={styles.sources}>{snapshots.map(s => <div key={s.label}>{s.label} · recorded <time dateTime={s.capturedAt}>{s.capturedAt.slice(0, 19).replace('T', ' ')} UTC</time> <span>({s.source})</span></div>)}</div>
      <p>Each panel updates automatically when its API responds. Telemetry and authenticated features are live-only and are not included.</p>
    </details>
  </aside>
}
