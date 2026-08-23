'use client'

import { motion } from 'framer-motion'
import { Radio, Satellite, Cpu, ListChecks, Waypoints } from 'lucide-react'
import EngineerChat from '@/components/engineer/EngineerChat'

/* Compact header readout — DESIGN.md §2 */
function HeaderStat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div style={{ padding: '9px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, minWidth: 96, textAlign: 'center' }}>
      <div className="font-num stat-num" style={{ fontSize: 16, color: accent || 'var(--foreground)' }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 3 }}>{label}</div>
    </div>
  )
}

const CONTEXT_SOURCES: { label: string; detail: string }[] = [
  { label: 'Timing tower', detail: 'Positions, gaps and tyre state for the top ten while a session is live.' },
  { label: 'Race control', detail: 'The five most recent messages — flags, safety cars, investigations.' },
  { label: 'Weather', detail: 'Air and track temperature, wind and rainfall from the session feed.' },
  { label: 'Championship', detail: '2026 drivers and constructors standings, top ten of each.' },
  { label: 'Calendar', detail: 'The next race weekend, its circuit and its date.' },
]

export default function EngineerPage() {
  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px', position: 'relative', zIndex: 1 }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Radio size={12} /> Pit Wall
          </div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>Race Engineer</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 620 }}>
            Ask Box Box about the session, the standings or the next race — answers are grounded in
            live data whenever a session is running.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <HeaderStat label="Callsign" value="BOX BOX" accent="var(--accent)" />
          <HeaderStat label="Channel" value="OPEN" accent="var(--sector-green)" />
        </div>
      </motion.div>

      {/* Console + rail */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(300px, 1fr)', gap: 16, alignItems: 'start' }} className="live-grid">
        <motion.div
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}
          className="glass-card"
          style={{ padding: 16, display: 'flex', minHeight: 'clamp(520px, 68vh, 760px)' }}
        >
          <EngineerChat />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
          style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          {/* What the engineer can see */}
          <div className="glass-card" style={{ padding: 18 }}>
            <h2 className="section-title" style={{ marginBottom: 14, ['--bar' as string]: 'var(--amber)' }}>
              <Waypoints size={13} style={{ marginRight: -4 }} />
              On The Wire
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {CONTEXT_SOURCES.map(src => (
                <div key={src.label} style={{ borderLeft: '2px solid var(--border)', paddingLeft: 11 }}>
                  <div className="font-display" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {src.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, marginTop: 3 }}>{src.detail}</div>
                </div>
              ))}
            </div>
          </div>

          {/* How to get a good answer */}
          <div className="glass-card" style={{ padding: 18 }}>
            <h2 className="section-title" style={{ marginBottom: 12, ['--bar' as string]: 'var(--sector-green)' }}>
              <ListChecks size={13} style={{ marginRight: -4 }} />
              Radio Discipline
            </h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
              Keep it short, like a real radio call. Ask about one thing at a time — who&apos;s
              leading, a gap, the weather, a tyre call, the next race. Follow-ups keep their context,
              so you can just say &ldquo;and P3?&rdquo; after asking about P2.
            </div>
          </div>

          {/* Engine note */}
          <div className="glass-card" style={{ padding: 18 }}>
            <h2 className="section-title" style={{ marginBottom: 12, ['--bar' as string]: 'var(--sector-purple)' }}>
              <Cpu size={13} style={{ marginRight: -4 }} />
              Engine
            </h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
              Runs on <strong style={{ color: 'var(--foreground)' }}>Gemini</strong> or{' '}
              <strong style={{ color: 'var(--foreground)' }}>Claude</strong> — set{' '}
              <code className="font-num" style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                padding: '1px 5px', borderRadius: 2, fontSize: 11, color: 'var(--foreground)',
              }}>GEMINI_API_KEY</code>{' '}or{' '}
              <code className="font-num" style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                padding: '1px 5px', borderRadius: 2, fontSize: 11, color: 'var(--foreground)',
              }}>ANTHROPIC_API_KEY</code>{' '}
              in the backend environment. Without a key a rule-based radio fallback answers from
              exactly the same live context — the badge above the transcript tells you which one
              is on air.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, fontSize: 11, color: 'var(--muted)' }}>
              <Satellite size={12} style={{ color: 'var(--amber)' }} />
              Context is rebuilt on every question.
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
