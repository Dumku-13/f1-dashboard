# F1 Platform — Features + Performance Plan

> **STATUS as of 2026-08-21 — all 12 phases are DONE and shipped.**
> Kept for the reasoning and the feasibility calls behind each decision.
> Current state of the codebase is in `../HANDOFF.md` — read that first.
>
> | Phase | State |
> |---|---|
> | 0 · Park the redesign doc | ✅ `frontend/FRONTEND_REDESIGN.md` |
> | 1 · SWR + code splitting | ✅ home 8+ → 4 requests, 0 duplicates |
> | 2 · News | ✅ `/news`, 6 RSS feeds, ~154 articles, no API key |
> | 3 · Standings evolution | ✅ points / ranking-bump / points-by-race |
> | 4 · Results + Schedule | ✅ `/results`, `/schedule` — **Mapbox needs a token** |
> | 5 · Driver Stats + Sankey | ✅ `/driver-stats` |
> | 6 · Head-to-Head | ✅ `/analysis` tab + teammate battles |
> | 7 · Consistency + Race Pace | ✅ `/analysis` tabs |
> | 8 · Pit analysis | ✅ `/analysis` tab, labelled "Pit Lane Time Loss" |
> | 9 · Navigation regroup | ✅ 25 flat icons → 7 dock items + 4 grouped panels |
> | 10 · Track DNA | ✅ `/api/analysis/track-dna/{y}/{r}` + the Track DNA tab |
> | 11 · Full QA + perf measurement | ✅ route sweep, mobile pass, a11y pass |
>
> Also done: `/analytics` merged into `/analysis` — one hub, nine tabs in three
> groups, and `/analytics` now redirects to `/analysis?tab=pace-ranking`.

---

## Context

The app has a fast backend and 34 working routes, but two problems:

1. **It feels laggy.** SWR is in `package.json` and **used nowhere** — every component
   fetches independently. I watched `/api/sessions/calendar/2026` fire **3× on a single page
   load**. Backend caching is fixed; the client is not.
2. **It's missing the analysis features** that make F1Dashboard worth opening.

Goal: add the feature set from your screenshots that real data can support, and make the
whole thing smooth.

### Feasibility — settled

| Building | Skipping (not in FastF1) |
|---|---|
| News · Schedule+map · Results · Race Pace | Tech Updates (curated from FIA docs) |
| Consistency · Head-to-Head · Driver Stats | Used Elements / PU usage (FIA PDFs) |
| Position-flow Sankey · Standings evolution | DHL pit-stop points + stop videos |
| Pit-lane analysis (labelled honestly) | |

Verified available: `laps` has **`Position`** (laps-led + position evolution are free),
`results` has `GridPosition` (Sankey) and **`HeadshotUrl`** — official photos for all 22
drivers, which also solves the missing-driver-images problem in the parked redesign.

---

# PART 1 — Performance (first, because it touches everything)

## 1.1 Wire up SWR — the main fix

`swr@2.4.2` is installed and unused. Add `lib/api/client.ts`:

```ts
// one fetcher, one cache, deduped across every component
export const useApi = <T>(key: string | null, opts?: SWRConfiguration) =>
  useSWR<T>(key, fetcher, {
    dedupingInterval: 60_000,      // static season data
    revalidateOnFocus: false,
    keepPreviousData: true,        // no flash when switching round/driver
    ...opts,
  })
export const useLiveApi = <T>(key: string | null) =>
  useApi<T>(key, { dedupingInterval: 2_000, refreshInterval: 4_000, revalidateOnFocus: true })
```

Then migrate every `useEffect(() => { fetch(...) })` to it. This gives, for free:
request dedupe, a shared cache across routes, `keepPreviousData` (kills the loading flash
when changing round/driver), and correct cancellation — replacing the hand-rolled
`cancelled` flags added earlier.

## 1.2 Code-split the charts

`recharts` is heavy and currently in the main bundle. All chart components become
`next/dynamic` with `ssr: false` and a `.shimmer` placeholder. Same for `mapbox-gl`.

## 1.3 Backend caching for the new endpoints

Every new analysis endpoint follows the **existing proven pattern** — disk-cache keyed by
completed-round count (`_completed_round_count()` in `routers/standings.py`), so the first
call pays FastF1 and every later call is ~0.2s and survives restarts.

## 1.4 The dev-mode trap

`next dev` (Turbopack) is *much* slower than a production build. Some of the "lag" is this.
Part of QA is measuring against `npm run build && npx next start`, which is what
`GO-LIVE.cmd` already does.

## 1.5 Measure

Record before/after for: home, standings, a driver page, live. Target LCP < 2.5s, no
duplicate requests in the network panel, live route holding 60fps.

---

# PART 2 — Features

Ordered so the highest-value, lowest-risk land first.

## 2.1 News — `GET /api/news` *(new router)*

RSS backbone + optional NewsAPI enrichment, as chosen.

