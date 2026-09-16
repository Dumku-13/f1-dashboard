'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Terminal } from 'lucide-react'
import { COMMAND_EVENT, parseCommand } from '@/lib/tactical/commands'
import { setOpsMode } from '@/lib/tactical/modes'

interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  abort(): void
}
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
const HELP = 'Try “thermal”, “track Max Verstappen”, “chase cam” or “display interval gaps”.'

/** No LLM, key, automatic listening, or backend fallback. Typed commands always work. */
export default function VoiceEngineer() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState(HELP)
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const recognition = useRef<Recognition | null>(null)
  useEffect(() => {
    const browser = window as SpeechWindow
    setSupported(!!(browser.SpeechRecognition || browser.webkitSpeechRecognition) && window.isSecureContext)
    return () => {
      const active = recognition.current
      if (active) { active.onresult = null; active.onerror = null; active.onend = null; active.abort() }
    }
  }, [])

  function run(value: string) {
    setText(value)
    const command = parseCommand(value)
    if (!command) { setStatus(`Command not recognized. ${HELP}`); return }
    if (command.type === 'mode') {
      setOpsMode(command.mode)
      setStatus(`Visual mode: ${command.mode}.`)
    } else {
      window.dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail: command }))
      setStatus(command.type === 'track-driver'
        ? `Target request: ${command.query}. The active track view resolves matching loaded drivers.`
        : 'Command sent to the active track view. Open Tactical Ops for replay controls.')
    }
  }

  function toggleMic() {
    if (recognition.current) { recognition.current.abort(); return }
    const browser = window as SpeechWindow
    const Constructor = browser.SpeechRecognition || browser.webkitSpeechRecognition
    if (!Constructor) return
    const active = new Constructor()
    recognition.current = active
    active.lang = 'en-US'
    active.continuous = false
    active.interimResults = false
    active.onresult = event => { const value = event.results[0]?.[0]?.transcript; if (value) run(value) }
    active.onerror = event => {
      setListening(false)
      setStatus(event.error === 'not-allowed' ? 'Microphone permission denied. Type a command below.'
        : event.error === 'no-speech' ? 'No speech detected. Try again or type a command.'
        : event.error === 'aborted' ? 'Microphone stopped.' : `Speech unavailable (${event.error}). Typed commands still work.`)
    }
    active.onend = () => { recognition.current = null; setListening(false) }
    try { active.start(); setListening(true); setStatus('Listening for one command…') }
    catch { recognition.current = null; setListening(false); setStatus('Unable to start the microphone. Type a command instead.') }
  }

  return <section aria-label="Local race engineer commands" style={{ border: '1px solid var(--border)', background: 'var(--surface)', padding: 14, borderRadius: 2, margin: '12px 0' }}>
    <div className="kicker" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><Terminal size={14} /> ENGINEER / LOCAL COMMANDS</div>
    <form onSubmit={event => { event.preventDefault(); run(text) }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <input aria-label="Tactical command" value={text} onChange={event => setText(event.target.value)} placeholder="Engineer, activate thermal" maxLength={180}
        style={{ flex: '1 1 180px', minWidth: 0, padding: '10px 12px', background: 'var(--background)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 2 }} />
      <button type="submit" disabled={!text.trim()} style={{ padding: '10px 14px', cursor: 'pointer' }}>Execute</button>
      <button type="button" disabled={!supported} onClick={toggleMic} aria-pressed={listening} aria-label={listening ? 'Stop microphone' : 'Start voice command'} title={supported ? 'Listen for one command' : 'Speech recognition unavailable; use typed commands'} style={{ padding: '10px 12px', cursor: 'pointer' }}>
        {listening ? <Square size={17} /> : <Mic size={17} />}
      </button>
    </form>
    <p role="status" style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: '10px 0 4px' }}>{status}</p>
    <p style={{ fontSize: 10, color: 'var(--muted)', margin: 0 }}>No AI API. Voice recognition depends on your browser and may send audio to its speech service. <a href="/tactical">Open Tactical Ops ↗</a></p>
  </section>
}
