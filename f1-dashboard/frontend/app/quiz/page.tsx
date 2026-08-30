'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, Flame, Trophy, Coins, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { BACKEND_URL } from '@/lib/constants'
import { getUsername, setUsername, addCoins } from '@/lib/wallet'
import { unlockAchievement } from '@/lib/achievements'
import { authHeaders } from '@/lib/auth'

const CLAIMED_KEY = 'f1.quiz.claimed'

interface QuizQuestion {
  question: string
  options: string[]
  category: string
  answer_idx?: number // present only once already-played / after submit reveal
}

interface DailyResponse {
  date: string
  questions: QuizQuestion[]
  already_played: boolean
  my_attempt?: { score: number; answers: number[]; completed_at: number }
}

interface SubmitResponse {
  score: number
  correct: number[]
  streak: number
}

interface StreakInfo {
  streak: number
  best_streak: number
  last_played: string | null
}

interface LeaderboardRow {
  username: string
  total_score: number
  days_played: number
}

type Phase = 'loading' | 'error' | 'intro' | 'playing' | 'result' | 'review'

const CATEGORY_LABEL: Record<string, string> = {
  standings: 'Standings',
  stats: 'Stats',
  teams: 'Teams',
  results: 'Results',
  circuits: 'Circuits',
  calendar: 'Calendar',
}

function todayClaimKey(date: string) {
  return `${CLAIMED_KEY}.${date}`
}

