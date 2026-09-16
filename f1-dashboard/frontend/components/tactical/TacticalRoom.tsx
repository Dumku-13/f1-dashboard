'use client'

import { useState } from 'react'
import RacePicker from './RacePicker'
import LiveRace from './LiveRace'
import ReplayDeck from './ReplayDeck'
import type { ReplayData } from '@/lib/tactical/replay'
import type { HistoricalSession } from '@/lib/tactical/history'

export default function TacticalRoom() {
  const [mode, setMode] = useState<'history' | 'live'>('history')
  const [replay, setReplay] = useState<{ data: ReplayData; label: string; session: HistoricalSession; startAt: number; revision: number }>()
  return <>
    <div role="group" aria-label="Race data source" style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid #2c3947' }}>
      {(['history', 'live'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} style={{ padding: '11px 18px', color: mode === value ? '#e9eef5' : '#91a2b6', background: mode === value ? '#202c39' : 'transparent', border: 0, borderBottom: mode === value ? '2px solid #b7c9dd' : '2px solid transparent', borderRadius: '5px 5px 0 0', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{value === 'history' ? 'Past races' : 'Live session'}</button>)}
    </div>
    {mode === 'history' ? <>
      <RacePicker onLoad={(data, label, session, startAt) => setReplay(previous => ({ data, label, session, startAt, revision: (previous?.revision ?? 0) + 1 }))} />
      <ReplayDeck key={replay?.revision ?? 0} initialReplay={replay} />
    </> : <LiveRace />}
  </>
}
