'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Target, Lock, Trophy, Coins, CheckCircle2, RefreshCw } from 'lucide-react'
import { BACKEND_URL, TEAM_COLORS } from '@/lib/constants'
import { hexColor } from '@/lib/utils'
import { getUsername, setUsername, addCoins } from '@/lib/wallet'
import { unlockAchievement, checkPredictionAchievements } from '@/lib/achievements'
import { logPulse } from '@/lib/pulse'
import { useApi, useApiList } from '@/lib/api/client'
import { useStandings } from '@/lib/api/hooks'
import KalshiOdds from '@/components/predictor/KalshiOdds'
import type { DriverStanding } from '@/lib/types'
import { authHeaders } from '@/lib/auth'

const YEAR = 2026
const CLAIMED_KEY = 'f1.predictor.claimed'

interface NextWeekend {
  round: number
  name: string
  country: string
  is_sprint: boolean
  lock_time: string | null
  locked: boolean
  max_points: number
  points: Record<string, number>
}

interface RoundInfo {
  round: number
  name: string
  country: string
  locked: boolean
  race_finished: boolean
  scored: boolean
}

interface Picks {
  pole: string; p1: string; p2: string; p3: string
  fastest_lap: string; first_dnf: string
  sc_count: number; red_flags: number
  gainer: string; loser: string
}

const EMPTY_PICKS: Picks = {
  pole: '', p1: '', p2: '', p3: '', fastest_lap: '', first_dnf: '',
  sc_count: 1, red_flags: 0, gainer: '', loser: '',
}

const FIELD_LABELS: Record<string, string> = {
  pole: 'Pole position', p1: 'P1 — Winner', p2: 'P2', p3: 'P3',
  winner_bonus: 'Winner bonus', fastest_lap: 'Fastest lap',
  first_dnf: 'First DNF', sc_count: 'Safety cars', red_flags: 'Red flags',
  gainer: 'Biggest gainer', loser: 'Biggest loser',
}

