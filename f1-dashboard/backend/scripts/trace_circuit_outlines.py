"""Regenerate the real track outlines in `data/circuits.py`.

    python scripts/trace_circuit_outlines.py        (run from f1-dashboard/backend,
                                                     with the API up on :8000)

`svgPath` used to hold hand-drawn approximations that did not resemble the
circuits they claimed to be. This traces each one from FastF1's logged car
position around a flying lap — the same data the live track map uses — via
`GET /api/circuits/{key}/outline`, and writes the result back into the data
file so pages can render it with no runtime cost.

Slow on a cold cache (each circuit loads a full session's telemetry), fast
afterwards: the endpoint disk-caches every outline permanently.
"""

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

BASE = "http://localhost:8000"
DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "circuits.py"

sys.path.insert(0, str(DATA_FILE.parent.parent))
from data.circuits import CIRCUITS  # noqa: E402


def fetch(key: str) -> dict:
    with urllib.request.urlopen(f"{BASE}/api/circuits/{key}/outline", timeout=900) as r:
        return json.load(r)


def main() -> int:
    text = DATA_FILE.read_text(encoding="utf-8")
    updated, skipped = 0, []

    for key in CIRCUITS:
        started = time.time()
        try:
            d = fetch(key)
        except Exception as exc:  # noqa: BLE001
            print(f"  {key:<16} FAILED  {type(exc).__name__}: {exc}")
            skipped.append(key)
            continue

        if not d.get("available") or not d.get("path"):
            print(f"  {key:<16} no session with position data")
            skipped.append(key)
            continue

        src = d["source"]
        # Replace this circuit's svgPath value, leaving every other field alone.
        pattern = re.compile(
            r'("' + re.escape(key) + r'":\s*\{.*?"svgPath":\s*)"[^"]*"',
            re.S,
        )
        new_text, n = pattern.subn(lambda m: m.group(1) + json.dumps(d["path"]), text, count=1)
        if not n:
            print(f"  {key:<16} svgPath not found in data file")
            skipped.append(key)
            continue

        text = new_text
        updated += 1
        print(f"  {key:<16} ok  {len(d['corners']):>2} corners  "
              f"from {src['year']} {src['session']}  ({time.time() - started:.0f}s)")

    DATA_FILE.write_text(text, encoding="utf-8")
    print(f"\n{updated} circuits updated, {len(skipped)} skipped"
          + (f": {', '.join(skipped)}" if skipped else ""))
    return 1 if skipped else 0


if __name__ == "__main__":
    raise SystemExit(main())
