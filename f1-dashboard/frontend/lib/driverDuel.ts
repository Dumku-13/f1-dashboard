import type { DriverStanding, RoundInfo } from '@/lib/types'

export interface DuelRound {
  round: number
  name: string
  isSprint: boolean
  firstPoints: number
  secondPoints: number
}

/** Keep API values numeric before they enter the chart. */
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Points awarded to one driver in one completed event. */
export function pointsForRound(driver: DriverStanding | null | undefined, round: number): number {
  const result = driver?.rounds?.[round]
  if (!result) return 0
  return (finite(result.race) ?? 0) + (finite(result.sprint) ?? 0)
}

/** The standings endpoint can list future rounds; a duel only plots scored rounds. */
export function completedRounds(rounds: RoundInfo[] | null | undefined): RoundInfo[] {
  return (rounds ?? [])
    .filter(round => round.status === 'complete' && Number.isFinite(round.round))
    .slice()
    .sort((a, b) => a.round - b.round)
}

/**
 * Build cumulative scores from the per-round ledger. The final row therefore
 * reflects exactly the completed rounds visible to the user, including sprint
 * points where they exist.
 */
export function buildDuelSeries(
  first: DriverStanding | null | undefined,
  second: DriverStanding | null | undefined,
  rounds: RoundInfo[] | null | undefined,
): DuelRound[] {
  let firstTotal = 0
  let secondTotal = 0

  return completedRounds(rounds).map(round => {
    firstTotal += pointsForRound(first, round.round)
    secondTotal += pointsForRound(second, round.round)
    return {
      round: round.round,
      name: round.name,
      isSprint: round.is_sprint,
      firstPoints: firstTotal,
      secondPoints: secondTotal,
    }
  })
}

/** Sum the same ledger used by the chart, useful for data-consistent readouts. */
export function completedPoints(
  driver: DriverStanding | null | undefined,
  rounds: RoundInfo[] | null | undefined,
): number {
  return buildDuelSeries(driver, null, rounds).at(-1)?.firstPoints ?? 0
}

/**
 * Pick the first two unique driver abbreviations in championship order. The
 * endpoint normally already returns this order, but sorting by position keeps
 * this deterministic when a partial response arrives out of order.
 */
export function defaultDuelDrivers(
  drivers: DriverStanding[] | null | undefined,
): [DriverStanding | null, DriverStanding | null] {
  const unique = new Map<string, DriverStanding>()
  for (const driver of drivers ?? []) {
    const key = driver.abbreviation.trim().toUpperCase()
    if (key && !unique.has(key)) unique.set(key, driver)
  }

  const ordered = [...unique.values()].sort((a, b) => {
    const aPosition = finite(a.position)
    const bPosition = finite(b.position)
    if (aPosition != null && bPosition != null && aPosition !== bPosition) return aPosition - bPosition
    if (aPosition != null) return -1
    if (bPosition != null) return 1
    return (finite(b.points) ?? 0) - (finite(a.points) ?? 0)
  })

  return [ordered[0] ?? null, ordered[1] ?? null]
}
