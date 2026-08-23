/**
 * Extended, static team information (history, honours, notable drivers).
 * The backend `/api/teams` payload is intentionally thin, so this file enriches
 * the team detail page. Keyed by the backend team `id`.
 *
 * Figures reflect each constructor's real-world heritage (career totals to the
 * mid-2020s) — used here for the 2026 dashboard's "about" sections.
 */

export interface TeamInfo {
  founded: string
  /** Constructors' Championships (WCC) */
  wcc: number
  /** Drivers' Championships won with this constructor (WDC) */
  wdc: number
  /** Approximate career race wins */
  raceWins: string
  /** Approximate career pole positions */
  poles: string
  /** Team principal */
  principal: string
  /** Notable drivers / champions associated with the team */
  notableDrivers: string[]
  /** Short history paragraph */
  history: string
}

export const TEAM_INFO: Record<string, TeamInfo> = {
  ferrari: {
    founded: '1929 · F1 debut 1950',
    wcc: 16,
    wdc: 15,
    raceWins: '240+',
    poles: '250+',
    principal: 'Frédéric Vasseur',
    notableDrivers: ['Michael Schumacher', 'Niki Lauda', 'Alberto Ascari', 'Kimi Räikkönen'],
    history:
      'Scuderia Ferrari is the only team to have competed in every Formula 1 World Championship since 1950 and is the sport’s most successful and storied constructor. Built around Enzo Ferrari’s racing obsession in Maranello, the Prancing Horse delivered the Schumacher dynasty of five straight titles (2000–2004) and remains F1’s emotional heartbeat.',
  },
  mercedes: {
    founded: '1954 (works) · returned 2010',
    wcc: 8,
    wdc: 9,
    raceWins: '125+',
    poles: '140+',
    principal: 'Toto Wolff',
    notableDrivers: ['Lewis Hamilton', 'Nico Rosberg', 'Juan Manuel Fangio'],
    history:
      'Mercedes-AMG Petronas defined the hybrid era, winning eight consecutive Constructors’ Championships from 2014 to 2021 — the most dominant run in F1 history. From its Brackley base, the works Silver Arrows team turned Lewis Hamilton into a record-equalling seven-time World Champion.',
  },
  red_bull: {
    founded: '2005 (from Jaguar Racing)',
    wcc: 6,
    wdc: 8,
    raceWins: '120+',
    poles: '100+',
    principal: 'Laurent Mekies',
    notableDrivers: ['Max Verstappen', 'Sebastian Vettel', 'Daniel Ricciardo'],
    history:
      'Red Bull Racing transformed from an energy-drink experiment into a championship juggernaut. Adrian Newey’s aerodynamic genius produced Sebastian Vettel’s four straight titles (2010–2013) and, after a ground-effect masterstroke, Max Verstappen’s era of total dominance. Based in Milton Keynes, the team races with a fearless, fast-iterating culture.',
  },
  mclaren: {
    founded: '1963 · F1 debut 1966',
    wcc: 9,
    wdc: 12,
    raceWins: '190+',
    poles: '160+',
    principal: 'Andrea Stella',
    notableDrivers: ['Ayrton Senna', 'Alain Prost', 'Mika Häkkinen', 'Lewis Hamilton'],
    history:
      'Founded by New Zealander Bruce McLaren, the Woking team is F1’s second-most successful constructor. Home to the legendary Senna–Prost rivalry of the late 1980s, McLaren has won across five decades and engineered a dramatic modern resurgence to fight at the front once more.',
  },
  williams: {
    founded: '1977',
    wcc: 9,
    wdc: 7,
    raceWins: '110+',
    poles: '120+',
    principal: 'James Vowles',
    notableDrivers: ['Nigel Mansell', 'Alain Prost', 'Damon Hill', 'Jacques Villeneuve'],
    history:
      'Founded by Sir Frank Williams and Patrick Head, Williams was the dominant force of the late 1980s and 1990s, famous for its engineering purity and a roll-call of champions. Now under new ownership and led by James Vowles, the independent Grove team is rebuilding toward the front.',
  },
  aston_martin: {
    founded: '2021 (ex-Racing Point / Jordan lineage)',
    wcc: 0,
    wdc: 0,
    raceWins: '0',
    poles: '1',
    principal: 'Andy Cowell',
    notableDrivers: ['Fernando Alonso', 'Lance Stroll', 'Sebastian Vettel'],
    history:
      'The green machine from Silverstone carries the lineage of Jordan, Force India and Racing Point. Backed by Lawrence Stroll’s ambitious investment — a new factory, wind tunnel and a future Honda works partnership — Aston Martin is building deliberately toward title contention.',
  },
  alpine: {
    founded: '2021 (Renault heritage)',
    wcc: 2,
    wdc: 2,
    raceWins: '20+',
    poles: '20+',
    principal: 'Oliver Oakes',
    notableDrivers: ['Fernando Alonso (Renault)', 'Esteban Ocon', 'Pierre Gasly'],
    history:
      'Alpine is the French works identity of the Enstone team whose Renault badge powered Fernando Alonso to back-to-back titles in 2005 and 2006. With deep championship heritage from the Benetton–Renault years, the squad blends a UK chassis base with French engine pedigree.',
  },
  rb: {
    founded: '2006 (as Toro Rosso)',
    wcc: 0,
    wdc: 0,
    raceWins: '2',
    poles: '1',
    principal: 'Laurent Mekies',
    notableDrivers: ['Sebastian Vettel', 'Pierre Gasly', 'Carlos Sainz'],
    history:
      'The Faenza-based sister team to Red Bull — once Toro Rosso, then AlphaTauri — serves as F1’s premier proving ground for young talent. It owns two of the sport’s great upsets: Vettel’s 2008 Monza win and Gasly’s 2020 Monza victory.',
  },
  audi: {
    founded: '2026 (from Sauber)',
    wcc: 0,
    wdc: 0,
    raceWins: '1',
    poles: '1',
    principal: 'Mattia Binotto (Project Lead)',
    notableDrivers: ['—'],
    history:
      'Audi enters Formula 1 in 2026 as a full works manufacturer, taking over the long-running Sauber team in Hinwil, Switzerland. It is the first time the Four Rings compete in F1, building a complete power unit under the new hybrid regulations — a landmark German entry.',
  },
  haas: {
    founded: '2016',
    wcc: 0,
    wdc: 0,
    raceWins: '0',
    poles: '1',
    principal: 'Ayao Komatsu',
    notableDrivers: ['Kevin Magnussen', 'Romain Grosjean', 'Nico Hülkenberg'],
    history:
      'The first American-owned team in a generation, Haas runs a lean model built on close technical ties with Ferrari and a chassis partnership with Dallara. Operating from Kannapolis, North Carolina, it punches above its budget as F1’s scrappiest privateer.',
  },
  cadillac: {
    founded: '2026 (General Motors)',
    wcc: 0,
    wdc: 0,
    raceWins: '0',
    poles: '0',
    principal: 'Graeme Lowdon',
    notableDrivers: ['—'],
    history:
      'Cadillac joins the grid in 2026 as Formula 1’s 11th team, backed by General Motors and the TWG/Andretti project. The all-new American operation begins with a customer power unit while developing its own GM engine for the future — the sport’s most-watched new entry.',
  },
}

export function getTeamInfo(teamId?: string | null): TeamInfo | null {
  if (!teamId) return null
  return TEAM_INFO[teamId] ?? null
}

/** Background videos keyed by team id (extend as more are added). */
export const TEAM_VIDEOS: Record<string, string> = {
  red_bull: '/video/redbull-team.mp4',
}

export function getTeamVideo(teamId?: string | null): string | null {
  if (!teamId) return null
  return TEAM_VIDEOS[teamId] ?? null
}
