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
import { useIsPhone } from '@/lib/breakpoint'

export type TowerView = 'timing' | 'stints'

const TOWER_GRID = '36px minmax(100px,1.1fr) 60px 60px 76px 76px minmax(174px,2.1fr) 42px 48px 56px'
/** Stints view: the timeline takes everything the timing columns gave back. */
const STINT_GRID = '36px minmax(100px,1.1fr) 60px 60px 42px 48px 56px minmax(190px,3fr)'

/**
 * Collapsed timing view — sector times AND the mini-sector bars.
 *
 * The bars used to be expand-only, on the reasoning that `minmax(174px,2.1fr)`
 * took the largest share of the spare width and left the track map beside the
 * tower too small to read. That trade is off the table now the map opens
 * fullscreen on its own (see TrackMap's expand control): the map no longer
 * depends on the tower staying narrow, so where a car is *losing* time goes
 * back to being visible without clicking anything.
 *
 * The bars sit after S3 rather than replacing it. The sector times say who is
 * quick; the bars say where — they answer different questions and the tower
 * had both before. Narrower here than in TOWER_GRID (140 vs 174) so the
 * collapsed row still fits a 1280px screen without scrolling.
 */
const COLLAPSED_TOWER_GRID = [
  '38px',                    // POS
  'minmax(96px,1.4fr)',      // DRIVER
  'minmax(58px,0.9fr)',      // GAP
  'minmax(58px,0.9fr)',      // INT
  'minmax(72px,1fr)',        // LAST LAP
  'minmax(72px,1fr)',        // BEST LAP
  'minmax(56px,0.9fr)',      // S1
  'minmax(56px,0.9fr)',      // S2
  'minmax(56px,0.9fr)',      // S3
  'minmax(140px,1.8fr)',     // MINI-SECTORS
  'minmax(40px,0.5fr)',      // LAPS
  'minmax(42px,0.5fr)',      // PIT
  'minmax(68px,0.8fr)',      // TYRE — fits "S 24L (+7)"; the used-set suffix
                             //   clipped by 6px at 56px once the type grew
].join(' ')
// Every column carries an `fr` share on purpose. With DRIVER as the only
// flexible track it absorbed *all* the slack once the page stopped being
// width-capped: measured at 2560px it stretched to 760px, leaving a canyon
// between the driver's name and their gap. Sharing the slack keeps the row
// tabular at any width.

/**
 * Phone tower — five columns instead of ten.
 *
 * `TOWER_GRID` needs 782px of minimum track (728px of columns plus nine 6px
 * gaps). Measured on a 375px phone that is 806px of content in a 334px box, so
 * reading P4's gap meant scrolling the tower sideways with your thumb, mid-race
 * — the exact one-handed case /live exists for.
 *
 * Nothing is dropped. The five columns below are what you check at a glance;
 * everything else moves to a full-width second line under each row, which is
 * why the grid ends in a `1 / -1` cell. The mini-sectors actually come out
 * ahead: they get the whole row width (~310px) rather than the 174px minimum
 * they're squeezed into on desktop.
 */
const PHONE_TOWER_GRID = '26px minmax(0,1fr) 52px 52px 40px'
const PHONE_STINT_GRID = '26px minmax(0,1fr) 52px 52px 40px'
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

