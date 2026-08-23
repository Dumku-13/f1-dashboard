'use client'

/**
 * Global achievement toast queue + wallet-balance achievement watcher.
 * Mounted once from the root layout so unlocks pop on any page.
 */

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { UNLOCK_EVT, checkCoinAchievements, type AchievementDef } from '@/lib/achievements'
import { getCoins } from '@/lib/wallet'

export default function AchievementToaster() {
  const [queue, setQueue] = useState<AchievementDef[]>([])

  useEffect(() => {
    const onUnlock = (e: Event) => {
      const def = (e as CustomEvent<AchievementDef>).detail
      setQueue(q => [...q, def])
      setTimeout(() => setQueue(q => q.filter(x => x.id !== def.id)), 5200)
    }
    // Balance milestones can be crossed by any coin source (games, predictor…)
    const onCoins = () => checkCoinAchievements(getCoins())
    window.addEventListener(UNLOCK_EVT, onUnlock)
    window.addEventListener('pitcoins-change', onCoins)
    return () => {
      window.removeEventListener(UNLOCK_EVT, onUnlock)
      window.removeEventListener('pitcoins-change', onCoins)
    }
  }, [])

  return (
    <div style={{ position: 'fixed', top: '16px', right: '16px', zIndex: 200, display: 'flex', flexDirection: 'column', gap: '8px', pointerEvents: 'none' }}>
      <AnimatePresence>
        {queue.map(def => (
          <motion.div
            key={def.id}
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className="glass-card"
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
              minWidth: '250px', maxWidth: '320px',
              borderLeft: '2px solid var(--amber)',
            }}
          >
            <span style={{ fontSize: '22px', lineHeight: 1, flexShrink: 0 }}>{def.icon}</span>
            <div style={{ minWidth: 0 }}>
              <div className="kicker" style={{ marginBottom: '2px' }}>Achievement unlocked</div>
              <div className="font-display" style={{ fontSize: '14px', fontWeight: 700, color: 'var(--foreground)' }}>{def.title}</div>
              <div className="font-num" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                {def.desc} · <span style={{ color: 'var(--amber)', fontWeight: 700 }}>+{def.coins} coins</span>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
