import type { LiveRaceControl } from './live'

export type ControlFilter = 'all' | 'flags' | 'incidents'

export function controlId(item: LiveRaceControl): string {
  return JSON.stringify([item.date, item.category, item.flag, item.message, item.driver_number, item.lap_number, item.sector, item.scope])
}

export function normalizeControl(items: LiveRaceControl[]): LiveRaceControl[] {
  return [...new Map(items.map(item => [controlId(item), item])).values()]
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
}

export function filterControl(items: LiveRaceControl[], filter: ControlFilter, query: string): LiveRaceControl[] {
  const needle = query.trim().toLowerCase()
  return items.filter(item => {
    const text = `${item.message} ${item.category} ${item.flag ?? ''} ${item.driver_number ?? ''}`.toLowerCase()
    const matchesCategory = filter === 'all' || (filter === 'flags'
      ? Boolean(item.flag) || /safety car|vsc|virtual safety|red flag/.test(text)
      : /investigat|incident|penalty|penalties|noted|infringement|deleted|reinstated/.test(text))
    const matchesSearch = /^\d+$/.test(needle)
      ? item.driver_number === Number(needle) || new RegExp(`\\bcar\\s+0*${Number(needle)}\\b`, 'i').test(item.message)
      : !needle || text.includes(needle)
    return matchesCategory && matchesSearch
  })
}

export function unseenControlCount(items: LiveRaceControl[], seen: ReadonlySet<string>): number {
  return new Set(items.map(controlId).filter(id => !seen.has(id))).size
}
