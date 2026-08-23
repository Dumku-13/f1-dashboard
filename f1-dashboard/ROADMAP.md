# F1 Dashboard — Master Roadmap

North star: **Race Weekend OS** — a fan opens the site Friday before FP1 and never needs another tab until the podium.

Rules: one phase per work session (token budget). Each phase ends verified in the browser. Mark phases `[DONE]` with date when completed. Local-first until Phase 12. When the user says "start phase N", read that phase's spec here and build it.

Already built (July 2026): `/live` timing tower (dual-source: OpenF1 + backend SignalR bridge to F1's official feed — anonymous, no F1TV needed), `/paddock` chat (SQLite), `/games` + Pit Coins wallet (`frontend/lib/wallet.ts`), `/fantasy` v1, Driver of the Season index, analytics (pace/deg/strategy sim/champ sim — tabular), telemetry compare (custom SVG charts, `pos_data` x/y available), calendar (read-only).

---

## Phase 1 — Race Weekend Essentials `[DONE 2026-07-03]`
> Shipped: `/api/sessions/calendar/{year}/ics` (+`?round=`), calendar Sync buttons + browser alerts (`lib/notify.ts`), S1/S2/S3 colored sector columns in `/live` (both data sources), `Position.z` decode + `/api/livetiming/track` outline + `components/live/TrackMap.tsx`. Live car dots verified by decoder unit test; visually confirm during next live session.

**1a. Calendar sync + session notifications**
- Backend: `GET /api/sessions/calendar/{year}/ics` in `routers/sessions.py` — generate RFC-5545 `.ics` (stdlib, no deps) from existing calendar data: one VEVENT per session (FP1/FP2/FP3/SQ/Sprint/Quali/Race, UTC times, VALARM -30min). Whole-season download + per-race links.
- Frontend calendar page: "Sync to Calendar" button (downloads .ics → phone/Google calendar reminders that work with the site closed); per-race "add this weekend" buttons.
- Browser notifications: `frontend/lib/notify.ts` — permission toggle on calendar page; fires at T-30min / T-5min / session start while site is open; mounted from layout so it runs on any page.

**1b. Live sector times (yellow/green/purple)**
- Data already flows: F1 feed `TimingData.Lines[n].Sectors["0".."2"]` → `{Value, PersonalFastest, OverallFastest}` (index-keyed dicts — use `indexedValues()` in `lib/live.ts`). OpenF1 path: `laps` rows have `duration_sector_1/2/3` — compute personal/overall bests client-side.
- Extend `TowerRow` with `sectors: {value: string|null, color: 'purple'|'green'|'yellow'}[]` (3 entries); map in `mapF1Feeds` (purple=OverallFastest, green=PersonalFastest, else yellow) and in the OpenF1 `rebuild()`.
- `/live` tower: add S1/S2/S3 columns (font-num, existing `--sector-*` CSS vars), flash on change, keep mobile horizontal scroll.

**1c. Live track mini-map with driver badges**
- Backend `routers/livetiming.py`: subscribe `Position.z`, decode (base64 → zlib raw inflate `-MAX_WBITS`) → keep only LATEST position per driver `{X, Y, Status}` (no history). Expose in `/state` feeds as `Position`.
- Track outline: `GET /api/livetiming/track/{year}/{round}` — build once from fastf1 `pos_data` of a completed lap (reuse session-loading pattern from `routers/telemetry.py`), downsample ~400 points, cache in memory. Fallback: trace the leader's live positions over 1–2 laps client-side if fastf1 has nothing yet (Friday FP1).
- New `frontend/components/live/TrackMap.tsx`: SVG outline + circle per driver (team color, TLA label, gold ring for P1), normalized to viewBox, framer-motion springs; TrackStatus tint (yellow/SC/red). Place near Race Control in `.live-grid` on `/live`.
- Done when: live session → moving dots; between sessions → outline + "cars appear when session is live".

## Phase 2 — Race Predictor v1 ⭐ `[DONE 2026-07-04]`
> Shipped: `/predictor` + `backend/routers/predictor.py` (SQLite `predictor.db`: predictions, scores). Picks: pole, podium in order (+winner bonus), FL, first DNF/NONE, SC count, red flags, gainer/loser. Locks at Qualifying start. Auto-scoring pulls fastf1 race results + race-control messages (`POST /api/predictor/score/{y}/{r}`, idempotent); verified against real Austrian GP results. Per-race + season leaderboards; scores pay Pit Coins 1:1 (claim-once via localStorage). Also fixed calendar sync: `components/calendar/CalendarSyncModal.tsx` (Google import flow + per-session quick-add links + Apple/Outlook download) replacing the raw .ics download that Windows handed to Outlook; ICS now served with `charset=utf-8`.
- Later: first-SC-lap + pit stop counts; global leaderboard at Phase 12.

## Phase 3 — Watch Party (Paddock 2.0) `[DONE 2026-07-04]`
> Shipped: `community.py` extended (message `kind` text/burst/sticker + `pinned` via ALTER migrations; `reactions`, `polls`, `poll_votes` tables; toggle-reaction, aggregated channel reactions, poll create/vote/close — max 3 open per room, pin/unpin + pinned strip endpoints). `/paddock`: live watch-party room auto-appears from `useLiveStatus` (auto-enters on session start), polls sidebar (`components/paddock/PollsPanel.tsx`, animated result bars), quick-react emoji bar → `burst` messages rain across every viewer's screen (`components/paddock/EmojiRain.tsx`), hover reactions + chips, 12-sticker built-in set, spoiler shield (Off/30s/1m/2m — blurs others' messages newer than your stream delay, click to reveal), pin any message. Still 3s polling — WebSocket push deferred.
- Later: WebSocket push, Tenor GIFs (needs key), voice (Phase 12+).

