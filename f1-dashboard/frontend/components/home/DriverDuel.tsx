'use client'

import { useState, type CSSProperties } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeftRight, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Standings } from '@/lib/types'
import { buildDuelSeries, defaultDuelDrivers } from '@/lib/driverDuel'
import { hexColor } from '@/lib/utils'
import { TEAM_COLORS } from '@/lib/constants'
import styles from './DriverDuel.module.css'

export default function DriverDuel({ standings }: { standings?: Standings }) {
  const [selection, setSelection] = useState<[string, string] | null>(null)
  const [roundIndex, setRoundIndex] = useState<number | null>(null)
  const reduced = useReducedMotion()
  const drivers = standings?.drivers ?? []
  const defaults = defaultDuelDrivers(drivers)
  const first = drivers.find(d => d.abbreviation === selection?.[0]) ?? defaults[0]
  const second = drivers.find(d => d.abbreviation === selection?.[1] && d !== first) ?? drivers.find(d => d !== first)
  if (!first || !second) return null
  const series = buildDuelSeries(first, second, standings?.rounds)
  if (!series.length) return null
  const index = Math.min(roundIndex ?? series.length - 1, series.length - 1)
  const selected = series[index]
  const colors = [first, second].map(d => hexColor(d.team_color) || TEAM_COLORS[d.team] || 'var(--muted)')
  const maximum = Math.max(1, ...series.flatMap(r => [r.firstPoints, r.secondPoints]))
  const x = (i: number) => 48 + (i + 1) / series.length * 664
  const y = (value: number) => 245 - value / maximum * 210
  const path = (field: 'firstPoints' | 'secondPoints') => `M48,245 ${series.map((r, i) => `L${x(i)},${y(r[field])}`).join(' ')}`
  const gap = selected.firstPoints - selected.secondPoints
  const change = (side: number, value: string) => {
    const pair: [string, string] = [first.abbreviation, second.abbreviation]
    if (pair[1 - side] === value) pair[1 - side] = pair[side]
    pair[side] = value
    setSelection(pair)
  }
  return <section className={`glass-card ${styles.duel}`} aria-labelledby="duel-title">
    <header className={styles.header}><div className={styles.titleLockup}><h2 id="duel-title">Head to head</h2><p>Two drivers. One season. Follow how the points gap changes, round by round.</p></div><div className={styles.roundStamp}><strong className="font-num">{series.length}</strong><span>scored rounds</span></div></header>
    <div className={styles.content}><div className={styles.chartColumn}>
      <div className={styles.controls}>
        {[first, second].map((driver, side) => <label key={side} className={styles.driverField} style={{ '--driver-color': colors[side], gridColumn: side ? 3 : 1, gridRow: 1 } as CSSProperties}><span>Driver {side + 1}</span><div className={styles.selectWrap}><i className={styles.colorMark} style={{ background: colors[side] }} /><select aria-label={`Compare driver ${side + 1}`} className={styles.select} value={driver.abbreviation} onChange={e => change(side, e.target.value)}>{drivers.map(d => <option key={d.abbreviation} value={d.abbreviation}>{d.name}</option>)}</select></div></label>)}
        <button className={styles.swap} style={{ gridColumn: 2, gridRow: 1 }} aria-label="Swap compared drivers" onClick={() => setSelection([second.abbreviation, first.abbreviation])}><ArrowLeftRight size={18} /></button>
      </div>
      <div className={styles.chartHead}><h3>Cumulative points</h3><div className={styles.legend}>{[first, second].map((d, i) => <span key={d.abbreviation} className={styles.legendItem}><i style={{ background: 'none', borderTop: `2px ${i ? 'dashed' : 'solid'} ${colors[i]}` }} />{d.abbreviation}</span>)}</div></div>
      <div className={styles.chartArea}><svg viewBox="0 0 740 285" className={styles.chartSvg} role="img" aria-label={`Cumulative championship points for ${first.name} and ${second.name}. Use the round slider for exact values.`}>
        {[0, .5, 1].map(tick => <g key={tick}><line x1="48" x2="712" y1={y(maximum * tick)} y2={y(maximum * tick)} className={styles.gridLine} /><text x="38" y={y(maximum * tick) + 4} textAnchor="end" className={styles.axisText}>{Math.round(maximum * tick)}</text></g>)}
        {(['firstPoints', 'secondPoints'] as const).map((field, side) => <motion.path key={`${side}-${first.abbreviation}-${second.abbreviation}`} d={path(field)} fill="none" stroke={colors[side]} strokeWidth={3} strokeDasharray={side ? '8 5' : undefined} initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : .4 }} />)}
        <line x1={x(index)} x2={x(index)} y1="24" y2="245" className={styles.activeLine} />
        {[selected.firstPoints, selected.secondPoints].map((points, i) => <circle key={i} cx={x(index)} cy={y(points)} r={6} fill={colors[i]} stroke="var(--card)" strokeWidth="2" />)}
        {series.map((r, i) => (i === 0 || i === series.length - 1 || i === index) && <text key={r.round} x={x(i)} y="271" textAnchor="middle" className={styles.roundText}>R{r.round}</text>)}
      </svg></div>
      <div className={styles.focusControls}><button className={styles.stepButton} aria-label="Previous round" disabled={index === 0} onClick={() => setRoundIndex(index - 1)}><ChevronLeft size={17} /></button><label style={{ flex: 1 }}>Explore a round<input className={styles.range} type="range" aria-label="Comparison round" aria-valuetext={`Round ${selected.round}: ${selected.name}`} min={0} max={series.length - 1} value={index} disabled={series.length === 1} onChange={e => setRoundIndex(Number(e.target.value))} /></label><button className={styles.stepButton} aria-label="Next round" disabled={index === series.length - 1} onClick={() => setRoundIndex(index + 1)}><ChevronRight size={17} /></button></div>
    </div>
    <div className={styles.rail}><div className={styles.railHeading}><h3>{selected.name}</h3><span>After round {selected.round}{selected.isSprint ? ' · includes sprint' : ''}</span></div>
      <div className={styles.scoreline}>{[first, second].map((driver, i) => <div className={styles.score} key={driver.abbreviation}><span>{driver.abbreviation}</span><motion.strong key={`${driver.abbreviation}-${index}`} className="font-num" style={{ color: colors[i] }} initial={{ opacity: reduced ? 1 : .4 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : .2 }}>{i ? selected.secondPoints : selected.firstPoints}</motion.strong></div>)}</div>
      <div className={styles.gapPanel} aria-live="polite"><span>{gap === 0 ? 'Level on points' : `${gap > 0 ? first.name : second.name} leads`}</span><strong className="font-num">{Math.abs(gap)} <small>points</small></strong></div>
      <table className={styles.metrics}><caption style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 12, paddingBottom: 12 }}>Season totals</caption><thead><tr><th scope="col">Metric</th><th scope="col">{first.abbreviation}</th><th scope="col">{second.abbreviation}</th></tr></thead><tbody>{(['points','wins','podiums'] as const).map(metric => <tr key={metric}><th scope="row">{metric[0].toUpperCase() + metric.slice(1)}</th><td>{first[metric]}</td><td>{second[metric]}</td></tr>)}</tbody></table><p className={styles.railNote}>Chart totals include race and sprint points from completed rounds. Missing round entries count as no recorded points.</p>
    </div></div>
  </section>
}
