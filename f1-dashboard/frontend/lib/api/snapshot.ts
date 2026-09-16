import bundle from './core-snapshot.json'

export interface CoreSnapshot { label: string; capturedAt: string; source: string; data: unknown }
const entries: Record<string, CoreSnapshot> = bundle.entries

/** Exact public allowlist. Never normalize arbitrary queries into a snapshot key. */
export function coreSnapshot(path: string | null): CoreSnapshot | undefined {
  if (!path) return
  if (Object.hasOwn(entries, path)) return entries[path]
  const match = /^\/api\/circuits\/([a-z0-9_]+)$/.exec(path)
  if (match) {
    const reference = entries['/api/circuits/']
    const data = (reference.data as { key: string }[]).find(c => c.key === match[1])
    if (data) return { ...reference, data }
  }
}

/** Refuse successful-but-empty/malformed core responses before replacing a snapshot. */
export function validCoreResponse(path: string, data: unknown): boolean {
  if (!coreSnapshot(path)) return true
  if (path.startsWith('/api/standings/')) {
    const s = data as { drivers?: unknown[]; constructors?: unknown[]; rounds?: unknown[] } | null
    const rows = (value: unknown, keys: string[]) => Array.isArray(value) && value.length > 0 && value.every(v => v && typeof v === 'object' && keys.every(k => k in v))
    return !!s && rows(s.drivers, ['abbreviation', 'name', 'team', 'points', 'rounds']) && rows(s.constructors, ['name', 'points', 'rounds']) && rows(s.rounds, ['round', 'status'])
  }
  if (path.startsWith('/api/sessions/calendar/')) return Array.isArray(data) && data.length > 0 && data.every(v => v && typeof v.name === 'string' && typeof v.sessions === 'object')
  return path === '/api/circuits/' ? Array.isArray(data) && data.length > 0 && data.every(v => v && typeof v.key === 'string') : !!data && typeof data === 'object' && 'key' in data
}