- Sources: Autosport, Motorsport.com, PlanetF1, RaceFans, F1.com official
- Parse with `feedparser` (small pure-Python dep; stdlib `ElementTree` + existing `bs4`
  as fallback if you'd rather not add it)
- Merge → dedupe on normalised title → sort newest → cache 15 min
- If `NEWSAPI_KEY` is set in the backend env, enrich with images/search; absent, RSS alone
  works fully. **No key is required for this to ship.**

```
{ title, summary, source, published, url, image?, tags[] }
```

Frontend `/news`: featured lead item + list, source chips, filter by source, relative
timestamps, links out to the original article. Never republishes full article text.

## 2.2 Schedule + Mapbox — `/schedule`

- Add `lat`/`lng` to all 23 entries in `backend/data/circuits.py`
- `mapbox-gl` + `NEXT_PUBLIC_MAPBOX_TOKEN` (you create the token)
- Horizontal race-card carousel: round, flag, country, dates, COMPLETED/UPCOMING/SPRINT
  badge, SVG track outline
- Selecting a card **flies the map** to that circuit; graceful no-map fallback if the token
  is absent, so it never hard-fails

## 2.3 Results — `/results`

Backed by the existing `/api/sessions/{y}/{r}/{s}/results`. Round + session selector,
full classification, grid vs finish delta, points, fastest lap. Pure frontend.

## 2.4 Standings evolution — **zero backend work**

`standings.rounds` already carries per-round points per driver and constructor. Adds to the
existing standings pages:
- **Points Evolution** — cumulative multi-line, hover shows the full ranked field at that round
- **Ranking Evolution** — bump chart, position over rounds, lines crossing
- **Points by Race** — stacked horizontal bars
- **Season Stats** — grouped bars (wins / podiums / points finishes / poles / DNF)

## 2.5 Driver Stats — `GET /api/analysis/driver/{driver}/{year}`

KPI tiles (GP wins, podiums, season points, **laps led** from `laps.Position == 1`),
finish-position distribution, points-in-finishes donut, points evolution vs previous season,
laps-led per race, and the **Start→Finish position-flow Sankey** from
`GridPosition → Position`.

## 2.6 Head-to-Head — `GET /api/analysis/h2h/{year}?d1=&d2=`

Two-driver comparison: points, wins, podiums, points finishes, poles, Q3 appearances, best
race/quali finish — dual bars with percentages. Plus season-wide **teammate battle** lists
for qualifying and race, as in your screenshot.

## 2.7 Consistency — `GET /api/analysis/consistency/{year}`

Server-computed box-plot stats (min/q1/median/q3/max + outliers) per driver for race finish,
sprint finish, qualifying and sprint qualifying. `Exclude DNF` toggle handled server-side via
a query param so the maths stays in one place.

## 2.8 Race Pace — `GET /api/analysis/race-pace/{year}/{round}`

Top-20 fastest laps, race-pace evolution (multi-line lap times), race-pace box plot, lap-time
scatter, position evolution (straight from `laps.Position`). Clean-lap filter and the 107%
outlier cutoff applied server-side.

## 2.9 Pit analysis — `GET /api/analysis/pitstops/{year}`

**Labelled "Pit Lane Time Loss", not "Pit Stop Time"** — PitIn→PitOut includes driving the
pit lane, so it is ~20–25s, not the 1.99s stationary time, which isn't in the data. The UI
says so plainly. Genuinely useful for strategy: total stops, stops per race, loss per
circuit, team comparison, consistency box plots.

## 2.10 Track DNA — `GET /api/analysis/track-dna/{circuit}` *(if budget allows)*

Circuit fingerprint from telemetry: full-throttle %, avg/top speed, braking events, corner
mix, tyre stress. Uses geometry helpers that already exist. Lowest priority.

---

# PART 3 — Navigation

The new pages push the 19-item icon dock past breaking point. Minimum viable fix now
(the full redesign is parked):

```
RACING     Home · Live · Schedule · Results · Standings
ANALYSIS   Race Pace · Consistency · Head to Head · Driver Stats · Pit Analysis · Telemetry
REFERENCE  Drivers · Teams · Circuits · History · News
PLAY       Fantasy · Predictor · Quiz · Games · Feed · Paddock
```

Grouped, labelled, with the existing ⌘K search promoted. No icon memorisation.

---

# PART 4 — Existing features QA

You asked that everything runs perfectly. After the feature work, one full pass:
every route rendered and read back in the browser, console clean, live timing still
updating, and fantasy/predictor/quiz submissions still working.

---

# PART 5 — Verification

Per phase, not just at the end:

1. `npx tsc --noEmit` clean; `npm run build` exit 0 — **run via bash**, PowerShell's
   `Select-Object -First` truncates the pipeline and reports a false failure
2. New endpoints swept for 500s and NaN (NaN is invalid JSON and breaks the client)
3. Every route **rendered in the browser and read back** — HTTP 200 proves nothing about
   client render, a lesson already learned on `/live`
4. **Network panel shows no duplicate requests** — the specific SWR success criterion
5. Cold vs warm vs post-restart timings recorded for each new endpoint
6. Live timing still updates; game submissions still work
7. Measured on a production build, not `next dev`

---

# Phase order

| # | Phase | Why here |
|---|---|---|
| 0 | Save `FRONTEND_REDESIGN.md` to the repo | Park the redesign without losing it |
| 1 | **SWR + code splitting** | Fixes the lag; every later page benefits |
| 2 | News | Self-contained, new router, no FastF1 risk |
| 3 | Standings evolution charts | Zero backend work — data already there |
| 4 | Results + Schedule/Mapbox | Needs your Mapbox token |
| 5 | Driver Stats + Sankey | Heaviest new endpoint |
| 6 | Head-to-Head | Reuses Driver Stats groundwork |
| 7 | Consistency + Race Pace | Shared box-plot primitives |
| 8 | Pit analysis | |
| 9 | Navigation regroup | After the page count is known |
| 10 | Track DNA *(optional)* | |
| 11 | Full QA + perf measurement | |

---

# What I need from you

- **Mapbox public token** → `NEXT_PUBLIC_MAPBOX_TOKEN` in `frontend/.env.local`
  (mapbox.com → free account → Tokens). Blocks **only** Phase 4; everything else proceeds.
- *Optional:* NewsAPI key → `NEWSAPI_KEY` in the backend env. News works fully without it.

---

# Risks

| Risk | Mitigation |
|---|---|
| SWR migration breaks working fetches | Migrate per-route, typecheck + render-verify each; the existing `cancelled` flags stay until each route is proven |
| New analysis endpoints are slow cold | Same disk-cache-by-round-count pattern that took standings 16s → 0.24s |
| RSS feeds change or die | Per-source try/except; one dead feed can't take down `/api/news` |
| Mapbox token absent | Map degrades to the SVG outline rather than erroring |
| Pit-lane numbers mistaken for real stop times | Metric named "Pit Lane Time Loss" everywhere + an explainer in the UI |
| Regressing the ~40 earlier bug fixes | Invariants in memory + `DESIGN.md`; `tsc` + build gate every phase |

---

# Appendix — PARKED: frontend redesign decisions

Preserved so the work already done isn't lost. Phase 0 writes this into the repo.

**Approved:** dual-mode (cream editorial `#F2F0EA` → ink technical `#0B0C0E`); **F1 red
`#E10600` as the only chroma** — no borrowed neon, discipline is *scale* (red at 40vw =
brand, red at 4px = state); timing colours stay F1-canonical and data-only; Archivo Expanded
/ Inter / IBM Plex Mono via `next/font`.

**Governing rules:** *never sacrifice information hierarchy for cinematic presentation*, and
the **motion budget** — 1 primary + 1 secondary animated element per viewport.

**Motion tiers:** micro 120–200ms · UI 200–450ms · cinematic scroll-driven.

**Phase order:** audit ✅ → tokens → type+nav → **hero prototype** → **visual QA (hard stop)**
→ homepage → race weekend → driver/team → track → telemetry → dataviz → motion → mobile →
perf → a11y → final QA.

**Hero spec:** black; `2026 / ROUND 14 / DUTCH GRAND PRIX`; massive image; track geometry
drawing behind; `ZANDVOORT`; tiny contextual data; scroll cue; subtle red only.

**Scroll scenes:** race name → track expands → track becomes P1/P2/P3 → race data becomes
LAP 42 telemetry deltas.

**Key finding:** the neon track visualiser is ~80% built —
`/api/livetiming/track/{y}/{r}/details` already returns points, numbered corners, marshal
sectors and rotation, and `geometry.ts` has the projection/rotation/path/DRS-detection
helpers. Styling + motion, not a rebuild.

**Open question for the QA gate:** you chose cream editorial but specified a BLACK hero.
Hero is dark; whether other editorial surfaces go cream gets decided with it on screen.

**Asset note:** `HeadshotUrl` in FastF1 results supplies official photos for all 22 drivers —
this removes the 14-missing-driver-images blocker. Cut-out PNGs are still better for the
type-collision effect, but this is a working fallback.

## Files

**New backend:** `routers/news.py`, `routers/analysis.py`; `lat`/`lng` added to `data/circuits.py`

**New frontend:** `lib/api/client.ts` (SWR), `app/news/`, `app/schedule/`, `app/results/`,
`app/analysis/{race-pace,consistency,head-to-head,pit-analysis}/`,
`app/drivers/[driverNum]/stats/`, `components/charts/*` (Sankey, bump, box plot, evolution)

**Modified:** every page's fetch → `useApi`; `main.py` router registration; nav component;
`.env.local` (Mapbox token)

**Untouched:** live timing internals, game/community features, existing bug fixes
