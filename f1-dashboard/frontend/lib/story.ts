/**
 * Driver story derivation — turning successive timing snapshots into events.
 *
 * A timing screen is present-tense: it shows the state of the session now and
 * forgets everything else. This diffs one snapshot against the last to recover
 * what actually happened, which is the part a fan misses by looking away.
 *
 * Kept free of JSX so the cases that only arise mid-session — a place gained by
 * a pass versus one inherited from somebody else's pit stop, a lap that is both
 * a personal best and the session best — are testable without a browser:
 * `node scripts/driver-story.test.mjs`.
 */

// Relative, not `@/lib/live`: the test scripts load this file through jiti,
// which doesn't resolve the tsconfig path alias. `lib/live.ts` imports its own
// dependencies the same way for the same reason.
import { fmtLap, type TowerRow } from './live'

export type StoryTone = 'good' | 'bad' | 'purple' | 'neutral'

export interface StorySnap {
  position: number | null
  compound: string | null
  tyreAge: number | null
  pitStops: number
  bestLap: number | null
  overallBest: boolean
  lapsDone: number
  /** Who was directly ahead — the candidate for "passed X" next time round. */
  aheadAbbr: string | null
}

export interface DerivedEvent {
  text: string
  detail?: string
  tone: StoryTone
}

export function snapshotOf(me: TowerRow, rows: TowerRow[]): StorySnap {
  const ahead = me.position != null && me.position > 1
    ? rows.find(r => r.position === me.position! - 1)
    : undefined
  return {
    position: me.position,
    compound: me.compound,
    tyreAge: me.tyreAge,
    pitStops: me.pitStops,
    bestLap: me.bestLapDuration,
    overallBest: me.isOverallBestLap,
    lapsDone: me.lapsDone,
    aheadAbbr: ahead?.driver.name_acronym ?? null,
  }
}

/**
 * Events between two snapshots.
 *
 * `was` being null is the baseline case and yields nothing — without that the
 * whole feed fires on mount describing things that happened before you arrived.
 */
export function deriveEvents(
  was: StorySnap | null,
  now: StorySnap,
  rows: TowerRow[],
): DerivedEvent[] {
  if (!was) return []
  const out: DerivedEvent[] = []

  if (now.position != null && was.position != null && now.position !== was.position) {
    const gained = now.position < was.position
    // Only claim a pass when the car that was ahead is now demonstrably behind.
    // A position can also improve because somebody else pitted or retired, and
    // saying "passed SAI" about a car that simply stopped is a lie.
    const passed = gained && was.aheadAbbr
      ? rows.find(r =>
          r.driver.name_acronym === was.aheadAbbr &&
          r.position != null && r.position > now.position!)
      : undefined
    out.push({
      text: `${gained ? 'Up' : 'Down'} to P${now.position}`,
      detail: passed ? `passed ${passed.driver.name_acronym}` : `from P${was.position}`,
      tone: gained ? 'good' : 'bad',
    })
  }

  if (now.pitStops > was.pitStops) {
    out.push({
      text: 'Pitted',
      detail: now.compound
        ? `${now.compound}${now.tyreAge != null ? ` · ${now.tyreAge}L` : ''}`
        : undefined,
      tone: 'neutral',
    })
  } else if (now.compound && now.compound !== was.compound) {
    // A compound change with no extra stop counted — the feed occasionally
    // reports the tyre before the stop lands.
    out.push({
      text: `Switched to ${now.compound}`,
      detail: now.tyreAge != null ? `${now.tyreAge}L` : undefined,
      tone: 'neutral',
    })
  }

  // Session best supersedes personal best — the same lap is both, and listing
  // it twice reads as two laps.
  if (now.overallBest && !was.overallBest) {
    out.push({ text: 'Fastest lap of the session', detail: fmtLap(now.bestLap), tone: 'purple' })
  } else if (now.bestLap != null && (was.bestLap == null || now.bestLap < was.bestLap)) {
    out.push({ text: 'Personal best', detail: fmtLap(now.bestLap), tone: 'good' })
  }

  return out
}

/**
 * Race-control messages that concern one driver.
 *
 * `driver_number` is frequently null on these, so the text is matched too. The
 * acronym is feed content, so it is stripped to word characters before going
 * anywhere near a regex.
 */
export function raceControlFor(
  messages: { message: string; driver_number: number | null }[],
  abbr: string,
  driverNumber: number,
): { message: string; driver_number: number | null }[] {
  const safe = abbr.replace(/[^A-Za-z0-9]/g, '')
  const re = safe ? new RegExp(`\\b(${safe}|CAR ${driverNumber})\\b`, 'i') : null
  return messages.filter(m => m.driver_number === driverNumber || (re != null && re.test(m.message)))
}

/** Race control that reads as trouble rather than information. */
export function isBadNews(message: string, flag: string | null): boolean {
  return flag === 'BLACK AND WHITE' || /penalt|investigat|deleted|reprimand/i.test(message)
}
