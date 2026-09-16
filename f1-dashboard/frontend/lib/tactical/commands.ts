export type TacticalCommand =
  | { type: 'mode'; mode: 'default' | 'thermal' }
  | { type: 'track-driver'; query: string }
  | { type: 'camera'; mode: 'free' | 'follow' | 'chase' }
  | { type: 'intervals'; visible: boolean }

/** Deliberately bounded grammar: unknown speech must never execute a guessed action. */
export function parseCommand(text: string): TacticalCommand | null {
  const value = text.toLowerCase().replace(/[.,!?]/g, '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:hey )?engineer\s+/, '').replace(/^please\s+/, '')
  if (/^(?:(?:activate|enable|turn on) )?(?:thermal|flir)(?: mode)?$/.test(value)) return { type: 'mode', mode: 'thermal' }
  if (/^(?:(?:activate|restore|enable) )?(?:default|normal|satellite)(?: mode)?$/.test(value)) return { type: 'mode', mode: 'default' }
  if (/^(?:clear|disable|turn off) (?:filters|thermal)$/.test(value)) return { type: 'mode', mode: 'default' }
  if (/^(?:(?:activate|enable) )?(?:cockpit|chase)(?: cam| camera)?$/.test(value)) return { type: 'camera', mode: 'chase' }
  if (/^(?:free (?:cam|camera)|release (?:target|camera)|unlock)$/.test(value)) return { type: 'camera', mode: 'free' }
  if (/^(?:follow (?:cam|camera))$/.test(value)) return { type: 'camera', mode: 'follow' }
  if (/^(?:display|show|enable) (?:interval gaps|intervals|gaps)$/.test(value)) return { type: 'intervals', visible: true }
  if (/^(?:hide|disable) (?:interval gaps|intervals|gaps)$/.test(value)) return { type: 'intervals', visible: false }
  const driver = value.match(/^(?:track|follow|lock onto) (?:driver |car )?([a-z0-9][a-z0-9 '\-]{0,59})$/)
  return driver ? { type: 'track-driver', query: driver[1].trim() } : null
}

export const COMMAND_EVENT = 'f1:tactical-command'
