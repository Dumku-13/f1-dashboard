'use client'

/**
 * Live polls for a watch-party room: create, vote (changeable while open),
 * animated result bars, creator can close.
 */

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BarChart3, Plus, X, Check } from 'lucide-react'
import { BACKEND_URL } from '@/lib/constants'
import { unlockAchievement } from '@/lib/achievements'

const POLL_REFRESH = 5000
const BAR_COLORS = ['#E10600', '#3671C6', '#00D2BE', '#FF8000', '#BF00FF', '#00D131']

export interface Poll {
  id: number
  channel: string
  username: string
  question: string
  options: string[]
  counts: number[]
  total: number
  my_vote: number | null
  closed: boolean
}

export default function PollsPanel({ channel, username }: { channel: string; username: string }) {
  const [polls, setPolls] = useState<Poll[]>([])
  const [creating, setCreating] = useState(false)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    fetch(`${BACKEND_URL}/api/community/polls?channel=${channel}&username=${encodeURIComponent(username)}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setPolls(Array.isArray(d) ? d : []))
      .catch(() => null)
  }, [channel, username])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_REFRESH)
    return () => clearInterval(t)
  }, [refresh])

  const create = async () => {
    const opts = options.map(o => o.trim()).filter(Boolean)
    if (!question.trim() || opts.length < 2 || !username) return
    setError('')
    const res = await fetch(`${BACKEND_URL}/api/community/polls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, username, question: question.trim(), options: opts }),
    }).catch(() => null)
    if (!res?.ok) {
      const body = await res?.json().catch(() => null)
      setError(body?.detail || 'could not create poll')
      return
    }
    unlockAchievement('poll-pundit')
    setQuestion('')
    setOptions(['', ''])
    setCreating(false)
    refresh()
  }

  const vote = async (poll: Poll, idx: number) => {
    if (poll.closed || !username) return
    const res = await fetch(`${BACKEND_URL}/api/community/polls/${poll.id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, option_idx: idx }),
    }).catch(() => null)
    if (res?.ok) {
      const updated = await res.json()
      setPolls(prev => prev.map(p => p.id === updated.id ? updated : p))
    }
  }

  const close = async (poll: Poll) => {
    await fetch(`${BACKEND_URL}/api/community/polls/${poll.id}/close?username=${encodeURIComponent(username)}`, { method: 'POST' }).catch(() => null)
    refresh()
  }

  const open = polls.filter(p => !p.closed)
  const finished = polls.filter(p => p.closed).slice(0, 2)

  return (
    <div className="glass-card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <BarChart3 size={13} /> Live polls
        </h2>
        {username && (
          <button
            onClick={() => setCreating(c => !c)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              background: creating ? 'rgba(255,255,255,0.08)' : 'rgba(225,6,0,0.14)',
              border: `1px solid ${creating ? 'rgba(255,255,255,0.15)' : 'rgba(225,6,0,0.35)'}`,
              color: creating ? 'var(--muted)' : '#fff', borderRadius: '8px', padding: '5px 10px',
              fontSize: '11px', fontWeight: 700, cursor: 'pointer',
            }}
          >
            {creating ? <><X size={11} /> Cancel</> : <><Plus size={11} /> New poll</>}
          </button>
        )}
      </div>

      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden', marginBottom: '12px' }}
          >
            <input
              value={question} onChange={e => setQuestion(e.target.value)} maxLength={200}
              aria-label="Ask the room…"
              placeholder="Ask the room…"
              style={{
                width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.14)', borderRadius: '8px',
                padding: '8px 11px', color: '#fff', fontSize: '12px', outline: 'none', marginBottom: '6px',
              }}
            />
            {options.map((o, i) => (
              <input
                key={i} value={o} maxLength={60}
                onChange={e => setOptions(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                aria-label={`Option ${i + 1}`}
                placeholder={`Option ${i + 1}`}
                style={{
                  width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
                  padding: '7px 11px', color: '#fff', fontSize: '12px', outline: 'none', marginBottom: '5px',
                }}
              />
            ))}
            <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
              {options.length < 6 && (
                <button onClick={() => setOptions(o => [...o, ''])} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--muted)', borderRadius: '7px', padding: '6px 10px', fontSize: '11px', cursor: 'pointer' }}>
                  + option
                </button>
              )}
              <button onClick={create} style={{ background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: '7px', padding: '6px 14px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
                Launch poll
              </button>
            </div>
            {error && <div style={{ fontSize: '11px', color: '#E8002D', marginTop: '5px' }}>{error}</div>}
          </motion.div>
        )}
      </AnimatePresence>

      {open.length === 0 && finished.length === 0 && !creating && (
        <div style={{ fontSize: '11px', color: 'var(--muted)', padding: '6px 0' }}>No polls yet — start one for the room.</div>
      )}

      {[...open, ...finished].map(poll => (
        <div key={poll.id} style={{ marginBottom: '14px', opacity: poll.closed ? 0.65 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '7px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, lineHeight: 1.4 }}>{poll.question}</div>
            {!poll.closed && poll.username === username && (
              <button onClick={() => close(poll)} title="Close poll" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '10px', cursor: 'pointer', flexShrink: 0 }}>
                close
              </button>
            )}
          </div>
          {poll.options.map((opt, i) => {
            // `counts` can be shorter than `options`; without the ?? 0 this
            // renders `width: NaN%` and a "undefined · NaN%" label.
            const votes = poll.counts[i] ?? 0
            const pct = poll.total > 0 ? (votes / poll.total) * 100 : 0
            const mine = poll.my_vote === i
            return (
              <button
                key={i}
                onClick={() => vote(poll, i)}
                disabled={poll.closed}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', position: 'relative',
                  background: 'rgba(255,255,255,0.03)', border: `1px solid ${mine ? BAR_COLORS[i % BAR_COLORS.length] : 'rgba(255,255,255,0.07)'}`,
                  borderRadius: '8px', padding: '7px 10px', marginBottom: '5px', overflow: 'hidden',
                  cursor: poll.closed ? 'default' : 'pointer',
                }}
              >
                <motion.span
                  animate={{ width: `${pct}%` }}
                  transition={{ type: 'spring', stiffness: 120, damping: 22 }}
                  style={{
                    position: 'absolute', inset: '0 auto 0 0',
                    background: `${BAR_COLORS[i % BAR_COLORS.length]}2e`,
                    borderRadius: '7px',
                  }}
                />
                <span style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#E5E7EB', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    {mine && <Check size={11} style={{ color: BAR_COLORS[i % BAR_COLORS.length] }} />}
                    {opt}
                  </span>
                  <span className="font-num" style={{ fontSize: '10px', color: 'var(--muted)' }}>
                    {votes} · {pct.toFixed(0)}%
                  </span>
                </span>
              </button>
            )
          })}
          <div style={{ fontSize: '10px', color: 'var(--muted)' }}>
            {poll.total} vote{poll.total === 1 ? '' : 's'} · by {poll.username}{poll.closed ? ' · closed' : ''}
          </div>
        </div>
      ))}
    </div>
  )
}
