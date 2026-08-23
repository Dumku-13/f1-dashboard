'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { LogIn, UserPlus, KeyRound, Mail, Flag } from 'lucide-react'
import { login, register, useAuth } from '@/lib/auth'
import { getUsername } from '@/lib/wallet'

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#0E0F12',
  border: '1px solid var(--border)', borderRadius: '2px',
  padding: '11px 13px', color: '#EDEFF2', fontSize: '14px', outline: 'none',
  fontFamily: "'IBM Plex Mono', monospace",
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '10px', letterSpacing: '0.16em', color: '#8C939E',
  textTransform: 'uppercase', marginBottom: '6px', fontFamily: "'Chakra Petch', sans-serif",
  fontWeight: 600,
}

export default function LoginPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [username, setUsernameField] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Prefill with the guest paddock name — registering it adopts your history
  useEffect(() => { setUsernameField(getUsername()) }, [])

  // Already signed in → straight to the profile
  useEffect(() => {
    if (!loading && user) router.replace('/profile')
  }, [loading, user, router])

  const submit = async () => {
    if (!username.trim() || !password) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'signin') await login(username.trim(), password)
      else await register(username.trim(), password, email.trim() || undefined)
      router.push('/profile')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'something went wrong')
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: '460px', margin: '0 auto', padding: '48px 16px', position: 'relative', zIndex: 1 }}>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: '20px' }}>
        <div className="kicker" style={{ marginBottom: '8px' }}>Driver Licence</div>
        <h1 className="display-title" style={{ fontSize: 'clamp(30px, 6vw, 44px)', margin: 0 }}>
          {mode === 'signin' ? 'Sign In' : 'Join the Grid'}
        </h1>
        <div style={{ color: '#8C939E', fontSize: '13px', marginTop: '8px', lineHeight: 1.6 }}>
          One account for everything — predictions, fantasy team, feed, coins and badges.
          {mode === 'register' && ' Register with your current paddock name and your existing history comes with you.'}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
        className="featured-card" style={{ padding: '24px 22px' }}
      >
        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: '2px', marginBottom: '22px', border: '1px solid var(--border)', padding: '2px' }}>
          {(['signin', 'register'] as const).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError('') }}
              style={{
                flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer',
                background: mode === m ? 'var(--accent)' : 'transparent',
                color: mode === m ? '#fff' : '#8C939E',
                fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700,
                fontSize: '12px', letterSpacing: '0.1em', textTransform: 'uppercase',
                transition: 'background 0.15s',
              }}
            >
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label htmlFor="username" style={labelStyle}><Flag size={10} style={{ verticalAlign: '-1px', marginRight: '5px' }} />Paddock name</label>
          <input
            id="username"
            value={username}
            onChange={e => setUsernameField(e.target.value)}
            maxLength={24}
            placeholder="e.g. GravelTrapGuru"
            autoComplete="username"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label htmlFor="password" style={labelStyle}><KeyRound size={10} style={{ verticalAlign: '-1px', marginRight: '5px' }} />Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            maxLength={128}
            placeholder={mode === 'register' ? 'min 6 characters' : '••••••••'}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            style={inputStyle}
          />
        </div>

        {mode === 'register' && (
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="email" style={labelStyle}><Mail size={10} style={{ verticalAlign: '-1px', marginRight: '5px' }} />Email <span style={{ opacity: 0.6 }}>(optional)</span></label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              maxLength={120}
              placeholder="for account recovery later"
              autoComplete="email"
              style={inputStyle}
            />
          </div>
        )}

        {error && (
          <div style={{
            marginBottom: '14px', padding: '9px 12px', fontSize: '12px', color: '#FF7B76',
            background: 'rgba(225,6,0,0.08)', border: '1px solid rgba(225,6,0,0.3)', borderRadius: '2px',
          }}>
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={busy || !username.trim() || password.length < (mode === 'register' ? 6 : 1)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px',
            background: busy ? '#3A3E46' : 'var(--accent)', color: '#fff', border: 'none',
            borderRadius: '2px', padding: '13px 0', cursor: busy ? 'default' : 'pointer',
            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '14px',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}
        >
          {mode === 'signin' ? <LogIn size={16} /> : <UserPlus size={16} />}
          {busy ? 'Checking…' : mode === 'signin' ? 'Open the garage' : 'Sign the contract'}
        </button>

        <div style={{ marginTop: '14px', fontSize: '11px', color: '#5B6069', lineHeight: 1.6 }}>
          Accounts are stored locally in this app&apos;s own database. Password is salted + hashed
          (PBKDF2); sessions expire after 30 days.
        </div>
      </motion.div>
    </div>
  )
}
