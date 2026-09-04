'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessagesSquare, Send, Hash, Radio, Pin, PinOff, EyeOff, Sticker } from 'lucide-react'
import { BACKEND_URL } from '@/lib/constants'
import { getUsername, setUsername } from '@/lib/wallet'
import { useLiveStatus } from '@/lib/live'
import { unlockAchievement, bumpCounter } from '@/lib/achievements'
import { logPulse } from '@/lib/pulse'
import { fetcher } from '@/lib/api/client'
import { useCalendar } from '@/lib/api/hooks'
import EmojiRain from '@/components/paddock/EmojiRain'
import PollsPanel from '@/components/paddock/PollsPanel'
import type { DriverStanding } from '@/lib/types'
import { authHeaders } from '@/lib/auth'

const POLL = 3000
const QUICK_EMOJI = ['🔥', '😂', '😱', '👏', '🏆', '💀']
const REACT_EMOJI = ['🔥', '😂', '👍', '😱', '❤️', '🏆']
const STICKERS = [
  '🛞 BOX BOX BOX', '🚦 LIGHTS OUT!', '🟣 MEGA LAP', '👑 GRAND CHELEM',
  '💨 SEND IT', '🥿 SHOEY TIME', '📻 COPY THAT', '🛞💀 BONO, MY TYRES ARE GONE',
  '🦁 SIMPLY LOVELY', '🧊 KEEP COOL', '⏱️ PURPLE SECTOR', '🍦 VALTTERI, IT\'S JAMES',
]
const SPOILER_DELAYS = [
  { label: 'Off', value: 0 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '2m', value: 120 },
]
const SPOILER_KEY = 'f1.paddock.spoilerDelay'

// Module-scope cache of driver abbreviations for @mention detection in chat
// text — fetched once per page load (browser tab), shared across renders.
let driverTlasCache: string[] | null = null
let driverTlasPromise: Promise<string[]> | null = null

function getDriverTlas(): Promise<string[]> {
  if (driverTlasCache) return Promise.resolve(driverTlasCache)
  if (driverTlasPromise) return driverTlasPromise
  driverTlasPromise = fetcher<{ drivers?: DriverStanding[] }>('/api/standings/?year=2026')
    .then(d => {
      const drivers: DriverStanding[] = Array.isArray(d?.drivers) ? d.drivers : []
      driverTlasCache = drivers.map(dr => dr.abbreviation).filter(Boolean)
      return driverTlasCache
    })
    .catch(() => {
      driverTlasCache = []
      return driverTlasCache
    })
  return driverTlasPromise
}

/** Scan free text for 3-letter uppercase tokens that match a known driver TLA. */
function extractMentionedTlas(text: string, knownTlas: string[]): string[] {
  const tokens = text.match(/\b[A-Z]{3}\b/g) || []
  if (tokens.length === 0) return []
  const known = new Set(knownTlas)
  return [...new Set(tokens.filter(t => known.has(t)))]
}

interface ChatMessage {
  id: number
  channel: string
  username: string
  text: string
  created_at: number
  kind?: string
  pinned?: number
}

interface Reaction {
  message_id: number
  emoji: string
  count: number
  mine: number
}

interface Channel {
  id: string
  label: string
  sub?: string
  live?: boolean
}

function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })
}

