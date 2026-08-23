'use client'

/**
 * Team radio clips from the live feed.
 *
 * F1 publishes each capture as an mp3 on its static host; the engine resolves
 * the absolute URL. Plays one at a time — overlapping radio is unlistenable.
 * Hides itself entirely when there are no clips, which is the normal state on
 * the OpenF1 source (it carries no radio feed).
 */

import { useEffect, useRef, useState } from 'react'
import { Mic, Play, Pause } from 'lucide-react'
import type { TeamRadioClip, TowerRow } from '@/lib/live'

export default function TeamRadioPanel({
  clips,
  rows,
}: {
  clips: TeamRadioClip[]
  rows: TowerRow[]
}) {
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Stop audio when the panel unmounts, or a clip keeps playing after you
  // navigate away.
  useEffect(() => () => { audioRef.current?.pause() }, [])

  if (!clips.length) return null

  const byNumber = new Map(rows.map(r => [r.driver.driver_number, r.driver]))

  const toggle = (clip: TeamRadioClip) => {
    if (playing === clip.url) {
      audioRef.current?.pause()
      setPlaying(null)
      return
    }
    audioRef.current?.pause()
    const el = new Audio(clip.url)
    el.onended = () => setPlaying(null)
    el.onerror = () => setPlaying(null)
    audioRef.current = el
    void el.play().then(() => setPlaying(clip.url)).catch(() => setPlaying(null))
  }

  return (
    <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Mic size={14} style={{ color: 'var(--sector-purple)' }} />
        <span className="font-display" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Team Radio
        </span>
        <span className="font-num" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>{clips.length}</span>
      </div>

      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {clips.map(clip => {
          const d = byNumber.get(clip.driverNumber)
          const colour = d?.team_colour ? `#${d.team_colour.replace('#', '')}` : 'var(--muted)'
          const isPlaying = playing === clip.url
          const when = clip.date ? new Date(clip.date) : null
          return (
            <button
              key={clip.url}
              onClick={() => toggle(clip)}
              aria-label={`${isPlaying ? 'Pause' : 'Play'} team radio from ${d?.name_acronym || `car ${clip.driverNumber}`}`}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 16px', background: 'transparent', cursor: 'pointer',
                border: 'none', borderBottom: '1px solid var(--hairline)',
                borderLeft: `2px solid ${colour}`, color: 'var(--foreground)',
                textAlign: 'left', minHeight: 44,
              }}
            >
              {isPlaying ? <Pause size={13} style={{ color: 'var(--accent)' }} /> : <Play size={13} style={{ color: 'var(--muted)' }} />}
              <span className="font-display" style={{ fontSize: 12, fontWeight: 700, minWidth: 34 }}>
                {d?.name_acronym || clip.driverNumber}
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d?.team_name || ''}
              </span>
              {when && !Number.isNaN(when.getTime()) && (
                <span className="font-num" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>
                  {when.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
