'use client'

/**
 * Live timing engine — auto-detects the latest OpenF1 session and polls it
 * efficiently. The previous implementation fetched the FULL position and
 * interval history on every poll (several MB late in a race, which timed out
 * and left the page empty). This one takes an initial snapshot, then only
 * fetches rows newer than a short lookback window and merges them into maps.
 */

import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react'
import { BACKEND_URL, OPENF1_URL } from './constants'

// Share the single resolver in lib/constants so the live bridge follows the
// same localhost-vs-same-origin rule as every other fetch in the app.
const OPENF1 = OPENF1_URL
const BACKEND = BACKEND_URL
// Team radio clips are served straight off F1's static host, not our backend.
const F1_STATIC_BASE = 'https://livetiming.formula1.com/static'

const FAST_POLL = 4000   // positions + intervals
const SLOW_POLL = 15000  // laps, stints, race control, weather
const F1_POLL = 4000     // backend livetiming bridge
const MODE_CHECK_POLL = 30000 // re-check "is a session live?" to start/stop the loops

/** How far back to ask OpenF1 for car positions. Wide enough to always contain
 *  a sample (they arrive ~4/s per car), narrow enough to stay one small page. */
const OPENF1_POS_LOOKBACK_MS = 8000
/** Never re-ask OpenF1 for positions faster than this, whatever the caller does. */
const OPENF1_POS_MIN_GAP_MS = 4000

let openF1PosLastTry = 0
let openF1PosBackoffUntil = 0

export interface OpenF1LocationRow {
  driver_number: number
  x: number
  y: number
  date: string
}

/**
 * Newest usable fix per driver from a window of OpenF1 `location` rows.
 *
 * Pure and exported because the interesting cases can't be summoned on demand:
 * the endpoint returns a *time window* containing many samples per car in no
 * guaranteed order, and cars with no fix report a literal (0,0) that would park
 * them all in the same corner of the map. See `scripts/car-positions.test.mjs`,
 * which runs this against a real captured Zandvoort window.
 */
