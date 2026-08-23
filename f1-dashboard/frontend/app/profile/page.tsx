'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Coins, Pencil, Check, Lock, LogIn, LogOut, ShieldCheck } from 'lucide-react'
import { useWallet, getUsername, setUsername } from '@/lib/wallet'
import { useAchievements } from '@/lib/achievements'
import { useAuth, logout, updateProfile } from '@/lib/auth'
import { TEAMS_2026 } from '@/lib/constants'
import { useStandings } from '@/lib/api/hooks'

function AccountCard() {
  const { user, loading } = useAuth()
  const { data: standings } = useStandings(2026)
  const drivers = (standings?.drivers || []).map(x => x.abbreviation)
  const [saving, setSaving] = useState('')

  const save = async (patch: Parameters<typeof updateProfile>[0], key: string) => {
    setSaving(key)
    try { await updateProfile(patch) } catch { /* shown on next sync */ }
    setSaving('')
  }

  if (loading) return null

  if (!user) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="featured-card"
        style={{ padding: '16px 20px', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}
      >
        <div style={{ flex: 1, minWidth: '220px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, fontFamily: "'Chakra Petch', sans-serif" }}>GUEST MODE</div>
          <div style={{ fontSize: '12px', color: '#8C939E', marginTop: '3px' }}>
            Create an account to lock your paddock name and keep your history safe.
          </div>
        </div>
        <Link href="/login" style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none',
          background: 'var(--accent)', color: '#fff', borderRadius: '2px', padding: '10px 18px',
          fontSize: '12px', fontWeight: 700, fontFamily: "'Chakra Petch', sans-serif",
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          <LogIn size={14} /> Sign in
        </Link>
      </motion.div>
    )
  }

  const chip = (selected: boolean): React.CSSProperties => ({
    padding: '4px 9px', borderRadius: '2px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
    background: selected ? 'rgba(225,6,0,0.16)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    color: selected ? '#fff' : '#8C939E',
  })

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="featured-card" style={{ padding: '18px 20px', marginBottom: '18px' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <ShieldCheck size={16} style={{ color: '#00D131' }} />
          <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: "'Chakra Petch', sans-serif", letterSpacing: '0.06em' }}>
            SIGNED IN — {user.username.toUpperCase()}
          </span>
          {user.email && <span className="font-num" style={{ fontSize: '11px', color: '#5B6069' }}>{user.email}</span>}
        </div>
        <button
          onClick={() => logout()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
            background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
            color: '#8C939E', borderRadius: '2px', padding: '7px 13px', fontSize: '11px', fontWeight: 700,
          }}
        >
          <LogOut size={12} /> Sign out
        </button>
      </div>

      <div style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#8C939E', marginBottom: '7px', fontFamily: "'Chakra Petch', sans-serif", fontWeight: 600 }}>
        FAVOURITE DRIVER {saving === 'driver' && '· saving…'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '14px' }}>
        {drivers.map(tla => (
          <button key={tla} onClick={() => save({ favorite_driver: tla }, 'driver')} style={chip(user.favorite_driver === tla)}>
            {tla}
          </button>
        ))}
      </div>

      <div style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#8C939E', marginBottom: '7px', fontFamily: "'Chakra Petch', sans-serif", fontWeight: 600 }}>
        FAVOURITE TEAM {saving === 'team' && '· saving…'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {TEAMS_2026.map(t => (
          <button key={t.id} onClick={() => save({ favorite_team: t.name }, 'team')} style={{
            ...chip(user.favorite_team === t.name),
            borderColor: user.favorite_team === t.name ? t.color : 'var(--border)',
            background: user.favorite_team === t.name ? `${t.color}22` : 'rgba(255,255,255,0.04)',
          }}>
            {t.name}
          </button>
        ))}
      </div>
    </motion.div>
  )
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ProfilePage() {
  const { coins } = useWallet()
  const { unlocked, defs } = useAchievements()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => { setName(getUsername()) }, [])

  const save = () => {
    const n = draft.trim().slice(0, 24)
    if (n) {
      setUsername(n)
      setName(n)
    }
    setEditing(false)
  }

  const unlockedCount = defs.filter(d => d.id in unlocked).length
  const totalCoinsFromBadges = defs.filter(d => d.id in unlocked).reduce((a, d) => a + d.coins, 0)
  const visible = defs.filter(d => !d.secret || d.id in unlocked)
  const secretsHidden = defs.length - visible.length

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '24px 16px', position: 'relative', zIndex: 1 }}>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: '18px' }}>
        <div className="kicker" style={{ marginBottom: '8px' }}>Driver Profile</div>
        <h1 className="display-title" style={{ fontSize: 'clamp(28px, 5vw, 44px)', margin: 0 }}>
          {name || 'Rookie'}
        </h1>
        <div style={{ color: '#9CA3AF', fontSize: '13px', marginTop: '6px' }}>
          Your paddock identity, Pit Coins and badge cabinet.
        </div>
      </motion.div>

      <AccountCard />

      {/* Identity + wallet strip */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
        className="glass-card"
        style={{ padding: '18px 22px', marginBottom: '18px', display: 'flex', gap: '28px', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <div>
          <div style={{ fontSize: '10px', color: '#9CA3AF', letterSpacing: '0.12em', marginBottom: '4px' }}>PADDOCK NAME</div>
          {editing ? (
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                value={draft} onChange={e => setDraft(e.target.value)} maxLength={24} autoFocus
                onKeyDown={e => e.key === 'Enter' && save()}
                style={{
                  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.16)',
                  borderRadius: '8px', padding: '6px 10px', color: '#fff', fontSize: '14px', outline: 'none',
                }}
              />
              <button onClick={save} aria-label="Save name" style={{ background: 'var(--accent)', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' }}>
                <Check size={14} style={{ color: '#fff' }} />
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px', fontWeight: 800 }}>{name || 'Not set'}</span>
              <button onClick={() => { setDraft(name); setEditing(true) }} aria-label="Edit name" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '2px' }}>
                <Pencil size={13} />
              </button>
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#9CA3AF', letterSpacing: '0.12em', marginBottom: '4px' }}>PIT COINS</div>
          <div className="font-num" style={{ fontSize: '20px', fontWeight: 800, color: '#FFD700', display: 'flex', alignItems: 'center', gap: '7px' }}>
            <Coins size={17} /> {coins}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#9CA3AF', letterSpacing: '0.12em', marginBottom: '4px' }}>BADGES</div>
          <div className="font-num" style={{ fontSize: '20px', fontWeight: 800 }}>{unlockedCount} / {defs.length}</div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#9CA3AF', letterSpacing: '0.12em', marginBottom: '4px' }}>COINS FROM BADGES</div>
          <div className="font-num" style={{ fontSize: '20px', fontWeight: 800, color: '#FFD700' }}>+{totalCoinsFromBadges}</div>
        </div>
      </motion.div>

      {/* Badge cabinet */}
      <h2 className="section-title" style={{ marginBottom: '12px' }}>Badge cabinet</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
        {visible.map((d, i) => {
          const isUnlocked = d.id in unlocked
          return (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.4) }}
              className="glass-card"
              style={{
                padding: '16px', display: 'flex', gap: '13px', alignItems: 'flex-start',
                border: isUnlocked ? '1px solid rgba(255,215,0,0.3)' : '1px solid rgba(255,255,255,0.07)',
                background: isUnlocked ? 'rgba(255,215,0,0.04)' : undefined,
                opacity: isUnlocked ? 1 : 0.6,
              }}
            >
              <span style={{
                fontSize: '26px', filter: isUnlocked ? 'none' : 'grayscale(1) brightness(0.6)',
                width: '36px', textAlign: 'center', flexShrink: 0,
              }}>
                {d.icon}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {d.title}
                  {!isUnlocked && <Lock size={10} style={{ color: 'var(--muted)' }} />}
                </div>
                <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '3px', lineHeight: 1.45 }}>{d.desc}</div>
                <div className="font-num" style={{ fontSize: '10px', marginTop: '5px', color: isUnlocked ? '#FFD700' : 'var(--muted)' }}>
                  {isUnlocked ? `Unlocked ${fmtDate(unlocked[d.id])} · +${d.coins} coins` : `Reward: +${d.coins} coins`}
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>
      {secretsHidden > 0 && (
        <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '12px' }}>
          + {secretsHidden} secret badge{secretsHidden === 1 ? '' : 's'} still hidden…
        </div>
      )}
    </div>
  )
}