const AVATAR_COLORS = ['#E10600', '#FF8000', '#00D2BE', '#3671C6', '#BF00FF', '#00D131', '#64C4FF', '#FF87BC']
function avatarColor(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

export default function PaddockPage() {
  const { live, session } = useLiveStatus()
  const { data: calendarData } = useCalendar(2026)
  const [active, setActive] = useState('general')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [reactions, setReactions] = useState<Map<number, Reaction[]>>(new Map())
  const [pinned, setPinned] = useState<ChatMessage[]>([])
  const [bursts, setBursts] = useState<{ id: number; emoji: string }[]>([])
  const [draft, setDraft] = useState('')
  const [name, setName] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [backendUp, setBackendUp] = useState(true)
  const [stickersOpen, setStickersOpen] = useState(false)
  const [spoilerDelay, setSpoilerDelay] = useState(0)
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [, forceTick] = useState(0)
  const lastIdRef = useRef(0)
  const seenBurstRef = useRef(0)
  const initialLoadRef = useRef(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setName(getUsername())
    const saved = parseInt(localStorage.getItem(SPOILER_KEY) || '0', 10)
    if (Number.isFinite(saved)) setSpoilerDelay(saved)
  }, [])

  // Spoiler shield needs a ticking clock to un-blur aging messages
  useEffect(() => {
    if (!spoilerDelay) return
    const t = setInterval(() => forceTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [spoilerDelay])

  // Live watch-party room — appears while a session runs, on top of the list
  const liveChannel: Channel | null = useMemo(() => {
    if (!live || !session) return null
    const key = slugify(`live-${session.country_name || 'session'}-${session.session_name || ''}`)
    return { id: key, label: `${session.country_name} ${session.session_name}`, sub: 'Watch party — live now', live: true }
  }, [live, session])

  // Channel list from the race calendar (past + current races get threads)
  const channels: Channel[] = useMemo(() => {
    if (calendarData.length === 0) return [{ id: 'general', label: 'General Paddock', sub: 'All things F1' }]
    const now = Date.now()
    const raceChannels: Channel[] = calendarData
      .filter(ev => new Date(ev.event_date).getTime() < now + 7 * 86400000)
      .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime())
      .slice(0, 8)
      .map(ev => ({
        id: `race-${ev.round}`,
        label: ev.name,
        sub: `Round ${ev.round} · ${ev.country}`,
      }))
    return [{ id: 'general', label: 'General Paddock', sub: 'All things F1' }, ...raceChannels]
  }, [calendarData])

  const allChannels = useMemo(
    () => liveChannel ? [liveChannel, ...channels] : channels,
    [liveChannel, channels],
  )

  // Auto-enter the live room when a session starts
  useEffect(() => {
    if (liveChannel) setActive(liveChannel.id)
  }, [liveChannel?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchMessages = useCallback(async (channel: string, reset = false) => {
    try {
      const after = reset ? 0 : lastIdRef.current
      const res = await fetch(`${BACKEND_URL}/api/community/messages?channel=${channel}&after_id=${after}`)
      if (!res.ok) throw new Error()
      const data: ChatMessage[] = await res.json()
      setBackendUp(true)
      if (data.length) {
        lastIdRef.current = data[data.length - 1].id
        setMessages(prev => reset ? data : [...prev, ...data].slice(-300))
        // Rain for new bursts — everyone in the room sees the same storm
        const newBursts = data.filter(m => m.kind === 'burst' && m.id > seenBurstRef.current)
        if (newBursts.length) {
          seenBurstRef.current = Math.max(...newBursts.map(m => m.id))
          if (!initialLoadRef.current) {
            setBursts(newBursts.map(m => ({ id: m.id, emoji: m.text })))
          }
        }
        initialLoadRef.current = false
      } else if (reset) {
        setMessages([])
        initialLoadRef.current = false
      }
    } catch {
      setBackendUp(false)
    }
  }, [])

  const fetchExtras = useCallback(async (channel: string) => {
    try {
      const [rRes, pRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/community/reactions?channel=${channel}&username=${encodeURIComponent(getUsername())}`),
        fetch(`${BACKEND_URL}/api/community/messages/pinned?channel=${channel}`),
      ])
      if (rRes.ok) {
        const rows: Reaction[] = await rRes.json()
        const map = new Map<number, Reaction[]>()
        rows.forEach(r => {
          const list = map.get(r.message_id) || []
          list.push(r)
          map.set(r.message_id, list)
        })
        setReactions(map)
      }
      if (pRes.ok) setPinned(await pRes.json())
    } catch { /* backend down — messages poll shows the banner */ }
  }, [])

  useEffect(() => {
    lastIdRef.current = 0
    seenBurstRef.current = 0
    initialLoadRef.current = true
    setMessages([])
    setPinned([])
    setReactions(new Map())
    fetchMessages(active, true)
    fetchExtras(active)
    const t = setInterval(() => { fetchMessages(active); fetchExtras(active) }, POLL)
    return () => clearInterval(t)
  }, [active, fetchMessages, fetchExtras])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  const post = async (text: string, kind = 'text') => {
    if (!text || !name) return false
    setError(null)
    try {
      const res = await fetch(`${BACKEND_URL}/api/community/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ channel: active, username: name, text, kind }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.detail || 'Message failed to send')
        return false
      }
      unlockAchievement('paddock-debut')
      if (kind === 'burst' && bumpCounter('bursts_sent') >= 10) unlockAchievement('tifosi-energy')
      if (kind === 'text') {
        getDriverTlas().then(tlas => {
          extractMentionedTlas(text, tlas).forEach(tla => logPulse('mention', tla))
        })
      }
      await fetchMessages(active)
      return true
    } catch {
      setError("Couldn't reach the chat server — please try again in a moment.")
      return false
    }
  }

  const send = async () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await post(text)
  }

  const react = async (messageId: number, emoji: string) => {
    if (!name) return
    await fetch(`${BACKEND_URL}/api/community/reactions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ message_id: messageId, username: name, emoji }),
    }).catch(() => null)
    fetchExtras(active)
  }

  const togglePin = async (messageId: number) => {
    if (!name) return
    const res = await fetch(
      `${BACKEND_URL}/api/community/messages/${messageId}/pin?username=${encodeURIComponent(name)}`,
      { method: 'POST', credentials: 'include', headers: authHeaders() },
    ).catch(() => null)
    // Only mirror the change locally if the backend accepted it — the pin is
    // author-only, so someone else's message will come back 403.
    if (!res || !res.ok) return
    fetchExtras(active)
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, pinned: m.pinned ? 0 : 1 } : m))
  }

  const setSpoiler = (v: number) => {
    setSpoilerDelay(v)
    setRevealed(new Set())
    localStorage.setItem(SPOILER_KEY, String(v))
  }

  const isSpoilered = (m: ChatMessage) =>
    spoilerDelay > 0 &&
    m.username !== name &&
    !revealed.has(m.id) &&
    Date.now() / 1000 - m.created_at < spoilerDelay

  const joinAs = () => {
    const n = nameDraft.trim().slice(0, 24)
    if (!n) return
    setUsername(n)
    setName(n)
  }

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px 16px', position: 'relative', zIndex: 1 }}>
      <EmojiRain bursts={bursts} />

      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: '18px' }}>
        <div className="kicker" style={{ marginBottom: '8px' }}>Community</div>
        <h1 className="display-title" style={{ fontSize: 'clamp(28px, 5vw, 44px)', margin: 0 }}>The Paddock</h1>
        <div style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '6px' }}>
          Watch parties, live polls and emoji storms — every session gets a room.
        </div>
      </motion.div>

      {!backendUp && (
        <div className="glass-card" style={{ padding: '14px 18px', marginBottom: '14px', fontSize: '12px', color: '#FF8000', border: '1px solid rgba(255,128,0,0.25)' }}>
          Can&apos;t reach the chat server right now — reconnecting…
        </div>
      )}

      <div className="live-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(210px, 0.75fr) minmax(0, 2fr) minmax(220px, 0.85fr)', gap: '14px', alignItems: 'start' }}>
        {/* Channels */}
        <div className="glass-card" style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {allChannels.map((ch, i) => (
            <motion.button
              key={ch.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => setActive(ch.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left',
                padding: '10px 12px', borderRadius: '10px', cursor: 'pointer', border: 'none',
                background: active === ch.id ? 'rgba(225,6,0,0.16)' : ch.live ? 'rgba(0,209,49,0.07)' : 'transparent',
                outline: active === ch.id ? '1px solid rgba(225,6,0,0.35)' : ch.live ? '1px solid rgba(0,209,49,0.25)' : 'none',
                transition: 'background 0.15s',
              }}
            >
              {ch.live
                ? <span className="live-dot" style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#00D131', boxShadow: '0 0 10px #00D131', flexShrink: 0 }} />
                : <Hash size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />}
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch.label}</span>
                {ch.sub && <span style={{ display: 'block', fontSize: '10px', color: ch.live ? '#00D131' : 'var(--muted)' }}>{ch.sub}</span>}
              </span>
            </motion.button>
          ))}
        </div>

        {/* Chat */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', height: '660px', overflow: 'hidden' }}>
          <div style={{ padding: '11px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {allChannels.find(c => c.id === active)?.live
              ? <Radio size={15} style={{ color: '#00D131' }} />
              : <MessagesSquare size={15} style={{ color: 'var(--accent)' }} />}
            <span className="font-display" style={{ fontWeight: 700, fontSize: '14px', flex: 1, minWidth: '120px' }}>
              {allChannels.find(c => c.id === active)?.label || active}
            </span>
            {/* Spoiler shield */}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <EyeOff size={12} style={{ color: spoilerDelay ? '#FF8000' : 'var(--muted)' }} />
              {SPOILER_DELAYS.map(d => (
                <button
                  key={d.value}
                  onClick={() => setSpoiler(d.value)}
                  title="Spoiler shield — blur messages newer than your stream delay"
                  style={{
                    background: spoilerDelay === d.value ? 'rgba(255,128,0,0.16)' : 'transparent',
                    border: `1px solid ${spoilerDelay === d.value ? 'rgba(255,128,0,0.45)' : 'rgba(255,255,255,0.08)'}`,
                    color: spoilerDelay === d.value ? '#FF8000' : 'var(--muted)',
                    borderRadius: '6px', padding: '2px 7px', fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {d.label}
                </button>
              ))}
            </span>
          </div>

          {/* Pinned strip */}
          {pinned.length > 0 && (
            <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,215,0,0.15)', background: 'rgba(255,215,0,0.04)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {pinned.slice(-3).map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                  <Pin size={11} style={{ color: '#FFD700', flexShrink: 0 }} />
                  <span style={{ color: '#FFD700', fontWeight: 700, flexShrink: 0 }}>{m.username}:</span>
                  <span style={{ color: '#D1D5DB', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.text}</span>
                </div>
              ))}
            </div>
          )}

          <div ref={scrollRef} className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {messages.length === 0 && (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                No messages yet — be the first to open the radio. 🎙️
              </div>
            )}
            <AnimatePresence initial={false}>
              {messages.map(m => {
                const own = m.username === name
                if (m.kind === 'burst') {
                  return (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      style={{ textAlign: 'center', fontSize: '12px', color: 'var(--muted)' }}
                    >
                      <span style={{ fontSize: '18px', marginRight: '6px' }}>{m.text}</span>
                      {m.username} sent an emoji storm
                    </motion.div>
                  )
                }
                const spoiled = isSpoilered(m)
                const mReactions = reactions.get(m.id) || []
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className="paddock-msg"
                    style={{ display: 'flex', gap: '10px', flexDirection: own ? 'row-reverse' : 'row' }}
                  >
                    <span style={{
                      width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                      background: `${avatarColor(m.username)}33`, border: `1px solid ${avatarColor(m.username)}66`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '12px', fontWeight: 800, color: avatarColor(m.username),
                    }}>
                      {m.username.slice(0, 1).toUpperCase()}
                    </span>
                    <div style={{ maxWidth: '75%', minWidth: 0 }}>
                      <div className={`chat-bubble${own ? ' own' : ''}`} style={{ position: 'relative' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: '3px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: avatarColor(m.username) }}>{m.username}</span>
                          <span className="font-num" style={{ fontSize: '9px', color: 'var(--muted)' }}>{fmtTime(m.created_at)}</span>
                          {!!m.pinned && <Pin size={9} style={{ color: '#FFD700' }} />}
                        </div>
                        <div
                          onClick={() => spoiled && setRevealed(prev => new Set(prev).add(m.id))}
                          title={spoiled ? 'Spoiler shield — click to reveal' : undefined}
                          role={spoiled ? 'button' : undefined}
                          tabIndex={spoiled ? 0 : undefined}
                          onKeyDown={spoiled ? (e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              if (e.key === ' ') e.preventDefault()
                              setRevealed(prev => new Set(prev).add(m.id))
                            }
                          }) : undefined}
                          style={{
                            fontSize: m.kind === 'sticker' ? '17px' : '13px',
                            fontWeight: m.kind === 'sticker' ? 800 : 400,
                            lineHeight: 1.5, color: '#E5E7EB', wordBreak: 'break-word',
                            filter: spoiled ? 'blur(7px)' : 'none',
                            cursor: spoiled ? 'pointer' : 'default',
                            transition: 'filter 0.3s',
                            letterSpacing: m.kind === 'sticker' ? '0.03em' : undefined,
                          }}
                        >
                          {m.text}
                        </div>
                        {/* Hover actions */}
                        {name && (
                          <div className="msg-actions" style={{
                            position: 'absolute', top: '-14px', [own ? 'left' : 'right']: '6px',
                            display: 'flex', gap: '2px', background: 'rgba(18,18,20,0.95)',
                            border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '2px 4px',
                          }}>
                            {REACT_EMOJI.slice(0, 4).map(e => (
                              <button key={e} onClick={() => react(m.id, e)} style={{ background: 'none', border: 'none', fontSize: '12px', cursor: 'pointer', padding: '2px' }}>
                                {e}
                              </button>
                            ))}
                            {/* Pinning is author-only server-side — don't offer
                                a button that can only ever 403. */}
                            {own && (
                              <button onClick={() => togglePin(m.id)} title={m.pinned ? 'Unpin' : 'Pin'} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}>
                                {m.pinned ? <PinOff size={11} style={{ color: '#FFD700' }} /> : <Pin size={11} style={{ color: 'var(--muted)' }} />}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Reaction chips */}
                      {mReactions.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap', justifyContent: own ? 'flex-end' : 'flex-start' }}>
                          {mReactions.map(r => (
                            <button
                              key={r.emoji}
                              onClick={() => react(m.id, r.emoji)}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: '3px',
                                background: r.mine ? 'rgba(225,6,0,0.16)' : 'rgba(255,255,255,0.05)',
                                border: `1px solid ${r.mine ? 'rgba(225,6,0,0.4)' : 'rgba(255,255,255,0.1)'}`,
                                borderRadius: '99px', padding: '1px 7px', fontSize: '11px', cursor: 'pointer',
                              }}
                            >
                              {r.emoji} <span className="font-num" style={{ fontSize: '9px', color: 'var(--muted)' }}>{r.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>

          {error && <div style={{ padding: '6px 18px', fontSize: '11px', color: '#E8002D' }}>{error}</div>}

          {/* Composer */}
          <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {name ? (
              <>
                <div style={{ display: 'flex', gap: '5px', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {QUICK_EMOJI.map(e => (
                    <button
                      key={e}
                      onClick={() => post(e, 'burst')}
                      title="Send an emoji storm"
                      style={{
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px', padding: '4px 8px', fontSize: '15px', cursor: 'pointer',
                      }}
                    >
                      {e}
                    </button>
                  ))}
                  <button
                    onClick={() => setStickersOpen(o => !o)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                      background: stickersOpen ? 'rgba(225,6,0,0.16)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${stickersOpen ? 'rgba(225,6,0,0.4)' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: '8px', padding: '5px 10px', fontSize: '11px', fontWeight: 700,
                      color: '#D1D5DB', cursor: 'pointer',
                    }}
                  >
                    <Sticker size={13} /> Stickers
                  </button>
                </div>
                <AnimatePresence>
                  {stickersOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      style={{ overflow: 'hidden', marginBottom: '8px' }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                        {STICKERS.map(s => (
                          <button
                            key={s}
                            onClick={async () => { if (await post(s, 'sticker')) setStickersOpen(false) }}
                            style={{
                              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '8px', padding: '5px 10px', fontSize: '11px', fontWeight: 700,
                              color: '#E5E7EB', cursor: 'pointer',
                            }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') send() }}
                    placeholder={`Message as ${name}…`}
                    maxLength={500}
                    style={{
                      flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '10px', padding: '10px 14px', color: '#fff', fontSize: '13px', outline: 'none',
                    }}
                  />
                  <button
                    onClick={send}
                    aria-label="Send message"
                    disabled={!draft.trim()}
                    style={{
                      background: draft.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                      border: 'none', borderRadius: '10px', width: '44px', cursor: draft.trim() ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s',
                    }}
                  >
                    <Send size={15} style={{ color: draft.trim() ? '#fff' : 'var(--muted)' }} />
                  </button>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') joinAs() }}
                  placeholder="Pick a paddock name to join the chat…"
                  maxLength={24}
                  style={{
                    flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '10px', padding: '10px 14px', color: '#fff', fontSize: '13px', outline: 'none',
                  }}
                />
                <button
                  onClick={joinAs}
                  style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Join
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Polls sidebar */}
        <PollsPanel channel={active} username={name} />
      </div>

      <style jsx global>{`
        .paddock-msg .msg-actions { opacity: 0; pointer-events: none; transition: opacity 0.12s; }
        .paddock-msg:hover .msg-actions { opacity: 1; pointer-events: auto; }
      `}</style>
    </div>
  )
}
