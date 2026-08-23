# F1 Dashboard — Project Handoff

**Last updated:** 2026-08-21 · Read this first in a new session.

Related docs (read as needed, don't duplicate them here):

**The two plans** — both approved by the user, both preserved:
- `f1-dashboard/FEATURES_PLAN.md` — features + performance. **All 12 phases DONE.**
  Keeps the feasibility reasoning (what FastF1 can and can't support) and the phase table.
- `f1-dashboard/frontend/FRONTEND_REDESIGN.md` — the editorial/cinematic redesign.
  **Approved but PARKED, not started.** Full spec: dual-mode palette, hero, scroll scenes.

**Conventions**
- `f1-dashboard/frontend/DESIGN.md` — the current "PIT WALL" UI contract (what's built today)
- `f1-dashboard/frontend/AGENTS.md` — Next.js version warning + repo conventions

---

## 1. What this is

A Formula 1 intelligence platform.

**Two front doors, as of 2026-08-22:**
- **`/` is the landing page** — a cinematic scroll: an F1 car explodes into its parts over three
  viewports while the race name, circuit dossier and news scroll over it. No tools, no tables.
  It exists to open the site with.
- **`/dashboard` is the app** — the "Welcome back" hub with the weekend panel, Follow Along,
  standings and every feature. This is what used to live at `/`. All the data is here.
- The top-centre **F1 Dashboard** link and the dock's first icon both go to `/dashboard`.

**40 routes** — `/analytics` folded into `/analysis`,
plus `/follow` (Follow Along) and `/race-engineer` (Race Engineering).
- **Backend:** FastAPI + FastF1 (+ OpenF1, Jolpica/Ergast, F1 SignalR live bridge) on `:8000`
- **Frontend:** Next.js 16 (Turbopack) + React 19, TypeScript, inline styles, framer-motion, recharts on `:3000`
- **Season:** 2026, currently 11 of 23 rounds complete

State: **build green, tsc clean, all 40 swept routes render real content, no console errors,
zero horizontal overflow at 375px.** The features plan is fully delivered.

---

## 2. How to run it

```bash
# Backend — MUST be launched detached or Windows reaps it when the shell exits
powershell -Command "Start-Process python -ArgumentList '-m','uvicorn','main:app','--port','8000' -WindowStyle Hidden"
# (run from f1-dashboard/backend)

# Frontend
cd f1-dashboard/frontend && npx next dev

# Or the one-click production launcher (build + start + Cloudflare tunnel)
GO-LIVE.cmd
```

**Site loads but every page is empty?** The backend isn't running — that's the single most
common failure here, and the app now shows a banner saying exactly that. Start it from
`f1-dashboard/backend` and hit Retry.

**Port already in use?** `Get-NetTCPConnection -LocalPort 8000 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }`

`.claude/launch.json` has two entries: **`f1-frontend`** (dev, :3000) and **`f1-frontend-prod`**
(`next start` on :3001). Use the prod one for anything performance- or layout-related — they can
run side by side, so you can compare. `next start` serves `public/` from disk at request time,
so after adding a static asset **restart it**; a rebuild alone won't help.

---

## 3. Verification assets — run these first

A captured live feed plus six scripts that check the real parsers against it. They exist because
the interesting states (mini-sector colours, qualifying cuts, a tyre fitted used, a session going
live) only occur while a session is actually running, and can't be summoned on demand.

**Fixture:** `backend/fixtures/livetiming-sprintquali-zandvoort-2026.json` — six snapshots 10s
apart of the real F1 SignalR feed during 2026 Dutch GP sprint qualifying. All four mini-sector
colour codes, 266 segment transitions, qualifying `SessionPart`/`NoEntries`, and stints with used
sets. **Don't delete it** — without it none of the live features can be developed off-weekend.

```bash
cd f1-dashboard/frontend
node scripts/stint-age.test.mjs          # tyre age vs stint length (the "24L on lap 16" bug)
node scripts/qualifying-cuts.test.mjs    # Q1/Q2 cut-line placement, knocked-out drivers
node scripts/minisector-parse.test.mjs   # segment status codes, speed traps, stint shape
node scripts/broadcast-delay.test.mjs    # delay buffer selection, never leaks fresher data
node scripts/live-poll-schedule.test.mjs # OpenF1 poll cadence + backoff
node scripts/live-poll-store.test.mjs    # shared poller, 429 fallback, both-sources-down
node scripts/battle-gaps.test.mjs        # Follow Along gaps + gap-trend maturing
node scripts/driver-story.test.mjs       # Follow Along event derivation from snapshot diffs
node scripts/lap-trace.test.mjs          # telemetry join: speed onto position, corner lookup
node scripts/telemetry-delta.test.mjs    # lap time delta: interpolation, sign, shorter-lap clipping
```

There is no test runner; these use `jiti` (already a dependency) to import the real TypeScript, so
they check shipped code rather than a copy. All eight pass as of this handoff.

**jiti can't do two things**, which is why the pure logic lives where it does:
it cannot parse **JSX**, so anything a script imports must be a `.ts` file, not `.tsx`; and it does
not resolve the **`@/` path alias**, so files under `lib/` import each other **relatively**
(`./live`, not `@/lib/live`). A *type-only* `@/` import happens to work because it's erased —
that's the trap. Keep them relative so adding a value import later doesn't break the tests.

Gate before calling anything done: `npx tsc --noEmit`, `npm run build`, the eight scripts, then open
the page and read it back.

---

## 3b. Verification — the gotchas that cost time

1. **Run `npm run build` via bash, NOT PowerShell.** PowerShell's `Select-Object -First N`
   truncates the pipeline and kills the process, reporting a false **exit 255**. The build
   is fine; the shell lied. Use `npm run build 2>&1 | tail -40`.
2. **HTTP 200 proves nothing about client render.** Always open the page and read it back
   (browser tools / `get_page_text`) plus check console errors. Learned the hard way on `/live`.
3. **Stale Turbopack.** After many file changes the dev server can serve a cached broken
   module and report an error already fixed on disk. `touch` the file, or `rm -rf .next`.
4. **Dev mode is much slower than production.** Judge performance against
   `npm run build && npx next start`, not `next dev`.
5. **The agent Browser pane runs hidden, so `requestAnimationFrame` never fires.**
   Consequences that look exactly like bugs but aren't: framer-motion never animates, so
   elements sit at **opacity 0** forever; `AnimatePresence` exit animations never complete, so
   dismissed panels pile up in the DOM; `:focus` never matches (`document.hasFocus()` is false)
   even though `element.focus()` does set `activeElement`; and screenshots fail outright.
   **Verify state, not appearance** — read text and the DOM, walk `document.styleSheets` to
   confirm a CSS rule exists, and mirror React state onto a `data-` attribute when it is only
   observable through an animated element. `GlassDockNav` carries `data-open-group` for exactly
   this reason. I lost real time concluding the dock's Escape-to-close was broken when the state
   had been updating correctly the whole time.
6. **Measuring mobile:** load routes into a 375px-wide `<iframe>` and compare
   `documentElement.scrollWidth` to `clientWidth`. Static analysis missed both real overflows;
   measurement found them in one pass. Note content inside an `overflow-x: auto` wrapper is
   *supposed* to be wider — compare the page, not the element.

---

## 4. What has been done

### 4a. Bug-fix pass (~40 bugs)
Full audit of backend + frontend. Highlights:
- **Public tunnel was completely broken** — `.env.local`'s `NEXT_PUBLIC_BACKEND_URL` is inlined
  at build time and won over the hostname check, so every remote visitor hit *their own*
  localhost. `resolveBackendUrl()` now tests hostname FIRST.
- Standings `fastest_laps` was always 0 (FastF1 has no such results column).
- Season stats: `"CHEQUERED"` contains `"red"` → 11 phantom red flags; VSCs never counted
  (feed says `"VSC DEPLOYED"`, not `"VIRTUAL SAFETY CAR"`); safety cars 3× over-counted.
- Driver Career tab was permanently empty (page passes car number, Jolpica needs a slug).
- Championships were always 0 (Jolpica rejects that query; code read `MRData` off the error body).
- Ctrl+F / Ctrl+P / Ctrl+S hijacked by single-letter nav shortcuts.
- `/live` never started polling if opened >10 min early, and never stopped after.
- Race Engineer sent an empty conversation history every turn.
- Alerts went deaf after 40 race-control messages.

### 4b. Performance
- **Backend:** `CACHE_TTL` was **300s** while the work behind it cost 15–40s. Now 3600s, plus
  disk-cache keyed by completed-round count. Measured, backend restarted in between:
  standings **16.0s → 0.24s**, season-stats **15.8s → 0.23s**, driver season **33.9s → 0.22s**.
- **Frontend:** `swr` was installed but **used nowhere** — every component fetched
  independently (`/api/sessions/calendar/2026` fired 3× per page load; `lib/notify.ts` in the
  root layout refetched it on *every page of the site*). Now everything reads through
  `lib/api/client.ts`. **Home page: 8+ requests → 4, zero duplicates.**

### 4c. UI pass
~20 files brought onto the PIT WALL system (flat panels, 2px corners, token palette,
`.font-num` numerals, 1560px shell, KPI tiles, side rails). Includes telemetry (was a 1200px
column of 60px sparklines), analytics, standings, calendar, all race pages, drivers, teams,
search, history, season-stats, circuits, global chrome, shared components.

### 4d. New features
| Route | Notes |
|---|---|
| `/news` | 6 RSS feeds merged, deduped, cached 15 min. ~154 live articles. No API key needed. |
| `/schedule` | 23-round carousel + circuit hero. Mapbox-ready (needs token), SVG fallback. |
| `/results` | Round + session picker, grid-vs-finish deltas, podium rail. |
| `/analysis` | 4 tabs at the time: Race Pace · Consistency · Head-to-Head · Pit Analysis. **Superseded by 4e** — now nine tabs. |
| `/driver-stats` | KPIs, **Start→Finish Sankey**, finish distribution, points evolution, laps led. |
| standings | Points Evolution + Ranking bump chart + Points-by-Race (zero backend work). |

New backend: `routers/news.py`, `routers/analysis.py`. All analysis endpoints warm at **~0.2s**.

---

### 4e. The final phase (2026-08-21) — merge, nav, Track DNA, QA

**`/analytics` merged into `/analysis`.** The two hubs overlapped (both were "pick a round,
look at race pace") and split the analysis surface in half. Now one page, **nine tabs in three
labelled groups**, deep-linkable with `?tab=`:

| Group | Tabs |
|---|---|
| Performance | Race Pace · Pace Ranking · Tyre Deg · **Track DNA** |
| Comparison | Head to Head · Consistency · Pit Analysis |
| Simulation | Strategy Sim · Championship |

- The four views from the old route live in `components/analysis/AnalyticsHub.tsx`, driven by
  `{ tab, round }` props. Its internals are otherwise **unchanged** from the original page —
  the derived state in there is tangled enough that lifting it out was not worth the risk.
- The shell owns the header, the tab strip and one shared round picker (the R1..Rn chip strip
  replaced the old number input). `round: true` in the tab registry marks the per-session views.
- `AnalyticsHub` is deliberately **not keyed by tab** — keying would throw away loaded pace /
  degradation data and sim inputs every time you moved between its own four tabs.
- `AnalyticsHub` and `TrackDNA` are `next/dynamic({ ssr: false })`, so nine tabs don't all ship
  in the first chunk. `/analysis` first load: **1249 KB JS, 3 API calls, 0 duplicates.**
- `/analytics` is now a redirect stub → `/analysis?tab=pace-ranking`. Every in-app link,
  the ⌘K search index and the `a` keyboard shortcut were repointed.

**Navigation regrouped (plan phase 9).** The dock was a flat strip of **25 icons** — every route
in one row, distinguished only by a lucide glyph and a hover tooltip, and already scrolling
sideways at 1280px. It now carries **seven** controls: Home, four groups (Racing · Analysis ·
Reference · Play), Search, Profile. Selecting a group opens a labelled panel above the dock
listing its routes with names and one-line descriptions — nothing depends on icon recognition.
Escape and outside-click close it; the dock marks whichever group owns the current route.
`ROUTE_GROUPS` in `components/layout/GlassDockNav.tsx` is the single source of truth.

**Track DNA (plan phase 10).** `GET /api/analysis/track-dna/{year}/{round}?session_code=Q`.
Circuit fingerprint from the fastest lap's car telemetry — time-weighted throttle/brake/coast
split, top/avg/min speed, corner count and apex-speed bands, braking events, gear mix.
Discriminates circuits properly: Monaco reads 37% full throttle / 12 slow corners / 129 km/h
average apex; the Hungaroring 46% / 6 slow / 158 km/h.

**QA (plan phase 11).** Measured on a **production build**, not `next dev`:

| Check | Result |
|---|---|
| Routes rendered + read back | **40/40** real content |
| `NaN` / `undefined` / `Infinity` / `Pnull` in visible text | **none** |
| Horizontal overflow at 375px | **0 px on all 33 page routes** |
| Duplicate API requests | **none** (home 4 calls, `/analysis` 3) |
| Prod TTFB / DCL | home 9 ms / 38 ms · `/analysis` 10 ms / 153 ms |
| Backend, warm | every analysis endpoint **~0.21 s** |
| Backend, post-restart | ~0.22 s (disk cache survives) |

**Accessibility pass.** Global `:focus-visible` ring (there were 18 `outline: none`
declarations and **no** focus rule anywhere, so keyboard focus was invisible); a skip link;
`aria-label` on icon-only buttons and unlabelled selects/inputs; `Field` wrappers changed from
`<div>` to `<label>`; the reaction-test gantry and feed tag chips changed from `<div onClick>`
to real buttons; dialog semantics + Escape on the calendar-sync modal; `role="navigation"` on
the dock. **116 hard-coded greys** (`#6B7280` at 4.05:1, `#4B5563` at 2.59:1) replaced with
`var(--muted)` (6.3:1) — the token always passed, the hard-coded values never did.

**Mobile pass.** `.map-grid` was applied in `app/map` but **had no CSS rule anywhere**, so its
280px sidebar minimum crushed the circuit column; the battlestation panes never collapsed;
several `minmax(Npx, 1fr)` tracks couldn't shrink below their minimum. Plus two real overflows
found by measurement, not by reading code — see the invariants table for the `min-width: 0` rule.

**PWA icons.** `manifest.json` referenced `/icon-192.png` and `/icon-512.png`, neither of which
existed — two 404s on every page load. Generated from the existing brand mark (F1 red tile,
white "F1", same as the Navbar logo).

**OpenF1 polling rewritten.** `useLiveStatus()` drives the LIVE NOW pill, which the root layout
renders on every page. It used to be a bare `setInterval(check, 60_000)` **inside the hook**, so
it made one external request per minute *per mounted component* — `/` and `/paddock` each mount
their own alongside the pill, so `/` made two — forever, regardless of whether a session was
anywhere near running, and in background tabs. A fast pass over the site earned **HTTP 429**
from OpenF1.

It is now a single module-level poller behind `useSyncExternalStore`, shared by every caller:
- **Paces itself off data it already has.** `sessions?session_key=latest` returns
  `date_start`/`date_end`, so `nextLiveCheckDelay()` picks 60s when live or within 20 min of a
  start, otherwise up to 10 min — never sleeping past the moment `sessionIsLive()` flips.
- **Backs off on failure** — 1, 2, 4, 8, 10 min, capped. This is what a 429 storm actually needs.
- **Sleeps while `document.hidden`**, resuming on `visibilitychange`. The first check on mount is
  unconditional, so opening the site mid-session still shows the pill at once.
- **Keeps the last known state when both sources fail** rather than flapping to "not live".

Measured: `/` → paddock is now **1 OpenF1 request total**, down from ~3-4.

Two throwaway-proof scripts were kept, since the interesting states can't be reached from the UI
unless a race is running (the project has no test runner; these use `jiti`, already a dependency,
to import the real TypeScript):
```bash
node scripts/live-poll-schedule.test.mjs   # 24 cadence + backoff cases
node scripts/live-poll-store.test.mjs      # live path, 429 fallback, both-sources-down
```


### 4f. Real track outlines + Gemini support (2026-08-21)

**The `svgPath` values in `data/circuits.py` were fabricated.** Hand-drawn squiggles that did
not resemble the circuits they claimed to be — Zandvoort and Monza rendered as near-identical
scribbles on `/schedule`. They were rendered in three places, at three *different* hard-coded
viewBoxes (420, 420, 200) for the same path data, so at least one was always mis-scaled too.

All 23 are now traced from **real FastF1 car position telemetry** — the logged X/Y around a
flying lap, rotated by `circuit_info.rotation` (the angle that puts a circuit in the
orientation people recognise), fitted to a 1000x1000 box with aspect ratio preserved.

- `GET /api/circuits/{key}/outline` builds one — permanently disk-cached, and it walks back
  through previous seasons because an upcoming round has no session data yet. Returns the
  path, numbered corner markers in the same coordinate space, and the resolved source year.
- `backend/scripts/trace_circuit_outlines.py` regenerates every `svgPath` in the data file
  from that endpoint, so pages pay nothing at runtime. Re-run it if a layout is revised.
- **Quality gate, not just an exception gate.** 2026 Hungary's position data is degraded —
  every lap has a median step of **0** (stalled samples) plus a 3472-unit teleport — and it
  drew a jagged polygon that was not the Hungaroring. `_trace_score()` rejects any trace whose
  max/median step ratio exceeds 12 or whose median is 0, `_best_pos_trace()` scores the eight
  quickest laps rather than trusting `pick_fastest()`, and a whole session that fails falls
  through to the previous year. Hungary now resolves to 2026 Q; Monza/Zandvoort/Spa to 2025 R.
- `CIRCUIT_VIEWBOX` in `lib/constants.ts` is now the single viewBox for all render sites.

**The AI engineer runs on Gemini or Claude.** `routers/engineer.py` was Anthropic-only. It now
picks a provider from whichever key is set — `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) or
`ANTHROPIC_API_KEY`, Gemini first, `ENGINEER_PROVIDER` to force one. Models override via
`GEMINI_MODEL` (default `gemini-2.5-flash`) / `ANTHROPIC_MODEL`. With no key it still answers
from the same live context with the rule-based fallback, and a bad key degrades to that rather
than erroring.

`GET /api/engineer/status` reports `{ai, provider, model}`; add **`?probe=1`** to make one real
API call and get `{ok, detail}` back — that surfaces "API key not valid" or a wrong model id
directly, instead of every answer silently falling back.


### 4g. Broadcast delay + backend-offline banner (2026-08-21)

**"Nothing is loading" was the backend process being dead, not a code bug.** Every page reads
from `:8000`, so with that process down the whole site renders as empty shells with no
explanation. It now says so: `BackendOfflineBanner` shows a fixed bar naming the problem and
the command to fix it, plus a Retry that revalidates every SWR key. Verified by actually
killing the backend, seeing the banner, restarting, and hitting Retry to recover.

Reachability is tracked in `fetcher` — the single choke point for all reads — and only a
*connection* failure counts. A 404 or 500 means the backend answered, which is a different
problem and must not raise the banner.

**Broadcast delay.** Every TV feed runs behind the timing data, so the tower was spoiling
overtakes before they appeared on screen. `/live` has a Delay picker (Off · 15s · 30s · 1m ·
1m 30s · 2m), persisted in `localStorage`.

It is applied **inside `useLiveSession()`**, not in the page — so `/live`, the track map and
both pop-out widgets all honour one setting. Delaying the tower while the map still showed
live car positions would just move the spoiler.

- Only engages while `status === 'live'`. With nothing live there is nothing to spoil, and
  buffering off-session would have stranded the page on "loading" for a minute on a quiet day.
- While the buffer fills it **withholds** (`status: 'loading'`, `delayBuffering: true`) rather
  than falling back to live data — showing current positions on a page whose whole job is to
  be late would spoil exactly the moment the user asked to hide.
- A 1s ticker advances the delayed view between polls, otherwise it freezes.
- `selectDelayedSnapshot()` is pure and exported so the maturing/boundary cases are testable:
  `node scripts/broadcast-delay.test.mjs` (11 cases, including "never returns a snapshot
  younger than the delay" swept across 200 values).

**`GO-LIVE.cmd` served stale code.** It built only `if not exist ".next\BUILD_ID"`, so the
first run baked a build and every later run reused it — code changes never reached the public
link. It now always rebuilds (~10s).


### 4h. Broadcast-grade live timing (2026-08-21)

Rebuilt `/live` to match a professional timing screen. **Everything here was verified against a
real running session** (2026 Dutch GP sprint qualifying), not just the fixture.

**Mini-sectors.** F1's `TimingData` splits each sector into segments and reports a status per
segment as the car passes it — **24 per lap at Zandvoort** (8 per sector). The bridge was
already receiving this and throwing it away. Status codes, confirmed live:

| Code | State |
|---|---|
| `0` | not yet timed (grey) |
| `2048` | yellow |
| `2049` | green — personal best |
| `2051` | purple — session best |
| `2064` | pit lane (blue) |

`miniSectorState()` maps them, defaulting unknown non-zero codes to yellow rather than dropping
a timed segment. Verified in the browser with all four colours on screen at once (87 green,
21 yellow, 11 purple, rest grey across 528 segments).

**Timing / Stints views.** One tab strip over the tower, two column layouts. Stints come from
`TimingAppData.Lines[].Stints[]` — compound, laps, and tyre age, on one shared horizontal scale
so strategy is comparable across the grid. Used sets render at reduced opacity; the feed sends
`New` as the **string** `"true"`, so parsing it as a boolean makes every tyre look new.

**Team Radio.** `"TeamRadio"` added to `TOPICS`. Captures carry a `Path` relative to
`SessionInfo.Path`; the playable URL is `https://livetiming.formula1.com/static/` + both. Plays
one clip at a time.

**Best Lap Benchmarks.** `GET /api/analysis/benchmarks/{year}/{round}?session_code=` — session
best from the live tower, lap record from `data/circuits.py`, plus a scan of the last five
seasons. Matches the broadcast numbers exactly (Zandvoort lap record 1:11.097 Hamilton 2021,
track record 1:08.662 Piastri 2025).
- `track_record` is *the fastest Q/R lap in the seasons scanned*, not a genuine all-time record.
  The payload carries `seasons_scanned` and a `note` saying so.
- A circuit hosting its first sprint weekend has no previous sprint qualifying at all. Rather
  than leave the row blank, it falls back to the nearest equivalent (SQ→Q, S→R), returns the
  session it actually used, and the UI labels it **"Previous qualifying (closest match)"**. The
  reference site we were copying shows that same Q time labelled as a sprint-quali edition,
  which is simply wrong.

**Fixture.** `backend/fixtures/livetiming-sprintquali-zandvoort-2026.json` — six snapshots 10s
apart, all four colour codes, **266 real segment transitions**. Segment data only exists while a
session runs, so without this none of the above can be developed or tested between race
weekends. `node scripts/minisector-parse.test.mjs` runs the real parser against it.

**Degradation:** all of this is F1-source-only. On the OpenF1 fallback `miniSectors`, `speeds`
and `teamRadio` come through empty and the UI drops to plain sector times and hides the radio
panel — it must not break.


### 4i. Follow Along, tower fixes, qualifying cuts (2026-08-21)

**Three bugs off a user screenshot of `/live`:**

1. **Rows stuck invisible.** LEC (P3) and ANT (P5) rendered blank. The rows were in the DOM with
   full content but at `opacity: 0` — the entry tween never completed. Cause: `layoutId` plus a
   per-row `delay: index * 0.03` stagger. `layoutId` marks a row as a shared-element transition
   target, and when the tower re-sorted mid-stagger the entry animation was interrupted and stuck.
   Fixed with `layout="position"` + `initial={false}` — reordering still animates, entry doesn't.
2. **PIT and TYRE cut off.** The grid was 1034px inside an 840px column. Trimmed the column widths
   and the gap → **0px overflow**, every column visible without scrolling.
3. **Added an Expand toggle** anyway, which hides the side rail and gives the tower the full
   1238px — useful on the Stints view.

**Qualifying elimination.** `TimingData` carries `SessionPart`, `NoEntries` and `KnockedOut`, all
previously ignored. At Zandvoort `NoEntries` read `{0: 22, 1: 16, 2: 10}` — 22 start, 16 survive
SQ1, 10 survive SQ2 — so the cut lines go after rows 16 and 10. Eliminated drivers are dimmed and
desaturated; each cut line shows how many went out, and the segment currently running shows the
cut-off time instead. `node scripts/qualifying-cuts.test.mjs` (14 checks) verifies the placement
against the fixture, including that every `KnockedOut` driver really does sit below the cut.

**`/follow` — Follow Along.** One click from the dock. Optional driver pin, persisted.
- Pinning a driver **is** the alert setup: it sets `myDriver` on the existing alert engine and
  switches it on, so there's no second configuration step.
- Focus card: position, gap, interval, last/best lap, tyre, mini-sectors, stints, and the cars
  directly ahead and behind.
- Season form for that driver from `/api/analysis/driver/{abbr}/{year}`.
- Session clock (time left in the running session, and time to the next one), order table, race
  control, and the engineer chat.
- Inherits the broadcast delay, because it renders from the same `useLiveSession()`.

**Landing page was slow because of a 22 MB video, not the API.** `components/home/VideoBackground.tsx`
had `preload="auto"` on `public/video/f1-intro.mp4`, which began downloading at ~390ms — *before the
page issued a single API request* — and starved the data calls. It's now `preload="none"` with the
`src` attached after window `load`. Video requests now start at ~850ms, after the first API call.
The page also rendered nothing at all until data landed; the stat row, next-race panel and podium
now mount immediately as `.shimmer` skeletons, and the standings tables + the WebGL button are
`next/dynamic({ ssr: false })`.
*Still one round-trip behind:* the podium needs a round number and only the calendar or standings
can supply it. A `/api/sessions/latest/R/results` endpoint would remove that hop.

**Season switcher — 2026 / 2025 / 2024.** `lib/season.tsx` is a module-level store (same
`useSyncExternalStore` pattern as the broadcast delay, no provider needed), persisted to
`localStorage` under `f1.season` and validated against the allowed list. The hooks in
`lib/api/hooks.ts` now default their `year` to the selected season, so SWR keys change and data
refetches automatically. Verified: switching to 2025 loads the real 2025 season (Norris champion,
24/24 rounds, "Final").

**`components/live/TimingTower.tsx` — the tower is now shared.** `/follow` originally had a
simplified order table, which meant two implementations to keep in step. The header row, driver
rows, tyre state, mini-sectors and qualifying cut lines all live in one component now, used by
both `/live` and `/follow`. Verified by rendering both and diffing: identical rows, byte for byte.
Follow Along also carries the weather strip, track map, benchmarks and team radio, so it is the
same data set as the live page rather than a subset.

**Follow Along entry points:** a full-width CTA under the home hero, an Explore card, a direct
dock button, and an entry in the Racing group.

**Dropped: Kalshi.** Investigated and cancelled by the user on 2026-08-21. For the record, if it
ever comes back: `api.elections.kalshi.com` and `api.kalshi.com` don't resolve from this machine,
`trading-api.kalshi.com` returns 401, and it needs API-key + private-key signing. Don't re-open it
without being asked.

### Race Engineering (2026-08-21)

Plan a tyre strategy by dragging compounds onto a stint bar, then see where it would have
finished against the real classification.

- `components/engineer/StrategyBuilder.tsx` — the drag-and-drop stint editor. Native HTML5 DnD is
  **mouse-only**, so every drag action has a button equivalent: compound buttons re-shoe the
  selected stint, −/+ resize it, arrow keys resize a focused stint, "Add stint" appends. Dragging
  is the fast path, not the only path.
- Adding a stint takes its laps out of the **longest existing stint** rather than extending the
  race, and removing one hands its laps to a neighbour — so the plan stays near race distance
  instead of drifting.
- `components/engineer/RaceEngineer.tsx` — the panel: builder + safety-car/rain inputs + results.
  Used by `/race-engineer`, the `/analysis` **Race Engineering** tab (which replaced the old
  Strategy Sim), and `/follow` when a driver is pinned.
- Backend: `POST /api/analysis/race-engineer/simulate` — multi-stint, with pace and degradation
  **fitted from the actual race** rather than the hard-coded `{SOFT: 0.09, MEDIUM: 0.05}` the old
  single-stop sim used.

**This is a model, and the UI says so.** The response carries a `model` block naming what was
measured versus assumed. Two caveats are rendered *loudly* above the fold, not in a footnote:
- **Extrapolation.** A plan running a compound longer than any stint actually run in that race is
  flagged — the fitted line has no cliff, real tyres do.
- **The fuel-burn artefact.** Degradation fitted from a race can't separate a car getting lighter
  from a tyre wearing out, so a compound run late on a light car reads artificially quick and
  low-deg. At 2026 Hungary this inverts the expected order (HARD +0.042 s/lap vs SOFT +0.009).
  When the fit puts a harder compound above a softer one, the UI says why. Without this a user
  would reasonably conclude "always run hards".

**Comparison is model-vs-model.** `delta_vs_actual_s` is the plan simulated minus the driver's own
real stint plan simulated through the same code, so the difference is attributable to strategy
rather than to model bias. `projected_position` is `actual_time + delta` slotted into the real
classification, keeping it in real-race units.

**A distance guard refuses rather than lying.** If the plan's lap count doesn't match what the
driver actually ran, `delta_vs_actual_s` is null with the reason shown. This exists because I
tested with `total_laps=57` at a 70-lap circuit and got "18 minutes faster"; the entire gap was
13 laps of ordinary lap time. `useRaceLaps()` in `lib/api/hooks.ts` now resolves the real distance
from the circuit record, because **the calendar carries no lap count**.

**Lapped runners** are classified but cover fewer laps, so their total isn't comparable. They rank
by laps-then-time like the real classification, carry a null time, and are held out of the
comparison list with a count of how many and why — never shown as "0:00".

The old `POST /api/analytics/strategy-sim` and the AnalyticsHub Strategy Sim branch still exist
but nothing routes to them any more.

**Follow Along has its own round picker.** The round was originally derived only from the live
session's circuit, so with nothing running — or no circuit match — there was no round and the
whole Race Engineering panel silently vanished. It's now a real picker over completed rounds that
merely *defaults* to this weekend's round. Upcoming rounds aren't offered: the sim fits pace from a
race that has actually run.

**Optimisation — measured, not guessed.** The backend simulate is already ~0.206s warm, which is
essentially all local connection overhead, so it was never the bottleneck. What was actually
wasteful:
- `RaceEngineer` imported `ResponsiveContainer` from recharts and **never rendered it**, pulling a
  chart chunk for nothing. Removed — `/race-engineer` now loads zero recharts chunks.
- Identical plans re-hit the backend. There's now a client-side memo keyed on the full request
  payload, bounded at 40 entries. Pressing Run twice, or reverting an edit, costs **zero** network
  requests (verified: 1 request across two runs).
- Editing the plan clears the shown result, so a projected finish can never describe a strategy
  that's no longer on screen.

**Tyre age was double-counted.** The tower showed "24L" against a car on lap 16. The feed's
`TotalLaps` is the tyre's **cumulative age** (already including laps it had before this stint) and
`StartLaps` is the age it was fitted at — so `TotalLaps + StartLaps` counts a used set's prior life
twice, and `TotalLaps` alone is *not* the stint length. Correct forms:

    laps run in the stint = TotalLaps - StartLaps
    tyre age              = TotalLaps

Live example: NOR had run 21 laps on a used set fitted with 4 laps on it — real age 25, old formula
said 29, which is impossible with 21 laps completed. `LiveStintRow` now carries explicit
`laps` / `tyreAge` / `startAge` instead of the feed's misleading names, and the stint bars were
mis-sized by the same confusion. `node scripts/stint-age.test.mjs` pins it, including a check that
the old formula produced ages exceeding the car's own lap count.

**"28L against 24 laps" is correct, and now looks it.** After the age fix the number was right but
still read as impossible. The feed for the 2026 sprint: RUS `TotalLaps=28 StartLaps=4`, HAM `31/7`,
GAS `24/0` — every one satisfies `TotalLaps - StartLaps = 24` laps run. Most of the grid started on
a set already carrying 4 laps from sprint qualifying; GAS started on a new set, which is why his
reads exactly race distance. So the presentation had to show the carried-over life:
- Timing view renders **`28L (+4)`**.
- Stints view draws a small hatched **`+4`** nub before the bar, and the stint badge shows the laps
  actually run (`24`, matching the bar's own width) in a high-contrast dark pill ringed in the
  compound colour — the old badge was a small tinted circle that vanished on yellow and white.

**Compound colours and the tyre dot.** Pirelli's broadcast values are picked for a white TV
graphic; on this near-black UI `#FFF200` reads as a flat greenish yellow and `#FFFFFF` glares.
They're nudged warmer and more saturated while staying recognisable. The tower's tyre dot was a
thin ring that disappeared at 14px — it now has a tinted core, a faint glow and the compound
letter inside. Used sets in the stint bars are **hatched** rather than just faded, so new-vs-used
reads without relying on an opacity difference.

**New data in Follow Along.** Speed traps (I1 / I2 / FL / ST) were parsed off the feed and never
displayed anywhere — they're now on the pinned driver's card, coloured purple for session best and
green for personal best. Added alongside: tyre age against the field median, which is the number
that says whether a driver is about to have pace or about to lose it.

**Fixed in passing: `_finished()` counted 12 of 22 drivers per race as DNFs.** It matched only
`"Finished"` and `"+N Lap"`, but 2026 data uses the literal `"Lapped"`. At round 11 that meant
7/22 classified instead of 19/22, feeding wrong DNF and points-finish tallies into driver stats.

### 4j. Stint bars de-striped, and `/follow` split from `/live` (2026-08-22)

**The stint bars were hatched and it looked like static.** Used sets were drawn as a
`repeating-linear-gradient`, on the reasoning that new-vs-used should read without an opacity
difference. In practice most of the grid starts on a set carrying laps from earlier running, so the
exception *was* the rule and the whole timeline was texture — worst on MEDIUM, where `#FFD21E`
against its own darkened mix is a barber pole. Four other things were fighting in the same 13px:
two hatch patterns at different periods sat adjacent (grey `+N` nub at 4px, compound at 5px), the
lap badge was an **18px pill inside a 13px bar** so it bulged out of its own track, an `0 0 8px`
glow bloomed across segment edges, and 7px pill corners were off the PIT WALL system.

Width carries the meaning now and nothing is striped:

    grey block  = laps the set already carried    (drawn to scale, per stint)
    colour block = laps run in this stint
    the two together = tyre age

So `28L (+4)` is self-evident rather than needing a caption. Solid fills, 2px corners, no glow,
18px bar in a recessed groove, compound letter and lap count as dark ink **inside** the bar.
Verified against the real Zandvoort sprint: `anyHatch: false`, gaps to scale (HAM 7-lap carry-over
renders at 21.8% of a bar whose true share is 22.6%), zero overflow at 375px and at desktop.

Two things fell out of doing it:
- **`capText()` was dead code and also wrong.** It returned white ink for INTERMEDIATE and WET.
  Dark ink wins on *every* Pirelli compound — inter green is 10.6:1 against near-black versus
  2.0:1 against white, wet blue 6.0:1 versus 3.5:1. Only the unknown-compound grey wants white.
- **The carried-over block is now drawn per stint, not just for the first.** SAI's real sprint had
  a second used set mid-session (`carry23`) that the old code could not draw at all.

**`/live` and `/follow` had converged into the same page.** `/follow` rendered `TimingTower`,
`TrackMap`, `BenchmarksPanel` and `TeamRadioPanel` — a strict superset of `/live` plus a focus
card. There was no reason to open `/live` once you'd pinned a driver; they weren't two pages, they
were one page with a filter.

The split, and the rule that keeps it honest:

> **If it doesn't change when you change the pinned driver, it doesn't belong on `/follow`.**

- **`/live` = the session.** Third-person, whole grid, present tense. Optimised for scanning 22 rows.
- **`/follow` = your race.** First-person. Optimised for *not* scanning.

Removed from `/follow`: the 22-row tower, the benchmarks panel, the weather strip, and the
unfiltered race-control feed — all session-level and all already on `/live`. Added:

| Panel | What it does that a timing screen can't |
|---|---|
| **The fight** (`components/live/BattleView.tsx`) | Two cars each side. In a race: the gap plus its **trend** — 1.4s means nothing, 1.4s shrinking 0.8s per half-minute is the story — and a **THREAT / CHANCE** tag when a rival within 2.5s is ≥3 laps different on tyres. In qualifying: best lap and **Δ to you**, because the feed sends no gaps at all there. |
| **Their session** (`components/live/DriverStory.tsx`) | Places won and lost, stops, personal bests, and the race-control messages naming them — recovered by diffing snapshots, so looking away doesn't lose it. |

Team radio is filtered to the pinned driver. Both panels read the same delayed snapshots the tower
does, so neither can narrate ahead of the feed.

Gap maths (`lib/battle.ts`) and event derivation (`lib/story.ts`) are pure, JSX-free and tested —
66 checks across the two new scripts. Two real bugs were caught by rendering it rather than by
reading it: **P1 showed no gap at all** (the leader's own `gapToLeader` arrives blank, not `0`), and
**"measuring…" persisted forever** on an ended session, where no trend will ever arrive.

Every panel on `/follow` now changes with the pinned driver — the track map was the last holdout and
is covered in 4k below.

**Qualifying sends no gaps, and the fight panel shipped broken because of it.** The F1 feed carries
`GapToLeader` and `IntervalToPositionAhead` only in a race — in qualifying it sends `Position` and
`BestLapTime` and nothing else, because nobody is racing anybody on the road. The panel was built on
gaps and verified against a *sprint race* fixture, so it looked right and then rendered a column of
`—` for the whole of the next qualifying session. It now picks its mode from `hasTrackGaps()` — the
data, not the session name, so a race whose gaps haven't arrived degrades the same way:

| | Race | Qualifying |
|---|---|---|
| Column 3 | Gap (`+0.4s`) | Best lap (`1:13.060`) |
| Column 4 | Trend (`▼ closing −0.8s`) | **Δ to you** (`+0.004s`) |

Note the sign flips meaning: in qualifying a **negative** delta is the bad one (they're quicker).


### 4k. Time-to-first-timing-data (2026-08-22)

`/live` took **2539 ms** to put a number on screen. Measured from the resource waterfall, not
guessed. It was three serial round trips, none of which needed to be serial:

    boot() → OpenF1 /sessions        (469 ms, fails — see below)
           → bootF1() → /session     (401 ms, header metadata only)
                      → /state       ← first timing data, 2506 ms

Two fixes, now **~1150 ms** on a warm backend:

1. **`bootF1()` no longer awaits `/session` before the first `/state` poll.** `/session` supplies
   the page title and nothing else — the tower, map and every number come from `/state`. A full
   external round trip sat in front of the timing data purely to fill in a label. They run side by
   side now, and the title is patched in on arrival so it doesn't wait for the next 4s poll.
2. **`GET /api/livetiming/session` is cached for 30s.** It was an uncached hop to
   livetiming.formula1.com on *every* call, and it is called on every page mount **and** by the
   live-status poller behind the LIVE pill. **778 ms → 215 ms.** Errors are deliberately not
   cached — a transient upstream failure must not pin the app to "no session" for 30 seconds.

**Track outlines now survive a restart.** `_track_cache` was a plain in-process dict, so every
backend restart paid another ~3–5 s fastf1 load before the live map could draw, and this backend
gets restarted a lot. Finished rounds go to the disk cache. **Rounds that haven't raced yet stay in
memory on purpose** — their trace can be built from partial or degraded position data, and unlike
`/api/circuits/{key}/outline` this builder has *no* `_trace_score()` quality gate, so persisting one
would freeze a wrong circuit shape forever.

**The bridge is now probed before OpenF1.** `routers/livetiming.py`'s own module docstring says
OpenF1 "returns 401 for ALL endpoints while a session is live" — that is *why* the SignalR bridge
exists — yet `boot()` tried OpenF1 first anyway, spending ~490 ms on a call known to fail during
exactly the sessions `/live` is for. `bridgeIsActive()` asks the local `/state` (~20 ms) and, when
the bridge is feeding, goes straight to `bootF1()`.

This is a **guard added in front of the OpenF1 branch, not a rewrite of it** — the whole OpenF1 path
is byte-identical and still runs whenever the probe says no: backend down, bridge not yet connected
(`/state` starts the SignalR client on demand, so the very first probe can legitimately report
inactive), or nothing to relay. It also picks the *better* source: mini-sectors, stints, speed traps
and team radio are F1-bridge-only.

Measured on a warm reload: **401 ms** to first timing data, of which only **42 ms** is API — the
rest is the dev bundle. OpenF1 calls in the boot path went 2 → 0 (the one left in the waterfall is
the LIVE-pill poller, a separate module).

| | Before | After |
|---|---|---|
| Time to first timing data | 2539 ms | 401 ms (warm) |
| API chain after bundle | ~733 ms | ~42 ms |
| OpenF1 calls before data | 2 | 0 |

Remaining time is dev bundle/hydration plus a StrictMode double-boot that only happens in
`next dev`. Judge the real number on a production build.

**The track map is now driver-focused too**, which closes the last panel on `/follow` that failed
the rule. It takes `focus` (the pinned driver) and `highlight` (their battle window, derived from
the same `battleNeighbours()` the fight panel uses, so the two can't disagree about who the rivals
are). The focused car gets a white ring and a larger label, the fight stays lit, everyone else drops
to 26% opacity and loses their label — traffic recedes rather than disappearing, because you still
want to see where the field is. `/live` passes neither prop and is unchanged.

`mapEmphasis()` / `mapPaintRank()` live in `lib/battle.ts` and are tested, because **car positions
only exist while cars are on track** — there is no way to check the dimming or the paint order in a
browser between sessions. Paint order matters: SVG draws in document order, so the focused car is
sorted last or it ends up buried under whoever is alongside it.

---

## 5. Architecture patterns — follow these

### Backend: expensive-computation caching
Every costly endpoint uses this. Copy it.
```python
# key the disk cache by how many rounds are complete → permanent for that state,
# and the key changes by itself the moment a new race is scored
done = await asyncio.to_thread(_completed_round_count, year)
disk_key = f"{key}_r{done}"
```
`routers/analysis.py::_cached()` is the reference implementation (memory → disk → compute,
with a single-flight `asyncio.Lock` so a cold miss computes once, not once per caller).

Expensive season-wide scans (`_scan_season`, `_scan_laps_led`) are computed **once and shared**
by all 22 drivers — never per-driver.

### Frontend: all reads through SWR
```ts
import { useApi, useApiList } from '@/lib/api/client'
import { useCalendar, useStandings, useDrivers, useTeams, useCircuits, SEASON } from '@/lib/api/hooks'
```
- Prefer the **domain hook** when one exists — that's what collapses the duplicates.
- Conditional fetch: pass `null` as the key, don't guard with `if`.
- `useApiList` guarantees an array — no `Array.isArray(x) ? x : []` needed.
- Retry buttons use `mutate` from the same hook.
- **Reads only.** All POST/PATCH/DELETE stay as raw `fetch`.
- Charts are `next/dynamic({ ssr: false })` to keep recharts out of the main bundle.

---

## 6. INVARIANTS — do not undo these

Each is a fixed bug. Re-check after any refactor of these files.

| File | Invariant |
|---|---|
| `lib/constants.ts` | `resolveBackendUrl()` checks **hostname before** the env var |
| `lib/live.ts` | imports `BACKEND_URL` from constants, never re-derives it |
| `routers/standings.py` | FL point gated to `year <= 2024` (abolished for 2025+) |
| `utils.py` | `fastest_lap_driver()` derives FL from **laps**, not results |
| `season_stats.py` | flags compared **exactly** (`flag == "RED"`), never substring |
| `sessions.py` | `_iso_utc()` — all calendar timestamps emitted as ISO-8601 UTC `...Z` |
| `data/circuits.py` | `resolve_circuit_key()` returns **None** when unknown (don't slugify-fallback) |
| `race/[round]/sprint` | `r.points ?? …` — never derive points from row index |
| `race/[round]/race` | `grid_position != null` (not `!== undefined`) → avoids `"Pnull"` |
| `race/[round]/race` | `air_temp != null ? … : '—'` → avoids `"undefined°C"` |
| `race/[round]/qualifying` | `Infinity` sentinel for ideal lap; Q1/Q2/Q3 tabs; sprint-aware chips |
| `paddock/page.tsx` | `togglePin` checks `res.ok`; pin button renders only for `own` messages |
| `PollsPanel.tsx` | `poll.counts[i] ?? 0` → avoids `NaN%` |
| `fantasy/page.tsx` | wallet writes stay **outside** the setState updater (StrictMode double-charge) |
| `EngineerChat.tsx` | history read from `messagesRef`, not inside a setState updater |
| `CountdownTimer.tsx` | seeded `null`, hydrated in effect (hydration mismatch) |
| `news.py` | **defusedxml**, never stdlib ElementTree (untrusted remote XML → XXE) |
| `globals.css` | `.live-grid > *, .map-grid > * { min-width: 0 }` — grid/flex items default to `min-width: auto` and refuse to shrink below content, which is what let a chart legend stretch `/standings` to 1021px and a table stretch `/results` to 614px on a phone. Removing this reintroduces both. |
| `globals.css` | `.map-grid` has a rule at all — it was applied in `app/map` and defined nowhere |
| `globals.css` | `:focus-visible` sets **`box-shadow` as well as `outline`** — inline `outline: none` on the inputs beats the rule's `outline`, but can't beat a property it doesn't set |
| `analysis.py::track_dna` | the whole session attempt sits in **one** try/except — fastf1's `load()` returns without raising for a round that hasn't run, and only `s.laps` throws. Catching just the load turned a future round into a 500. |
| `analysis.py::_drs_zones` | returns **None**, not 0, when the DRS channel is flat — DRS was abolished for 2026, and 0 would read as a measurement |
| `analysis.py::track_dna` | unavailable rounds are cached in memory with a **TTL** and never written to disk — the session will run eventually and the answer has to change on its own |
| `analysis/page.tsx` | `AnalyticsHub` is rendered **without a `key`** — keying it discards loaded pace/degradation data and sim inputs on every tab change |
| `components/analysis/TrackDNA.tsx` | the lap-split `SplitBar` passes `total={100}` and supplies "Partial throttle" as a real segment. Letting it normalise against its own sum printed 60/27/14 next to a legend reading 46.3/20.7/10.6. |
| `CountdownTimer.tsx` | segment widths and the row gap are `clamp()`d — four fixed 56px tiles plus separators overflowed a 375px viewport |
| `lib/live.ts` | the live-status poller is **module-level**, not per-hook — putting the timer back inside `useLiveStatus` makes every mounted copy poll OpenF1 independently |
| `lib/live.ts` | the **first** check on mount runs even when `document.hidden` — this is what stops the old `/live` bug (polling never starting if the page was opened early) coming back |
| `lib/live.ts` | a failed check must **keep the last known state**, never set `live: false` — OpenF1 errors *during* live sessions, which is exactly when the pill matters |
| `lib/live.ts` | `getLiveStatusSnapshot` returns a **stable module reference**; building a new object per call makes React throw "The result of getSnapshot should be cached" in a loop |
| `data/circuits.py` | `svgPath` is **generated from telemetry**, not hand-drawn. Never author one by hand — run `scripts/trace_circuit_outlines.py`. The originals were invented and looked nothing like the circuits. |
| `routers/circuit.py` | `_trace_score()` rejects a trace with median step 0 or a max/median ratio over 12 — without it 2026 Hungary draws a jagged polygon that is not the Hungaroring |
| `lib/constants.ts` | `CIRCUIT_VIEWBOX` is the **only** viewBox for `svgPath`; it must match `OUTLINE_VIEWBOX` in `routers/circuit.py`. Three sites previously hard-coded three different values for the same data. |
| `routers/engineer.py` | every LLM path falls back to `_rule_based_answer` on **any** exception — a bad key or wrong model must degrade, never 500 the chat |
| `lib/live.ts` | the broadcast delay engages **only** when `status === 'live'` — buffering off-session strands the page on "loading" for a minute on a non-race day |
| `lib/live.ts` | an immature delay buffer **withholds** (`status: 'loading'`); never fall back to the live snapshot, that spoils the exact moment the delay exists to hide |
| `lib/live.ts` | the delay wraps `useLiveSession()` itself, so the map and widgets inherit it. Applying it in the page would leave the map spoiling positions. |
| `lib/api/client.ts` | only a **transport** failure sets the backend offline. A 404/500 means it answered — raising the banner for those would cry wolf on a single bad endpoint. |
| `GO-LIVE.cmd` | always runs `npm run build`; gating it on `.next\BUILD_ID` silently serves the first build forever |
| `lib/live.ts` | `miniSectorState()` defaults unknown **non-zero** codes to yellow — returning 'none' would blank a segment the car has actually passed |
| `lib/live.ts` | stint `New` arrives as the string `"true"`, not a boolean — `Boolean(st.New)` makes every tyre read as new |
| `lib/live.ts` | `miniSectors` / `speeds` / `teamRadio` are **empty on the OpenF1 source**; every consumer must degrade, not assume F1 data |
| `routers/livetiming.py` | `"TeamRadio"` must stay in `TOPICS`, and clip URLs need `SessionInfo.Path` — the capture `Path` alone is not playable |
| `routers/analysis.py` | `benchmarks` `track_record` is scan-bounded, not all-time; keep `seasons_scanned` + `note` in the payload |
| `routers/analysis.py` | `_fastest_lap_at` re-checks the matched event's circuit — `fastf1.get_session(y, location, …)` fuzzy-matches the whole calendar and can silently land on a different circuit |
| `app/live/page.tsx` | tower rows use `layout="position"` + `initial={false}` — restoring `layoutId` or a per-row entry `delay` brings back rows stuck at opacity 0 mid-resort |
| `app/live/page.tsx` | the grid is tuned to fit 840px with **zero** overflow; widening a column hides PIT/TYRE again |
| `globals.css` | the global type rules (Archivo Expanded on `h1`/`h2`/`.display-title`/`.section-title`, mono `.kicker` with a red rule) are **typography only**. Ground, tokens, spacing and layout stay PIT WALL. A cream editorial mode was built, sampled and rejected — don't reintroduce it. |
| `globals.css` | `.tower-row` / `.tower-head` are pinned to `font-stretch: 100%` and **must stay excluded**. Measured: Archivo Expanded pushes the DRIVER cell's content from 97px to 120px inside a 106px column and drops the tightest headers to 4px of headroom. Any other precision-fitted grid belongs in that rule, not in an override. |
| `globals.css` | that carve-out resets **only `font-stretch`**. An earlier version also reset `letter-spacing`, which silently stripped the tower header's intended 0.1em tracking. |
| `components/live/TimingTower.tsx` | `className="tower-head"` is a styling hook for the rule above, not decoration — removing it lets the expanded face back into the header row. |
| `app/layout.tsx` | the Archivo font link requests the **`wdth` axis** (`62..125`) app-wide. Without it `font-stretch` does nothing and fails *silently* — no error, just plain Archivo. |
| `components/map/lapTrace.ts` | telemetry arrives as **two series that must be joined on `time_s`** — `pos_data` has x/y and a **null** distance, `car_data` has speed and distance but no coordinates. They're sampled independently (259 vs 268 on a real lap), so pairing by index quietly puts the wrong speed on the wrong part of the track. |
| `components/map/lapTrace.ts` | `speedColour` guards `min === max`. Without it the ramp divides 0/0 and paints `rgb(NaN,NaN,NaN)`, which renders nothing at all rather than erroring. |
| `components/map/CircuitMap.tsx` | corner markers are **click- and keyboard-operable**, not hover-only — a hover-only readout doesn't exist on a touch device. They carry `role="button"`, `tabIndex`, `aria-pressed`, and a generous invisible hit circle. |
| `app/map/page.tsx` | lap comparison uses **qualifying** laps. A race fastest lap is set on arbitrary fuel and tyre age, so comparing two of them through a corner isn't comparing the drivers. |
| `app/drivers/[driverNum]` | championship **position comes from `useStandings`**, never counted from the driver's own results — position depends on the whole grid. |
| `lib/driverAssets.ts` | all 22 drivers are themed; photos are **generated** by `scripts/encode-driver-photos.mjs` from `driver pics/` at the repo root. The source filenames are misspelled ("alaex albon", "charles leclerec", "valteri bottas"), so the script maps them **explicitly** — deriving the driver from the filename silently drops people. |
| `lib/driverAssets.ts` | `getDriverTheme` falls through an `ALIASES` table (FastF1 and Jolpica disagree: "Nico Hülkenberg", "Andrea Kimi Antonelli"). A miss returns **null**, so an unknown driver renders the plain layout instead of a 404 image. |
| `app/drivers/page.tsx` | the card photo is an `<img loading="lazy">`, **not** a CSS `background-image`. With all 22 drivers themed, a background image is fetched the moment the element is styled — 839 KB on first paint for a grid you scroll through. |
| `app/telemetry/page.tsx` | the headline **lap gap comes from `lap_time_s`**, never from the end of the delta trace. Telemetry stops at the last distance *both* cars have samples for, which is not the timing line — at 2026 R1 the trace end read −0.004s (NOR ahead) when the lap times were 79.475 vs 79.380, i.e. NOR 0.095s behind. The trace end names the wrong winner. |
| `lib/telemetryDelta.ts` | `deltaTrace` clips to the **shorter** lap's distance. Past that one driver's time is clamped and the delta appears to explode at the finish line — a gap that never happened. |
| `routers/telemetry.py` | the `compare` endpoint's `delta_time()` is **dead code** — never returned, and its fallback substitutes the sample index for a timestamp. Don't wire a UI to it without fixing that first; the delta is computed client-side instead. |
| `lib/chartTheme.ts` | **all** chart chrome comes from here — grid, ticks, axis lines, tooltip. It was previously redefined in eight files with three different grid values, so charts on one page didn't match. New charts import it rather than declaring their own. |
| `lib/chartTheme.ts` | `SERIES_COLORS` deliberately excludes **purple, green and yellow** — those mean session best / personal best / caution across this app, and reusing them for an arbitrary series makes a chart look like it's reporting lap times. Team colours are reserved for teams. |
| `app/layout.tsx` | `<MotionConfig reducedMotion="user">` wraps the app — this is what makes every framer-motion animation honour the OS setting. Removing it silently reverts the whole app to ignoring the preference, with no visible symptom for anyone who doesn't set it. |
| `globals.css` | the blanket `prefers-reduced-motion` rule covers what framer-motion doesn't own (CSS transitions, keyframes, smooth scroll). Both guards are needed; neither alone covers the app. |
| `globals.css` | the touch-target floor is scoped to **`@media (pointer: coarse)`**, not a width breakpoint — a narrow desktop window has a mouse and shouldn't get inflated controls. It covers `button`/`select`/`[role=button]`/inputs but **not `<a>`**: most links here are inline text in prose and a 40px minimum wrecks the line boxes. |
| touch targets | an inline `minHeight` **beats** the media-query floor. When auditing, check the inline values too — `/follow`, `/race-engineer` and `StrategyBuilder` all set their own and stayed at 32-36px until raised. |
| touch targets | audit with **`offsetHeight`, not `getBoundingClientRect().height`**. Many controls are `motion.button` with `initial={{ scale: 0.85 }}`, and framer-motion never advances in the hidden browser pane — so the rect reports the stuck transform (34px on a 40px control) and you "fix" a bug that isn't there. |
| `HeroFrameScrub.tsx` | frame count adapts to the connection — every 6th on Data Saver/2G, every 3rd under 768px, all 110 otherwise. The full set is 3.9 MB, which is not a phone-on-race-day payload. The **last frame is always loaded** so the car still ends fully exploded at any stride. |
| a11y audits | **iframe audits measure BARE MODE.** `useBareMode()` returns true when `window.self !== window.top`, so a route loaded in an iframe renders with no skip link, dock or HomeButton. Layout/overflow checks in iframes are fine (chrome is `position: fixed`), but landmarks, focus order and chrome must be audited at top level. |
| `globals.css` | `h1-h4.section-title { margin: 0 }` — a `<h2>` brings ~0.83em of UA margin a `<span>` never had, so converting a panel title to real heading semantics would otherwise shift its panel. |
| `.section-title` | is a **heading** (`<h2>`) everywhere now — 102 spans/divs converted across 41 files. Keep new ones as headings; the global type rule targets `h2, .section-title` together so they render identically. Never put one inside a `<p>`: that is the nesting the HTML parser rewrites, and it causes a hydration mismatch. |
| `app/drivers/[driverNum]` | the **career fetch is off the critical path**. It comes from Jolpica (serial, with retries) and is far slower than the other two; `Promise.all`-ing it left the whole profile on "Retrieving" while the name, photo, position and points were already in hand. |
| `lib/live.ts` | qualifying cut lines come from `NoEntries` (survivors per segment), not from hard-coded 15/10 — the counts differ by session and entry list |
| `app/follow/page.tsx` | pinning a driver writes `myDriver` into the alert engine; don't add a separate alert UI here, that's the point of the page |
| `components/home/VideoBackground.tsx` | `preload="none"` and a deferred `src` — the clip is 22 MB and `preload="auto"` starved every API call on the landing page |
| `lib/season.tsx` | the stored season is validated against the allowed list before use — a stale value must not select a season with no data |
| `components/live/TimingTower.tsx` | `/live` and `/follow` share this — don't fork a second tower, the point is they can't drift |
| `app/drivers/[driverNum]` | the fetch effect has a `cancelled` guard: the season store hydrates after mount, so the first (wrong-year) responses can otherwise land last and overwrite the right ones |
| `app/dashboard/page.tsx` | the app's own home, pinned to `SEASON` on purpose — it shows "next session" and the live pill, and it doesn't display the season picker. (Was `app/page.tsx` until the landing page took `/`.) |
| `routers/analysis.py` | `_finished()` must accept **`"Lapped"`** as well as `"Finished"`/`"+N Lap"` — 2026 uses the former and dropping it counts 12 of 22 finishers as DNFs |
| `lib/api/hooks.ts` | race distance comes from `useRaceLaps()` (circuit record), **not** the calendar — the calendar has no lap count and a hard-coded 57 mis-sizes every strategy |
| `RaceEngineer.tsx` | the extrapolation and fuel-burn warnings stay above the fold; burying them lets the tool recommend a strategy its own data doesn't support |
| `lib/live.ts` | tyre age is `TotalLaps` **alone**; stint length is `TotalLaps - StartLaps`. Adding the two double-counts a used set — that's the "24L on lap 16" bug. |
| `StintBar.tsx` | segments are **solid**; never reintroduce the `repeating-linear-gradient`. Most of the grid runs used sets, so hatching the exception hatches nearly everything — the whole timeline reads as static, worst on MEDIUM. Used life is shown by the graphite block's **width** instead. |
| `StintBar.tsx` | the lap count sits **inside** the bar, no taller than it. The old 18px badge in a 13px bar bulged out of its own track, which is what made the row look broken. |
| `StintBar.tsx` | the carried-over block is drawn **per stint**, not only for `stints[0]` — a mid-session used set (SAI's real sprint had one at +23 laps) is otherwise invisible. |
| `StintBar.tsx` | dark ink on **every** compound including INTERMEDIATE and WET (10.6:1 and 6.0:1 versus 2.0:1 and 3.5:1 for white). Only unknown-compound grey takes white. |
| `StintBar.tsx` | no framer-motion here — extension is a CSS `flex-grow` transition. An entry tween with a per-index `delay` in a list that re-sorts is exactly what stranded tower rows at opacity 0. |
| `lib/battle.ts`, `lib/story.ts` | import **relatively** (`./live`), never `@/lib/live`, and stay free of JSX — jiti does neither, and both test scripts import these directly. A type-only `@/` import compiles away and hides the problem until someone adds a value import. |
| `lib/battle.ts` | the leader's `gapToLeader` arrives **blank, not 0** — without the `position === 1` fallback, P1 shows no gap. Anything else non-numeric ("+1 LAP", "IN PIT") must stay **null**, never coerced to 0. |
| `BattleView.tsx` | the trend needs `MIN_SPAN_MS` of history before it claims a direction, and a stale buffer reports **none** rather than a change measured across a hole in time. Off-session it shows `—`, not "measuring…" — nothing will ever arrive. |
| `lib/battle.ts` | **qualifying sends no `GapToLeader` and no interval at all** — only `Position` and `BestLapTime`. A gap-only panel renders a column of `—` for the whole session. `hasTrackGaps()` picks the mode from the *data*, not the session name, so a race whose gaps haven't arrived yet degrades the same way. Confirmed live at 2026 Dutch qualifying. |
| `BattleView.tsx` | in qualifying a **negative** lap delta is the bad one (they're quicker), the opposite of a race gap. Colouring both the same way inverts the meaning for half the weekend. |
| `lib/live.ts` | `bootF1()` must **not** await `/api/livetiming/session` before the first `/state` poll. `/session` is the page title; `/state` is every number on the page. Awaiting it put a ~500ms external round trip in front of all timing data — that was 20% of a 2.5s load. |
| `routers/livetiming.py` | `/session` stays **cached** (30s). It's an external hop to livetiming.formula1.com called on every mount *and* by the live-status poller. Never cache its error branch — a transient upstream failure would pin the whole app to "no session". |
| `routers/livetiming.py` | the track-outline disk cache is gated to **completed rounds only** (`_round_is_final`). This builder has no `_trace_score()` quality gate, unlike `/api/circuits/{key}/outline`, so persisting an in-progress weekend could freeze a degraded trace permanently — the 2026 Hungary failure mode. |
| `lib/live.ts` | `boot()` probes `bridgeIsActive()` **before** OpenF1. OpenF1 401s on every endpoint during a live session, so asking it first burned ~490ms on a guaranteed failure. Keep this a *guard in front of* the OpenF1 branch — that branch must stay intact and still runs whenever the probe says no. |
| `TrackMap.tsx` | `focus`/`highlight` are optional and `/live` passes neither — the unfocused map must keep rendering exactly as before. |
| `lib/battle.ts` | `mapEmphasis` / `mapPaintRank` are pure and tested because **car positions only exist while cars are on track** — between sessions there is no way to verify the dimming or the paint order in a browser. The focused car must sort **last**: SVG paints in document order. |
| `scripts/encode-hero-frames.mjs` | the sequence stops at **frame 110**. From ~115 the source bakes in garbled part labels (`SAT WUND`, `RONE VOICE`, duplicate `ENGINE`/`REAR WING`). Frame 110 is already fully exploded and wordless. Never extend the range to "get the labels". |
| `HeroFrameScrub.tsx` | frame loading waits for `window.load`. 3.9 MB fetched eagerly would repeat the landing-page bug where a 22 MB clip starved every API call. |
| `HeroFrameScrub.tsx` | the canvas sizes from its **own `getBoundingClientRect` via `ResizeObserver`**, not `window.innerWidth`. The window is 7px wider once a scrollbar exists (stretching every frame), and at mount it can report 0 — which left the canvas 0x0 with no resize event ever coming to fix it. |
| `prototype/hero` | scene 02 is **`200svh` with sticky copy**. The explode spans 3 viewports of *scroll* and scroll distance is one viewport less than page height, so at `100svh` the car stopped at frame 95 and never finished. |
| `prototype/hero` | scroll-linked opacity/transform sits under `.hero-scrub-active`, added only by the scrubber. Base CSS leaves every scene visible, so no-JS or reduced-motion renders a readable page instead of blank sections waiting on a variable that never arrives. |
| `GlassDockNav.tsx` | an explicit collapse (persisted under `f1.dock.collapsed`) **outranks** scroll auto-hide — scrolling up must not undo a deliberate hide. `data-dock-hidden` mirrors the state because the slide is a transform. |
| `app/page.tsx` | the ink scenes are **translucent** (0.60, news 0.70) over a 0.22 backdrop wash so the exploded car reads through them. Measured against real frame pixels: the car spans 66 luminance levels and the smallest 10px label still clears 4.5:1. Making them solid again hides the entire point of the sequence. |
| `app/page.tsx` | `.hp-label` is `opacity: 0.72` on ink and `0.6` on cream. 0.6 over the translucent scenes drops 10px labels to 3.3:1. |
| `HomeButton.tsx` | top-**centre**, transparent, no card or shadow. It is chrome, not a CTA, and it sits over the hero artwork — it lifts to full strength on hover/`:focus-visible` via `.home-chip` in globals.css. |
| `CircuitDossier.tsx` | the glow is **two stacked strokes**, not an SVG filter — a blur filter allocates a full-size offscreen buffer, which is not something to pay for on a scrolling page. |
| `CircuitDossier.tsx` | bounds come from the **outline only**, never the corner markers: a corner sitting slightly outside the traced line would rescale the whole circuit. |
| the app's look | **the app stays PIT WALL / dark.** A cream editorial mode was built, sampled on `/drivers`, `/calendar` and `/standings`, and rejected on sight — then fully reverted. Don't re-propose cream surfaces; the only cream on the site is the landing page's own band. |
| `app/page.tsx` | the landing page loads its **own** Archivo font link with the `wdth` axis, scoped to itself. That is why its Expanded type survived the global revert — don't "consolidate" it into the root layout without adding the axis there too, or `font-stretch: 125%` silently degrades to plain Archivo. |
| dev server | **never run `npm run build` while `next dev` is running** — they share `.next`, and it wedges the dev server's watcher so CSS edits stop compiling while the file on disk is correct. Symptom: the served chunk keeps its old content hash. Fix: stop dev, `rm -rf .next/dev`, restart. |
| `lib/story.ts` | "passed X" is only claimed when the car that was ahead is **now demonstrably behind**. A place can also be inherited from somebody else's stop, and naming them would be a fabrication. |
| `lib/story.ts` | a session best supersedes the personal best for the same lap — emitting both reads as two laps. |
| `lib/story.ts` | `deriveEvents(null, …)` returns nothing: the first snapshot is the baseline, not news. Without it the whole feed fires on mount describing what happened before you arrived. |
| `lib/story.ts` | the acronym is stripped to word characters before it reaches a regex — it is feed content. |
| `app/follow/page.tsx` | **anything that doesn't change when you change the pinned driver doesn't belong here.** The tower, benchmarks, weather and unfiltered race control were removed under this rule; re-adding them makes `/follow` a superset of `/live` again, which is what it was before. |

---

## 7. FastF1 data limitations discovered

- **No fastest-lap column** in `session.results` — derive from `session.laps`.
- **Sprint Qualifying `Position` is empty.** Recover the order from the sprint race's
  `GridPosition` (sprint quali is what sets that grid). Handled in `_scan_season`.
- **Pit stops:** only `PitInTime → PitOutTime`, which includes driving the pit lane
  (**~22s median**). The famous ~2s stationary time is **not in public data**. The metric is
  named **"Pit Lane Time Loss"** everywhere and the UI says so. Keep it that way.
- **Jolpica** clamps `limit` to 100 → read `MRData.total`. It rejects
  `/drivers/{id}/driverStandings/1.json` (needs `season_year`) → count titles per-season,
  **serially with retries** (parallel bursts 429).
- `results` has **`HeadshotUrl`** — official photos for all 22 drivers. This solves the
  "only 8 driver images" problem for the parked redesign.
- **The DRS telemetry channel is flat zero for 2026** — the 2026 regulations abolished DRS in
  favour of the active-aero override. The channel still exists, so a naive read reports "0 DRS
  zones" as if measured. `track_dna` returns `null` and the UI says "Not in this season's data".
- **Not in FastF1 at all** (deliberately skipped): Tech Updates, Used Elements / PU usage,
  DHL pit-stop points. These are hand-curated from FIA PDFs on F1Dashboard.

---

## 7b. NEXT SESSION — start here

**1. Put this on git and share it with a collaborator.** Nothing is version
controlled yet — `git status` fails, there is no `.git` anywhere in the project.
Before the first push:

- `.gitignore` must cover `node_modules/`, `.next/`, `f1-dashboard/backend/cache/`
  (fastf1's cache is **hundreds of MB** of race data), `backend/cache/api/`,
  `.env.local`, `__pycache__/`, and `.hero-frames-tmp/`.
- **Check for secrets before the first commit, not after.** `frontend/.env.local`
  holds `NEXT_PUBLIC_MAPBOX_TOKEN`; the backend env may hold `GEMINI_API_KEY` /
  `ANTHROPIC_API_KEY` / `NEWSAPI_KEY`. A key committed once stays in history even
  if deleted in the next commit — it has to be absent from the *first* one.
- Decide what to do with the generated assets: `public/hero/` (110 frames,
  3.9 MB) and `public/drivers/` (22 photos, 0.82 MB) are both **rebuildable**
  from `hero video frames/` and `driver pics/` via the scripts in
  `frontend/scripts/`. Committing the sources plus the scripts is smaller and
  cleaner than committing the outputs; committing the outputs makes a fresh
  clone work without ffmpeg. Ask which they want.
- A collaborator needs: Python deps for the backend, `npm install`, and the note
  that **the backend must be running or every page is empty** (section 2).

**2. Race day is 2026-08-23 — mobile has to hold up.** Phase 13 covered layout
and touch targets; what has *not* been exercised is a real phone on a real
network during a live session. Watch specifically: the frame-scrub landing page
on mobile data, `/live` and `/follow` under a running session, and the dock's
auto-hide while scrolling a live tower.

## 8. Open items

**Blocked on the user**
- **Mapbox token** → `NEXT_PUBLIC_MAPBOX_TOKEN` in `frontend/.env.local`. Only thing gating
  the satellite schedule view; it degrades to SVG track outlines meanwhile.
- *Optional:* `NEWSAPI_KEY` in the backend env for richer news images. Works fully without.

**Known / deliberate**
- Two files still use raw `fetch` on purpose: `history/page.tsx` (multi-step aggregation, not
  a keyed GET) and `paddock/page.tsx` chat polling (`after_id` delta-cursor; SWR replaces the
  whole dataset each poll, which would break accumulation).
- Verstappen laps-led reads **8** here vs **7** on F1Dashboard — a definitional edge
  (lap-1 / final-lap counting), not an error. Everything else cross-checks exactly.
- `components/layout/Navbar.tsx` is **dead code** — nothing imports it; the app navigates via
  `GlassDockNav`. Left in place rather than deleted unasked, but don't edit it expecting the
  nav to change.
- The pit-stop metric stays **"Pit Lane Time Loss"** (~22s). If a future session "fixes" it
  towards the famous ~2s figure, that is a regression into fabricated data.

**Waiting on a look, not on work**
- `/prototype/hero` is now a **four-scene scrolling page** — hero, anatomy, next race
  (Black/Cream gate), latest news — over a scroll-scrubbed 110-frame sequence of the car
  coming apart. Built by `scripts/encode-hero-frames.mjs` from `hero video frames/` at the
  repo root; re-run it if the source changes. Section 4b of `FRONTEND_REDESIGN.md` has the
  details, including why the sequence stops at frame 110.
- **Follow Along was removed from the dock's direct icons** (still in the Racing group, the
  home Explore card, and the home CTA). The dock now auto-hides on scroll down and has a
  chevron collapse that persists.
- `FRONTEND_REDESIGN.md` — **Phase 04 is built: `/prototype/hero`.** The black hero as specced,
  with Scene 02 underneath on a Black/Cream toggle so the parked palette question can be settled
  by comparing them in place. Phase 05 is the hard stop: if the hero reads as mediocre it gets
  fixed before anything else migrates. Nothing in it touches the shipped app — separate route,
  component-scoped CSS, `/` still live to compare against. Six findings that change the spec
  (the `d1` scale needs a height term; the hero can't live inside `<main>`; animations must run
  *from* the hidden state; `priority` is deprecated in Next 16; Archivo needs its `wdth` axis
  requested; only 4 of 8 driver photos are hero-scale) are written up at the bottom of that doc.
- Phases 06–16 remain unstarted and gated behind 05.

---

## 9. File map

**Backend** (`f1-dashboard/backend/`)
```
main.py                 router registration
utils.py                cache_get/set (ttl-aware), disk cache, safe_val, fastest_lap_driver
routers/
  analysis.py           driver stats, h2h, teammates, consistency, race-pace, pitstops,
                        track-dna (NEW — circuit fingerprint from fastest-lap telemetry)
  news.py               NEW — RSS aggregation (defusedxml)
  standings.py          _completed_round_count + _round_is_complete live here
  sessions.py           calendar, results, laps, stints, weather, race-control, ICS
  livetiming.py         F1 SignalR bridge + track geometry (points/corners/marshal sectors)
data/circuits.py        23 circuits + lat/lng + resolve_circuit_key()
```

**Frontend** (`f1-dashboard/frontend/`)
```
lib/api/client.ts       useApi / useLiveApi / useApiList / fetcher   ← all reads go here
lib/api/hooks.ts        useCalendar / useStandings / useDrivers / useTeams / useCircuits
lib/constants.ts        BACKEND_URL resolution (see invariants)
lib/ist.ts              parseApiDate, formatIST*, countdownTo
lib/battle.ts           NEW — Follow Along gap derivation + gap-trend (pure, no JSX)
lib/story.ts            NEW — Follow Along event derivation from snapshot diffs (pure, no JSX)
components/live/        TimingTower (shared /live + tower), StintBar, MiniSectors, TrackMap,
                        BenchmarksPanel, TeamRadioPanel,
                        BattleView + DriverStory (NEW — /follow only)
components/charts/      StandingsEvolution, BoxPlot, PositionFlow (Sankey)
components/analysis/    AnalyticsHub (the old /analytics, now a tab set), TrackDNA
components/layout/GlassDockNav.tsx   ROUTE_GROUPS — the single source of truth for nav
components/map/geometry.ts  projection/rotation/pathFrom/DRS detection — already built
app/                    38 routes
```

---

## 10. Working preferences

- Verify in the browser, not just by status code. Report failures plainly with output.
- Don't fabricate data or imagery — if something isn't in the source, say so and label it.
- Subagents are fine for mechanical, well-scoped work; give them the invariant list above
  and **verify their output yourself** rather than trusting the report. Two batches of audit
  fixes were applied this way and both held up on spot-check — but tell them to use
  exact-string `Edit` only and never `Write` an existing file, so two agents can safely work
  the same files at once.
- The user has hit session limits three times — prefer fewer, better-scoped agents over many,
  and don't hand a browser sweep to an agent late in a session; it's the first thing to die.