export function selectLatestPositions(
  rows: OpenF1LocationRow[],
): Record<string, { X: number; Y: number }> {
  const latest = new Map<number, { X: number; Y: number; at: number }>()
  ;(Array.isArray(rows) ? rows : []).forEach(r => {
    // `Number(null)` is 0, not NaN — so a null coordinate would survive the
    // finite check and then survive the (0,0) check too if the other axis had
    // a value, planting the car on the pit straight. Reject the empties first.
    if (r?.x == null || r?.y == null) return
    const x = Number(r.x), y = Number(r.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    // (0,0) is OpenF1's "no fix", not a point on the pit straight.
    if (x === 0 && y === 0) return
    const at = Date.parse(r.date)
    if (!Number.isFinite(at)) return
    const prev = latest.get(r.driver_number)
    if (!prev || at > prev.at) latest.set(r.driver_number, { X: x, Y: y, at })
  })
  const out: Record<string, { X: number; Y: number }> = {}
  latest.forEach((v, num) => { out[String(num)] = { X: v.X, Y: v.Y } })
  return out
}

/**
 * Latest car x/y per driver, from OpenF1's `location` endpoint, shaped exactly
 * like the F1 bridge's `Position` feed so it can be dropped in unchanged.
 *
 * This exists because the track-map dots never appeared. The chain in front of
 * them is fine — `mapF1Feeds` reads `feeds.Position`, `pos` flows to `TowerRow`,
 * `CircuitMap` projects it — but the bridge's `Position` feed is empty. The
 * captured fixture shows all six snapshots with `connected: true`, no error,
 * every other feed populated, and `Position: null`. Backend diagnostics now
 * record whether those frames arrive at all (see `/state` → `diag`), but the
 * dots should not wait on that answer.
 *
 * The comment this replaces claimed "OpenF1 carries no car x/y". It does:
 * `/location` returns `{x, y, z}` per driver, **in the same coordinate space as
 * the track outline** — verified against Zandvoort, whose geometry spans
 * x −1015..8701 / y −1606..6702 with the start line at [595, 3990], while
 * OpenF1 puts car 1 at (305, 3264) at session start. No transform is needed;
 * the map's existing rotate + project handles it.
 *
 * One request covers every car (20 drivers, ~18 KB, ~0.8s measured) — asking
 * per-driver would be 20 requests a tick, which is exactly the pattern that
 * earned this app an OpenF1 429 before.
 */
async function fetchOpenF1CarPositions(
  sessionKey: string | number = 'latest',
): Promise<Record<string, { X: number; Y: number }>> {
  const now = Date.now()
  if (now < openF1PosBackoffUntil || now - openF1PosLastTry < OPENF1_POS_MIN_GAP_MS) return {}
  openF1PosLastTry = now
  try {
    const since = new Date(now - OPENF1_POS_LOOKBACK_MS).toISOString()
    // `>` must be percent-encoded — OpenF1's comparison operators are part of
    // the parameter name, not the value.
    const res = await fetch(
      `${OPENF1}/location?session_key=${sessionKey}&date%3E${since}`,
      { cache: 'no-store' },
    )
    if (!res.ok) {
      // 401 during a live session is the documented OpenF1 behaviour that the
      // F1 bridge exists to work around; back off rather than retry into it.
      openF1PosBackoffUntil = Date.now() + (res.status === 429 || res.status === 401 ? 60_000 : 15_000)
      return {}
    }
    return selectLatestPositions(await res.json())
  } catch {
    openF1PosBackoffUntil = Date.now() + 15_000
    return {}
  }
}

/** Does a `Position` feed actually carry a usable fix for anyone? */
function hasCarPositions(feed: unknown): boolean {
  if (!feed || typeof feed !== 'object') return false
  return Object.values(feed as Record<string, any>).some(
    e => Number.isFinite(Number(e?.X)) && Number.isFinite(Number(e?.Y)),
  )
}

/**
 * Coarse track regime from the newest race-control messages, in the vocabulary
 * `lib/alerts.ts` `trackRegime()` understands. OpenF1 exposes no TrackStatus
 * feed, so without this the SC/VSC/red-flag alert rules can never fire on it.
 * `raceControl` is newest-first.
 */
function regimeFromRaceControl(raceControl: { message?: string; flag?: string | null }[]): string {
  for (const m of raceControl) {
    const msg = (m?.message || '').toUpperCase()
    const flag = (m?.flag || '').toUpperCase()
    if (flag === 'RED' || msg.includes('RED FLAG')) return 'Red'
    if (msg.includes('VSC') || msg.includes('VIRTUAL SAFETY CAR')) {
      return msg.includes('DEPLOYED') ? 'VSCDeployed' : 'AllClear'
    }
    if (msg.includes('SAFETY CAR')) {
      return msg.includes('DEPLOYED') ? 'SCDeployed' : 'AllClear'
    }
    if (flag === 'CHEQUERED' || flag === 'CLEAR' || flag === 'GREEN') return 'AllClear'
    if (flag === 'YELLOW' || flag === 'DOUBLE YELLOW') return 'Yellow'
  }
  return ''
}
const LOOKBACK_MS = 3 * 60 * 1000

export interface LiveSessionMeta {
  session_key: number
  meeting_key: number
  session_name: string
  session_type: string
  date_start: string
  date_end: string
  circuit_short_name: string
  country_name: string
  year: number
}

export interface LiveDriverInfo {
  driver_number: number
  name_acronym: string
  full_name: string
  broadcast_name: string
  team_name: string
  team_colour: string
  headshot_url: string | null
}

export interface LiveLap {
  driver_number: number
  lap_number: number
  lap_duration: number | null
  duration_sector_1: number | null
  duration_sector_2: number | null
  duration_sector_3: number | null
  is_pit_out_lap: boolean
  st_speed: number | null
  date_start: string | null
}

export interface LiveStint {
  driver_number: number
  stint_number: number
  lap_start: number
  lap_end: number
  compound: string
  tyre_age_at_start: number
}

export interface LiveRaceControl {
  date: string
  category: string
  flag: string | null
  message: string
  scope: string | null
  lap_number: number | null
  driver_number: number | null
  /** Marshal sector this message applies to (F1 feed only; null for OpenF1). */
  sector: number | null
}

export interface LiveWeather {
  air_temperature: number | null
  track_temperature: number | null
  humidity: number | null
  rainfall: number | null
  wind_speed: number | null
  /** degrees; meteorological "from" bearing. F1 feed + OpenF1 both supply it. */
  wind_direction: number | null
}

export interface TowerSector {
  value: string | null
  /** The sector time before this one — shown dimmed under the live value. */
  previous: string | null
  color: 'purple' | 'green' | 'yellow'
}

/**
 * Mini-sector state. F1's timing feed splits each sector into segments (8 per
 * sector at Zandvoort, 24 for the lap) and sends a status code per segment as
 * the car passes it. This is the segmented bar on the broadcast timing screen.
 *
 * Codes observed live: 0 not yet timed, 2048 yellow, 2049 green (personal
 * best), 2051 purple (session best), 2064 pit lane. Anything else non-zero is
 * a timed segment we don't have a specific colour for, so it reads as yellow
 * rather than vanishing.
 *
 * OpenF1 has no equivalent, so this is empty on that source and the UI must
 * fall back to plain sector times.
 */
export type MiniSectorState = 'none' | 'yellow' | 'green' | 'purple' | 'pit'

export interface SpeedTrap {
  /** I1/I2 = intermediate points, FL = finish line, ST = speed trap */
  key: 'I1' | 'I2' | 'FL' | 'ST'
  value: number | null
  color: 'purple' | 'green' | 'yellow'
}

/**
 * Qualifying segment state, straight from `TimingData`.
 *
 * `NoEntries` is the number of cars that survive each segment — at Zandvoort
 * 2026 sprint qualifying it read `{0: 22, 1: 16, 2: 10}`, i.e. 22 start, 16
 * come out of SQ1, 10 out of SQ2. `SessionPart` is the segment now running.
 */
export interface QualifyingState {
  /** 1, 2 or 3 — the segment currently running. */
  part: number
  /** Cars advancing out of each segment, index 0 = entry count. */
  entries: number[]
  /** Slowest time still safe, as the feed formats it. */
  cutOffTime: string | null
  /** Positions at which the cut falls, e.g. [16, 10] — used to draw the lines. */
  cutPositions: number[]
}

export interface TeamRadioClip {
  driverNumber: number
  /** Absolute, playable mp3 URL */
  url: string
  date: string
}

/**
 * One tyre stint.
 *
 * The feed's field names are a trap. `TotalLaps` is the tyre's **cumulative
 * age**, already including any laps it had before this stint, and `StartLaps`
 * is the age it started at. So the laps actually run in the stint are
 * `TotalLaps - StartLaps`, and the age is `TotalLaps` on its own — adding the
 * two together double-counts a used set. That's what put "24L" against a car
 * on lap 16.
 */
export interface LiveStintRow {
  compound: string | null
  isNew: boolean
  /** Laps run **in this stint**. */
  laps: number
  /** Tyre age at the end of the stint, including use before it. */
  tyreAge: number
  /** Age the tyre started the stint at — non-zero only for a used set. */
  startAge: number
  /** Lap the stint began on, when the feed reports it */
  lapNumber: number | null
}

const SEGMENT_STATUS: Record<number, MiniSectorState> = {
  0: 'none',
  2048: 'yellow',
  2049: 'green',
  2051: 'purple',
  2064: 'pit',
}

export function miniSectorState(code: unknown): MiniSectorState {
  const n = Number(code)
  if (!Number.isFinite(n) || n === 0) return 'none'
  return SEGMENT_STATUS[n] ?? 'yellow'
}

export interface TowerRow {
  driver: LiveDriverInfo
  position: number | null
  prevPosition: number | null
  gapToLeader: number | string | null
  interval: number | string | null
  lastLap: LiveLap | null
  bestLapDuration: number | null
  isOverallBestLap: boolean
  /** Last-lap sectors S1–S3: purple = session best, green = personal best */
  sectors: TowerSector[]
  /** Per-sector mini-sector states, [[S1…], [S2…], [S3…]]. Empty on OpenF1. */
  miniSectors: MiniSectorState[][]
  /** Speed-trap readings. Empty on OpenF1. */
  speeds: SpeedTrap[]
  /** Every stint this session — drives the Stints view. Empty on OpenF1. */
  stints: LiveStintRow[]
  /** Qualifying only: eliminated in an earlier segment. F1 source only. */
  knockedOut: boolean
  /** Qualifying only: currently below the cut line. F1 source only. */
  cutoff: boolean
  /** Raw livetiming x/y car position (F1 source only) — for the track map */
  pos: { x: number; y: number } | null
  compound: string | null
  /** Total laps on the current set, including any before this stint. */
  tyreAge: number | null
  /** Laps the set already had when fitted — 0 for a new set. */
  tyreStartAge: number | null
  pitStops: number
  lapsDone: number
}

export type LiveStatus = 'loading' | 'live' | 'ended' | 'upcoming' | 'error'
export type LiveSource = 'openf1' | 'f1'

interface EngineState {
  status: LiveStatus
  source: LiveSource
  session: LiveSessionMeta | null
  rows: TowerRow[]
  raceControl: LiveRaceControl[]
  weather: LiveWeather | null
  currentLap: number
  /** '' | 'AllClear' | 'Yellow' | 'SCDeployed' | 'Red' | 'VSCDeployed' … */
  trackStatus: string
  /** Driver radio clips, newest first. F1 source only. */
  teamRadio: TeamRadioClip[]
  /** Qualifying segmentation, null outside a qualifying session. */
  qualifying: QualifyingState | null
  lastUpdate: Date | null
  /** Broadcast delay applied to this snapshot, ms. 0 = live. */
  delayMs?: number
  /** True while the delay buffer is still filling — data is withheld, not missing. */
  delayBuffering?: boolean
}

// OpenF1's free tier rate-limits aggressively; parallel bursts get 429s
// (this is what killed live data on race day). All requests go through a
// serial queue with a minimum gap, retrying once on 429.
const MIN_GAP_MS = 350
let queueTail: Promise<unknown> = Promise.resolve()

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function rawGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  // OpenF1 quirk: an empty result set comes back as 404 "No results found"
  if (res.status === 404) return [] as unknown as T
  if (res.status === 429) {
    await sleep(1800)
    const retry = await fetch(url, { cache: 'no-store' })
    if (!retry.ok) throw new Error(`429 retry failed: ${retry.status}`)
    return retry.json()
  }
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${OPENF1}/${path}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const run = queueTail.then(
    () => rawGet<T>(url.toString()),
    () => rawGet<T>(url.toString()),
  )
  queueTail = run.then(() => sleep(MIN_GAP_MS), () => sleep(MIN_GAP_MS))
  return run
}

