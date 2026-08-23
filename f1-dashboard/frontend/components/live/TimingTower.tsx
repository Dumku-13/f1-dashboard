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
const SECTOR_UI_COLORS = {
  purple: 'var(--sector-purple)',
  green: 'var(--sector-green)',
  yellow: 'rgba(255,242,0,0.72)',
} as const

function SectorCell({ sector }: { sector: TowerSector | undefined }) {
  if (!sector?.value) return <span style={{ fontSize: '11px', color: '#374151' }}>—</span>
  return (
    <motion.span
      key={sector.value}
      initial={{ opacity: 0.25 }}
      animate={{ opacity: 1 }}
      className="font-num"
      style={{
        fontSize: '11px',
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
      style={{ fontSize: '10px', fontWeight: 800, color: up ? '#00D131' : '#E8002D' }}
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

function TowerRowView({ row, index, view, maxStintLaps }: { row: TowerRow; index: number; view: TowerView; maxStintLaps: number }) {
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
        gridTemplateColumns: view === 'timing' ? TOWER_GRID : STINT_GRID,
        alignItems: 'center',
        gap: '6px',
        padding: '9px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: leader ? 'linear-gradient(90deg, rgba(255,215,0,0.06), transparent 55%)' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span className="font-num" style={{ fontWeight: 800, fontSize: '15px', color: leader ? '#FFD700' : '#fff' }}>
          {row.position ?? '—'}
        </span>
        <PosDelta row={row} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <span style={{ width: '4px', height: '20px', background: color, borderRadius: '2px', flexShrink: 0, boxShadow: `0 0 8px ${color}66` }} />
        <span className="font-display" style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '0.02em' }}>{row.driver.name_acronym}</span>
        <span style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.driver.team_name}</span>
      </div>

      <span className="font-num" style={{ fontSize: '12px', color: row.gapToLeader === 0 ? '#FFD700' : '#D1D5DB' }}>{fmtGap(row.gapToLeader)}</span>
      <span className="font-num" style={{ fontSize: '12px', color: '#9CA3AF' }}>{fmtGap(row.interval)}</span>

      {view === 'timing' && (
        <>
          <AnimatePresence mode="popLayout">
            <motion.span
              key={row.lastLap ? `${row.lastLap.lap_number}-${row.lastLap.lap_duration}` : 'none'}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="font-num"
              style={{ fontSize: '12px', color: '#E5E7EB' }}
            >
              {fmtLap(row.lastLap?.lap_duration)}
            </motion.span>
          </AnimatePresence>

          <span className="font-num" style={{ fontSize: '12px', color: row.isOverallBestLap ? 'var(--sector-purple)' : '#00D131', textShadow: row.isOverallBestLap ? '0 0 12px rgba(191,0,255,0.5)' : 'none' }}>
            {fmtLap(row.bestLapDuration)}
          </span>

          <MiniSectors miniSectors={row.miniSectors} sectors={row.sectors} />
        </>
      )}

      <span className="font-num" style={{ fontSize: '11px', color: '#9CA3AF', textAlign: 'center' }}>{row.lapsDone || '—'}</span>
      <span style={{ display: 'flex', justifyContent: 'center' }}>
        {row.interval === 'IN PIT'
          ? <span className="font-display" style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', padding: '2px 6px', borderRadius: 3, background: 'rgba(59,130,246,0.16)', border: '1px solid rgba(59,130,246,0.45)', color: '#7CB0FF' }}>IN PIT</span>
          : <span className="font-num" style={{ fontSize: '11px', color: '#9CA3AF' }}>{row.pitStops || '—'}</span>}
      </span>
      <TyreDot compound={row.compound} age={row.tyreAge} startAge={row.tyreStartAge} />

      {view === 'stints' && <StintBar stints={row.stints} maxLaps={maxStintLaps} />}
    </motion.div>
  )
}


/** Header row + rows + qualifying cut lines. */
export default function TimingTower({
  rows, view, qualifying, emptyMessage,
}: {
  rows: TowerRow[]
  view: TowerView
  qualifying: QualifyingState | null
  emptyMessage: string
}) {
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
            gridTemplateColumns: view === 'timing' ? TOWER_GRID : STINT_GRID,
            gap: '6px', padding: '10px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.09)',
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--muted)',
          }}
        >
          <span>POS</span><span>DRIVER</span><span>GAP</span><span>INT</span>
          {view === 'timing' && <><span>LAST LAP</span><span>BEST LAP</span><span>MINI-SECTORS</span></>}
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
          const node = <TowerRowView key={row.driver.driver_number} row={row} index={i} view={view} maxStintLaps={maxStintLaps} />
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
