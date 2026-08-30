'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { LogIn, UserPlus, KeyRound, Mail, Flag, Eye, EyeOff } from 'lucide-react'
import { login, register, useAuth } from '@/lib/auth'
import { getUsername } from '@/lib/wallet'
import FormStatus from '@/components/ui/FormStatus'

// Tokens, not literals: this page is one of the surfaces the light theme has
// to work on, and `#0E0F12` on paper is a black box.
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: '2px',
  padding: '11px 13px', color: 'var(--foreground)', fontSize: '14px', outline: 'none',
  fontFamily: "'IBM Plex Mono', monospace",
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '10px', letterSpacing: '0.16em', color: 'var(--muted)',
  textTransform: 'uppercase', marginBottom: '6px', fontFamily: "'Chakra Petch', sans-serif",
  fontWeight: 600,
}

// Mirrors USERNAME_RE in backend/routers/auth.py. Duplicated deliberately —
// the server's copy is the one that enforces, this one just saves a round trip
// to be told something the field could have said immediately.
const USERNAME_RE = /^[A-Za-z0-9_-]{3,24}$/
const MIN_PASSWORD = 6

export default function LoginPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [username, setUsernameField] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const statusRef = useRef<HTMLDivElement>(null)

  // Prefill with the guest paddock name — registering it adopts your history
  useEffect(() => { setUsernameField(getUsername()) }, [])

  // Already signed in → straight to the profile
  useEffect(() => {
    if (!loading && user) router.replace('/profile')
  }, [loading, user, router])

  /** What the server would reject, said here instead of after a round trip. */
  const validate = (): string | null => {
    const name = username.trim()
    if (!name) return 'a paddock name is required'
    if (!USERNAME_RE.test(name)) return 'paddock name: 3-24 letters, numbers, _ or -'
    if (mode === 'register' && password.length < MIN_PASSWORD) {
      return `password needs at least ${MIN_PASSWORD} characters`
    }
    if (!password) return 'password is required'
    return null
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (busy) return

    const invalid = validate()
    if (invalid) {
      setError(invalid)
      setSuccess('')
      // Announce it: role="alert" fires on mount, and moving focus here means
      // a keyboard user lands on the reason rather than hunting for it.
      requestAnimationFrame(() => statusRef.current?.focus())
      return
    }

    setBusy(true)
    setError('')
    try {
      if (mode === 'signin') await login(username.trim(), password)
      else await register(username.trim(), password, email.trim() || undefined)
      // Confirm before leaving. The page used to navigate instantly, so a
      // successful sign-in and a silently-swallowed failure looked identical.
      setSuccess(mode === 'signin' ? 'Signed in — rolling out…' : 'Contract signed — welcome to the grid…')
      setTimeout(() => router.push('/profile'), 700)
    } catch (err) {
      // Includes the 429 the backend now returns after repeated failures.
      // Whatever it says, show it and stop — never retry an auth call.
      setError(err instanceof Error ? err.message : 'something went wrong')
      setBusy(false)
      requestAnimationFrame(() => statusRef.current?.focus())
    }
  }

  return (
    <div style={{ maxWidth: '460px', margin: '0 auto', padding: '48px 16px', position: 'relative', zIndex: 1 }}>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: '20px' }}>
        <div className="kicker" style={{ marginBottom: '8px' }}>Driver Licence</div>
        <h1 className="display-title" style={{ fontSize: 'clamp(30px, 6vw, 44px)', margin: 0 }}>
          {mode === 'signin' ? 'Sign In' : 'Join the Grid'}
        </h1>
        <div style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '8px', lineHeight: 1.6 }}>
          One account for everything — predictions, fantasy team, feed, coins and badges.
          {mode === 'register' && ' Register with your current paddock name and your existing history comes with you.'}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
        className="featured-card" style={{ padding: '24px 22px' }}
      >
        {/* Mode tabs — outside the form: they switch context, they don't submit. */}
        <div style={{ display: 'flex', gap: '2px', marginBottom: '22px', border: '1px solid var(--border)', padding: '2px' }}>
          {(['signin', 'register'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(''); setSuccess('') }}
              style={{
                flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer',
                background: mode === m ? 'var(--accent)' : 'transparent',
                color: mode === m ? '#fff' : 'var(--muted)',
                fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700,
                fontSize: '12px', letterSpacing: '0.1em', textTransform: 'uppercase',
                transition: 'background 0.15s',
              }}
            >
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        {/* A real <form>: Enter submits from any field without a per-input
            keydown handler, and password managers only offer to save on a
            form submission. */}
        <form onSubmit={submit} noValidate>

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
          <div style={{ position: 'relative' }}>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              maxLength={128}
              placeholder={mode === 'register' ? `min ${MIN_PASSWORD} characters` : '••••••••'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              // Room on the right for the toggle so a long password doesn't
              // run underneath it.
              style={{ ...inputStyle, paddingRight: '44px' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              aria-controls="password"
              style={{
                position: 'absolute', right: '1px', top: '1px', bottom: '1px', width: '40px',
                display: 'grid', placeItems: 'center', cursor: 'pointer',
                background: 'transparent', border: 'none', color: 'var(--muted)',
              }}
            >
              {showPassword ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
            </button>
          </div>
          {mode === 'register' && (
            <div style={{ marginTop: '6px', fontSize: '11px', color: password.length >= MIN_PASSWORD ? 'var(--sector-green)' : 'var(--muted)' }}>
              {password.length}/{MIN_PASSWORD} characters minimum
            </div>
          )}
        </div>

        {mode === 'register' && (
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="email" style={labelStyle}><Mail size={10} style={{ verticalAlign: '-1px', marginRight: '5px' }} />Email <span style={{ opacity: 0.6 }}>(optional)</span></label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              maxLength={120}
              placeholder="for account recovery later"
              autoComplete="email"
              style={inputStyle}
            />
          </div>
        )}

        <div ref={statusRef} tabIndex={-1} style={{ outline: 'none' }}>
          <FormStatus tone="success" message={success} />
          <FormStatus tone="error" message={success ? null : error} />
        </div>

        <button
          type="submit"
          disabled={busy || !!success || !username.trim() || password.length < (mode === 'register' ? MIN_PASSWORD : 1)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px',
            background: busy || success ? 'var(--border)' : 'var(--accent)', color: '#fff', border: 'none',
            borderRadius: '2px', padding: '13px 0', cursor: busy ? 'default' : 'pointer',
            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '14px',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}
        >
          {mode === 'signin' ? <LogIn size={16} /> : <UserPlus size={16} />}
          {busy ? 'Checking…' : mode === 'signin' ? 'Open the garage' : 'Sign the contract'}
        </button>

        </form>

        <div style={{ marginTop: '14px', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.6 }}>
          Accounts are stored locally in this app&apos;s own database. Password is salted + hashed
          (PBKDF2); sessions expire after 30 days.
        </div>
      </motion.div>
    </div>
  )
}