## Phase 4 — Achievements + unified Pit Coins economy `[DONE 2026-07-04]`
> Shipped: `frontend/lib/achievements.ts` — 13 badges (localStorage, wallet-style events; backend table deferred to Phase 12 online migration), coin rewards auto-paid on unlock, global toast queue (`components/layout/AchievementToaster.tsx` in layout, also watches wallet balance for coin milestones). Hooks: paddock (first message, first poll, 10 bursts), predictor (first prediction; pole/podium/SC-count/50pts checked from score breakdown), games (sub-250ms reaction), live (3 sessions / 5 weekends watched via `recordLiveWatch`). `/profile`: paddock name editor, Pit Coins, badge cabinet with locked/secret states.
- Later: quiz streaks (Phase 9), server-side achievement storage (Phase 12).

## Phase 5 — PickStop (Fantasy 2.0) `[DONE 2026-07-04]`
> Shipped: `routers/fantasy.py` (`fantasy.db`: teams + scores per round; teams lock at RACE start). Boost catalog: engine_upgrade ×1.25, undercut +2/pos gained, pit_crew +10 if podium, weather_boost ×2 if rain (applied last); captain 2×; constructor 0.5× via pinned 2026 team-name map; max 2 boosts, bought with Pit Coins client-side. `/fantasy` rewritten round-based: lock countdown, captain star, boost shop, per-round Score buttons, season leaderboard, coins 1:1 on scored rounds (claim-once `f1.fantasy.claimed`). Known quirk: boost toggle refunds are client-side (coin-farmable) — same trust model as the rest of the wallet, revisit at Phase 12.

## Phase 6 — AI Race Engineer 🎙️ `[DONE 2026-07-04]` (full AI needs `ANTHROPIC_API_KEY`)
> Shipped: `routers/engineer.py` — POST /ask streams; context = livetiming module in-memory state read directly under its lock (tower top10/tyres/track status/weather/last 5 RC msgs) + standings (cache→127.0.0.1 self-call, 3s timeout) + next race (cached schedule); claude-sonnet-5, max_tokens 700, "Box Box" race-engineer persona; rule-based keyword fallback with real data when no key/SDK failure (+ note about setting the key); GET /status → {ai}. `anthropic` SDK 0.116 installed. Frontend: `components/engineer/EngineerChat.tsx` (streaming reader, quick chips, localStorage history, AI/RULE-BASED badge), `/engineer` page, `EngineerDock` floating on `/live`. Fixed post-agent: no-session snapshot string was missing the `LIVE SESSION SNAPSHOT` marker `find_block()` needs, so the leader question never fell back to standings.

## Phase 7 — Analytics Glow-Up `[DONE 2026-07-04]`
> Shipped: `/battle` hub — dual team-colored driver pickers + completed-round selector; 6 independent sections (season H2H tug-of-war, radar (recharts, standings + selected-round laps for pace/consistency), quali grid H2H (selected round only), 107%-filtered race-pace lines, sector-delta bars, start-performance dumbbells) each with own skeleton/fallback. Strategy Sim 2.0: `/api/analytics/strategy-sim` gained optional `sc_laps` (×1.40 pace, half pit loss on SC laps) + `rain_from` (dry compounds +8s, 3× deg) + `timeline` [{lap, cumulative_s}] in response; UI: compound-block stint timeline, pit-lap steppers, SC/rain toggles, animated predicted order (single-driver model + filler rivals). Pace/deg tabs restyled with recharts (deg = stint bubble scatter; tables kept as collapsible fallback). recharts@3.9.2 added.

