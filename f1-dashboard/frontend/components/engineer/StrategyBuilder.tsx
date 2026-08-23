'use client'

/**
 * Drag-and-drop stint planner.
 *
 * Drag a compound from the rack onto the race bar to drop a new stint in at
 * that point, or onto an existing stint to re-shoe it. Each stint can then be
 * lengthened or shortened.
 *
 * Native HTML5 drag-and-drop is mouse-only — it does nothing on touch, and
 * nothing on a keyboard. So every drag action here has an equivalent button:
 * "Add stint" appends, the compound buttons on a selected stint re-shoe it, and
 * the −/+ controls resize it. The dragging is the fast path, not the only path.
 */

import { useRef, useState } from 'react'
import { Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { COMPOUND_COLORS } from '@/lib/constants'

export interface Stint {
  compound: string
  laps: number
}

export const COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'] as const

const SHORT: Record<string, string> = {
  SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W',
}

export const compoundColor = (c: string) =>
  COMPOUND_COLORS[(c || '').toUpperCase()] || COMPOUND_COLORS.UNKNOWN || '#8C939E'

/** Dark ink on the light compounds, white on the dark ones. */
const inkOn = (c: string) =>
  ['MEDIUM', 'HARD', 'SOFT'].includes((c || '').toUpperCase()) ? '#0B0C0E' : '#fff'

const MIN_STINT = 1
const MAX_STINTS = 6

export default function StrategyBuilder({
  totalLaps,
  stints,
  onChange,
}: {
  totalLaps: number
  stints: Stint[]
  onChange: (next: Stint[]) => void
}) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [selected, setSelected] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)

  const planned = stints.reduce((n, s) => n + s.laps, 0)
  const over = planned - totalLaps

  const setStint = (i: number, patch: Partial<Stint>) =>
    onChange(stints.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  const resize = (i: number, delta: number) => {
    const next = Math.max(MIN_STINT, stints[i].laps + delta)
    setStint(i, { laps: next })
  }

  const addStint = (compound = 'MEDIUM', at = stints.length) => {
    if (stints.length >= MAX_STINTS) return
    // Take the laps for the new stint out of the longest existing one, so the
    // plan stays near the race distance instead of growing every time.
    const donor = stints.reduce((best, s, j) => (s.laps > stints[best].laps ? j : best), 0)
    const take = Math.max(MIN_STINT, Math.floor(stints[donor].laps / 2))
    const next = stints.map((s, j) => (j === donor ? { ...s, laps: s.laps - take } : s))
    next.splice(at, 0, { compound, laps: take })
    onChange(next.filter(s => s.laps >= MIN_STINT))
    setSelected(at)
  }

  const remove = (i: number) => {
    if (stints.length <= 1) return
    const dead = stints[i]
    const next = stints.filter((_, j) => j !== i)
    // Give the removed stint's laps to its neighbour rather than shortening the race.
    const heir = Math.min(i, next.length - 1)
    next[heir] = { ...next[heir], laps: next[heir].laps + dead.laps }
    onChange(next)
    setSelected(Math.max(0, i - 1))
  }

  /* ------------------------------ drag handling --------------------------- */

  const onDropAt = (index: number, e: React.DragEvent) => {
    e.preventDefault()
    const compound = e.dataTransfer.getData('text/compound') || dragging
    setDragging(null)
    setDropTarget(null)
    if (!compound) return
    // Dropping onto an existing stint re-shoes it; dropping on a seam inserts.
    if (index < stints.length) setStint(index, { compound })
    else addStint(compound)
  }

  return (
    <div>
      {/* Tyre rack */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <span className="font-display" style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Tyre rack
        </span>
        {COMPOUNDS.map(c => (
          <div
            key={c}
            draggable
            onDragStart={e => {
              e.dataTransfer.setData('text/compound', c)
              e.dataTransfer.effectAllowed = 'copy'
              setDragging(c)
            }}
            onDragEnd={() => { setDragging(null); setDropTarget(null) }}
            title={`Drag ${c} onto a stint, or use the buttons below`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 11px', borderRadius: 20, cursor: 'grab',
              background: `color-mix(in srgb, ${compoundColor(c)} 20%, transparent)`,
              border: `1px solid ${compoundColor(c)}`,
              opacity: dragging === c ? 0.5 : 1,
            }}
          >
            <span
              className="font-num"
              style={{
                width: 18, height: 18, borderRadius: '50%', background: compoundColor(c),
                color: inkOn(c), fontSize: 10, fontWeight: 800,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {SHORT[c]}
            </span>
            <span className="font-display" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>{c}</span>
          </div>
        ))}
        <button
          onClick={() => addStint()}
          disabled={stints.length >= MAX_STINTS}
          className="font-display"
          style={{
            marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 13px', borderRadius: 2, minHeight: 40,
            background: 'var(--surface)', border: '1px solid var(--border)',
            color: stints.length >= MAX_STINTS ? 'var(--muted)' : 'var(--foreground)',
            cursor: stints.length >= MAX_STINTS ? 'not-allowed' : 'pointer',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          }}
        >
          <Plus size={12} /> Add stint
        </button>
      </div>

      {/* Race bar */}
      <div
        ref={barRef}
        style={{ display: 'flex', gap: 3, height: 46, marginBottom: 10 }}
        onDragOver={e => e.preventDefault()}
      >
        {stints.map((s, i) => (
          <div
            key={i}
            role="button"
            tabIndex={0}
            aria-label={`Stint ${i + 1}: ${s.compound}, ${s.laps} laps. Select to edit.`}
            aria-pressed={selected === i}
            onClick={() => setSelected(i)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(i) }
              if (e.key === 'ArrowRight') { e.preventDefault(); resize(i, 1) }
              if (e.key === 'ArrowLeft') { e.preventDefault(); resize(i, -1) }
            }}
            onDragOver={e => { e.preventDefault(); setDropTarget(i) }}
            onDragLeave={() => setDropTarget(t => (t === i ? null : t))}
            onDrop={e => onDropAt(i, e)}
            style={{
              flex: `${Math.max(s.laps, 1)} 1 0`,
              minWidth: 44,
              background: compoundColor(s.compound),
              opacity: dropTarget === i ? 0.65 : 1,
              outline: selected === i ? '2px solid #fff' : 'none',
              outlineOffset: -2,
              borderRadius: 3,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: inkOn(s.compound),
            }}
          >
            <span className="font-display" style={{ fontSize: 12, fontWeight: 800 }}>{SHORT[s.compound] || '?'}</span>
            <span className="font-num" style={{ fontSize: 10, fontWeight: 700 }}>{s.laps}L</span>
          </div>
        ))}

        {/* Drop zone for appending a stint at the end */}
        {stints.length < MAX_STINTS && (
          <div
            onDragOver={e => { e.preventDefault(); setDropTarget(stints.length) }}
            onDragLeave={() => setDropTarget(t => (t === stints.length ? null : t))}
            onDrop={e => onDropAt(stints.length, e)}
            aria-hidden
            style={{
              width: 44, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `1px dashed ${dropTarget === stints.length ? 'var(--accent)' : 'var(--border)'}`,
              background: dropTarget === stints.length ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
              color: 'var(--muted)', fontSize: 16,
            }}
          >
            +
          </div>
        )}
      </div>

      {/* Lap ruler + distance check */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 14 }}>
        <span className="font-num">LAP 1</span>
        <span
          className="font-num"
          style={{ color: over === 0 ? 'var(--sector-green)' : 'var(--amber)', fontWeight: 700 }}
        >
          {planned} of {totalLaps} laps planned
          {over !== 0 && ` · ${over > 0 ? `${over} over` : `${-over} short`}`}
        </span>
        <span className="font-num">LAP {totalLaps}</span>
      </div>

      {/* Selected stint controls — the keyboard/touch path for everything above */}
      {stints[selected] && (
        <div
          className="glass-card"
          style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
        >
          <span className="font-display" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>
            Stint {selected + 1}
          </span>

          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {COMPOUNDS.map(c => (
              <button
                key={c}
                onClick={() => setStint(selected, { compound: c })}
                aria-pressed={stints[selected].compound === c}
                aria-label={`Set stint ${selected + 1} to ${c}`}
                className="font-num"
                style={{
                  width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
                  background: stints[selected].compound === c ? compoundColor(c) : 'transparent',
                  border: `1px solid ${compoundColor(c)}`,
                  color: stints[selected].compound === c ? inkOn(c) : compoundColor(c),
                  fontSize: 11, fontWeight: 800,
                }}
              >
                {SHORT[c]}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <button
              onClick={() => resize(selected, -1)}
              aria-label={`Shorten stint ${selected + 1}`}
              style={{ width: 34, height: 34, borderRadius: 2, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)', cursor: 'pointer' }}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="font-num" style={{ minWidth: 54, textAlign: 'center', fontSize: 13, fontWeight: 700 }}>
              {stints[selected].laps} laps
            </span>
            <button
              onClick={() => resize(selected, 1)}
              aria-label={`Lengthen stint ${selected + 1}`}
              style={{ width: 34, height: 34, borderRadius: 2, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)', cursor: 'pointer' }}
            >
              <ChevronRight size={14} />
            </button>
            <button
              onClick={() => remove(selected)}
              disabled={stints.length <= 1}
              aria-label={`Remove stint ${selected + 1}`}
              style={{
                width: 34, height: 34, borderRadius: 2, background: 'transparent',
                border: '1px solid var(--border)', marginLeft: 4,
                color: stints.length <= 1 ? 'var(--muted)' : 'var(--accent)',
                cursor: stints.length <= 1 ? 'not-allowed' : 'pointer',
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
