'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Swords, Star, Lock, Trophy, Coins, Zap, RefreshCw, RotateCcw, CheckCircle2 } from 'lucide-react'
import { BACKEND_URL, TEAM_COLORS } from '@/lib/constants'
import { hexColor } from '@/lib/utils'
import { getUsername, setUsername, useWallet, spendCoins, addCoins } from '@/lib/wallet'
import { logPulse } from '@/lib/pulse'
import { useApi, useApiList } from '@/lib/api/client'
import { useStandings } from '@/lib/api/hooks'
import type { DriverStanding, ConstructorStanding } from '@/lib/types'
import { authHeaders } from '@/lib/auth'

const YEAR = 2026
const TEAM_KEY = 'f1.fantasy.team'
const CLAIMED_KEY = 'f1.fantasy.claimed'
const MAX_DRIVERS = 5
const MAX_BOOSTS = 2

interface Boost {
  id: string
  name: string
  desc: string
  cost: number
}

interface NextRound {
  round: number
  name: string
  country: string
  is_sprint: boolean
  lock_time: string | null
  locked: boolean
  boosts: Boost[]
  max_boosts: number
  team_size: number
}

interface RoundInfo {
  round: number
  name: string
  country: string
  locked: boolean
  race_finished: boolean
  scored: boolean
}

interface LocalTeam {
  drivers: string[]
  constructor: string | null
  captain: string | null
  boosts: string[]
}

const EMPTY_TEAM: LocalTeam = { drivers: [], constructor: null, captain: null, boosts: [] }

interface ScoreBreakdown {
  drivers: Record<string, { race_points: number; captain: boolean; awarded: number }>
  captain: string
  boosts: string[]
  driver_subtotal: number
  engine_upgrade_bonus?: number
  undercut_bonus?: { positions_gained: number; points: number }
  pit_crew_bonus?: { podium: boolean; points: number }
  constructor: { id: string; team_name: string; raw_points: number; awarded: number }
  weather_boost?: { rained: boolean; pre_weather_total: number }
  total: number
}

