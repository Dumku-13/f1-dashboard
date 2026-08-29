# Deploying

Two halves: a **FastAPI backend** and a **Next.js frontend**. Deploy the backend
first — the frontend needs its URL at build time.

Vercel + Render below because they're the fastest path, but nothing here is
Render-specific except `backend/render.yaml`; any host that runs a Python
process with a persistent disk works the same way.

---

## The one thing to understand first

The browser **never calls the backend directly**.

`resolveBackendUrl()` in `frontend/lib/constants.ts` returns `""` for any
hostname that isn't localhost, so the app makes **same-origin** `/api/*`
requests. `next.config.ts` then rewrites those **server-side** to
`BACKEND_ORIGIN`.

Two consequences worth knowing before you debug anything:

- **CORS is not on the critical path.** The proxied call is server-to-server.
  If you hit a CORS error, something is calling the backend directly and that's
  the bug — don't "fix" it by loosening CORS.
- **`BACKEND_ORIGIN` is a server-side variable, not `NEXT_PUBLIC_`.** Making it
  public would put the backend's address in the client bundle and expose it
  directly to the internet.

---

## 1. Backend → Render

1. **New → Blueprint**, connect `Dumku-13/f1-dashboard`, point it at
   `f1-dashboard/backend/render.yaml`. (Or create a Web Service by hand with
   the settings below.)

   | Setting | Value |
   |---|---|
   | Root directory | `f1-dashboard/backend` |
   | Build | `pip install -r requirements.txt` |
   | Start | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
   | Health check | `/docs` |

   **Bind to `$PORT`, not 8000.** A fixed port makes the service unreachable and
   the failure presents as a timeout rather than a config error.

2. **Add a disk** — mount `/var/data`, 10GB, and set `FASTF1_CACHE=/var/data/fastf1`.

   fastf1 caches raw session telemetry; the local dev cache is **~3.1GB**, is
   gitignored, and never ships. Without a disk the service re-downloads per
   session on each cold start, so a telemetry or track-outline request takes
   30-90s instead of being fast. **The app still works without it** — it's a
   speed problem, not a correctness one.

3. Wait for the first deploy, then confirm:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://YOUR-API.onrender.com/docs
   ```

4. Copy that origin. It's `BACKEND_ORIGIN` in the next step.

---

## 2. Frontend → Vercel

1. **Add New → Project**, import the repo, set **Root Directory** to
   `f1-dashboard/frontend`. Vercel detects Next.js on its own.

2. Environment variables:

   | Name | Value | Notes |
   |---|---|---|
   | `BACKEND_ORIGIN` | `https://YOUR-API.onrender.com` | **No** `NEXT_PUBLIC_` prefix, no trailing slash |
   | `NEXT_PUBLIC_OPENF1_URL` | `https://api.openf1.org/v1` | Called from the browser, so this one is public |

   Do **not** set `NEXT_PUBLIC_BACKEND_URL` in production. It's inlined into the
   client bundle at build time, and it once broke the public tunnel completely
   by sending every remote visitor to *their own* localhost — see `HANDOFF.md`.

3. Deploy, then verify the proxy actually reaches the backend:

   ```bash
   curl -s "https://YOUR-APP.vercel.app/api/standings/drivers?year=2026" | head -c 200
   ```

   Real JSON means the rewrite works. An HTML error page means `BACKEND_ORIGIN`
   is wrong or the backend is asleep.

---

## 3. Check before you present

```bash
curl -s -o /dev/null -w "%{http_code}  /\n"          https://YOUR-APP.vercel.app/
curl -s -o /dev/null -w "%{http_code}  /dashboard\n" https://YOUR-APP.vercel.app/dashboard
curl -s -o /dev/null -w "%{http_code}  /live\n"      https://YOUR-APP.vercel.app/live
curl -s -o /dev/null -w "%{http_code}  /standings\n" https://YOUR-APP.vercel.app/standings
curl -s -o /dev/null -w "%{http_code}  api\n"        "https://YOUR-APP.vercel.app/api/standings/drivers?year=2026"
```

Then open it on a phone. That's the only way to check the tab bar's safe-area
inset, which needs a device with a home indicator.

---

## Known limits — say these before someone finds them

- **Cold start.** A free/idle Render service spins down and takes ~50s to wake.
  **Hit the URL a few minutes before presenting** so it's warm. This is the
  single most likely thing to embarrass a live demo.
- **First telemetry load is slow** even when warm, if the fastf1 cache is cold —
  it's downloading a session. `/circuits/[key]` is ~7s cold locally.
- **Runtime SQLite DBs are ephemeral.** They're gitignored and recreated empty
  on each deploy, so accounts, predictions and chat reset. Fine for a demo;
  needs a real database to persist.
- **No live session data off-weekend.** `/live` shows the last session's final
  state and the map shows the pit-lane grid — that's the designed off-session
  behaviour, not a failure.
- **Mapbox is unset**, so the satellite schedule view degrades to traced SVG
  circuit outlines. Deliberate.

## If something breaks

| Symptom | Cause |
|---|---|
| Every page empty, banner about the backend | Backend asleep or `BACKEND_ORIGIN` wrong |
| `/api/*` returns HTML not JSON | Rewrite not applied — check the var has no trailing slash and isn't `NEXT_PUBLIC_` |
| Backend deploy times out | Bound to a fixed port instead of `$PORT` |
| Telemetry pages hang first time | Cold fastf1 cache; expected without a disk |
| CORS error in console | Something is calling the backend directly — that's the bug, don't loosen CORS |