function lookbackISO(from = Date.now()) {
  return new Date(from - LOOKBACK_MS).toISOString()
}

/** Is `now` within the session window (with generous padding — races overrun). */
export function sessionIsLive(s: LiveSessionMeta, now = Date.now()) {
  const start = new Date(s.date_start).getTime() - 10 * 60 * 1000
  const end = new Date(s.date_end).getTime() + 30 * 60 * 1000
  return now >= start && now <= end
}

// ---------------------------------------------------------------------------
// F1 official live timing fallback.
// OpenF1's free tier returns 401 for everything WHILE a session is live, so
// during sessions we poll our backend's SignalR bridge (/api/livetiming)
// which relays Formula 1's own feed. Field shapes differ, hence the mapping.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

interface F1SessionInfo {
  meeting: string | null
  country: string | null
  circuit: string | null
  session_name: string | null
  session_type: string | null
  date_start_utc: string | null
  date_end_utc: string | null
  archive_status: string | null
  error?: string
}

/** "1:33.026" | "33.026" | "" → seconds */
function parseLapStr(v: string | null | undefined): number | null {
  if (!v) return null
  const parts = v.split(':').map(Number)
  if (parts.some(Number.isNaN)) return null
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0]
}

function f1MetaToSession(info: F1SessionInfo): LiveSessionMeta {
  return {
    session_key: 0,
    meeting_key: 0,
    session_name: info.session_name || 'Session',
    session_type: info.session_type || '',
    date_start: info.date_start_utc || new Date().toISOString(),
    date_end: info.date_end_utc || new Date().toISOString(),
    circuit_short_name: info.circuit || '',
    country_name: info.country || info.meeting || '',
    year: info.date_start_utc ? new Date(info.date_start_utc).getFullYear() : new Date().getFullYear(),
  }
}

/** Highest-index entry of a normalized index-keyed dict ({"0": ..., "1": ...}). */
function lastIndexed(obj: any): any {
  if (!obj || typeof obj !== 'object') return null
  const keys = Object.keys(obj).filter(k => /^\d+$/.test(k))
  if (!keys.length) return null
  return obj[String(Math.max(...keys.map(Number)))]
}

function indexedValues(obj: any): any[] {
  if (!obj || typeof obj !== 'object') return []
  return Object.keys(obj)
    .filter(k => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))
    .map(k => obj[k])
}

