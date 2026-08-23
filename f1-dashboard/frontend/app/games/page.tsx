'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Coins, Zap, Trophy, Lock, Check, Timer } from 'lucide-react'
import { useWallet, addCoins, unlock } from '@/lib/wallet'
import { unlockAchievement } from '@/lib/achievements'
import { TEAMS_2026 } from '@/lib/constants'

const BEST_KEY = 'f1.reaction.best'
const THEME_KEY = 'f1.theme'
const THEME_COST = 150

type Phase = 'idle' | 'arming' | 'set' | 'go' | 'jumped' | 'result'

function coinsFor(ms: number): number {
  if (ms < 200) return 50
  if (ms < 250) return 35
  if (ms < 300) return 25
  if (ms < 400) return 15
  return 5
}

function verdict(ms: number): string {
  if (ms < 200) return 'ALIEN REFLEXES — F1 seat when?'
  if (ms < 250) return 'Race winner material 🏆'
  if (ms < 300) return 'Solid midfield launch'
  if (ms < 400) return 'You got swallowed into turn 1'
  return 'Anti-stall. The whole grid went past.'
}

function ReactionGame() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [litCount, setLitCount] = useState(0)
  const [reaction, setReaction] = useState<number | null>(null)
  const [earned, setEarned] = useState(0)
  const [best, setBest] = useState<number | null>(null)
  const goAtRef = useRef(0)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const b = localStorage.getItem(BEST_KEY)
    if (b) setBest(parseFloat(b))
    return () => timersRef.current.forEach(clearTimeout)
  }, [])

  const start = useCallback(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    setPhase('arming')
    setLitCount(0)
    setReaction(null)

    for (let i = 1; i <= 5; i++) {
      timersRef.current.push(setTimeout(() => setLitCount(i), i * 900))
    }
    const holdMs = 5 * 900 + 400 + Math.random() * 2600
    timersRef.current.push(setTimeout(() => setPhase('set'), 5 * 900))
    timersRef.current.push(setTimeout(() => {
      setLitCount(0)
      goAtRef.current = performance.now()
      setPhase('go')
    }, holdMs))
  }, [])

  const click = useCallback(() => {
    if (phase === 'idle' || phase === 'result' || phase === 'jumped') { start(); return }
    if (phase === 'arming' || phase === 'set') {
      timersRef.current.forEach(clearTimeout)
      setLitCount(5)
      setPhase('jumped')
      return
    }
    if (phase === 'go') {
      const ms = performance.now() - goAtRef.current
      const coins = coinsFor(ms)
      setReaction(ms)
      setEarned(coins)
      addCoins(coins)
      if (ms < 250) unlockAchievement('lightning-start')
      setPhase('result')
      if (best === null || ms < best) {
        setBest(ms)
        localStorage.setItem(BEST_KEY, String(ms))
      }
    }
  }, [phase, start, best])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); click() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [click])

  return (
    <div className="featured-card" style={{ padding: '28px', textAlign: 'center', userSelect: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={16} style={{ color: 'var(--accent)' }} />
          <span className="font-display" style={{ fontWeight: 800, fontSize: '16px', letterSpacing: '0.04em' }}>LIGHTS OUT — REACTION TEST</span>
        </div>
        <div className="font-num" style={{ fontSize: '12px', color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Trophy size={13} style={{ color: '#FFD700' }} />
          Best: {best !== null ? `${best.toFixed(0)} ms` : '—'}
        </div>
      </div>

      {/* Gantry */}
      <button
        type="button"
        onClick={click}
        style={{ cursor: 'pointer', padding: '26px 12px', borderRadius: '14px', background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.07)', display: 'block', width: '100%', color: 'inherit', font: 'inherit', textAlign: 'inherit' }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', gap: 'clamp(8px, 2vw, 18px)', marginBottom: '22px' }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className={`race-light${litCount >= i ? ' on' : ''}`} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={phase + String(reaction)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{ minHeight: '84px' }}
          >
            {phase === 'idle' && (
              <>
                <div className="font-display" style={{ fontSize: '20px', fontWeight: 800 }}>Click or press SPACE to start</div>
                <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '6px' }}>React when all five lights go out. Earn Pit Coins for fast launches.</div>
              </>
            )}
            {(phase === 'arming' || phase === 'set') && (
              <div className="font-display" style={{ fontSize: '20px', fontWeight: 800, color: '#FFF200' }}>WAIT FOR LIGHTS OUT…</div>
            )}
            {phase === 'go' && (
              <div className="font-display" style={{ fontSize: '26px', fontWeight: 900, color: '#00D131' }}>GO GO GO!</div>
            )}
            {phase === 'jumped' && (
              <>
                <div className="font-display" style={{ fontSize: '22px', fontWeight: 900, color: '#E8002D' }}>JUMP START! 🚨</div>
                <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '6px' }}>5-second penalty for you. Click to try again.</div>
              </>
            )}
            {phase === 'result' && reaction !== null && (
              <>
                <div className="font-num" style={{ fontSize: '38px', fontWeight: 800, color: reaction < 250 ? '#BF00FF' : '#fff' }}>
                  {reaction.toFixed(0)}<span style={{ fontSize: '16px', color: '#9CA3AF' }}> ms</span>
                </div>
                <div style={{ fontSize: '13px', color: '#D1D5DB', marginTop: '4px' }}>{verdict(reaction)}</div>
                <div className="font-num" style={{ fontSize: '13px', color: '#FFD700', marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Coins size={14} /> +{earned} Pit Coins — click to go again
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </button>

      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '14px' }}>
        F1 drivers react in ~200 ms. Under 100 ms on race day is judged a jump start.
      </div>
    </div>
  )
}

function ThemeShop() {
  const { coins, unlocks } = useWallet()
  const [activeTheme, setActiveTheme] = useState('')
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => { setActiveTheme(localStorage.getItem(THEME_KEY) || '') }, [])

  const apply = (id: string, color: string) => {
    localStorage.setItem(THEME_KEY, id ? `${id}|${color}` : '')
    setActiveTheme(id ? `${id}|${color}` : '')
    document.documentElement.style.setProperty('--accent', id ? color : '#E10600')
    window.dispatchEvent(new CustomEvent('f1-theme-change'))
  }

  const buy = (id: string, color: string) => {
    if (unlock(`theme-${id}`, THEME_COST)) {
      apply(id, color)
    } else {
      setFlash(id)
      setTimeout(() => setFlash(null), 1200)
    }
  }

  return (
    <div className="glass-card" style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '8px' }}>
        <h2 className="section-title">Pit Wall Shop — Team Themes</h2>
        <span className="font-num" style={{ fontSize: '13px', color: '#FFD700', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Coins size={15} /> {coins}
        </span>
      </div>
      <div style={{ fontSize: '12px', color: '#9CA3AF', marginBottom: '18px' }}>
        Spend {THEME_COST} Pit Coins to recolor the whole site in your team&apos;s livery. Premium flex, zero real money.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' }}>
        <button
          onClick={() => apply('', '#E10600')}
          style={{
            padding: '12px', borderRadius: '12px', cursor: 'pointer', textAlign: 'left',
            background: 'rgba(255,255,255,0.04)', border: activeTheme === '' ? '1px solid #E10600' : '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <span style={{ display: 'block', width: '100%', height: '6px', borderRadius: '3px', background: '#E10600', marginBottom: '8px' }} />
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#fff' }}>F1 Classic</span>
          <span style={{ display: 'block', fontSize: '10px', color: '#00D131', marginTop: '3px' }}>Default · Free</span>
        </button>

        {TEAMS_2026.map(team => {
          const owned = unlocks.includes(`theme-${team.id}`)
          const isActive = activeTheme.startsWith(`${team.id}|`)
          return (
            <motion.button
              key={team.id}
              whileHover={{ y: -2 }}
              onClick={() => owned ? apply(team.id, team.color) : buy(team.id, team.color)}
              style={{
                padding: '12px', borderRadius: '12px', cursor: 'pointer', textAlign: 'left',
                background: flash === team.id ? 'rgba(232,0,45,0.15)' : 'rgba(255,255,255,0.04)',
                border: isActive ? `1px solid ${team.color}` : '1px solid rgba(255,255,255,0.08)',
                transition: 'background 0.3s',
              }}
            >
              <span style={{ display: 'block', width: '100%', height: '6px', borderRadius: '3px', background: team.color, marginBottom: '8px', boxShadow: `0 0 10px ${team.color}55` }} />
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {team.name}
                {isActive && <Check size={12} style={{ color: team.color }} />}
              </span>
              <span style={{ display: 'block', fontSize: '10px', color: flash === team.id ? '#E8002D' : owned ? '#00D131' : '#9CA3AF', marginTop: '3px' }}>
                {flash === team.id ? 'Not enough coins!' : owned ? (isActive ? 'Equipped' : 'Owned — click to equip') : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Lock size={9} /> {THEME_COST} coins</span>
                )}
              </span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

export default function GamesPage() {
  const { coins } = useWallet()

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px 16px', position: 'relative', zIndex: 1 }}>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div className="kicker" style={{ marginBottom: '8px' }}>Arcade</div>
          <h1 className="display-title" style={{ fontSize: 'clamp(28px, 5vw, 44px)', margin: 0 }}>Pit Lane Games</h1>
          <div style={{ color: '#9CA3AF', fontSize: '13px', marginTop: '6px' }}>Earn Pit Coins, unlock team liveries for the whole site.</div>
        </div>
        <div className="glass-panel glow-pulse" style={{ borderRadius: '999px', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px', ['--glow' as string]: 'rgba(255,215,0,0.3)' }}>
          <Coins size={16} style={{ color: '#FFD700' }} />
          <span className="font-num" style={{ fontSize: '16px', fontWeight: 800, color: '#FFD700' }}>{coins}</span>
          <span style={{ fontSize: '10px', color: '#9CA3AF', letterSpacing: '0.1em' }}>PIT COINS</span>
        </div>
      </motion.div>

      <div style={{ display: 'grid', gap: '16px' }}>
        <ReactionGame />
        <ThemeShop />

        <div className="glass-card" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '12px', opacity: 0.75 }}>
          <Timer size={18} style={{ color: '#9CA3AF' }} />
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700 }}>More games on the way</div>
            <div style={{ fontSize: '11px', color: '#9CA3AF' }}>Pit-stop tap challenge · Track guesser · Lap time memory — all paying out Pit Coins.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
