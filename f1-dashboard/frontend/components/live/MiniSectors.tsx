'use client'

/**
 * Mini-sector bar — the segmented strip on a broadcast timing screen.
 *
 * F1's timing feed splits each sector into segments (8 per sector at
 * Zandvoort, 24 across the lap) and reports a status per segment as the car
 * passes it, so the strip fills in live as a driver runs. Under each sector
 * group sits the sector time, with the previous one dimmed beside it.
 *
 * OpenF1 has no segment data. When `sectors` come through with no segments the
 * component falls back to the plain sector times rather than rendering an
 * empty strip.
 */

import type { MiniSectorState, TowerSector } from '@/lib/live'

const SEGMENT_COLOR: Record<MiniSectorState, string> = {
  none: 'rgba(255,255,255,0.10)',
  yellow: '#FFF200',
  green: 'var(--sector-green)',
  purple: 'var(--sector-purple)',
  pit: '#3B82F6',
}

const TIME_COLOR = {
  purple: 'var(--sector-purple)',
  green: 'var(--sector-green)',
  yellow: 'rgba(255,242,0,0.80)',
} as const

function SectorTimes({ sector }: { sector: TowerSector | undefined }) {
  if (!sector?.value && !sector?.previous) {
    return <span className="font-num" style={{ fontSize: 10, color: '#3A3F47' }}>—</span>
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap' }}>
      <span className="font-num" style={{ fontSize: 11, color: sector.value ? TIME_COLOR[sector.color] : '#6B7280' }}>
        {sector.value || '—'}
      </span>
      {sector.previous && sector.previous !== sector.value && (
        <span className="font-num" style={{ fontSize: 10, color: 'var(--muted)', opacity: 0.75 }}>
          {sector.previous}
        </span>
      )}
    </span>
  )
}

export default function MiniSectors({
  miniSectors,
  sectors,
}: {
  miniSectors: MiniSectorState[][]
  sectors: TowerSector[]
}) {
  const hasSegments = miniSectors.some(g => g.length > 0)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, minWidth: 0 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          {hasSegments && (
            <div
              style={{ display: 'flex', gap: 2, height: 7 }}
              // The strip is decorative: the sector times below carry the same
              // information in text, so don't make a screen reader walk 24 divs.
              aria-hidden
            >
              {(miniSectors[i] || []).map((state, j) => (
                <span
                  key={j}
                  style={{
                    flex: 1,
                    minWidth: 3,
                    background: SEGMENT_COLOR[state],
                    borderRadius: 1,
                    transition: 'background 140ms linear',
                  }}
                />
              ))}
            </div>
          )}
          <SectorTimes sector={sectors[i]} />
        </div>
      ))}
    </div>
  )
}