function mapF1Feeds(feeds: any): {
  rows: TowerRow[]
  raceControl: LiveRaceControl[]
  weather: LiveWeather | null
  currentLap: number
  trackStatus: string
  status: LiveStatus
  teamRadio: TeamRadioClip[]
  qualifying: QualifyingState | null
} {
  const driverList = feeds?.DriverList || {}
  const lines = feeds?.TimingData?.Lines || {}
  const appLines = feeds?.TimingAppData?.Lines || {}
  const positions = feeds?.Position || {}

  let overallBest: number | null = null
  Object.values(lines).forEach((l: any) => {
    const best = parseLapStr(l?.BestLapTime?.Value)
    if (best != null && (overallBest === null || best < overallBest)) overallBest = best
  })

  let currentLap = Number(feeds?.LapCount?.CurrentLap) || 0
  const rows: TowerRow[] = Object.keys(driverList)
    .filter(k => /^\d+$/.test(k))
    .map(num => {
      const d = driverList[num] || {}
      const line: any = lines[num] || {}
      const stints = indexedValues(appLines[num]?.Stints)
      const curStint = stints.length ? stints[stints.length - 1] : null

      const lapsDone = Number(line.NumberOfLaps) || 0
      currentLap = Math.max(currentLap, lapsDone)

      // Race sessions carry GapToLeader / IntervalToPositionAhead;
      // practice & quali carry TimeDiffToFastest / TimeDiffToPositionAhead.
      // Any of them may arrive plain OR wrapped as {Value: "..."} depending on
      // session type — unwrap, never let an object through to the tower.
      const gapVal = (v: any): number | string | null => {
        if (v == null || v === '') return null
        if (typeof v === 'string' || typeof v === 'number') return v
        if (typeof v === 'object' && v.Value != null) return gapVal(v.Value)
        return null
      }
      let gap: number | string | null =
        gapVal(line.GapToLeader) ?? gapVal(line.TimeDiffToFastest) ??
        gapVal(line.Stats ? lastIndexed(line.Stats)?.TimeDiffToFastest : null)
      let interval: number | string | null =
        gapVal(line.IntervalToPositionAhead) ?? gapVal(line.TimeDiffToPositionAhead) ??
        gapVal(line.Stats ? lastIndexed(line.Stats)?.TimeDifftoPositionAhead : null)
      const position = line.Position ? Number(line.Position) : null
      if (position === 1 && !gap) gap = 'LEADER'
      if (line.Retired || line.Stopped) { gap = 'OUT'; interval = null }
      else if (line.KnockedOut) { gap = 'OUT'; interval = null }
      else if (line.InPit) interval = 'IN PIT'
      else if (line.PitOut) interval = 'OUT LAP'

      const lastLapS = parseLapStr(line.LastLapTime?.Value)
      const bestLapS = parseLapStr(line.BestLapTime?.Value)

      const posEntry = positions[num]
      const pos =
        posEntry && Number.isFinite(Number(posEntry.X)) && Number.isFinite(Number(posEntry.Y))
          ? { x: Number(posEntry.X), y: Number(posEntry.Y) }
          : null

      const sectorArr = indexedValues(line.Sectors).slice(0, 3)
      const sectors: TowerSector[] = [0, 1, 2].map(i => {
        const sec: any = sectorArr[i] || {}
        return {
          value: sec.Value || null,
          previous: sec.PreviousValue || null,
          color: sec.OverallFastest ? 'purple' : sec.PersonalFastest ? 'green' : 'yellow',
        }
      })

      // Segments arrive as an index-keyed object per sector, in track order.
      const miniSectors: MiniSectorState[][] = [0, 1, 2].map(i =>
        indexedValues((sectorArr[i] as any)?.Segments).map((seg: any) => miniSectorState(seg?.Status)),
      )

      const speeds: SpeedTrap[] = (['I1', 'I2', 'FL', 'ST'] as const)
        .map(key => {
          const sp: any = line.Speeds?.[key]
          if (!sp) return null
          const raw = Number(sp.Value)
          return {
            key,
            value: Number.isFinite(raw) && sp.Value !== '' ? raw : null,
            color: sp.OverallFastest ? 'purple' : sp.PersonalFastest ? 'green' : 'yellow',
          } as SpeedTrap
        })
        .filter((x): x is SpeedTrap => x !== null)

      const stintRows: LiveStintRow[] = stints.map((st: any) => {
        const age = Number(st?.TotalLaps) || 0
        const startAge = Number(st?.StartLaps) || 0
        return {
          compound: st?.Compound || null,
          // The feed sends these as the strings "true"/"false", not booleans.
          isNew: String(st?.New).toLowerCase() === 'true',
          // Age minus the age it started at — never the two added together.
          laps: Math.max(0, age - startAge),
          tyreAge: age,
          startAge,
          lapNumber: st?.LapNumber != null ? Number(st.LapNumber) : null,
        }
      })

      return {
        driver: {
          driver_number: Number(num),
          name_acronym: d.Tla || `#${num}`,
          full_name: d.FullName || '',
          broadcast_name: d.BroadcastName || '',
          team_name: d.TeamName || '',
          team_colour: d.TeamColour || '',
          headshot_url: d.HeadshotUrl || null,
        },
        position,
        prevPosition: null,
        gapToLeader: gap,
        interval,
        lastLap: lastLapS != null
          ? {
              driver_number: Number(num), lap_number: lapsDone, lap_duration: lastLapS,
              duration_sector_1: null, duration_sector_2: null, duration_sector_3: null,
              is_pit_out_lap: !!line.PitOut, st_speed: null, date_start: null,
            }
          : null,
        bestLapDuration: bestLapS,
        isOverallBestLap: bestLapS != null && overallBest !== null && bestLapS === overallBest,
        sectors,
        miniSectors,
        speeds,
        stints: stintRows,
        knockedOut: !!line.KnockedOut,
        cutoff: !!line.Cutoff,
        pos,
        compound: curStint?.Compound || null,
        // TotalLaps is already the cumulative age; adding StartLaps double-counts.
        tyreAge: curStint ? (Number(curStint.TotalLaps) || 0) : null,
        tyreStartAge: curStint ? (Number(curStint.StartLaps) || 0) : null,
        pitStops: Number(line.NumberOfPitStops) || Math.max(0, stints.length - 1),
        lapsDone,
      }
    })

  rows.sort((a, b) => (a.position ?? 99) - (b.position ?? 99))

  const raceControl: LiveRaceControl[] = indexedValues(feeds?.RaceControlMessages?.Messages)
    .map((m: any) => ({
      // F1's Utc strings lack the Z suffix — without it they'd parse as local time
      date: m?.Utc ? (String(m.Utc).endsWith('Z') ? m.Utc : `${m.Utc}Z`) : '',
      category: m?.Category || '',
      flag: m?.Flag || null,
      message: m?.Message || '',
      scope: m?.Scope || null,
      lap_number: m?.Lap != null ? Number(m.Lap) : null,
      driver_number: null,
      // F1's yellow-flag messages carry the marshal Sector they apply to.
      sector: m?.Sector != null ? Number(m.Sector) : null,
    }))
    .slice(-40)
    .reverse()

  const w = feeds?.WeatherData
  const weather: LiveWeather | null = w
    ? {
        air_temperature: w.AirTemp != null ? parseFloat(w.AirTemp) : null,
        track_temperature: w.TrackTemp != null ? parseFloat(w.TrackTemp) : null,
        humidity: w.Humidity != null ? parseFloat(w.Humidity) : null,
        rainfall: w.Rainfall != null ? parseFloat(w.Rainfall) : null,
        wind_speed: w.WindSpeed != null ? parseFloat(w.WindSpeed) : null,
        wind_direction: w.WindDirection != null ? parseFloat(w.WindDirection) : null,
      }
    : null

  const sessionStatus = String(feeds?.SessionStatus?.Status || '')
  const status: LiveStatus = ['Finished', 'Finalised', 'Ends'].includes(sessionStatus)
    ? 'ended'
    : rows.length
      ? 'live'
      : 'loading'

  const trackStatus = String(feeds?.TrackStatus?.Message || '')

  // Radio captures carry a Path relative to the session's static folder, so
  // the playable URL only exists once SessionInfo.Path has arrived.
  const sessionPath = String(feeds?.SessionInfo?.Path || '')
  const teamRadio: TeamRadioClip[] = sessionPath
    ? indexedValues(feeds?.TeamRadio?.Captures)
        .map((c: any) => ({
          driverNumber: Number(c?.RacingNumber) || 0,
          url: `${F1_STATIC_BASE}/${sessionPath}${c?.Path || ''}`,
          date: String(c?.Utc || ''),
        }))
        .filter(c => c.driverNumber > 0 && !!c.url)
        .slice(-25)
        .reverse()
    : []

  // Qualifying segmentation. SessionPart is only present on qualifying-type
  // sessions, so its absence is what tells us this isn't one.
  const td: any = feeds?.TimingData || {}
  const part = Number(td.SessionPart)
  let qualifying: QualifyingState | null = null
  if (Number.isFinite(part) && part > 0) {
    const entries = indexedValues(td.NoEntries).map((n: any) => Number(n) || 0)
    // entries[0] is the entry count; entries[1..] are how many survive each
    // segment, which is exactly where each cut line sits.
    qualifying = {
      part,
      entries,
      cutOffTime: td.CutOffTime || null,
      cutPositions: entries.slice(1).filter(n => n > 0),
    }
  }

  return { rows, raceControl, weather, currentLap, trackStatus, status, teamRadio, qualifying }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

function useLiveSessionRaw(): EngineState {
  const [state, setState] = useState<EngineState>({
    status: 'loading', source: 'openf1', session: null, rows: [], raceControl: [],
    weather: null, currentLap: 0, trackStatus: '', lastUpdate: null, teamRadio: [],
    qualifying: null,
  })

  // Mutable stores merged across polls (avoids re-fetching history)
  const store = useRef({
    drivers: new Map<number, LiveDriverInfo>(),
    positions: new Map<number, number>(),
    prevPositions: new Map<number, number>(),
    startPositions: new Map<number, number>(),
    gaps: new Map<number, { gap: number | string | null; interval: number | string | null }>(),
    laps: new Map<string, LiveLap>(), // key: driver-lap
    stints: new Map<number, LiveStint[]>(),
    raceControl: [] as LiveRaceControl[],
    weather: null as LiveWeather | null,
    session: null as LiveSessionMeta | null,
    // Car x/y from OUR backend bridge — OpenF1 has no positions, so the map
    // dots come from here even when the tower runs on the OpenF1 source.
    carXY: new Map<number, { x: number; y: number }>(),
  })

  const rebuild = useCallback((status: LiveStatus) => {
    const s = store.current
    const lapsByDriver = new Map<number, LiveLap[]>()
    s.laps.forEach(lap => {
      const arr = lapsByDriver.get(lap.driver_number) || []
      arr.push(lap)
      lapsByDriver.set(lap.driver_number, arr)
    })

    let overallBest: { driver: number; t: number } | null = null
    lapsByDriver.forEach((laps, d) => {
      laps.forEach(l => {
        if (l.lap_duration && (!overallBest || l.lap_duration < overallBest.t)) {
          overallBest = { driver: d, t: l.lap_duration }
        }
      })
    })

    // Session-best sector times (purple thresholds), across all drivers
    const overallSector: (number | null)[] = [null, null, null]
    lapsByDriver.forEach(laps => {
      laps.forEach(l => {
        ;[l.duration_sector_1, l.duration_sector_2, l.duration_sector_3].forEach((v, i) => {
          if (v != null && (overallSector[i] === null || v < (overallSector[i] as number))) overallSector[i] = v
        })
      })
    })

    let currentLap = 0
    const rows: TowerRow[] = Array.from(s.drivers.values()).map(driver => {
      const laps = (lapsByDriver.get(driver.driver_number) || []).sort((a, b) => a.lap_number - b.lap_number)
      const completed = laps.filter(l => l.lap_duration != null)
      const lastLap = completed.length ? completed[completed.length - 1] : null

      const personalSector: (number | null)[] = [null, null, null]
      laps.forEach(l => {
        ;[l.duration_sector_1, l.duration_sector_2, l.duration_sector_3].forEach((v, i) => {
          if (v != null && (personalSector[i] === null || v < (personalSector[i] as number))) personalSector[i] = v
        })
      })
      const lastSectors = lastLap
        ? [lastLap.duration_sector_1, lastLap.duration_sector_2, lastLap.duration_sector_3]
        : [null, null, null]
      const sectors: TowerSector[] = lastSectors.map((v, i) => ({
        value: v != null ? v.toFixed(3) : null,
        // OpenF1 gives one sector time per lap, so there's no prior value to dim.
        previous: null,
        color: v != null && v === overallSector[i] ? 'purple' : v != null && v === personalSector[i] ? 'green' : 'yellow',
      }))
      const bestLap = completed.reduce<number | null>((best, l) =>
        l.lap_duration != null && (best === null || l.lap_duration < best) ? l.lap_duration : best, null)
      const lapsDone = laps.length ? laps[laps.length - 1].lap_number : 0
      currentLap = Math.max(currentLap, lapsDone)

      const stints = (s.stints.get(driver.driver_number) || []).sort((a, b) => a.stint_number - b.stint_number)
      const curStint = stints[stints.length - 1] || null
      const tyreAge = curStint ? curStint.tyre_age_at_start + Math.max(0, lapsDone - curStint.lap_start) : null

      const g = s.gaps.get(driver.driver_number)
      return {
        driver,
        position: s.positions.get(driver.driver_number) ?? null,
        prevPosition: s.prevPositions.get(driver.driver_number) ?? null,
        gapToLeader: g?.gap ?? null,
        interval: g?.interval ?? null,
        lastLap,
        bestLapDuration: bestLap,
        isOverallBestLap: !!overallBest && overallBest.driver === driver.driver_number && bestLap === overallBest.t,
        sectors,
        // OpenF1 carries no segment or speed-trap data — the UI degrades to
        // plain sector times when these are empty. Stints it does have.
        miniSectors: [],
        speeds: [],
        stints: stints.map(st => {
          const ran = Math.max(0, (st.lap_end ?? 0) - (st.lap_start ?? 0) + 1)
          const startAge = st.tyre_age_at_start ?? 0
          return {
            compound: st.compound ?? null,
            isNew: startAge === 0,
            laps: ran,
            tyreAge: startAge + ran,
            startAge,
            lapNumber: st.lap_start ?? null,
          }
        }),
        knockedOut: false,
        cutoff: false,
        pos: s.carXY.get(driver.driver_number) ?? null,
        compound: curStint?.compound ?? null,
        tyreAge,
        tyreStartAge: curStint?.tyre_age_at_start ?? null,
        pitStops: Math.max(0, stints.length - 1),
        lapsDone,
      }
    })

    rows.sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
    const recentRc = s.raceControl.slice(-40).reverse()
    setState({
      status,
      source: 'openf1',
      session: s.session,
      rows,
      raceControl: recentRc,
      weather: s.weather,
      currentLap,
      // OpenF1 has no TrackStatus feed, but this used to be hardcoded '' —
      // which made the safety-car / VSC / red-flag alert rules structurally
      // unreachable on this source. Derive a coarse regime from race control.
      trackStatus: regimeFromRaceControl(recentRc),
      // OpenF1 has no radio feed; the panel hides itself when this is empty.
      teamRadio: [],
      qualifying: null,
      lastUpdate: new Date(),
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    let fastTimer: ReturnType<typeof setInterval> | null = null
    let slowTimer: ReturnType<typeof setInterval> | null = null
    let bridgePosTimer: ReturnType<typeof setInterval> | null = null
    let modeTimer: ReturnType<typeof setInterval> | null = null
    const s = store.current

    const pollFast = async (initial = false, live = true) => {
      const sess = s.session
      if (!sess) return
      try {
        if (!live) {
          // Ended session: the official classification is one tiny payload.
          const results = await get<{
            driver_number: number; position: number | null; number_of_laps: number
            gap_to_leader: number | string | null; dnf: boolean; dns: boolean; dsq: boolean
          }[]>('session_result', { session_key: String(sess.session_key) })
          if (cancelled) return

          if (results.length) {
            const leaderLaps = Math.max(0, ...results.map(r => r.number_of_laps || 0))
            results.forEach(r => {
              if (r.position != null) s.positions.set(r.driver_number, r.position)
              let gap = r.gap_to_leader
              if (r.dnf || r.dns || r.dsq) gap = r.dnf ? 'DNF' : r.dns ? 'DNS' : 'DSQ'
              else if (gap == null && r.number_of_laps > 0 && r.number_of_laps < leaderLaps) {
                gap = `+${leaderLaps - r.number_of_laps} LAP${leaderLaps - r.number_of_laps > 1 ? 'S' : ''}`
              }
              s.gaps.set(r.driver_number, { gap, interval: null })
            })
            // Derive intervals between consecutively classified cars
            const classified = results
              .filter(r => typeof r.gap_to_leader === 'number' && !r.dnf && !r.dns && !r.dsq && r.position != null)
              .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
            for (let i = 1; i < classified.length; i++) {
              const g = s.gaps.get(classified[i].driver_number)
              if (g) g.interval = +(((classified[i].gap_to_leader as number) - (classified[i - 1].gap_to_leader as number))).toFixed(3)
            }
          } else {
            // No official result (e.g. practice) — fall back to position history
            const pos = await get<{ driver_number: number; position: number; date: string }[]>('position', {
              session_key: String(sess.session_key),
            })
            if (cancelled) return
            pos.sort((a, b) => a.date.localeCompare(b.date)).forEach(p => s.positions.set(p.driver_number, p.position))
          }
          rebuild('ended')
          return
        }

        const [pos, ints] = await Promise.all([
          // Position history is cumulative but small (rows only on changes) — full fetch is fine.
          get<{ driver_number: number; position: number; date: string }[]>('position', {
            session_key: String(sess.session_key),
          }),
          // Interval history is HUGE (a row per driver every ~4s) — always date-filter it.
          get<{ driver_number: number; gap_to_leader: number | string | null; interval: number | string | null; date: string }[]>('intervals', {
            session_key: String(sess.session_key),
            'date>': lookbackISO(),
          }).catch(() => []),
        ])
        if (cancelled) return

        s.prevPositions = new Map(s.positions)
        pos.sort((a, b) => a.date.localeCompare(b.date)).forEach(p => {
          if (!s.startPositions.has(p.driver_number)) s.startPositions.set(p.driver_number, p.position)
          s.positions.set(p.driver_number, p.position)
        })
        ints.sort((a, b) => a.date.localeCompare(b.date)).forEach(i => {
          s.gaps.set(i.driver_number, { gap: i.gap_to_leader, interval: i.interval })
        })
        rebuild('live')
      } catch {
        if (!cancelled && initial) rebuild(live ? 'live' : 'ended')
      }
    }

    const pollSlow = async (initial = false, live = true) => {
      const sess = s.session
      if (!sess) return
      const key = String(sess.session_key)
      try {
        const [laps, stints, rc, weather] = await Promise.all([
          initial
            ? get<LiveLap[]>('laps', { session_key: key })
            : get<LiveLap[]>('laps', { session_key: key, 'date_start>': lookbackISO() }).catch(() => [] as LiveLap[]),
          get<LiveStint[]>('stints', { session_key: key }).catch(() => [] as LiveStint[]),
          get<Omit<LiveRaceControl, 'sector'>[]>('race_control', { session_key: key })
            .then(list => list.map(m => ({ ...m, sector: null })) as LiveRaceControl[])
            .catch(() => [] as LiveRaceControl[]),
          get<LiveWeather[]>('weather', { session_key: key }).catch(() => [] as LiveWeather[]),
        ])
        if (cancelled) return

        laps.forEach(l => s.laps.set(`${l.driver_number}-${l.lap_number}`, l))
        const byDriver = new Map<number, LiveStint[]>()
        stints.forEach(st => {
          const arr = byDriver.get(st.driver_number) || []
          arr.push(st)
          byDriver.set(st.driver_number, arr)
        })
        if (byDriver.size) s.stints = byDriver
        if (rc.length) s.raceControl = rc
        if (weather.length) s.weather = weather[weather.length - 1]
        rebuild(live ? 'live' : 'ended')
      } catch { /* keep previous data */ }
    }

    // Fallback path: poll our backend's F1 SignalR bridge. OpenF1 locks its
    // whole free API during live sessions — exactly when this page matters.
    let f1Timer: ReturnType<typeof setInterval> | null = null
    let f1Meta: LiveSessionMeta | null = null
    const prevF1Positions = new Map<number, number>()

    const pollF1 = async () => {
      try {
        const res = await fetch(`${BACKEND}/api/livetiming/state`, { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json()
        if (cancelled) return
        if (!data.active) {
          setState(prev => (prev.rows.length ? prev : {
            ...prev,
            source: 'f1',
            session: f1Meta,
            status: data.connected ? 'loading' : (data.error ? 'error' : 'loading'),
            lastUpdate: new Date(),
          }))
          return
        }
        // The bridge is the richer source, but its `Position` feed has been
        // arriving empty (see `fetchOpenF1CarPositions`). Everything else in
        // the payload is still good, so only the dots fall back.
        if (!hasCarPositions(data.feeds?.Position)) {
          const fallback = await fetchOpenF1CarPositions()
          if (cancelled) return
          if (Object.keys(fallback).length) {
            data.feeds = { ...(data.feeds || {}), Position: fallback }
          }
        }
        const mapped = mapF1Feeds(data.feeds)
        mapped.rows.forEach(r => {
          const prev = prevF1Positions.get(r.driver.driver_number)
          r.prevPosition = prev ?? null
          if (r.position != null) prevF1Positions.set(r.driver.driver_number, r.position)
        })
        setState({
          status: mapped.status,
          source: 'f1',
          session: f1Meta,
          rows: mapped.rows,
          raceControl: mapped.raceControl,
          weather: mapped.weather,
          currentLap: mapped.currentLap,
          trackStatus: mapped.trackStatus,
          teamRadio: mapped.teamRadio,
          qualifying: mapped.qualifying,
          lastUpdate: new Date(),
        })
      } catch {
        if (!cancelled) {
          setState(prev => (prev.rows.length ? prev : { ...prev, source: 'f1', session: f1Meta, status: 'error' }))
        }
      }
    }

    const bootF1 = async () => {
      // `/session` is header metadata only — the tower, the map and every
      // number on the page come from `/state`. Awaiting it first put a full
      // external round trip (~500ms) in front of the first timing data purely
      // to fill in a title, so the two now run side by side.
      const meta = (async () => {
        try {
          const res = await fetch(`${BACKEND}/api/livetiming/session`, { cache: 'no-store' })
          if (res.ok) {
            const info: F1SessionInfo = await res.json()
            if (!info.error) f1Meta = f1MetaToSession(info)
          }
        } catch { /* header meta is optional */ }
        // Patch it in on arrival. `pollF1` only reads `f1Meta` when it runs, so
        // without this the header would stay blank until the next 4s poll.
        if (!cancelled && f1Meta) setState(prev => ({ ...prev, session: f1Meta }))
      })()

      if (cancelled) return
      await Promise.all([meta, pollF1()])
      if (!cancelled) f1Timer = setInterval(pollF1, F1_POLL)
    }

    /**
     * Is our own F1 bridge feeding right now?
     *
     * Asked *before* OpenF1, and it decides. OpenF1 returns 401 for every
     * endpoint while a session is live — that is the entire reason the bridge
     * exists — so probing OpenF1 first spent a round trip (~490ms) on a call
     * guaranteed to fail during exactly the sessions this page is for. This
     * probe is local (~20ms) and the bridge is also the richer source: it
     * carries mini-sectors, stints, speed traps and team radio, none of which
     * OpenF1 has.
     *
     * Any doubt falls through to the OpenF1 path below, unchanged: a backend
     * that's down, a bridge that hasn't connected yet (`/state` starts the
     * SignalR client on demand, so the very first probe can legitimately say
     * inactive), or an off-season with nothing to relay.
     */
    const bridgeIsActive = async (): Promise<boolean> => {
      try {
        const res = await fetch(`${BACKEND}/api/livetiming/state`, { cache: 'no-store' })
        if (!res.ok) return false
        const data = await res.json()
        return Boolean(data?.active)
      } catch {
        return false
      }
    }

    const boot = async () => {
      if (await bridgeIsActive()) {
        if (!cancelled) await bootF1()
        return
      }
      if (cancelled) return
      try {
        const sessions = await get<LiveSessionMeta[]>('sessions', { session_key: 'latest' })
        if (cancelled) return
        if (!sessions.length) {
          await bootF1()
          return
        }
        s.session = sessions[0]
        const live = sessionIsLive(s.session)

        const drivers = await get<LiveDriverInfo[]>('drivers', { session_key: String(s.session.session_key) })
        if (cancelled) return
        drivers.forEach(d => s.drivers.set(d.driver_number, d))

        await Promise.all([pollSlow(true, live), pollFast(true, live)])
        if (cancelled) return

        // Car x/y comes from our own bridge when it has it. Polling /state is
        // also what keeps the backend's SignalR worker connected, so this runs
        // even when the positions themselves come from elsewhere.
        //
        // It used to say "OpenF1 carries no car x/y". That is wrong — OpenF1's
        // `/location` does — and believing it left the track map with no
        // fallback at all when the bridge's Position feed came up empty, which
        // is exactly what it does.
        const pollBridgePositions = async () => {
          try {
            const res = await fetch(`${BACKEND}/api/livetiming/state`, { cache: 'no-store' })
            if (!res.ok || cancelled) return
            const data = await res.json()
            const posFeed = data?.feeds?.Position
            if (!posFeed || typeof posFeed !== 'object') return
            let changed = false
            Object.entries(posFeed).forEach(([num, entry]: [string, any]) => {
              const x = Number(entry?.X)
              const y = Number(entry?.Y)
              if (Number.isFinite(x) && Number.isFinite(y)) {
                s.carXY.set(Number(num), { x, y })
                changed = true
              }
            })
            if (changed) rebuild('live')
            if (!changed) await graftOpenF1Positions()
          } catch {
            // Bridge offline — try the other source before giving up on dots.
            await graftOpenF1Positions()
          }
        }

        /** Fill `carXY` from OpenF1 when the bridge has no fix to offer. */
        const graftOpenF1Positions = async () => {
          const key = s.session?.session_key ?? 'latest'
          const fallback = await fetchOpenF1CarPositions(key)
          if (cancelled) return
          let changed = false
          Object.entries(fallback).forEach(([num, entry]) => {
            s.carXY.set(Number(num), { x: entry.X, y: entry.Y })
            changed = true
          })
          if (changed) rebuild('live')
        }

        // `sessionIsLive` used to be evaluated exactly once, at mount. Opening
        // /live half an hour before lights-out therefore never started the
        // polling loops (the tower sat on the previous session all race), and
        // opening it during a session never stopped them (the loops hammered
        // OpenF1 for as long as the tab stayed open). Re-check periodically.
        const startLoops = () => {
          if (fastTimer) return
          fastTimer = setInterval(() => pollFast(false, true), FAST_POLL)
          slowTimer = setInterval(() => pollSlow(false, true), SLOW_POLL)
          pollBridgePositions()
          bridgePosTimer = setInterval(pollBridgePositions, F1_POLL)
        }
        const stopLoops = () => {
          if (fastTimer) { clearInterval(fastTimer); fastTimer = null }
          if (slowTimer) { clearInterval(slowTimer); slowTimer = null }
          if (bridgePosTimer) { clearInterval(bridgePosTimer); bridgePosTimer = null }
        }

        if (live) startLoops()

        modeTimer = setInterval(async () => {
          if (cancelled) return
          try {
            // Re-read the latest session too: a weekend rolls FP → Quali → Race
            // under the same tab.
            const latest = await get<LiveSessionMeta[]>('sessions', { session_key: 'latest' })
            if (cancelled) return
            if (latest.length) s.session = latest[0]
          } catch { /* keep the session we have */ }
          const nowLive = s.session ? sessionIsLive(s.session) : false
          if (nowLive) {
            startLoops()
          } else {
            stopLoops()
            // One final snapshot so the tower shows the closing classification.
            pollSlow(false, false).catch(() => {})
          }
        }, MODE_CHECK_POLL)
      } catch {
        // OpenF1 unavailable (401 during live sessions, or offline) — use
        // the official F1 feed relayed by our backend instead.
        if (!cancelled) await bootF1()
      }
    }

    boot()
    return () => {
      cancelled = true
      if (fastTimer) clearInterval(fastTimer)
      if (slowTimer) clearInterval(slowTimer)
      if (f1Timer) clearInterval(f1Timer)
      if (bridgePosTimer) clearInterval(bridgePosTimer)
      if (modeTimer) clearInterval(modeTimer)
    }
  }, [rebuild])

  return state
}

/* ---------------------------------------------------------------------------
   Broadcast delay.

   Every TV feed runs behind the timing data — often 30-60s, more on a stream.
   Without this the tower spoils an overtake before you see it, which makes the
   page actively worse to watch alongside the race.

   The delay is global on purpose: it wraps the engine itself, so `/live`, the
   track map and the pop-out widgets all honour it without knowing it exists.
   Delaying the tower but not the map would just move the spoiler.
   --------------------------------------------------------------------------- */

const DELAY_KEY = 'f1.live.broadcastDelay'
/** Offered in the UI. 0 = off, the rest are seconds. */
export const DELAY_PRESETS_S = [0, 15, 30, 60, 90, 120] as const
const MAX_DELAY_MS = 5 * 60_000

let delayMs = 0
let delayLoaded = false
const delaySubs = new Set<() => void>()

function loadDelay(): number {
  if (delayLoaded || typeof window === 'undefined') return delayMs
  delayLoaded = true
  const raw = Number(window.localStorage.getItem(DELAY_KEY))
  delayMs = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), MAX_DELAY_MS) : 0
  return delayMs
}

export function getBroadcastDelay(): number {
  return loadDelay()
}

export function setBroadcastDelay(ms: number) {
  const next = Math.min(Math.max(Math.round(ms) || 0, 0), MAX_DELAY_MS)
  if (next === delayMs && delayLoaded) return
  delayMs = next
  delayLoaded = true
  try {
    window.localStorage.setItem(DELAY_KEY, String(next))
  } catch { /* private mode — the delay just won't persist */ }
  delaySubs.forEach(fn => fn())
}

function subscribeDelay(onChange: () => void): () => void {
  delaySubs.add(onChange)
  return () => { delaySubs.delete(onChange) }
}

/** Current broadcast delay in ms, and a setter. Shared across every consumer. */
export function useBroadcastDelay(): [number, (ms: number) => void] {
  const ms = useSyncExternalStore(
    subscribeDelay,
    getBroadcastDelay,
    () => 0,  // server render: no localStorage, and 0 avoids a hydration mismatch
  )
  return [ms, setBroadcastDelay]
}

interface Snapshot { at: number; state: EngineState }

/**
 * Newest buffered snapshot old enough to show, or null while the buffer is
 * still filling.
 *
 * Pulled out as a pure function because the states worth checking — a buffer
 * maturing, a snapshot releasing exactly on the boundary — only occur during a
 * live session, which can't be summoned on demand. See
 * `scripts/broadcast-delay.test.mjs`.
 */
export function selectDelayedSnapshot(
  buffer: readonly Snapshot[],
  delay: number,
  now: number = Date.now(),
): EngineState | null {
  if (delay <= 0) return buffer.length ? buffer[buffer.length - 1].state : null
  const releaseAt = now - delay
  let chosen: EngineState | null = null
  for (const snap of buffer) {
    if (snap.at <= releaseAt) chosen = snap.state
    else break
  }
  return chosen
}

/**
 * Hold each engine snapshot back by `delayMs`.
 *
 * While the buffer is still filling there is deliberately nothing old enough to
 * show, and we report `status: 'loading'` rather than falling back to the live
 * state — showing current data on a page whose whole job is to be late would
 * spoil exactly the moment the user asked us to hide.
 */
function useDelayedEngine(raw: EngineState, delay: number): EngineState {
  const buffer = useRef<Snapshot[]>([])
  const [, tick] = useState(0)

  // Record every distinct snapshot the engine produces.
  useEffect(() => {
    if (delay <= 0 || raw.status !== 'live') {
      // Drop the buffer between sessions so a stale snapshot can't resurface.
      buffer.current = []
      return
    }
    const buf = buffer.current
    if (!buf.length || buf[buf.length - 1].state !== raw) {
      buf.push({ at: Date.now(), state: raw })
    }
    // Keep a little more than the delay so the release point always exists.
    const cutoff = Date.now() - delay - 30_000
    while (buf.length > 2 && buf[0].at < cutoff) buf.shift()
  }, [raw, delay])

  // The delayed view has to advance with the clock, not just with new data —
  // without this it freezes between polls.
  useEffect(() => {
    if (delay <= 0 || raw.status !== 'live') return
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [delay, raw.status])

  // Nothing live means nothing to spoil — pass straight through, and don't
  // strand the page on "loading" for a minute on a non-race day.
  if (delay <= 0 || raw.status !== 'live') return raw

  const chosen = selectDelayedSnapshot(buffer.current, delay)

  if (!chosen) {
    // Buffer still filling. Keep the session identity so the header can render,
    // but withhold everything that would give the race away.
    return {
      ...raw,
      status: 'loading',
      rows: [],
      raceControl: [],
      currentLap: 0,
      trackStatus: '',
      lastUpdate: null,
      delayMs: delay,
      delayBuffering: true,
    }
  }

  return { ...chosen, delayMs: delay, delayBuffering: false }
}

/**
 * Live session state, held back by the user's broadcast delay (default none).
 *
 * Consumers don't opt in — the delay is applied here so a setting made on
 * `/live` also covers the track map and the pop-out widgets.
 */
export function useLiveSession(): EngineState {
  const raw = useLiveSessionRaw()
  const [delay] = useBroadcastDelay()
  return useDelayedEngine(raw, delay)
}

/* ---------------------------------------------------------------------------
   "Is anything live right now?" — one poller for the whole app.

   This drives the LIVE NOW pill, which the root layout renders on every page,
   so whatever it does it does everywhere. It used to be a plain
   `setInterval(check, 60_000)` inside the hook itself, which meant one
   external request per minute *per mounted component* — the home page and the
   paddock each mount their own alongside the pill, so `/` made two — forever,
   whether or not a session was anywhere near running, and even in a tab nobody
   was looking at. A quick pass over the site was enough to earn HTTP 429 from
   OpenF1.

   Now: a single module-level poller shared by every caller, pacing itself off
   the session data it already has, backing off when a source fails, and
   sleeping while the tab is hidden.
   --------------------------------------------------------------------------- */

/** Cadence while a session is live or imminent. */
export const LIVE_POLL_MS = 60_000
/** Cadence when the next session is hours or days away. */
export const IDLE_POLL_MS = 10 * 60_000
/** How far ahead of a session start to switch back to the live cadence. */
const PRE_SESSION_LEAD_MS = 20 * 60_000

/**
 * How long to wait before the next check, given what we currently know.
 *
 * Exported because all the interesting behaviour lives here — it's the one
 * piece worth testing without sitting through a ten-minute tick.
 */
export function nextLiveCheckDelay(session: LiveSessionMeta | null, now = Date.now()): number {
  // Nothing known yet: stay responsive rather than guess.
  if (!session) return LIVE_POLL_MS
  if (sessionIsLive(session, now)) return LIVE_POLL_MS

  const start = new Date(session.date_start).getTime()
  if (Number.isNaN(start)) return LIVE_POLL_MS

  const untilStart = start - now
  // Already run — nothing to watch until OpenF1 publishes the next one.
  if (untilStart <= 0) return IDLE_POLL_MS
  if (untilStart <= PRE_SESSION_LEAD_MS) return LIVE_POLL_MS
  // Far out: idle, but never sleep clean past the moment it goes live.
  // `sessionIsLive` opens its window 10 min before the start, and the lead is
  // 20, so waking at start-minus-20 always catches the transition.
  return Math.max(LIVE_POLL_MS, Math.min(IDLE_POLL_MS, untilStart - PRE_SESSION_LEAD_MS))
}

/** Exponential backoff after a failed check, capped at the idle cadence. */
export function failedLiveCheckDelay(failures: number): number {
  return Math.min(IDLE_POLL_MS, LIVE_POLL_MS * 2 ** Math.max(0, failures - 1))
}

export interface LiveSessionStatus {
  live: boolean
  session: LiveSessionMeta | null
}

/** Stable identity so an unchanged poll doesn't re-render every subscriber. */
const NO_LIVE_SESSION: LiveSessionStatus = Object.freeze({ live: false, session: null })

let statusSnapshot: LiveSessionStatus = NO_LIVE_SESSION
const statusSubscribers = new Set<() => void>()
let pollTimer: ReturnType<typeof setTimeout> | undefined
let pollFailures = 0
let lastCheckedAt = 0
let visibilityBound = false

function sameSession(a: LiveSessionMeta | null, b: LiveSessionMeta | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  // The F1-bridge fallback has no session_key (always 0), so compare the
  // fields that actually distinguish one session from another.
  return a.session_key === b.session_key
    && a.date_start === b.date_start
    && a.date_end === b.date_end
    && a.session_name === b.session_name
}

function publish(next: LiveSessionStatus) {
  if (next.live === statusSnapshot.live && sameSession(next.session, statusSnapshot.session)) return
  statusSnapshot = next
  statusSubscribers.forEach(fn => fn())
}

/** The current session per OpenF1, or the backend bridge, or null if both failed. */
async function fetchLiveSession(): Promise<LiveSessionMeta | null> {
  try {
    const sessions = await get<LiveSessionMeta[]>('sessions', { session_key: 'latest' })
    if (sessions.length) return sessions[0]
  } catch {
    // OpenF1 locks its free tier WHILE a session is live, so an error here
    // often means something IS live. It's also what rate limiting looks like.
    // Either way the backend's F1 bridge is the authority — fall through.
  }
  try {
    const res = await fetch(`${BACKEND}/api/livetiming/session`, { cache: 'no-store' })
    if (!res.ok) return null
    const info: F1SessionInfo = await res.json()
    if (info.error || !info.date_start_utc) return null
    return f1MetaToSession(info)
  } catch {
    return null // backend offline too
  }
}

function scheduleLiveCheck(ms: number) {
  clearTimeout(pollTimer)
  if (!statusSubscribers.size) return
  pollTimer = setTimeout(runLiveCheck, ms)
}

async function runLiveCheck(force = false) {
  if (!statusSubscribers.size) return
  // Don't poll a tab nobody is looking at. The visibility listener restarts
  // us — and `force` covers the very first check, which must happen whatever
  // the tab state, so opening the site mid-session shows the pill at once.
  if (!force && typeof document !== 'undefined' && document.hidden) {
    clearTimeout(pollTimer)
    return
  }

  lastCheckedAt = Date.now()
  const session = await fetchLiveSession()

  if (!session) {
    // Keep the last known state rather than flapping to "not live" on a blip.
    pollFailures += 1
    scheduleLiveCheck(failedLiveCheckDelay(pollFailures))
    return
  }

  pollFailures = 0
  publish({ live: sessionIsLive(session), session })
  scheduleLiveCheck(nextLiveCheckDelay(session))
}

function handleVisibility() {
  if (typeof document === 'undefined' || document.hidden) return
  if (!statusSubscribers.size) return
  const due = nextLiveCheckDelay(statusSnapshot.session)
  const elapsed = Date.now() - lastCheckedAt
  if (elapsed >= due) void runLiveCheck(true)
  else scheduleLiveCheck(due - elapsed)
}

/**
 * Subscribe to live-session changes outside React. Exported alongside
 * `readLiveStatus` so the poller can be driven and asserted on directly —
 * the interesting states (a session actually going live) can't be reached
 * from the UI unless a race happens to be running.
 */
export function subscribeLiveStatus(onChange: () => void): () => void {
  statusSubscribers.add(onChange)

  if (statusSubscribers.size === 1) {
    if (!visibilityBound && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility)
      visibilityBound = true
    }
    // First subscriber kicks off an immediate check regardless of tab state.
    void runLiveCheck(true)
  }

  return () => {
    statusSubscribers.delete(onChange)
    if (!statusSubscribers.size) {
      clearTimeout(pollTimer)
      pollTimer = undefined
      if (visibilityBound && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility)
        visibilityBound = false
      }
    }
  }
}

/** Current live status, without subscribing. */
export const readLiveStatus = (): LiveSessionStatus => statusSnapshot
const getLiveSessionStatusSnapshot = readLiveStatus
const getLiveSessionStatusServerSnapshot = () => NO_LIVE_SESSION

/**
 * Lightweight "is anything live right now?" — for the nav pill, home banner
 * and paddock header. Every caller shares one poller and one request.
 */
export function useLiveStatus(): LiveSessionStatus {
  return useSyncExternalStore(
    subscribeLiveStatus,
    getLiveSessionStatusSnapshot,
    getLiveSessionStatusServerSnapshot,
  )
}

export function fmtLap(t: number | null | undefined): string {
  if (t == null) return '—'
  const m = Math.floor(t / 60)
  const sec = t - m * 60
  return m > 0 ? `${m}:${sec.toFixed(3).padStart(6, '0')}` : sec.toFixed(3)
}

export function fmtGap(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return v // e.g. "+1 LAP"
  if (typeof v === 'number') return v === 0 ? 'LEADER' : `+${v.toFixed(3)}`
  return '—' // formatter must never crash the tower on a weird feed value
}