function useCountdown(iso: string | null) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!iso) return
    const update = () => {
      const ms = new Date(iso).getTime() - Date.now()
      if (ms <= 0) { setLabel('LOCKED'); return }
      const d = Math.floor(ms / 86400000)
      const h = Math.floor((ms % 86400000) / 3600000)
      const m = Math.floor((ms % 3600000) / 60000)
      const s = Math.floor((ms % 60000) / 1000)
      setLabel(d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`)
    }
    update()
    const iv = setInterval(update, 1000)
    return () => clearInterval(iv)
  }, [iso])
  return label
}

const BOOST_ICONS: Record<string, string> = {
  engine_upgrade: '⚙️',
  pit_crew: '🔧',
  weather_boost: '🌧️',
  undercut_bonus: '⏱️',
}

export default function FantasyPage() {
  const { data: nextRound, isLoading: nextRoundLoading, mutate: reloadNextRound } = useApi<NextRound>(`/api/fantasy/next?year=${YEAR}`)
  const { data: standings } = useStandings(YEAR)
  const { data: rounds, mutate: reloadRounds } = useApiList<RoundInfo>(`/api/fantasy/rounds?year=${YEAR}`)
  const { data: seasonBoard, mutate: reloadBoard } = useApiList<{ username: string; points: number; rounds_played: number; best_round: number }>(`/api/fantasy/leaderboard/${YEAR}`)

  const [team, setTeam] = useState<LocalTeam>(EMPTY_TEAM)
  const [name, setName] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [myScore, setMyScore] = useState<{ points: number; breakdown: ScoreBreakdown } | null>(null)
  const [scoring, setScoring] = useState<number | null>(null)
  const [coinsToast, setCoinsToast] = useState<number | null>(null)

  const { coins } = useWallet()
  const lockLabel = useCountdown(nextRound?.lock_time || null)
  const locked = nextRound?.locked || lockLabel === 'LOCKED'

  const drivers = standings?.drivers || []
  const constructors = standings?.constructors || []
  const boostCatalog = nextRound?.boosts || []

  // "Mine" (this user's saved team + score for the upcoming round) is only
  // fetched once a username is chosen — reactive on name/round, same request
  // the old imperative loadMine(username, round) used to fire.
  const mineKey = name && nextRound ? `/api/fantasy/team/${YEAR}/${nextRound.round}?username=${encodeURIComponent(name)}` : null
  const { data: mine, mutate: reloadMine } = useApi<{
    team?: LocalTeam
    score?: { points: number; breakdown: ScoreBreakdown }
  } | null>(mineKey)

  useEffect(() => {
    if (!mine) return
    if (mine.team) {
      const t = mine.team
      setTeam({
        drivers: t.drivers || [],
        constructor: t.constructor || null,
        captain: t.captain || null,
        boosts: t.boosts || [],
      })
      setSaved(true)
    }
    if (mine.score && nextRound) {
      setMyScore(mine.score)
      const claimKey = `${YEAR}-${nextRound.round}`
      try {
        const claimed: string[] = JSON.parse(localStorage.getItem(CLAIMED_KEY) || '[]')
        if (!claimed.includes(claimKey) && mine.score.points > 0) {
          addCoins(mine.score.points)
          localStorage.setItem(CLAIMED_KEY, JSON.stringify([...claimed, claimKey]))
          setCoinsToast(mine.score.points)
          setTimeout(() => setCoinsToast(null), 5000)
        }
      } catch { /* first claim */ }
    } else {
      setMyScore(null)
    }
  }, [mine, nextRound])

  const name0Ref = useRef(false)
  useEffect(() => {
    // Username lives in localStorage — read it once on mount (client only).
    if (name0Ref.current) return
    name0Ref.current = true
    setName(getUsername())
  }, [])

  const localFallbackRef = useRef(false)
  useEffect(() => {
    // If there's no username yet when the next round first resolves, fall
    // back to whatever team was last saved locally (mirrors the old
    // one-shot mount effect: server data wins once a username exists).
    if (localFallbackRef.current || !nextRound) return
    localFallbackRef.current = true
    if (!name) {
      try {
        const savedTeam = JSON.parse(localStorage.getItem(TEAM_KEY) || 'null')
        if (savedTeam?.drivers) setTeam(savedTeam)
      } catch { /* fresh team */ }
    }
  }, [nextRound, name])

  const loaded = !nextRoundLoading

  // Mirror to localStorage for instant reload
  useEffect(() => {
    if (loaded) localStorage.setItem(TEAM_KEY, JSON.stringify(team))
  }, [team, loaded])

  const toggleDriver = (d: DriverStanding) => {
    if (locked) return
    setSaved(false)
    setTeam(prev => {
      if (prev.drivers.includes(d.abbreviation)) {
        const nextDrivers = prev.drivers.filter(a => a !== d.abbreviation)
        return {
          ...prev,
          drivers: nextDrivers,
          captain: prev.captain === d.abbreviation ? null : prev.captain,
        }
      }
      if (prev.drivers.length >= MAX_DRIVERS) return prev
      return { ...prev, drivers: [...prev.drivers, d.abbreviation] }
    })
  }

  const toggleConstructor = (c: ConstructorStanding) => {
    if (locked) return
    setSaved(false)
    setTeam(prev => ({ ...prev, constructor: prev.constructor === c.id ? null : c.id }))
  }

  const toggleCaptain = (abbr: string) => {
    if (locked) return
    setSaved(false)
    setTeam(prev => ({ ...prev, captain: prev.captain === abbr ? null : abbr }))
  }

  const toggleBoost = (boost: Boost) => {
    if (locked) return
    // The wallet writes (spendCoins/addCoins) must stay OUT of the setState
    // updater: React may invoke an updater more than once (StrictMode double
    // render, discarded concurrent renders), which would debit/refund twice.
    const owned = team.boosts.includes(boost.id)
    if (owned) {
      // refund on removal before save (client-side economy only)
      addCoins(boost.cost)
      setSaved(false)
      setTeam(prev => ({ ...prev, boosts: prev.boosts.filter(b => b !== boost.id) }))
      return
    }
    if (team.boosts.length >= MAX_BOOSTS) return
    if (!spendCoins(boost.cost)) return
    setSaved(false)
    setTeam(prev => ({ ...prev, boosts: [...prev.boosts, boost.id] }))
  }

  const complete = team.drivers.length === MAX_DRIVERS && team.constructor !== null && team.captain !== null

  const submit = async () => {
    if (!nextRound || !name || !complete) return
    setSaveError('')
    setSaving(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/fantasy/team`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          username: name, year: YEAR, round: nextRound.round,
          drivers: team.drivers, constructor: team.constructor,
          captain: team.captain, boosts: team.boosts,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        setSaveError(err?.detail || 'save failed')
        return
      }
      setSaved(true)
      team.drivers.forEach(d => logPulse('pick', d))
    } catch {
      setSaveError('backend unreachable')
    } finally {
      setSaving(false)
    }
  }

  const scoreRound = async (round: number) => {
    setScoring(round)
    try {
      await fetch(`${BACKEND_URL}/api/fantasy/score/${YEAR}/${round}`, { method: 'POST' })
      reloadBoard()
      if (name) reloadMine()
      reloadRounds(rounds.map(r => r.round === round ? { ...r, scored: true } : r), { revalidate: false })
    } finally {
      setScoring(null)
    }
  }

  const saveName = () => {
    const n = nameDraft.trim()
    if (!n) return
    setUsername(n)
    setName(n)
    // "mine" is keyed on `name`, so this alone triggers the fetch once name updates.
  }

  const resetTeam = () => {
    // refund any purchased boosts still held
    team.boosts.forEach(b => {
      const boost = boostCatalog.find(x => x.id === b)
      if (boost) addCoins(boost.cost)
    })
    setTeam(EMPTY_TEAM)
    setSaved(false)
  }

  const finishedRounds = useMemo(() => rounds.filter(r => r.race_finished), [rounds])

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 16px', position: 'relative', zIndex: 1 }}>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: '18px' }}>
        <div className="kicker" style={{ marginBottom: '8px' }}>PickStop — Fantasy 2.0</div>
        <h1 className="display-title" style={{ fontSize: 'clamp(28px, 5vw, 44px)', margin: 0 }}>Build Your Dream Team</h1>
        <div style={{ color: '#9CA3AF', fontSize: '13px', marginTop: '6px' }}>
          {MAX_DRIVERS} drivers + 1 constructor, per round. Pick a captain for 2x points, buy boosts, score after every flag.
        </div>
      </motion.div>

      {coinsToast !== null && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          style={{
            position: 'fixed', top: '18px', left: '50%', transform: 'translateX(-50%)', zIndex: 90,
            display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px',
            borderRadius: '12px', background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.4)',
            color: '#FFD700', fontWeight: 800, fontSize: '14px', backdropFilter: 'blur(8px)',
          }}
        >
          <Coins size={16} /> +{coinsToast} Pit Coins from your fantasy score!
        </motion.div>
      )}

      {/* Header strip: round + lock + wallet */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
        className={complete ? 'featured-card' : 'glass-card'}
        style={{ padding: '18px 24px', marginBottom: '18px', display: 'flex', gap: '28px', flexWrap: 'wrap', alignItems: 'center' }}
      >
        {nextRound && (
          <div>
            <div style={{ fontSize: '10px', color: '#9CA3AF', letterSpacing: '0.12em', marginBottom: '4px' }}>
              ROUND {nextRound.round} · {nextRound.name.toUpperCase()}
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '5px 11px', borderRadius: '8px',
              background: locked ? 'rgba(232,0,45,0.1)' : 'rgba(0,209,49,0.08)',
              border: `1px solid ${locked ? 'rgba(232,0,45,0.35)' : 'rgba(0,209,49,0.3)'}`,
            }}>
              <Lock size={11} style={{ color: locked ? '#E8002D' : '#00D131' }} />
              <span className="font-num" style={{ fontSize: '12px', fontWeight: 700, color: locked ? '#E8002D' : '#00D131' }}>
                {locked ? 'Locked — race underway' : `Transfers open · locks in ${lockLabel}`}
              </span>
            </div>
          </div>
        )}
        <div>
          <div style={{ fontSize: '10px', color: '#9CA3AF', letterSpacing: '0.12em', marginBottom: '4px' }}>PICKS</div>
          <div className="font-num" style={{ fontSize: '22px', fontWeight: 800 }}>
            {team.drivers.length}/{MAX_DRIVERS} + {team.constructor ? '1' : '0'}/1
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#9CA3AF', letterSpacing: '0.12em', marginBottom: '4px' }}>PIT COINS</div>
          <div className="font-num" style={{ fontSize: '22px', fontWeight: 800, color: '#FFD700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Coins size={18} /> {coins}
          </div>
        </div>
        {myScore && (
          <div>
            <div style={{ fontSize: '10px', color: '#9CA3AF', letterSpacing: '0.12em', marginBottom: '4px' }}>LAST SCORED ROUND</div>
            <div className="font-num" style={{ fontSize: '22px', fontWeight: 800, color: '#FFD700', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Trophy size={18} /> {myScore.points} PTS
            </div>
          </div>
        )}
        {!locked && (
          <button
            onClick={resetTeam}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#9CA3AF', borderRadius: '8px', padding: '8px 14px', fontSize: '12px', cursor: 'pointer' }}
          >
            <RotateCcw size={12} /> Reset
          </button>
        )}
      </motion.div>

      {!standings || !nextRound ? (
        <div className="glass-card shimmer" style={{ padding: '60px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
          Loading the driver market…
        </div>
      ) : !name ? (
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>Pick a paddock name to play</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveName()}
                maxLength={24}
                placeholder="e.g. GravelTrapGuru"
                style={{
                  flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: '8px', padding: '9px 12px', color: '#fff', fontSize: '13px', outline: 'none',
                }}
              />
              <button onClick={saveName} style={{
                background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px',
                padding: '9px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
              }}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="live-grid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', alignItems: 'start' }}>
          {/* Driver market + boost shop */}
          <div style={{ display: 'grid', gap: '16px' }}>
            <div className="glass-card" style={{ padding: '18px' }}>
              <h2 className="section-title" style={{ marginBottom: '14px' }}>Driver Market</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '9px' }}>
                {drivers.map((d, i) => {
                  const picked = team.drivers.includes(d.abbreviation)
                  const isCaptain = team.captain === d.abbreviation
                  const disabled = locked || (!picked && team.drivers.length >= MAX_DRIVERS)
                  const color = hexColor(d.team_color) || TEAM_COLORS[d.team] || '#555'
                  return (
                    <motion.div
                      key={d.abbreviation}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.02, 0.4) }}
                      style={{
                        textAlign: 'left', padding: '12px 14px', borderRadius: '12px',
                        background: picked ? `${color}1f` : 'rgba(255,255,255,0.04)',
                        border: picked ? `1px solid ${color}` : '1px solid rgba(255,255,255,0.08)',
                        opacity: disabled && !picked ? 0.4 : 1, transition: 'opacity 0.2s',
                        position: 'relative',
                      }}
                    >
                      <button
                        onClick={() => toggleDriver(d)}
                        disabled={disabled}
                        style={{ all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer', display: 'block', width: '100%' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="font-display" style={{ fontWeight: 800, fontSize: '15px', color: '#fff' }}>{d.abbreviation}</span>
                          <span className="font-num" style={{ fontSize: '12px', fontWeight: 700, color: '#FFD700' }}>{d.points} pts</span>
                        </div>
                        <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '3px' }}>{d.team}</div>
                      </button>
                      {picked && (
                        <button
                          onClick={() => toggleCaptain(d.abbreviation)}
                          disabled={locked}
                          title="Set as captain (2x points)"
                          style={{
                            position: 'absolute', top: '8px', right: '8px', background: 'none', border: 'none',
                            cursor: locked ? 'default' : 'pointer', padding: 0, lineHeight: 0,
                          }}
                        >
                          <Star size={16} fill={isCaptain ? '#FFD700' : 'none'} color={isCaptain ? '#FFD700' : 'var(--muted)'} />
                        </button>
                      )}
                      {isCaptain && (
                        <span style={{
                          position: 'absolute', bottom: '8px', right: '8px', fontSize: '9px', fontWeight: 800,
                          color: '#FFD700', background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.35)',
                          borderRadius: '5px', padding: '1px 5px',
                        }}>
                          2×
                        </span>
                      )}
                    </motion.div>
                  )
                })}
              </div>

              <h2 className="section-title" style={{ margin: '20px 0 14px' }}>Constructor</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '9px' }}>
                {constructors.map(c => {
                  const picked = team.constructor === c.id
                  const color = c.color || TEAM_COLORS[c.name] || '#555'
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleConstructor(c)}
                      disabled={locked}
                      style={{
                        textAlign: 'left', padding: '12px 14px', borderRadius: '12px', cursor: locked ? 'not-allowed' : 'pointer',
                        background: picked ? `${color}1f` : 'rgba(255,255,255,0.04)',
                        border: picked ? `1px solid ${color}` : '1px solid rgba(255,255,255,0.08)',
                        opacity: locked && !picked ? 0.4 : 1,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="font-display" style={{ fontWeight: 700, fontSize: '13px', color: '#fff' }}>{c.name}</span>
                        <span className="font-num" style={{ fontSize: '12px', fontWeight: 700, color: '#FFD700' }}>{c.points} pts</span>
                      </div>
                      <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '3px' }} className="font-num">×0.5 scoring</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Boost shop */}
            <div className="glass-card" style={{ padding: '18px' }}>
              <h2 className="section-title" style={{ marginBottom: '4px' }}>
                <Zap size={13} style={{ marginRight: '-4px' }} /> Boost Shop
              </h2>
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '14px' }}>
                Max {MAX_BOOSTS} per round · costs deducted from your Pit Coins immediately
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
                {boostCatalog.map(boost => {
                  const owned = team.boosts.includes(boost.id)
                  const disabled = locked || (!owned && (team.boosts.length >= MAX_BOOSTS || coins < boost.cost))
                  return (
                    <button
                      key={boost.id}
                      onClick={() => toggleBoost(boost)}
                      disabled={disabled}
                      style={{
                        textAlign: 'left', padding: '12px 14px', borderRadius: '12px',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        background: owned ? 'rgba(255,215,0,0.08)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${owned ? 'rgba(255,215,0,0.4)' : 'rgba(255,255,255,0.08)'}`,
                        opacity: disabled && !owned ? 0.45 : 1,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700 }}>{BOOST_ICONS[boost.id]} {boost.name}</span>
                        <span className="font-num" style={{ fontSize: '12px', fontWeight: 700, color: owned ? '#FFD700' : '#9CA3AF' }}>
                          {owned ? 'OWNED' : `${boost.cost} coins`}
                        </span>
                      </div>
                      <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '4px', lineHeight: 1.4 }}>{boost.desc}</div>
                    </button>
                  )
                })}
              </div>
              {team.boosts.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
                  {team.boosts.map(b => {
                    const def = boostCatalog.find(x => x.id === b)
                    return (
                      <span key={b} style={{
                        fontSize: '10px', fontWeight: 700, color: '#FFD700', padding: '4px 9px',
                        borderRadius: '7px', background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)',
                      }}>
                        {BOOST_ICONS[b]} {def?.name || b} active
                      </span>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Score breakdown */}
            {myScore && (
              <div className="glass-card" style={{ padding: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h2 className="section-title" style={{ margin: 0 }}>Your last score</h2>
                  <span className="font-num" style={{ fontSize: '22px', fontWeight: 800, color: '#FFD700' }}>{myScore.points} pts</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' }}>
                  {Object.entries(myScore.breakdown.drivers || {}).map(([abbr, v]) => (
                    <div key={abbr} style={{
                      fontSize: '11px', padding: '6px 9px', borderRadius: '7px',
                      background: v.captain ? 'rgba(255,215,0,0.08)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${v.captain ? 'rgba(255,215,0,0.3)' : 'rgba(255,255,255,0.07)'}`,
                      color: '#D1D5DB',
                    }}>
                      {abbr}{v.captain ? ' (C)' : ''}: <b>{v.awarded}</b> <span style={{ color: 'var(--muted)' }}>({v.race_points} raw)</span>
                    </div>
                  ))}
                  <div style={{ fontSize: '11px', padding: '6px 9px', borderRadius: '7px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    {myScore.breakdown.constructor.team_name}: <b>{myScore.breakdown.constructor.awarded}</b>
                  </div>
                  {myScore.breakdown.engine_upgrade_bonus != null && (
                    <div style={{ fontSize: '11px', padding: '6px 9px', borderRadius: '7px', background: 'rgba(0,209,49,0.08)', border: '1px solid rgba(0,209,49,0.3)', color: '#00D131' }}>
                      ⚙️ Engine upgrade: +{myScore.breakdown.engine_upgrade_bonus.toFixed(1)}
                    </div>
                  )}
                  {myScore.breakdown.undercut_bonus && (
                    <div style={{ fontSize: '11px', padding: '6px 9px', borderRadius: '7px', background: 'rgba(0,209,49,0.08)', border: '1px solid rgba(0,209,49,0.3)', color: '#00D131' }}>
                      ⏱️ Undercut: +{myScore.breakdown.undercut_bonus.points}
                    </div>
                  )}
                  {myScore.breakdown.pit_crew_bonus && (
                    <div style={{ fontSize: '11px', padding: '6px 9px', borderRadius: '7px', background: myScore.breakdown.pit_crew_bonus.podium ? 'rgba(0,209,49,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${myScore.breakdown.pit_crew_bonus.podium ? 'rgba(0,209,49,0.3)' : 'rgba(255,255,255,0.07)'}`, color: myScore.breakdown.pit_crew_bonus.podium ? '#00D131' : 'var(--muted)' }}>
                      🔧 Pit crew: +{myScore.breakdown.pit_crew_bonus.points}
                    </div>
                  )}
                  {myScore.breakdown.weather_boost && (
                    <div style={{ fontSize: '11px', padding: '6px 9px', borderRadius: '7px', background: myScore.breakdown.weather_boost.rained ? 'rgba(0,209,49,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${myScore.breakdown.weather_boost.rained ? 'rgba(0,209,49,0.3)' : 'rgba(255,255,255,0.07)'}`, color: myScore.breakdown.weather_boost.rained ? '#00D131' : 'var(--muted)' }}>
                      🌧️ Weather boost: {myScore.breakdown.weather_boost.rained ? '×2 applied' : 'no rain — no effect'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* My garage / sidebar */}
          <div style={{ display: 'grid', gap: '16px' }}>
            <div className="glass-card" style={{ padding: '18px', position: 'sticky', top: '70px' }}>
              <h2 className="section-title" style={{ marginBottom: '14px' }}>
                <Swords size={13} style={{ marginRight: '-4px' }} /> My Garage
              </h2>
              <AnimatePresence>
                {team.drivers.length === 0 && !team.constructor && (
                  <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '20px 0', textAlign: 'center' }}>
                    Your garage is empty.<br />Pick 5 drivers + a constructor.
                  </div>
                )}
                {team.drivers.map(abbr => {
                  const d = drivers.find(x => x.abbreviation === abbr)
                  if (!d) return null
                  const color = hexColor(d.team_color) || TEAM_COLORS[d.team] || '#555'
                  const isCaptain = team.captain === abbr
                  return (
                    <motion.div
                      key={abbr}
                      layout
                      initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', marginBottom: '7px' }}
                    >
                      <span style={{ width: '4px', height: '22px', background: color, borderRadius: '2px' }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 700 }}>
                          {d.abbreviation} <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '11px' }}>{d.team}</span>
                        </div>
                      </div>
                      {isCaptain && <Star size={13} fill="#FFD700" color="#FFD700" />}
                      <span className="font-num" style={{ fontSize: '12px', color: '#FFD700' }}>{d.points}</span>
                    </motion.div>
                  )
                })}
                {team.constructor && (() => {
                  const c = constructors.find(x => x.id === team.constructor)
                  if (!c) return null
                  const color = c.color || TEAM_COLORS[c.name] || '#555'
                  return (
                    <motion.div
                      key="constructor"
                      layout initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', borderRadius: '10px', background: `${color}14`, border: `1px solid ${color}44`, marginTop: '10px' }}
                    >
                      <div style={{ flex: 1, fontSize: '13px', fontWeight: 700 }}>{c.name}</div>
                      <span className="font-num" style={{ fontSize: '12px', color: '#FFD700' }}>{Math.round(c.points * 0.5)}</span>
                    </motion.div>
                  )
                })()}
              </AnimatePresence>

              {!locked ? (
                <div style={{ marginTop: '16px' }}>
                  <button
                    onClick={submit}
                    disabled={!complete || saving}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '8px', width: '100%', justifyContent: 'center',
                      background: complete ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                      color: complete ? '#fff' : 'var(--muted)', border: 'none', borderRadius: '10px',
                      padding: '11px 22px', fontSize: '13px', fontWeight: 800,
                      cursor: complete ? 'pointer' : 'default',
                    }}
                  >
                    {saved ? <><CheckCircle2 size={15} /> Saved — edit anytime before race start</> : saving ? 'Saving…' : 'Save team'}
                  </button>
                  {saveError && <div style={{ fontSize: '11px', color: '#E8002D', marginTop: '8px' }}>{saveError}</div>}
                  {!complete && <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '8px' }}>Pick 5 drivers, 1 constructor, and a captain to save</div>}
                </div>
              ) : (
                <div style={{ marginTop: '14px', padding: '12px', borderRadius: '10px', background: 'rgba(232,0,45,0.06)', border: '1px solid rgba(232,0,45,0.2)', textAlign: 'center', fontSize: '11px', color: '#E8002D' }}>
                  Locked — race has started. Changes reopen next round.
                </div>
              )}
            </div>

            <div className="glass-card" style={{ padding: '18px' }}>
              <h2 className="section-title" style={{ marginBottom: '12px' }}>
                <Trophy size={13} style={{ marginRight: '-2px' }} /> Season leaderboard
              </h2>
              {seasonBoard.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '10px 0' }}>
                  No scored teams yet — scores appear after the first race is scored.
                </div>
              ) : seasonBoard.map((row, i) => (
                <div key={row.username} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px',
                  borderRadius: '9px', marginBottom: '5px',
                  background: row.username === name ? 'rgba(225,6,0,0.09)' : 'rgba(255,255,255,0.025)',
                  border: row.username === name ? '1px solid rgba(225,6,0,0.3)' : '1px solid transparent',
                }}>
                  <span className="font-num" style={{ fontSize: '12px', fontWeight: 800, width: '20px', color: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'var(--muted)' }}>
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.username}</span>
                  <span className="font-num" style={{ fontSize: '13px', fontWeight: 800, color: '#FFD700' }}>{row.points}</span>
                </div>
              ))}
            </div>

            <div className="glass-card" style={{ padding: '18px' }}>
              <h2 className="section-title" style={{ marginBottom: '12px' }}>Finished races</h2>
              {finishedRounds.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Season hasn&apos;t raced yet.</div>
              ) : finishedRounds.map(r => (
                <div key={r.round} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ flex: 1, fontSize: '12px' }}>
                    <span className="font-num" style={{ color: 'var(--muted)', marginRight: '6px' }}>R{r.round}</span>{r.name}
                  </span>
                  {r.scored ? (
                    <span style={{ fontSize: '10px', color: '#00D131', fontWeight: 700 }}>SCORED</span>
                  ) : (
                    <button
                      onClick={() => scoreRound(r.round)}
                      disabled={scoring === r.round}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                        color: '#D1D5DB', borderRadius: '7px', padding: '4px 9px',
                        fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      <RefreshCw size={10} className={scoring === r.round ? 'animate-spin' : undefined} />
                      {scoring === r.round ? 'Scoring…' : 'Score race'}
                    </button>
                  )}
                </div>
              ))}
              <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '10px', lineHeight: 1.5 }}>
                Scoring pulls official results — first run per race takes ~a minute while fastf1 loads.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