function TowerRowView({ row, index, view, maxStintLaps, phone, expanded }: { row: TowerRow; index: number; view: TowerView; maxStintLaps: number; phone: boolean; expanded: boolean }) {
  const color = row.driver.team_colour ? `#${row.driver.team_colour.replace('#', '')}` : '#555'
  const leader = row.position === 1
  const grid = phone
    ? (view === 'timing' ? PHONE_TOWER_GRID : PHONE_STINT_GRID)
    : (view === 'timing' ? TOWER_GRID : STINT_GRID)
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
        gridTemplateColumns: phone
          ? (view === 'timing' ? PHONE_TOWER_GRID : PHONE_STINT_GRID)
          : (view === 'timing' ? (expanded ? TOWER_GRID : COLLAPSED_TOWER_GRID) : STINT_GRID),
        alignItems: 'center',
        gap: phone ? '4px' : '7px',
        rowGap: phone ? '6px' : undefined,
        padding: phone ? '9px 10px' : '11px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: leader ? 'linear-gradient(90deg, rgba(255,215,0,0.06), transparent 55%)' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: phone ? '2px' : '5px', minWidth: 0 }}>
        <span className="font-num" style={{ fontWeight: 800, fontSize: phone ? '14px' : '17px', color: leader ? '#FFD700' : '#fff' }}>
          {row.position ?? '—'}
        </span>
        {!phone && <PosDelta row={row} />}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <span style={{ width: '4px', height: '20px', background: color, borderRadius: '2px', flexShrink: 0, boxShadow: `0 0 8px ${color}66` }} />
        <span className="font-display" style={{ fontWeight: 700, fontSize: phone ? '14px' : '15.5px', letterSpacing: '0.02em' }}>{row.driver.name_acronym}</span>
        {/* Measured at 375px the team name got a 47px box — "Red Bull Racing"
            rendered as "Red B…", which is noise, not information. The colour
            bar to its left already identifies the team, so on a phone the name
            goes and the position delta takes its place instead. */}
        {phone
          ? <PosDelta row={row} />
          : <span style={{ fontSize: '12.5px', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.driver.team_name}</span>}
      </div>

      <span className="font-num" style={{ fontSize: '14px', color: row.gapToLeader === 0 ? '#FFD700' : '#D1D5DB' }}>{fmtGap(row.gapToLeader)}</span>
      <span className="font-num" style={{ fontSize: '14px', color: '#9CA3AF' }}>{fmtGap(row.interval)}</span>

      {view === 'timing' && !phone && (
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

          {/* Both views carry the bars now. Expanded drops the three sector
              times because at that width the bars are detailed enough to read
              a sector off directly; collapsed keeps the times, because a
              140px bar tells you where but not how much. */}
          {expanded ? (
            <MiniSectors miniSectors={row.miniSectors} sectors={row.sectors} />
          ) : (
            <>
              <SectorCell sector={row.sectors[0]} />
              <SectorCell sector={row.sectors[1]} />
              <SectorCell sector={row.sectors[2]} />
              <MiniSectors miniSectors={row.miniSectors} sectors={row.sectors} />
            </>
          )}
        </>
      )}

      {!phone && (
        <>
          <span className="font-num" style={{ fontSize: '13px', color: '#9CA3AF', textAlign: 'center' }}>{row.lapsDone || '—'}</span>
          <span style={{ display: 'flex', justifyContent: 'center' }}>
            {row.interval === 'IN PIT'
              ? <span className="font-display" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', padding: '3px 7px', borderRadius: 3, background: 'rgba(59,130,246,0.16)', border: '1px solid rgba(59,130,246,0.45)', color: '#7CB0FF' }}>IN PIT</span>
              : <span className="font-num" style={{ fontSize: '13px', color: '#9CA3AF' }}>{row.pitStops || '—'}</span>}
          </span>
        </>
      )}
      <TyreDot compound={row.compound} age={row.tyreAge} startAge={row.tyreStartAge} />

      {!phone && view === 'stints' && <StintBar stints={row.stints} maxLaps={maxStintLaps} />}

      {/* Second line — the columns that don't fit five-across, spanning the
          full row. `1 / -1` is what keeps this honest: no data is dropped on a
          phone, it just stops competing for horizontal space with the gap and
          interval you're actually watching. */}
      {phone && (
        <div style={{
          gridColumn: '1 / -1',
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 12px',
          paddingLeft: 30,
        }}>
          {view === 'timing' ? (
            <>
              <PhoneStat label="LAST" value={fmtLap(row.lastLap?.lap_duration)} color="#E5E7EB" />
              <PhoneStat
                label="BEST"
                value={fmtLap(row.bestLapDuration)}
                color={row.isOverallBestLap ? 'var(--sector-purple)' : '#00D131'}
              />
              <PhoneStat label="LAPS" value={String(row.lapsDone || '—')} color="#9CA3AF" />
              <PhoneStat
                label="PIT"
                value={row.interval === 'IN PIT' ? 'IN PIT' : String(row.pitStops || '—')}
                color={row.interval === 'IN PIT' ? '#7CB0FF' : '#9CA3AF'}
              />
              <div style={{ flexBasis: '100%', minWidth: 0 }}>
                <MiniSectors miniSectors={row.miniSectors} sectors={row.sectors} />
              </div>
            </>
          ) : (
            <>
              <PhoneStat label="LAPS" value={String(row.lapsDone || '—')} color="#9CA3AF" />
              <PhoneStat label="PIT" value={String(row.pitStops || '—')} color="#9CA3AF" />
              <div style={{ flexBasis: '100%', minWidth: 0 }}>
                <StintBar stints={row.stints} maxLaps={maxStintLaps} />
              </div>
            </>
          )}
        </div>
      )}
    </motion.div>
  )
}

/** One labelled readout on the phone tower's second line. */
function PhoneStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '0.06em' }}>{label}</span>
      <span className="font-num" style={{ fontSize: 12, color }}>{value}</span>
    </span>
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
  const phone = useIsPhone()
  const timingGrid = expanded ? TOWER_GRID : COLLAPSED_TOWER_GRID
  // One horizontal scale for every stint bar, so rows stay comparable.
  const maxStintLaps = Math.max(
    1,
    ...rows.map(r => r.stints.reduce((n, st) => n + Math.max(st.laps, 1), 0)),
  )

  // On a phone the five columns fit, so the sideways scroller is removed
  // rather than left there empty — `fit-content` on the inner box would
  // otherwise still let a long driver name widen the tower past the screen.
  return (
    <div style={{ overflowX: phone ? 'visible' : 'auto' }}>
      <div style={{ minWidth: phone ? 0 : 'fit-content' }}>
        {/* `tower-head` is a styling hook, not decoration: globals.css holds the
            header (and the rows) at the body face because the expanded display
            face overruns these fixed columns. */}
        <div
          className="tower-head"
          style={{
            display: 'grid',
            gridTemplateColumns: phone
              ? (view === 'timing' ? PHONE_TOWER_GRID : PHONE_STINT_GRID)
              : (view === 'timing' ? timingGrid : STINT_GRID),
            gap: phone ? '4px' : '7px', padding: phone ? '10px 10px' : '11px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.09)',
            fontSize: '11.5px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--muted)',
          }}
        >
          <span>POS</span><span>DRIVER</span><span>GAP</span><span>INT</span>
          {view === 'timing' && !phone && (
            expanded
              ? <><span>LAST LAP</span><span>BEST LAP</span><span>MINI-SECTORS</span></>
              : <><span>LAST LAP</span><span>BEST LAP</span><span>S1</span><span>S2</span><span>S3</span><span>MINI-SECTORS</span></>
          )}
          {!phone && <span style={{ textAlign: 'center' }}>LAPS</span>}
          {!phone && <span style={{ textAlign: 'center' }}>PIT</span>}
          <span>TYRE</span>
          {view === 'stints' && !phone && <span>STINTS</span>}
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
            {emptyMessage}
          </div>
        ) : rows.flatMap((row, i) => {
          const node = <TowerRowView key={row.driver.driver_number} row={row} index={i} view={view} maxStintLaps={maxStintLaps} phone={phone} expanded={expanded} />
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
