'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Radio, Send, Satellite, Terminal } from 'lucide-react'
import { BACKEND_URL } from '@/lib/constants'

const HISTORY_KEY = 'f1.engineer.history'
const MAX_STORED_MESSAGES = 40
const MAX_HISTORY_TURNS = 10

const QUICK_PROMPTS = [
  "Who's leading?",
  'Weather update',
  "What's the gap to P2?",
  'Next race?',
]

interface Message {
  id: string
  role: 'user' | 'engineer'
  content: string
  streaming?: boolean
}

function loadHistory(): Message[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(messages: Message[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)))
  } catch {
    /* storage full or unavailable — non-fatal */
  }
}

let idCounter = 0
function nextId() {
  idCounter += 1
  return `m${Date.now()}_${idCounter}`
}

export default function EngineerChat({ compact = false }: { compact?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [aiStatus, setAiStatus] = useState<boolean | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Mirror of `messages` readable synchronously inside send() — see below.
  const messagesRef = useRef<Message[]>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setMessages(loadHistory())
    let cancelled = false
    fetch(`${BACKEND_URL}/api/engineer/status`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setAiStatus(d?.ai ?? false) })
      .catch(() => { if (!cancelled) setAiStatus(false) })
    return () => { cancelled = true }
  }, [])

  // Abort an in-flight stream when the dock closes / the page navigates away,
  // otherwise the reader keeps pulling and setState-ing on an unmounted tree.
  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    messagesRef.current = messages
    if (messages.length > 0) saveHistory(messages)
  }, [messages])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = useCallback(async (text: string) => {
    const question = text.trim()
    if (!question || sending) return

    setSending(true)
    setInput('')

    const userMsg: Message = { id: nextId(), role: 'user', content: question }
    const engineerMsg: Message = { id: nextId(), role: 'engineer', content: '', streaming: true }

    // Read the prior turns from a ref, NOT from inside a setMessages updater:
    // React defers the updater to the render phase (the fiber is already marked
    // by setSending/setInput above), so the fetch below used to serialise an
    // empty history every single time and the engineer had no conversation
    // context at all.
    const historyTurns = messagesRef.current
      .slice(-MAX_HISTORY_TURNS)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))

    setMessages(prev => [...prev, userMsg, engineerMsg])

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    try {
      const res = await fetch(`${BACKEND_URL}/api/engineer/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: historyTurns }),
        signal: ac.signal,
      })

      if (!res.ok || !res.body) {
        throw new Error('bad response')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += decoder.decode(value, { stream: true })
        setMessages(prev =>
          prev.map(m => (m.id === engineerMsg.id ? { ...m, content: full, streaming: true } : m))
        )
      }

      setMessages(prev =>
        prev.map(m => (m.id === engineerMsg.id ? { ...m, content: full || 'No response.', streaming: false } : m))
      )
    } catch {
      if (ac.signal.aborted) return
      setMessages(prev =>
        prev.map(m =>
          m.id === engineerMsg.id
            ? { ...m, content: 'Radio check failed — backend unreachable. Try again.', streaming: false }
            : m
        )
      )
    } finally {
      if (!ac.signal.aborted) setSending(false)
    }
  }, [sending])

  const onSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    send(input)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* Header / badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: compact ? '10px 14px' : '0 0 14px',
          borderBottom: compact ? '1px solid rgba(255,255,255,0.08)' : 'none',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Radio size={compact ? 14 : 16} style={{ color: 'var(--accent)' }} />
          <h2 className="section-title" style={{ fontSize: compact ? '12px' : '13px' }}>
            Box Box
          </h2>
        </div>
        {aiStatus !== null && (
          <span
            style={{
              fontSize: '9px',
              fontWeight: 800,
              letterSpacing: '0.08em',
              padding: '3px 8px',
              borderRadius: '999px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              background: aiStatus ? 'rgba(0,209,49,0.12)' : 'rgba(255,242,0,0.1)',
              border: `1px solid ${aiStatus ? 'rgba(0,209,49,0.35)' : 'rgba(255,242,0,0.3)'}`,
              color: aiStatus ? '#00D131' : '#FFF200',
            }}
          >
            {aiStatus ? <Satellite size={10} /> : <Terminal size={10} />}
            {aiStatus ? 'AI' : 'RULE-BASED'}
          </span>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="hide-scrollbar"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: compact ? '10px 14px' : '14px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {messages.length === 0 && (
          <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '18px 0', textAlign: 'center' }}>
            Box Box on the wire. Ask about the session, standings, or the next race.
          </div>
        )}
        <AnimatePresence initial={false}>
          {messages.map(m => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '85%',
                  padding: '9px 12px',
                  borderRadius: '12px',
                  fontSize: '12.5px',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: m.role === 'engineer' ? "'Space Grotesk', monospace" : 'inherit',
                  background:
                    m.role === 'user' ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                  border:
                    m.role === 'user'
                      ? '1px solid rgba(225,6,0,0.5)'
                      : '1px solid rgba(255,255,255,0.1)',
                  color: m.role === 'user' ? '#fff' : '#D1D5DB',
                }}
              >
                {m.content || (m.streaming ? '…' : '')}
                {m.streaming && m.content && <span className="live-dot" style={{ marginLeft: '4px' }}>▍</span>}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Quick prompts */}
      <div
        style={{
          display: 'flex',
          gap: '6px',
          flexWrap: 'wrap',
          padding: compact ? '0 14px 8px' : '0 0 10px',
          flexShrink: 0,
        }}
      >
        {QUICK_PROMPTS.map(p => (
          <button
            key={p}
            onClick={() => send(p)}
            disabled={sending}
            style={{
              fontSize: '10.5px',
              fontWeight: 600,
              padding: '5px 9px',
              borderRadius: '999px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#9CA3AF',
              cursor: sending ? 'default' : 'pointer',
              opacity: sending ? 0.5 : 1,
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={onSubmit}
        style={{
          display: 'flex',
          gap: '8px',
          padding: compact ? '10px 14px' : '0',
          borderTop: compact ? '1px solid rgba(255,255,255,0.08)' : 'none',
          flexShrink: 0,
        }}
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          maxLength={500}
          aria-label="Talk to your engineer…"
          placeholder="Talk to your engineer…"
          disabled={sending}
          style={{
            flex: 1,
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: '8px',
            padding: '9px 12px',
            color: '#fff',
            fontSize: '12.5px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={sending || !input.trim()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '38px',
            background: input.trim() && !sending ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
            border: 'none',
            borderRadius: '8px',
            color: input.trim() && !sending ? '#fff' : 'var(--muted)',
            cursor: input.trim() && !sending ? 'pointer' : 'default',
          }}
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  )
}
