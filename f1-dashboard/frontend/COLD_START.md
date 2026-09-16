# Core snapshot fallback

The frontend bundles `lib/api/core-snapshot.json`: standings and calendars for
2024–2026, plus circuit reference data. Circuit detail is selected from that
reference list. No telemetry, session results, live positions, credentials,
account data, predictions, or authenticated operations are bundled.

`useApi` exposes the snapshot immediately after hydration until the exact SWR
key receives valid API data. Snapshot data never enters SWR's successful-response
cache. A real response always wins and remains available after a later outage.
Unknown seasons and non-allowlisted query strings have no fallback. `useLiveApi`
never uses snapshots. Calendar notifications are disabled for snapshot data.

The persistent notice lists each active snapshot resource, its recorded UTC
timestamp, and source. It is independent of the dismissible connection banner:
a healthy `/api/health` does not claim every panel has recovered. Mounted consumers
unregister independently as their real responses arrive or they unmount.

The initial export uses existing real backend caches and the repository circuit
reference, preserving their file timestamps. These are **cache/reference capture
times**, not claims that the data was checked today. `exportedAt` is packaging time
only. In particular, the shipped 2026 standings are the saved round-13 cache;
the calendar and circuit reference may be older. Labels explicitly warn of age.

## Refreshing the shipped data

From the frontend, with a healthy backend:

```sh
python scripts/export-core-snapshot.py --origin http://127.0.0.1:8000
```

Review the generated JSON, run the checks, and include it in the next frontend
release. This command has a fixed public-resource allowlist, validates results,
and atomically replaces the bundle only after every resource succeeds. A build
never depends on the backend being reachable. `--cache` is the explicit offline
export mode; it preserves cache file timestamps instead of relabelling them fresh.

## Verification

```sh
node scripts/core-snapshot.test.mjs
node scripts/api-recovery.test.mjs
node scripts/cold-start-browser-check.mjs
```

The browser check uses the production frontend on `http://127.0.0.2:3002`
(`TEST_BASE_URL` overrides it) and intercepts network responses deterministically.
It verifies HTML wake responses, HTTP 503, snapshot rendering, timestamp labels,
partial recovery, automatic replacement without reload, retaining successful API
data during a later outage, calendar/circuit rendering, and mobile width. A
non-localhost hostname exercises the same-origin production API path.

Health probes are shared, cancellable, and budgeted to five minutes per outage
attempt. Retry/reconnect can restart recovery after expiry. A five-second minimum
between probes prevents a healthy health endpoint with busy data endpoints from
creating a request storm. Existing transport deadlines cover response bodies too.
