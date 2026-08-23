# F1 Dashboard

A Formula 1 intelligence platform — live timing, telemetry, strategy simulation
and season analysis, on real data from FastF1, OpenF1, Jolpica and F1's own
SignalR live-timing feed.

**Two front doors:**

| Route | What it is |
|---|---|
| `/` | The landing page. A cinematic scroll — an F1 car explodes into its parts over three viewports while the race name, circuit dossier and news scroll over it. No tools. |
| `/dashboard` | The app. Weekend hub, Follow Along, standings, and every feature. **All the data lives here.** |

The top-centre **F1 Dashboard** link and the dock's first icon both go to
`/dashboard`; from there the same chip becomes **Landing** and goes back.

---

## Read this first

**`HANDOFF.md` is the source of truth for this project.** It carries the
architecture, ~40 fixed bugs with their causes, the data limitations discovered
in FastF1, and an **INVARIANTS table** — a list of "do not undo this" rules,
each one a bug that has already been fixed once. Read it before changing
anything non-trivial, and add to it when you fix something subtle.

Other docs:

| File | What's in it |
|---|---|
| `HANDOFF.md` | Architecture, invariants, data gotchas. Start here. |
| `f1-dashboard/frontend/FRONTEND_REDESIGN.md` | The 16-phase redesign, all complete, with what was learned in each. |
| `f1-dashboard/frontend/DESIGN.md` | The PIT WALL visual contract. |
| `f1-dashboard/frontend/AGENTS.md` | Repo conventions + a Next.js version warning. |
| `DOCUMENTATION.md` | Feature-level docs. |

---

## Running it

The backend **must be running or every page renders empty**. That is the single
most common failure here — the app shows a banner naming it when it happens.

```bash
# 1. Backend (FastAPI + FastF1) on :8000
cd f1-dashboard/backend
pip install -r requirements.txt
python -m uvicorn main:app --port 8000
```

On Windows launch it **detached**, or it gets reaped when the shell exits:

```
powershell -Command "Start-Process python -ArgumentList '-m','uvicorn','main:app','--port','8000' -WindowStyle Hidden"
```

```bash
# 2. Frontend (Next.js 16 + React 19) on :3000
cd f1-dashboard/frontend
npm install
cp .env.example .env.local
npm run dev
```

Port 8000 already taken:

```bash
powershell -Command "Get-NetTCPConnection -LocalPort 8000 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }"
```

**First run is slow.** FastF1 downloads and caches race data into
`f1-dashboard/backend/cache/` — that directory grows to a few GB and is
gitignored. Later runs are fast (most endpoints ~0.2 s warm).

---

## Before you call anything done

```bash
cd f1-dashboard/frontend
npx tsc --noEmit
npm run build
for f in stint-age qualifying-cuts minisector-parse broadcast-delay \
         live-poll-schedule live-poll-store battle-gaps driver-story \
         lap-trace telemetry-delta; do node scripts/$f.test.mjs; done
```

Then **open the page and read it back**. HTTP 200 proves nothing about what
actually rendered.

There is no test runner. The scripts above use `jiti` (already a dependency) to
import the real TypeScript, so they exercise shipped code rather than a copy.
They exist because the interesting states — a tyre fitted used, a qualifying
cut line, a session going live — only occur while a session is actually running
and cannot be summoned on demand.

**Never run `npm run build` while `next dev` is running.** They share `.next`
and it wedges the dev server's file watcher: CSS edits silently stop compiling
while the file on disk is correct. Fix: stop dev, `rm -rf .next/dev`, restart.

---

## Generated assets

Both are committed so a fresh clone runs immediately, and both are rebuildable:

```bash
cd f1-dashboard/frontend
node scripts/encode-hero-frames.mjs    # 'hero video frames/' -> public/hero (110 WebP, 3.9 MB)
node scripts/encode-driver-photos.mjs  # 'driver pics/'       -> public/drivers (22 WebP, 0.8 MB)
```

The hero encoder needs `ffmpeg` on PATH. Both scripts are non-destructive and
safe to re-run.

---

## Optional environment

Everything works without these.

| Variable | Where | Effect if unset |
|---|---|---|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | frontend `.env.local` | `/schedule` uses traced SVG circuit outlines instead of satellite |
| `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` | backend env | The AI race engineer falls back to rule-based answers |
| `NEWSAPI_KEY` | backend env | `/news` still works — it reads six public RSS feeds |

`GET /api/engineer/status?probe=1` makes one real API call and reports back, so
a bad key surfaces instead of silently degrading.

---

## Working agreements

- **Don't fabricate data or imagery.** If something isn't in the source, say so
  and label it. Several UI labels exist purely to be honest about what was
  measured versus assumed — the pit-stop metric is "Pit Lane Time Loss" (~22 s)
  because the famous ~2 s stationary time is *not* in public data.
- **Verify in the browser, not by status code.**
- **Add to the invariants table** when you fix something whose cause wasn't obvious.