const POINTS_GUIDE_LABELS: Record<string, string> = {
  pole: 'Pole position', winner: 'Winner bonus',
  podium_exact: 'Podium — exact step', podium_partial: 'Podium — wrong step',
  fastest_lap: 'Fastest lap', first_dnf: 'First DNF',
  sc_count: 'Safety car count', red_flags: 'Red flag count',
  gainer: 'Biggest gainer', loser: 'Biggest loser',
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

function DriverGrid({ drivers, selected, onPick, disabled, taken, allowNone }: {
  drivers: DriverStanding[]
  selected: string
  onPick: (abbr: string) => void
  disabled?: boolean
  taken?: string[]
  allowNone?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
      {allowNone && (
        <button
          onClick={() => onPick('NONE')}
          disabled={disabled}
          style={{
            padding: '5px 9px', borderRadius: '7px', fontSize: '11px', fontWeight: 700,
            cursor: disabled ? 'default' : 'pointer',
            background: selected === 'NONE' ? 'rgba(0,209,49,0.18)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${selected === 'NONE' ? '#00D131' : 'rgba(255,255,255,0.1)'}`,
            color: selected === 'NONE' ? '#00D131' : '#9CA3AF',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          No DNF
        </button>
      )}
      {drivers.map(d => {
        const color = hexColor(d.team_color) || TEAM_COLORS[d.team] || '#555'
        const isSel = selected === d.abbreviation
        const isTaken = !isSel && taken?.includes(d.abbreviation)
        return (
          <button
            key={d.abbreviation}
            onClick={() => onPick(d.abbreviation)}
            disabled={disabled || isTaken}
            title={d.team}
            style={{
              padding: '5px 9px', borderRadius: '7px', fontSize: '11px', fontWeight: 700,
              cursor: disabled || isTaken ? 'default' : 'pointer',
              background: isSel ? `${color}2b` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${isSel ? color : 'rgba(255,255,255,0.1)'}`,
              color: isSel ? '#fff' : '#9CA3AF',
              opacity: disabled || isTaken ? 0.35 : 1,
            }}
          >
            {d.abbreviation}
          </button>
        )
      })}
    </div>
  )
}

function Stepper({ value, onChange, min, max, disabled }: {
  value: number; onChange: (v: number) => void; min: number; max: number; disabled?: boolean
}) {
  const btn = (label: string, delta: number) => (
    <button
      onClick={() => onChange(Math.min(max, Math.max(min, value + delta)))}
      disabled={disabled}
      style={{
        width: '30px', height: '30px', borderRadius: '8px', cursor: disabled ? 'default' : 'pointer',
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
        color: '#fff', fontSize: '15px', fontWeight: 700, opacity: disabled ? 0.4 : 1,
      }}
    >
      {label}
    </button>
  )
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
      {btn('−', -1)}
      <span className="font-num" style={{ fontSize: '20px', fontWeight: 800, minWidth: '24px', textAlign: 'center' }}>{value}</span>
      {btn('+', 1)}
    </div>
  )
}

export default function PredictorPage() {
  const { data: weekend } = useApi<NextWeekend>(`/api/predictor/next?year=${YEAR}`)
  const { data: standings } = useStandings(YEAR)
  const { data: rounds, mutate: reloadRounds } = useApiList<RoundInfo>(`/api/predictor/rounds?year=${YEAR}`)
  const { data: seasonBoard, mutate: reloadBoard } = useApiList<{ username: string; points: number; rounds_played: number; best_round: number }>(`/api/predictor/leaderboard/${YEAR}`)

  const [picks, setPicks] = useState<Picks>(EMPTY_PICKS)
  const [name, setName] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [myScore, setMyScore] = useState<{ points: number; breakdown: Record<string, { correct: boolean; points: number; actual: string }> } | null>(null)
  const [coinsToast, setCoinsToast] = useState<number | null>(null)
  const [scoring, setScoring] = useState<number | null>(null)

  const lockLabel = useCountdown(weekend?.lock_time || null)
  const locked = weekend?.locked || lockLabel === 'LOCKED'
  const drivers = standings?.drivers || []

  // This user's saved prediction + score for the upcoming round — only
  // fetched once a username is chosen, reactive on name/round (replaces the
  // old imperative loadMine(username, round)).
  const mineKey = name && weekend ? `/api/predictor/predictions/${YEAR}/${weekend.round}?username=${encodeURIComponent(name)}` : null
  const { data: mine, mutate: reloadMine } = useApi<{
    prediction?: Picks
    score?: { points: number; breakdown: Record<string, { correct: boolean; points: number; actual: string }> }
  } | null>(mineKey)

  useEffect(() => {
    if (!mine) return
    if (mine.prediction) {
      const p = mine.prediction
      setPicks({
        pole: p.pole, p1: p.p1, p2: p.p2, p3: p.p3,
        fastest_lap: p.fastest_lap, first_dnf: p.first_dnf,
        sc_count: p.sc_count, red_flags: p.red_flags,
        gainer: p.gainer, loser: p.loser,
      })
      setSaved(true)
    }
    if (mine.score && weekend) {
      setMyScore(mine.score)
      checkPredictionAchievements(mine.score.points, mine.score.breakdown)
      // Award Pit Coins once per scored round
      const claimKey = `${YEAR}-${weekend.round}`
      try {
        const claimed: string[] = JSON.parse(localStorage.getItem(CLAIMED_KEY) || '[]')
        if (!claimed.includes(claimKey) && mine.score.points > 0) {
          addCoins(mine.score.points)
          localStorage.setItem(CLAIMED_KEY, JSON.stringify([...claimed, claimKey]))
          setCoinsToast(mine.score.points)
          setTimeout(() => setCoinsToast(null), 5000)
        }
      } catch { /* first claim */ }
    }
  }, [mine, weekend])

  const name0Ref = useRef(false)
  useEffect(() => {
    // Username lives in localStorage — read it once on mount (client only).
    if (name0Ref.current) return
    name0Ref.current = true
    setName(getUsername())
  }, [])

  const set = (k: keyof Picks, v: string | number) => {
    setSaved(false)
    setPicks(prev => ({ ...prev, [k]: v }))
  }

  const podiumTaken = [picks.p1, picks.p2, picks.p3].filter(Boolean)
  const complete = picks.pole && picks.p1 && picks.p2 && picks.p3 &&
    picks.fastest_lap && picks.first_dnf && picks.gainer && picks.loser

  const submit = async () => {
    if (!weekend || !name || !complete) return
    setSaveError('')
    try {
      const res = await fetch(`${BACKEND_URL}/api/predictor/predictions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ username: name, year: YEAR, round: weekend.round, ...picks }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        setSaveError(err?.detail || 'save failed')
        return
      }
      setSaved(true)
      unlockAchievement('crystal-ball')
      const pickedDrivers = new Set(
        [picks.pole, picks.p1, picks.p2, picks.p3, picks.fastest_lap, picks.first_dnf, picks.gainer, picks.loser]
          .filter(v => v && v !== 'NONE'),
      )
      pickedDrivers.forEach(abbr => logPulse('pick', abbr))
    } catch {
      setSaveError('backend unreachable')
    }
  }

  const scoreRound = async (round: number) => {
    setScoring(round)
    try {
      await fetch(`${BACKEND_URL}/api/predictor/score/${YEAR}/${round}`, { method: 'POST' })
      reloadBoard()
      if (name && weekend) reloadMine()
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

  const sectionTitle = (label: string, pts?: number) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '18px 0 8px' }}>
      <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', color: '#D1D5DB', textTransform: 'uppercase' }}>{label}</span>
      {pts != null && <span className="font-num" style={{ fontSize: '11px', color: '#FFD700' }}>+{pts} pts</span>}
    </div>
  )

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 16px', position: 'relative', zIndex: 1 }}>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: '18px' }}>
        <div className="kicker" style={{ marginBottom: '8px' }}>Race Predictor</div>
        <h1 className="display-title" style={{ fontSize: 'clamp(28px, 5vw, 44px)', margin: 0 }}>Call the Race</h1>
        <div style={{ color: '#9CA3AF', fontSize: '13px', marginTop: '6px' }}>
          Lock your picks before qualifying. Correct calls pay Pit Coins after the flag.
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
          <Coins size={16} /> +{coinsToast} Pit Coins from your prediction!
        </motion.div>
      )}

      {!weekend || !standings ? (
        <div className="glass-card shimmer" style={{ padding: '60px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
          Loading the next race weekend…
        </div>
      ) : (
        <div className="live-grid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', alignItems: 'start' }}>
          {/* Prediction form */}
          <div className="glass-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h2 className="section-title"><Target size={13} style={{ marginRight: '-2px' }} /> Round {weekend.round} · {weekend.name}</h2>
                <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '4px' }}>{weekend.country}{weekend.is_sprint ? ' · Sprint weekend' : ''}</div>
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '7px 13px', borderRadius: '9px',
                background: locked ? 'rgba(232,0,45,0.1)' : 'rgba(0,209,49,0.08)',
                border: `1px solid ${locked ? 'rgba(232,0,45,0.35)' : 'rgba(0,209,49,0.3)'}`,
              }}>
                <Lock size={12} style={{ color: locked ? '#E8002D' : '#00D131' }} />
                <span className="font-num" style={{ fontSize: '12px', fontWeight: 700, color: locked ? '#E8002D' : '#00D131' }}>
                  {locked ? 'Locked — quali underway' : `Locks in ${lockLabel}`}
                </span>
              </div>
            </div>

            {!name ? (
              <div style={{ marginTop: '18px', padding: '16px', borderRadius: '12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
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
            ) : (
              <>
                {sectionTitle('Pole position', weekend.points.pole)}
                <DriverGrid drivers={drivers} selected={picks.pole} onPick={v => set('pole', v)} disabled={locked} />

                {sectionTitle('Podium — in order', weekend.points.podium_exact * 3 + weekend.points.winner)}
                <div style={{ display: 'grid', gap: '10px' }}>
                  {(['p1', 'p2', 'p3'] as const).map((slot, i) => (
                    <div key={slot}>
                      <div style={{ fontSize: '10px', color: i === 0 ? '#FFD700' : '#9CA3AF', fontWeight: 700, marginBottom: '5px' }}>
                        {i === 0 ? '🥇 P1 — winner (+10 bonus)' : i === 1 ? '🥈 P2' : '🥉 P3'}
                      </div>
                      <DriverGrid
                        drivers={drivers} selected={picks[slot]} onPick={v => set(slot, v)}
                        disabled={locked} taken={podiumTaken.filter(a => a !== picks[slot])}
                      />
                    </div>
                  ))}
                </div>

                {sectionTitle('Fastest lap', weekend.points.fastest_lap)}
                <DriverGrid drivers={drivers} selected={picks.fastest_lap} onPick={v => set('fastest_lap', v)} disabled={locked} />

                {sectionTitle('First DNF', weekend.points.first_dnf)}
                <DriverGrid drivers={drivers} selected={picks.first_dnf} onPick={v => set('first_dnf', v)} disabled={locked} allowNone />

                <div style={{ display: 'flex', gap: '36px', flexWrap: 'wrap' }}>
                  <div>
                    {sectionTitle('Safety cars', weekend.points.sc_count)}
                    <Stepper value={picks.sc_count} onChange={v => set('sc_count', v)} min={0} max={9} disabled={locked} />
                  </div>
                  <div>
                    {sectionTitle('Red flags', weekend.points.red_flags)}
                    <Stepper value={picks.red_flags} onChange={v => set('red_flags', v)} min={0} max={5} disabled={locked} />
                  </div>
                </div>

                {sectionTitle('Biggest gainer (grid → flag)', weekend.points.gainer)}
                <DriverGrid drivers={drivers} selected={picks.gainer} onPick={v => set('gainer', v)} disabled={locked} />

                {sectionTitle('Biggest loser', weekend.points.loser)}
                <DriverGrid drivers={drivers} selected={picks.loser} onPick={v => set('loser', v)} disabled={locked} />

                {!locked && (
                  <div style={{ marginTop: '22px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <button
                      onClick={submit}
                      disabled={!complete}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '8px',
                        background: complete ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                        color: complete ? '#fff' : 'var(--muted)', border: 'none', borderRadius: '10px',
                        padding: '11px 22px', fontSize: '13px', fontWeight: 800,
                        cursor: complete ? 'pointer' : 'default',
                      }}
                    >
                      {saved ? <><CheckCircle2 size={15} /> Saved — edit anytime before quali</> : 'Lock in prediction'}
                    </button>
                    {saveError && <span style={{ fontSize: '12px', color: '#E8002D' }}>{saveError}</span>}
                    {!complete && <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Make every pick to submit</span>}
                  </div>
                )}
              </>
            )}

            {/* Score breakdown once the round is scored */}
            {myScore && (
              <div style={{ marginTop: '22px', padding: '16px', borderRadius: '12px', background: 'rgba(255,215,0,0.05)', border: '1px solid rgba(255,215,0,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 800 }}>Your score</span>
                  <span className="font-num" style={{ fontSize: '22px', fontWeight: 800, color: '#FFD700' }}>{myScore.points} / {weekend.max_points}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' }}>
                  {Object.entries(myScore.breakdown).map(([k, v]) => (
                    <div key={k} style={{
                      fontSize: '11px', padding: '6px 9px', borderRadius: '7px',
                      background: v.correct ? 'rgba(0,209,49,0.08)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${v.correct ? 'rgba(0,209,49,0.3)' : 'rgba(255,255,255,0.07)'}`,
                      color: v.correct ? '#00D131' : 'var(--muted)',
                    }}>
                      {FIELD_LABELS[k] || k}: <b>{String(v.actual)}</b> {v.points > 0 && `+${v.points}`}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar: market odds + leaderboard + past rounds */}
          <div style={{ display: 'grid', gap: '16px' }}>
            {/* Sits above the leaderboard deliberately: everything else on this
                page is what *you* predicted, and this is what the market did. */}
            <KalshiOdds year={YEAR} standings={standings?.drivers} />
            <div className="glass-card" style={{ padding: '18px' }}>
              <h2 className="section-title" style={{ marginBottom: '12px' }}>
                <Trophy size={13} style={{ marginRight: '-2px' }} /> Season leaderboard
              </h2>
              {seasonBoard.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '10px 0' }}>
                  No scored predictions yet — scores appear after the first race is scored.
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
              {rounds.filter(r => r.race_finished).length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Season hasn&apos;t raced yet.</div>
              ) : rounds.filter(r => r.race_finished).map(r => (
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

            <div className="glass-card" style={{ padding: '18px' }}>
              <h2 className="section-title" style={{ marginBottom: '10px' }}>How points work</h2>
              {Object.entries(weekend.points).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9CA3AF', padding: '3px 0' }}>
                  <span>{POINTS_GUIDE_LABELS[k] || k}</span>
                  <span className="font-num" style={{ color: '#FFD700' }}>+{v}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 800, marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <span>Perfect weekend</span>
                <span className="font-num" style={{ color: '#FFD700' }}>{weekend.max_points}</span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '8px' }}>
                Points convert 1:1 into Pit Coins when the race is scored.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
