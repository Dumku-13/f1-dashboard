'use client'

/**
 * Compact alerts settings panel. Opened from the bell button in the /live
 * header. Enable toggle, my-driver TLA picker (from live rows, falling back to
 * a standings fetch), per-rule toggles, sound toggle, and a "test alert" button.
 */

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Bell, BellOff, Volume2, VolumeX, X } from 'lucide-react'
import {
  useAlertSettings,
  fireAlert,
  RULE_LABELS,
  type AlertRules,
} from '@/lib/alerts'
import { notificationsSupported } from '@/lib/notify'
import { TEAM_COLORS } from '@/lib/constants'
import { hexColor } from '@/lib/utils'
import { useStandings } from '@/lib/api/hooks'
import type { TowerRow } from '@/lib/live'

interface DriverOption {
  tla: string
  color: string
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        gap: '10px',
        padding: '8px 10px',
        borderRadius: '2px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        color: 'var(--foreground)',
        fontSize: '12px',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span>{label}</span>
      <span
        style={{
          position: 'relative',
          width: '32px',
          height: '16px',
          borderRadius: '2px',
          flexShrink: 0,
          background: on ? 'var(--accent)' : 'var(--card)',
          border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
          transition: 'background 0.2s ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: '1px',
            left: on ? '17px' : '1px',
            width: '12px',
            height: '12px',
            borderRadius: '1px',
            background: '#fff',
            transition: 'left 0.2s ease',
          }}
        />
      </span>
    </button>
  )
}

export default function AlertSettings({
  rows,
  onClose,
}: {
  rows: TowerRow[]
  onClose: () => void
}) {
  const { settings, update, setRule } = useAlertSettings()

  // Driver options: prefer live rows; if empty (no live session), fall back to
  // standings — shared with every other page that already fetches it.
  const liveDrivers = useMemo<DriverOption[]>(() => {
    const seen = new Set<string>()
    const out: DriverOption[] = []
    rows.forEach(r => {
      const tla = (r.driver.name_acronym || '').toUpperCase()
      if (!tla || seen.has(tla)) return
      seen.add(tla)
      out.push({ tla, color: hexColor(r.driver.team_colour) || TEAM_COLORS[r.driver.team_name] || '#888' })
    })
    return out.sort((a, b) => a.tla.localeCompare(b.tla))
  }, [rows])

  const { data: standingsData } = useStandings(2026)
  const fallbackDrivers = useMemo<DriverOption[]>(() => {
    return (standingsData?.drivers || [])
      .map(d => ({ tla: d.abbreviation.toUpperCase(), color: hexColor(d.team_color) || TEAM_COLORS[d.team] || '#888' }))
      .sort((a, b) => a.tla.localeCompare(b.tla))
  }, [standingsData])

  const drivers = liveDrivers.length > 0 ? liveDrivers : fallbackDrivers

  const toggleEnabled = async () => {
    if (!settings.enabled) {
      // Turning on — request browser notification permission (best-effort).
      if (notificationsSupported() && Notification.permission === 'default') {
        try { await Notification.requestPermission() } catch { /* denied */ }
      }
      update({ enabled: true })
    } else {
      update({ enabled: false })
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 360, damping: 30 }}
      className="glass-card"
      style={{
        position: 'absolute',
        top: 'calc(100% + 10px)',
        right: 0,
        zIndex: 60,
        width: 'min(320px, calc(100vw - 32px))',
        padding: '16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h2 className="section-title" style={{ fontSize: '12px' }}>Custom Alerts</h2>
        <button
          onClick={onClose}
          aria-label="Close alerts settings"
          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '2px', display: 'flex' }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Master enable */}
      <button
        onClick={toggleEnabled}
        style={{
          display: 'flex', alignItems: 'center', gap: '9px', width: '100%',
          padding: '10px 12px', borderRadius: '2px', marginBottom: '14px', cursor: 'pointer',
          background: settings.enabled ? 'color-mix(in srgb, var(--sector-green) 12%, var(--card))' : 'var(--surface)',
          border: `1px solid ${settings.enabled ? 'var(--sector-green)' : 'var(--border)'}`,
          color: settings.enabled ? 'var(--sector-green)' : 'var(--muted)',
          fontFamily: 'var(--font-display)', fontSize: '12px', fontWeight: 700,
          letterSpacing: '0.04em', textTransform: 'uppercase',
        }}
      >
        {settings.enabled ? <Bell size={15} /> : <BellOff size={15} />}
        {settings.enabled ? 'Alerts ON' : 'Alerts OFF'}
      </button>

      {/* My driver picker */}
      <div style={{ marginBottom: '14px' }}>
        <div className="kicker" style={{ marginBottom: '7px' }}>My driver</div>
        {drivers.length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--muted)' }}>No drivers available yet.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            <button
              onClick={() => update({ myDriver: null })}
              style={{
                padding: '4px 9px', borderRadius: '2px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                fontFamily: 'var(--font-display)', letterSpacing: '0.02em',
                background: settings.myDriver == null ? 'var(--surface)' : 'transparent',
                border: `1px solid ${settings.myDriver == null ? 'var(--foreground)' : 'var(--border)'}`,
                color: settings.myDriver == null ? 'var(--foreground)' : 'var(--muted)',
              }}
            >
              NONE
            </button>
            {drivers.map(d => {
              const sel = settings.myDriver === d.tla
              return (
                <button
                  key={d.tla}
                  onClick={() => update({ myDriver: d.tla })}
                  style={{
                    padding: '4px 9px', borderRadius: '2px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'var(--font-display)', letterSpacing: '0.02em',
                    background: sel ? `${d.color}26` : 'transparent',
                    border: `1px solid ${sel ? d.color : 'var(--border)'}`,
                    color: sel ? 'var(--foreground)' : 'var(--muted)',
                  }}
                >
                  {d.tla}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Per-rule toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
        {(Object.keys(RULE_LABELS) as (keyof AlertRules)[]).map(rule => (
          <Toggle
            key={rule}
            label={RULE_LABELS[rule]}
            on={settings.rules[rule]}
            onClick={() => setRule(rule, !settings.rules[rule])}
          />
        ))}
      </div>

      {/* Sound + test */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => update({ sound: !settings.sound })}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
            padding: '9px', borderRadius: '2px', cursor: 'pointer', fontSize: '12px', fontWeight: 700,
            fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.04em',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: settings.sound ? 'var(--foreground)' : 'var(--muted)',
          }}
        >
          {settings.sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
          {settings.sound ? 'Sound' : 'Muted'}
        </button>
        <button
          onClick={() =>
            fireAlert(
              { title: 'TEST ALERT', body: 'Alerts are wired up and working.', tone: 'good' },
              settings.sound,
            )
          }
          style={{
            flex: 1, padding: '9px', borderRadius: '2px', cursor: 'pointer', fontSize: '12px', fontWeight: 700,
            fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.04em',
            background: 'var(--accent)', border: 'none', color: '#fff',
          }}
        >
          Test alert
        </button>
      </div>
    </motion.div>
  )
}
