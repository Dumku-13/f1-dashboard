'use client'

/**
 * The timing tower, shared by /live and /follow.
 *
 * Extracted so the two pages can't drift: Follow Along needs exactly the same
 * columns, mini-sectors, tyre state and qualifying cut lines as the live page,
 * and keeping a second simplified copy meant every fix had to be made twice.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { fmtLap, fmtGap, type TowerRow, type TowerSector, type QualifyingState } from '@/lib/live'
import MiniSectors from '@/components/live/MiniSectors'
import StintBar from '@/components/live/StintBar'
import { COMPOUND_COLORS } from '@/lib/constants'

export type TowerView = 'timing' | 'stints'

const TOWER_GRID = '36px minmax(100px,1.1fr) 60px 60px 76px 76px minmax(174px,2.1fr) 42px 48px 56px'
/** Stints view: the timeline takes everything the timing columns gave back. */
const STINT_GRID = '36px minmax(100px,1.1fr) 60px 60px 42px 48px 56px minmax(190px,3fr)'

/**
 * Collapsed timing view — three sector times where the mini-sector bars go.
 *
 * `TOWER_GRID`'s mini-sector column is `minmax(174px, 2.1fr)`: it demands width
 * and then takes the largest share of whatever is spare. That is what kept the
 * tower wide and the track map beside it small enough that driver labels were
 * unreadable. Sector times answer the same question at a glance — who is quick
 * where, and in what colour — from fixed columns that never grow.
 *
 * The segmented bars aren't lost, they move behind EXPAND, which already means
 * "give the tower the whole page". Detail belongs in the detail view.
 */
const COLLAPSED_TOWER_GRID = [
  '38px',                    // POS
  'minmax(96px,1.6fr)',      // DRIVER
  'minmax(62px,1fr)',        // GAP
  'minmax(62px,1fr)',        // INT
  'minmax(74px,1fr)',        // LAST LAP
  'minmax(74px,1fr)',        // BEST LAP
  'minmax(62px,1fr)',        // S1
  'minmax(62px,1fr)',        // S2
  'minmax(62px,1fr)',        // S3
  'minmax(42px,0.6fr)',      // LAPS
  'minmax(44px,0.6fr)',      // PIT
  'minmax(68px,0.8fr)',      // TYRE — fits "S 24L (+7)"; the used-set suffix
                             //   clipped by 6px at 56px once the type grew
].join(' ')
// Every column carries an `fr` share on purpose. With DRIVER as the only
// flexible track it absorbed *all* the slack once the page stopped being
// width-capped: measured at 2560px it stretched to 760px, leaving a canyon
// between the driver's name and their gap. Sharing the slack keeps the row
// tabular at any width.
const SECTOR_UI_COLORS = {
  purple: 'var(--sector-purple)',
  green: 'var(--sector-green)',
  yellow: 'rgba(255,242,0,0.72)',
} as const

function SectorCell({ sector }: { sector: TowerSector | undefined }) {
  if (!sector?.value) return <span style={{ fontSize: '13.5px', color: '#374151' }}>—</span>
  return (
    <motion.span
      key={sector.value}
      initial={{ opacity: 0.25 }}
      animate={{ opacity: 1 }}
      className="font-num"
      style={{
        fontSize: '13.5px',
        color: SECTOR_UI_COLORS[sector.color],
        textShadow: sector.color === 'purple' ? '0 0 8px rgba(191,0,255,0.5)' : 'none',
      }}
    >
      {sector.value}
    </motion.span>
  )
}

function PosDelta({ row }: { row: TowerRow }) {
  if (row.position == null || row.prevPosition == null || row.position === row.prevPosition) return null
  const up = row.position < row.prevPosition
  return (
    <motion.span
      initial={{ opacity: 0, y: up ? 6 : -6 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ fontSize: '11.5px', fontWeight: 800, color: up ? '#00D131' : '#E8002D' }}
    >
      {up ? '▲' : '▼'}
    </motion.span>
  )
}