## Phase 8 — Interactive Track Map 2.0 `[DONE 2026-07-04]`
> Shipped: `GET /api/livetiming/track/{y}/{r}/details` (outline reused from cached builder + fastf1 `circuit_info`: corners x/y/number/letter/distance, marshal_sectors, rotation; raw 1/10-m coords, frontend rotates/normalizes; degrades to outline-only if circuit_info missing). `/map` (Map icon in dock, next to Live): `components/map/CircuitMap.tsx` + `DriverPanel.tsx` + `geometry.ts` — rotated glowing outline w/ TrackStatus tint, marshal mini-sectors tinted by live yellow-flag RC messages per sector (3-min window, CLEAR reverts; whole-track fallback when sector unknown — OpenF1 path has no sector), AoA zones approximated from curvature (window ±3 pts, <0.18 rad, runs ≥7%; labeled "approx"), toggleable corner numbers, clickable driver dots → right-rail panel (pos/delta, gaps, laps, tyre, pits, coarse relative-pace sparkline from a 40-sample position ring buffer), wind compass from live weather, round selector (works between sessions). Also fixed in `lib/live.ts`: `mapF1Feeds` was dropping RaceControlMessages `Sector` — now on `LiveRaceControl.sector`; `wind_direction` added to `LiveWeather`. Pit lane rendering skipped (no data source; revisit if fastf1 exposes it).

## Phase 9 — Daily Quiz + Driver Popularity Index `[DONE 2026-07-04]`
> Shipped: `routers/quiz.py` (10 templates from real standings/results/circuits, deterministic per date via seeded RNG, `quiz.db` attempts, streaks, 30-day leaderboard; coins = score×2 client-side claim-once) + `/quiz` page (one-at-a-time flow, review mode, streak flame). `routers/popularity.py` (`popularity.db` events: view×1/pick×3/mention×2 → `GET /index` with 7d score + trend, 60/min rate limit) + `lib/pulse.ts` hooks in drivers/[driverNum], predictor submit, fantasy save, paddock TLA mentions + `components/home/DriverPulse.tsx` heat strip on home. New achievements: quiz-rookie, quiz-streak-7.

## Phase 10 — F1 Social Feed `[DONE 2026-07-04]`
> Shipped: `routers/feed.py` (`feed.db`: posts/likes/comments/follows/reports; hot = (likes+2c+2r+1)/(age_h+2)^1.5 over latest 300; following feed; ≥3 reports soft-hides except to author; delete-own cascades, no repost chains) + `/feed` (Feed icon in dock): composer w/ image-URL preview + tag picker, Hot/New/Following tabs, tag filter, like/comment/repost/report/delete, @TLA mention chips, who-to-follow rail. Tag filter is Python-side post-pagination — "Load more" can over/undershoot slightly with tag filters on New (fine local-first).

## Phase 11 — Custom Alerts, Widgets, Multi-Screen `[DONE 2026-07-04]`
> Shipped: `lib/alerts.ts` engine (7 rules: my-driver pit/position, fastest lap, SC/VSC, red flag, rain, penalties regex-filtered to my driver; baseline-first-snapshot, per-key dedupe, only fires while status==='live') → toast (top-left `AlertToaster`) + browser Notification + WebAudio beep; bell settings popover on /live. `/widget/[type]` (timer/gaps/standings/weather) pop-outs via `PopOutButton` row on /live — bare mode (no chrome) via layout gate for /widget/* + any iframed page. `/battlestation` (LayoutGrid icon, `b` key): iframe cockpit, presets 2×1/2×2/1+2/3×1, swappable panes (map/live/paddock/engineer/telemetry/widgets), auto-saved layout, fullscreen. Note: SC/red-flag rules need the F1-bridge source (OpenF1 path has no trackStatus — fine, bridge is the live-session source); beep silent until first user gesture (browser autoplay policy).

## Phase 12 — Go Online 🌐
- Deploy: frontend → Vercel; backend → Railway/Fly (always-on needed for the SignalR bridge); SQLite → Postgres/Turso. Global + friend leaderboards, global watch party, public social feed. Web push + service worker → phone/lock-screen alerts; PWA install = mobile app v0.
- **Auth shipped early (local, 2026-07-05)**: `routers/auth.py` + `users.db` (users + server-side sessions; PBKDF2-SHA256 200k iters, per-user salt; 30-day bearer tokens), `/login` page, `lib/auth.ts`, account card on `/profile` (favourite driver/team saved server-side, sign out). Account username = paddock name, so registering adopts all existing per-username history (predictions/fantasy/feed/chat/quiz). At deploy time: move tokens to httpOnly cookies + add rate limiting on /login, then port to Postgres.

## Phase 13 — Platform & Revenue
- Public API (keys, rate limits, docs) for processed timing/analytics/history. Premium tier (deeper AI engineer, unlimited comparisons, custom dashboards, ad-free), affiliate links, donations. Native mobile app (React Native on the API) only after PWA traction.

---

### Data-source ground rules (every phase)
- **During live sessions**: backend SignalR bridge (`/api/livetiming/*`) — anonymous & free; OpenF1 free tier is 401-locked while sessions run.
- **Between sessions**: OpenF1 (serial request queue, 404 = empty, never fetch full `intervals` history, never burst-parallel) + fastf1 (slow first load) + Jolpica for history.