export default function QuizPage() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [daily, setDaily] = useState<DailyResponse | null>(null)
  const [name, setName] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [qIndex, setQIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [userAnswers, setUserAnswers] = useState<number[]>([])
  const [submitResult, setSubmitResult] = useState<SubmitResponse | null>(null)
  const [streakInfo, setStreakInfo] = useState<StreakInfo | null>(null)
  const [board, setBoard] = useState<LeaderboardRow[]>([])
  const [error, setError] = useState('')
  const [coinsAwarded, setCoinsAwarded] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const loadBoard = useCallback(() => {
    fetch(`${BACKEND_URL}/api/quiz/leaderboard`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setBoard(Array.isArray(d) ? d : []))
      .catch(() => null)
  }, [])

  const loadStreak = useCallback((username: string) => {
    fetch(`${BACKEND_URL}/api/quiz/streak?username=${encodeURIComponent(username)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setStreakInfo(d))
      .catch(() => null)
  }, [])

  const loadDaily = useCallback((username: string) => {
    setPhase('loading')
    const qs = username ? `?username=${encodeURIComponent(username)}` : ''
    fetch(`${BACKEND_URL}/api/quiz/daily${qs}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: DailyResponse) => {
        setDaily(d)
        if (d.already_played && d.my_attempt) {
          setUserAnswers(d.my_attempt.answers)
          setPhase('review')
        } else {
          setPhase(username ? 'intro' : 'intro')
        }
      })
      .catch(() => {
        setError("Couldn't reach the server — please try again in a moment.")
        setPhase('error')
      })
  }, [])

  useEffect(() => {
    const u = getUsername()
    setName(u)
    loadDaily(u)
    loadBoard()
    if (u) loadStreak(u)
  }, [loadDaily, loadBoard, loadStreak])

  const saveName = () => {
    const n = nameDraft.trim()
    if (!n) return
    setUsername(n)
    setName(n)
    loadDaily(n)
    loadStreak(n)
  }

  const startQuiz = () => {
    setQIndex(0)
    setSelected(null)
    setUserAnswers([])
    setSubmitResult(null)
    setPhase('playing')
  }

  const questions = daily?.questions || []
  const current = questions[qIndex]
  const progress = questions.length ? ((qIndex + (selected !== null ? 1 : 0)) / questions.length) * 100 : 0

  const pickAnswer = (idx: number) => {
    if (selected !== null) return
    setSelected(idx)
  }

  const next = async () => {
    if (selected === null || !current) return

    // Check this BEFORE clearing `selected`: the Finish button only renders
    // while an answer is selected, so bailing out afterwards made the button
    // vanish and the quiz look broken.
    const isFinal = qIndex + 1 >= questions.length
    if (isFinal && !name) {
      setError('Enter a paddock name above to submit your score.')
      return
    }

    const nextAnswers = [...userAnswers, selected]
    setUserAnswers(nextAnswers)
    setSelected(null)

    if (!isFinal) {
      setQIndex(qIndex + 1)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/quiz/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ username: name, answers: nextAnswers }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.detail || 'submit failed')
        setPhase('error')
        return
      }
      const result: SubmitResponse = await res.json()
      setSubmitResult(result)
      setPhase('result')
      loadBoard()
      loadStreak(name)

      // Coin claim guard — award score x 2 coins once per date, client-side
      const dateKey = daily?.date || ''
      const claimKey = todayClaimKey(dateKey)
      if (!localStorage.getItem(claimKey)) {
        const coins = result.score * 2
        addCoins(coins)
        localStorage.setItem(claimKey, '1')
        setCoinsAwarded(coins)
      }

      unlockAchievement('quiz-rookie')
      if (result.streak >= 7) unlockAchievement('quiz-streak-7')
    } catch {
      setError('backend unreachable')
      setPhase('error')
    } finally {
      setSubmitting(false)
    }
  }

  const reviewRows = useMemo(() => {
    if (!daily || !daily.my_attempt) return []
    return daily.questions.map((q, i) => ({
      question: q.question,
      options: q.options,
      answerIdx: q.answer_idx ?? -1,
      yourIdx: daily.my_attempt!.answers[i],
    }))
  }, [daily])

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px', position: 'relative', zIndex: 1 }}>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: '18px' }}>
        <div className="kicker" style={{ marginBottom: '8px' }}>Daily Quiz</div>
        <h1 className="display-title" style={{ fontSize: 'clamp(28px, 5vw, 44px)', margin: 0 }}>Paddock Pop Quiz</h1>
        <div style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '6px' }}>
          10 questions, fresh every day, built from real 2026 standings and results.
        </div>
      </motion.div>

      {coinsAwarded !== null && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          style={{
            position: 'fixed', top: '18px', left: '50%', transform: 'translateX(-50%)', zIndex: 90,
            display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px',
            borderRadius: '12px', background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.4)',
            color: '#FFD700', fontWeight: 800, fontSize: '14px', backdropFilter: 'blur(8px)',
          }}
        >
          <Coins size={16} /> +{coinsAwarded} Pit Coins from today&apos;s quiz!
        </motion.div>
      )}

      {phase === 'loading' && (
        <div className="glass-card shimmer" style={{ padding: '60px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
          Loading today&apos;s quiz…
        </div>
      )}

      {phase === 'error' && (
        <div className="glass-card" style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: '#E8002D', fontSize: '13px', marginBottom: '14px' }}>{error}</div>
          <button
            onClick={() => loadDaily(name)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)', color: '#D1D5DB', borderRadius: '8px',
              padding: '8px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
            }}
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {(phase === 'intro' || phase === 'playing' || phase === 'result' || phase === 'review') && !name && (
        <div className="glass-card" style={{ padding: '20px', marginBottom: '16px' }}>
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
      )}

      {phase === 'intro' && name && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="featured-card" style={{ padding: '32px', textAlign: 'center' }}>
          <Brain size={32} style={{ color: 'var(--accent)', marginBottom: '12px' }} />
          <div className="font-display" style={{ fontSize: '20px', fontWeight: 800, marginBottom: '8px' }}>
            Today&apos;s quiz is ready
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '20px' }}>
            {questions.length} questions · one attempt per day · answers lock in as you go
          </div>
          {streakInfo && streakInfo.streak > 0 && (
            <div style={{ fontSize: '13px', color: '#FF8000', marginBottom: '18px', fontWeight: 700 }}>
              {'🔥'.repeat(Math.min(streakInfo.streak, 10))} {streakInfo.streak}-day streak
            </div>
          )}
          <button
            onClick={startQuiz}
            style={{
              background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '10px',
              padding: '12px 28px', fontSize: '14px', fontWeight: 800, cursor: 'pointer',
            }}
          >
            Start quiz
          </button>
        </motion.div>
      )}

      {phase === 'playing' && current && (
        <div className="glass-card" style={{ padding: '24px' }}>
          {error && (
            <div style={{ color: '#E8002D', background: 'rgba(232,0,45,0.08)', border: '1px solid rgba(232,0,45,0.25)', borderRadius: 8, padding: '9px 12px', fontSize: 12, marginBottom: 14 }}>
              {error}
            </div>
          )}
          {/* Progress bar */}
          <div style={{ marginBottom: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)', marginBottom: '6px' }}>
              <span>Question {qIndex + 1} of {questions.length}</span>
              <span>{CATEGORY_LABEL[current.category] || current.category}</span>
            </div>
            <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <motion.div
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
                style={{ height: '100%', background: 'var(--accent)', borderRadius: '3px' }}
              />
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={qIndex}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
            >
              <div className="font-display" style={{ fontSize: '18px', fontWeight: 800, marginBottom: '18px', lineHeight: 1.4 }}>
                {current.question}
              </div>

              <div style={{ display: 'grid', gap: '10px' }}>
                {current.options.map((opt, i) => {
                  const isSelected = selected === i
                  const revealed = selected !== null
                  return (
                    <motion.button
                      key={i}
                      onClick={() => pickAnswer(i)}
                      whileHover={selected === null ? { x: 3 } : {}}
                      disabled={selected !== null}
                      style={{
                        textAlign: 'left', padding: '13px 16px', borderRadius: '10px',
                        background: isSelected ? 'rgba(225,6,0,0.12)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.1)'}`,
                        color: '#fff', fontSize: '13px', fontWeight: 600,
                        cursor: revealed ? 'default' : 'pointer',
                        opacity: revealed && !isSelected ? 0.5 : 1,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}
                    >
                      <span>{opt}</span>
                      {isSelected && <CheckCircle2 size={16} style={{ color: 'var(--accent)' }} />}
                    </motion.button>
                  )
                })}
              </div>

              {selected !== null && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: '18px', textAlign: 'right' }}>
                  <button
                    onClick={next}
                    disabled={submitting}
                    style={{
                      background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '10px',
                      padding: '10px 24px', fontSize: '13px', fontWeight: 800, cursor: 'pointer',
                    }}
                  >
                    {submitting ? 'Submitting…' : qIndex + 1 < questions.length ? 'Next question' : 'Finish quiz'}
                  </button>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {phase === 'result' && submitResult && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="featured-card" style={{ padding: '32px', textAlign: 'center' }}>
          <Trophy size={32} style={{ color: '#FFD700', marginBottom: '12px' }} />
          <div className="font-num" style={{ fontSize: '48px', fontWeight: 900, color: '#fff' }}>
            {submitResult.score}<span style={{ fontSize: '20px', color: 'var(--muted)' }}> / {questions.length}</span>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--muted)', margin: '8px 0 16px' }}>correct today</div>
          {submitResult.streak > 0 && (
            <div style={{ fontSize: '15px', color: '#FF8000', fontWeight: 800, marginBottom: '18px' }}>
              {'🔥'.repeat(Math.min(submitResult.streak, 10))} {submitResult.streak}-day streak
            </div>
          )}
          <div className="font-num" style={{ fontSize: '13px', color: '#FFD700', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Coins size={14} /> +{submitResult.score * 2} Pit Coins
          </div>
        </motion.div>
      )}

      {phase === 'review' && daily?.my_attempt && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="glass-card" style={{ padding: '24px', marginBottom: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '6px' }}>You already played today</div>
            <div className="font-num" style={{ fontSize: '38px', fontWeight: 900 }}>
              {daily.my_attempt.score}<span style={{ fontSize: '16px', color: 'var(--muted)' }}> / {questions.length}</span>
            </div>
            {streakInfo && streakInfo.streak > 0 && (
              <div style={{ fontSize: '13px', color: '#FF8000', fontWeight: 700, marginTop: '10px' }}>
                {'🔥'.repeat(Math.min(streakInfo.streak, 10))} {streakInfo.streak}-day streak
              </div>
            )}
          </div>

          <div className="glass-card" style={{ padding: '18px' }}>
            <h2 className="section-title" style={{ marginBottom: '12px' }}>Today&apos;s review</h2>
            <div style={{ display: 'grid', gap: '10px' }}>
              {reviewRows.map((r, i) => {
                const correct = r.yourIdx === r.answerIdx
                return (
                  <div key={i} style={{
                    padding: '12px 14px', borderRadius: '10px',
                    background: correct ? 'rgba(0,209,49,0.06)' : 'rgba(232,0,45,0.06)',
                    border: `1px solid ${correct ? 'rgba(0,209,49,0.25)' : 'rgba(232,0,45,0.25)'}`,
                  }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '6px' }}>
                      {correct
                        ? <CheckCircle2 size={14} style={{ color: '#00D131', marginTop: '2px', flexShrink: 0 }} />
                        : <XCircle size={14} style={{ color: '#E8002D', marginTop: '2px', flexShrink: 0 }} />}
                      <span style={{ fontSize: '13px', fontWeight: 700 }}>{r.question}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: '22px' }}>
                      Your answer: <b style={{ color: correct ? '#00D131' : '#E8002D' }}>{r.options[r.yourIdx] ?? '—'}</b>
                      {!correct && r.answerIdx >= 0 && (
                        <> · Correct: <b style={{ color: '#00D131' }}>{r.options[r.answerIdx]}</b></>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </motion.div>
      )}

      {(phase === 'result' || phase === 'review' || phase === 'intro') && board.length > 0 && (
        <div className="glass-card" style={{ padding: '18px', marginTop: '16px' }}>
          <h2 className="section-title" style={{ marginBottom: '12px' }}>
            <Trophy size={13} style={{ marginRight: '-2px' }} /> 30-day leaderboard
          </h2>
          {/* Two columns on a wide screen so the board fills the card instead
              of running as one thin strip down the left. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '5px 12px' }}>
            {board.map((row, i) => (
              <div key={row.username} style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px',
                borderRadius: 2,
                background: row.username === name ? 'rgba(225,6,0,0.09)' : 'var(--surface)',
                border: row.username === name ? '1px solid rgba(225,6,0,0.3)' : '1px solid var(--hairline)',
              }}>
                <span className="font-num" style={{ fontSize: '12px', fontWeight: 800, width: '20px', color: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'var(--muted)' }}>
                  {i + 1}
                </span>
                <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.username}</span>
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>{row.days_played}d played</span>
                <span className="font-num" style={{ fontSize: '13px', fontWeight: 800, color: '#FFD700' }}>{row.total_score}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
