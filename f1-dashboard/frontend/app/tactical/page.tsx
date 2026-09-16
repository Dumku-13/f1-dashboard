import TacticalRoom from '@/components/tactical/TacticalRoom'
import VoiceEngineer from '@/components/tactical/VoiceEngineer'
import type { CSSProperties } from 'react'

export const metadata = { title: 'Tactical Operations | F1 Dashboard', description: 'Keyless historical F1 telemetry replay and tactical camera control.' }

export default function TacticalPage() {
  return <div style={{ maxWidth: 1800, margin: '0 auto', padding: '24px clamp(12px, 2vw, 32px) 60px', background: '#0d1218', color: '#e9eef5', minHeight: '100vh', '--surface': '#151d26', '--background': '#0d1218', '--foreground': '#e9eef5', '--muted': '#91a2b6', '--border': '#2c3947', '--text-secondary': '#91a2b6' } as CSSProperties}>
    <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
      <div><h1 className="display-title" style={{ fontSize: 'clamp(26px, 3vw, 38px)', marginBottom: 6, color: '#e9eef5' }}>Tactical operations</h1>
      <p style={{ color: '#91a2b6', fontSize: 13, lineHeight: 1.5 }}>Choose a session. Follow a driver. Replay every turn.</p></div>
      <span style={{ fontSize: 11, color: '#91a2b6' }}>View shortcuts: <kbd>2</kbd> Thermal <span style={{ marginInline: 6 }}>/</span> <kbd>3</kbd> Normal</span>
    </header>
    <TacticalRoom />
    <VoiceEngineer />
  </div>
}