function TyreDot({ compound, age, startAge }: { compound: string | null; age: number | null; startAge?: number | null }) {
  if (!compound) return <span style={{ color: '#4B4B4B' }}>—</span>
  const c = COMPOUND_COLORS[compound.toUpperCase()] || '#555'
  const letter = compound.toUpperCase()[0]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      {/* A thin ring on a dark background disappears. Ring + tinted core + a
          faint glow, with the compound letter inside, stays legible at 15px. */}
      <span
        style={{
          width: '15px', height: '15px', borderRadius: '50%',
          border: `2.5px solid ${c}`,
          background: `color-mix(in srgb, ${c} 22%, transparent)`,
          boxShadow: `0 0 7px color-mix(in srgb, ${c} 45%, transparent)`,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span className="font-num" style={{ fontSize: 7, fontWeight: 800, color: c, lineHeight: 1 }}>{letter}</span>
      </span>
      {/* A used set's age exceeds the laps run this session, which looks wrong
          unless the carried-over life is visible. Show it. */}
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3 }}>
        <span className="font-num" style={{ fontSize: '11px', color: 'var(--foreground)', fontWeight: 700 }}>
          {age != null ? `${age}L` : ''}
        </span>
        {startAge != null && startAge > 0 && (
          <span
            className="font-num"
            title={`Fitted used — ${startAge} laps already on this set`}
            style={{ fontSize: '9px', color: 'var(--muted)' }}
          >
            (+{startAge})
          </span>
        )}
      </span>
    </span>
  )
}

/**
 * Qualifying cut line.
 *
 * `NoEntries` in the timing feed says how many cars survive each segment
 * (22 -> 16 -> 10 at Zandvoort), so the divider goes after that many rows.
 * Segments already run are labelled with how many went out; the segment
 * currently running shows the time you have to beat to stay in.
 */
function CutLine({ label, eliminated, cutOffTime, active }: {
  label: string
  eliminated: number
  cutOffTime: string | null
  active: boolean
}) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '5px 14px',
        background: active ? 'rgba(255,242,0,0.07)' : 'rgba(232,0,45,0.06)',
        borderTop: `1px solid ${active ? 'rgba(255,242,0,0.5)' : 'rgba(232,0,45,0.45)'}`,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <span
        className="font-display"
        style={{
          fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
          color: active ? '#FFF200' : '#FF6B7F',
        }}
      >
        {label} cut
      </span>
      <span style={{ fontSize: 10, color: 'var(--muted)' }}>
        {active
          ? cutOffTime ? `Cut-off ${cutOffTime}` : 'Cut line'
          : `${eliminated} eliminated below`}
      </span>
      <span style={{ flex: 1, height: 1, background: active ? 'rgba(255,242,0,0.25)' : 'rgba(232,0,45,0.22)' }} />
    </div>
  )
}

