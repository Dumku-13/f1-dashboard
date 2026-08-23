'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { ImageIcon, Send, X } from 'lucide-react'
import { TEAMS_2026 } from '@/lib/constants'

const MAX_LEN = 500
const MAX_TAGS = 5

interface Props {
  username: string
  driverOptions: string[]
  onSubmit: (data: { text: string; image_url?: string; tags: string[] }) => Promise<boolean>
}

export default function Composer({ username, driverOptions, onSubmit }: Props) {
  const [text, setText] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imageBroken, setImageBroken] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tagPickerOpen, setTagPickerOpen] = useState(false)

  const toggleTag = (t: string) => {
    setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : prev.length < MAX_TAGS ? [...prev, t] : prev)
  }

  const submit = async () => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError('')
    const ok = await onSubmit({
      text: trimmed,
      image_url: imageUrl.trim() || undefined,
      tags,
    })
    setBusy(false)
    if (ok) {
      setText('')
      setImageUrl('')
      setImageBroken(false)
      setTags([])
    } else {
      setError('Post failed — check the backend or try again in a moment')
    }
  }

  return (
    <div className="glass-card" style={{ padding: '16px' }}>
      <textarea
        value={text}
        onChange={e => setText(e.target.value.slice(0, MAX_LEN))}
        aria-label={username ? `What's happening in the paddock, ${username}?` : 'Join to start posting…'}
        placeholder={username ? `What's happening in the paddock, ${username}?` : 'Join to start posting…'}
        disabled={!username}
        rows={3}
        style={{
          width: '100%', resize: 'vertical', background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '12px 14px',
          color: '#fff', fontSize: '13.5px', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
        <span className="font-num" style={{ fontSize: '10px', color: text.length >= MAX_LEN ? '#E10600' : 'var(--muted)' }}>
          {text.length}/{MAX_LEN}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
        <ImageIcon size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
        <input
          value={imageUrl}
          onChange={e => { setImageUrl(e.target.value); setImageBroken(false) }}
          aria-label="Image URL (optional)…"
          placeholder="Image URL (optional)…"
          disabled={!username}
          maxLength={300}
          style={{
            flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px', padding: '7px 11px', color: '#fff', fontSize: '12px', outline: 'none',
          }}
        />
      </div>
      {imageUrl.trim() && !imageBroken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl.trim()}
          alt="preview"
          onError={() => setImageBroken(true)}
          style={{ maxHeight: '200px', width: 'auto', maxWidth: '100%', borderRadius: '10px', marginTop: '8px', display: 'block' }}
        />
      )}

      <div style={{ marginTop: '10px' }}>
        <button
          onClick={() => setTagPickerOpen(o => !o)}
          disabled={!username}
          style={{
            fontSize: '11px', fontWeight: 700, color: 'var(--muted)', background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer',
          }}
        >
          Tag drivers/teams ({tags.length}/{MAX_TAGS})
        </button>
        {tags.length > 0 && (
          <div style={{ display: 'inline-flex', gap: '5px', flexWrap: 'wrap', marginLeft: '8px', verticalAlign: 'middle' }}>
            {tags.map(t => {
              const team = TEAMS_2026.find(tm => tm.id === t)
              return (
                <button key={t} type="button" onClick={() => toggleTag(t)} aria-label={`Remove ${team?.name || t} tag`} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '3px', cursor: 'pointer',
                  font: 'inherit', margin: 0,
                  fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '99px',
                  background: `${team?.color || 'var(--accent)'}22`, color: team?.color || 'var(--accent)',
                  border: `1px solid ${team?.color || 'var(--accent)'}55`,
                }}>
                  {team?.name || t} <X size={9} />
                </button>
              )
            })}
          </div>
        )}

        {tagPickerOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            style={{ overflow: 'hidden', marginTop: '8px' }}
          >
            <div style={{ fontSize: '10px', color: 'var(--muted)', marginBottom: '5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Teams</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
              {TEAMS_2026.map(team => (
                <button
                  key={team.id}
                  onClick={() => toggleTag(team.id)}
                  style={{
                    fontSize: '10.5px', fontWeight: 700, padding: '4px 9px', borderRadius: '7px', cursor: 'pointer',
                    background: tags.includes(team.id) ? `${team.color}2b` : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${tags.includes(team.id) ? team.color : 'rgba(255,255,255,0.1)'}`,
                    color: tags.includes(team.id) ? '#fff' : 'var(--muted)',
                  }}
                >
                  {team.name}
                </button>
              ))}
            </div>
            {driverOptions.length > 0 && (
              <>
                <div style={{ fontSize: '10px', color: 'var(--muted)', marginBottom: '5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Drivers</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {driverOptions.map(abbr => (
                    <button
                      key={abbr}
                      onClick={() => toggleTag(abbr)}
                      style={{
                        fontSize: '10.5px', fontWeight: 700, padding: '4px 9px', borderRadius: '7px', cursor: 'pointer',
                        background: tags.includes(abbr) ? 'rgba(225,6,0,0.18)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${tags.includes(abbr) ? 'var(--accent)' : 'rgba(255,255,255,0.1)'}`,
                        color: tags.includes(abbr) ? '#fff' : 'var(--muted)',
                      }}
                    >
                      {abbr}
                    </button>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        )}
      </div>

      {error && <div style={{ fontSize: '11px', color: '#E10600', marginTop: '8px' }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
        <button
          onClick={submit}
          disabled={!username || !text.trim() || busy}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '7px',
            background: username && text.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
            color: username && text.trim() ? '#fff' : 'var(--muted)', border: 'none', borderRadius: '10px',
            padding: '9px 18px', fontSize: '12.5px', fontWeight: 700,
            cursor: username && text.trim() ? 'pointer' : 'default',
          }}
        >
          <Send size={13} /> {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  )
}