function TowerRowView({ row, index, view, maxStintLaps, expanded }: { row: TowerRow; index: number; view: TowerView; maxStintLaps: number; expanded: boolean }) {
  const color = row.driver.team_colour ? `#${row.driver.team_colour.replace('#', '')}` : '#555'
  const leader = row.position === 1
  return (
    <motion.div
      layout="position"
      initial={false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ layout: { type: 'spring', stiffness: 350, damping: 32 } }}
      className="tower-row"
      style={{
        display: 'grid',
        opacity: row.knockedOut ? 0.42 : 1,
        filter: row.knockedOut ? 'grayscale(0.75)' : 'none',
        gridTemplateColumns: view === 'timing'
          ? (expanded ? TOWER_GRID : COLLAPSED_TOWER_GRID)
          : STINT_GRID,
        alignItems: 'center',
        gap: '7px',
        padding: '11px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: leader ? 'linear-gradient(90deg, rgba(255,215,0,0.06), transparent 55%)' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span className="font-num" style={{ fontWeight: 800, fontSize: '17px', color: leader ? '#FFD700' : '#fff' }}>
          {row.position ?? '—'}
        </span>
        <PosDelta row={row} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <span style={{ width: '4px', height: '20px', background: color, borderRadius: '2px', flexShrink: 0, boxShadow: `0 0 8px ${color}66` }} />
        <span className="font-display" style={{ fontWeight: 700, fontSize: '15.5px', letterSpacing: '0.02em' }}>{row.driver.name_acronym}</span>
        <span style={{ fontSize: '12.5px', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.driver.team_name}</span>
      </div>

      <span className="font-num" style={{ fontSize: '14px', color: row.gapToLeader === 0 ? '#FFD700' : '#D1D5DB' }}>{fmtGap(row.gapToLeader)}</span>
      <span className="font-num" style={{ fontSize: '14px', color: '#9CA3AF' }}>{fmtGap(row.interval)}</span>

      {view === 'timing' && (
        <>
          <AnimatePresence mode="popLayout">
            <motion.span
              key={row.lastLap ? `${row.lastLap.lap_number}-${row.lastLap.lap_duration}` : 'none'}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="font-num"
              style={{ fontSize: '14px', color: '#E5E7EB' }}
            >
              {fmtLap(row.lastLap?.lap_duration)}
            </motion.span>
          </AnimatePresence>

          <span className="font-num" style={{ fontSize: '14px', color: row.isOverallBestLap ? 'var(--sector-purple)' : '#00D131', textShadow: row.isOverallBestLap ? '0 0 12px rgba(191,0,255,0.5)' : 'none' }}>
            {fmtLap(row.bestLapDuration)}
          </span>

          {/* Segmented bars need ~174px and grow to fill; the three sector
              times need 58px each and don't. Same question, a quarter of the
              width — which is what the map beside the tower gets back. */}
          {expanded ? (
            <MiniSectors miniSectors={row.miniSectors} sectors={row.sectors} />
          ) : (
            <>
              <SectorCell sector={row.sectors[0]} />
              <SectorCell sector={row.sectors[1]} />
              <SectorCell sector={row.sectors[2]} />
            </>
          )}
        </>
      )}

      <span className="font-num" style={{ fontSize: '13px', color: '#9CA3AF', textAlign: 'center' }}>{row.lapsDone || '—'}</span>
      <span style={{ display: 'flex', justifyContent: 'center' }}>
        {row.interval === 'IN PIT'
          ? <span className="font-display" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', padding: '3px 7px', borderRadius: 3, background: 'rgba(59,130,246,0.16)', border: '1px solid rgba(59,130,246,0.45)', color: '#7CB0FF' }}>IN PIT</span>
          : <span className="font-num" style={{ fontSize: '13px', color: '#9CA3AF' }}>{row.pitStops || '—'}</span>}
      </span>
      <TyreDot compound={row.compound} age={row.tyreAge} startAge={row.tyreStartAge} />

      {view === 'stints' && <StintBar stints={row.stints} maxLaps={maxStintLaps} />}
    </motion.div>
  )
}


/** Header row + rows + qualifying cut lines. */
export default function TimingTower({
  rows, view, qualifying, emptyMessage, expanded = false,
}: {
  rows: TowerRow[]
  view: TowerView
  qualifying: QualifyingState | null
  emptyMessage: string
  /** Full-page tower. Mini-sectors are only drawn here — see COLLAPSED_TOWER_GRID. */
  expanded?: boolean
}) {
  const timingGrid = expanded ? TOWER_GRID : COLLAPSED_TOWER_GRID
  // One horizontal scale for every stint bar, so rows stay comparable.
  const maxStintLaps = Math.max(
    1,
    ...rows.map(r => r.stints.reduce((n, st) => n + Math.max(st.laps, 1), 0)),
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 'fit-content' }}>
        {/* `tower-head` is a styling hook, not decoration: globals.css holds the
            header (and the rows) at the body face because the expanded display
            face overruns these fixed columns. */}
        <div
          className="tower-head"
          style={{
            display: 'grid',
            gridTemplateColumns: view === 'timing' ? timingGrid : STINT_GRID,
            gap: '7px', padding: '11px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.09)',
            fontSize: '11.5px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--muted)',
          }}
        >
          <span>POS</span><span>DRIVER</span><span>GAP</span><span>INT</span>
          {view === 'timing' && (
            expanded
              ? <><span>LAST LAP</span><span>BEST LAP</span><span>MINI-SECTORS</span></>
              : <><span>LAST LAP</span><span>BEST LAP</span><span>S1</span><span>S2</span><span>S3</span></>
          )}
          <span style={{ textAlign: 'center' }}>LAPS</span>
          <span style={{ textAlign: 'center' }}>PIT</span>
          <span>TYRE</span>
          {view === 'stints' && <span>STINTS</span>}
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
            {emptyMessage}
          </div>
        ) : rows.flatMap((row, i) => {
          const node = <TowerRowView key={row.driver.driver_number} row={row} index={i} view={view} maxStintLaps={maxStintLaps} expanded={expanded} />
          // A cut sits *after* the nth car, so check the 1-based index.
          const cutIdx = qualifying?.cutPositions.indexOf(i + 1) ?? -1
          if (cutIdx < 0) return [node]
          const segment = cutIdx + 1
          const survivors = qualifying!.cutPositions[cutIdx]
          const previous = cutIdx === 0 ? qualifying!.entries[0] : qualifying!.cutPositions[cutIdx - 1]
          return [
            node,
            <CutLine
              key={`cut-${segment}`}
              label={`Q${segment}`}
              eliminated={Math.max(0, previous - survivors)}
              cutOffTime={qualifying!.cutOffTime}
              active={qualifying!.part === segment}
            />,
          ]
        })}
      </div>
    </div>
  )
}
