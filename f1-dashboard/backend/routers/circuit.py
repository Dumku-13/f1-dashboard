import asyncio
import fastf1
import httpx
import numpy as np
from fastapi import APIRouter, HTTPException
from utils import cache_get, cache_set, disk_cache_get, disk_cache_set, safe_val, safe_td
from data.circuits import CIRCUITS, LOCATION_TO_CIRCUIT

router = APIRouter()

# ergast.com was decommissioned; api.jolpi.ca is the maintained drop-in mirror
ERGAST_BASE = "https://api.jolpi.ca/ergast/f1"


@router.get("")  # match with and without trailing slash (proxy strips it)
@router.get("/")
async def list_circuits():
    return list(CIRCUITS.values())


@router.get("/{circuit_key}")
async def get_circuit(circuit_key: str):
    circuit = CIRCUITS.get(circuit_key)
    if not circuit:
        raise HTTPException(status_code=404, detail=f"Circuit '{circuit_key}' not found")
    return circuit


@router.get("/{circuit_key}/records")
async def get_circuit_records(circuit_key: str):
    ck = f"circuit_records_{circuit_key}"
    cached = cache_get(ck)
    if cached:
        return cached

    circuit = CIRCUITS.get(circuit_key)
    if not circuit:
        raise HTTPException(status_code=404, detail="Circuit not found")

    # Map circuit key to Ergast circuit ID
    ergast_id_map = {
        "bahrain": "bahrain",
        "jeddah": "jeddah",
        "albert_park": "albert_park",
        "suzuka": "suzuka",
        "shanghai": "shanghai",
        "miami": "miami",
        "monaco": "monaco",
        "barcelona": "catalunya",
        "montreal": "villeneuve",
        "red_bull_ring": "red_bull_ring",
        "silverstone": "silverstone",
        "spa": "spa",
        "hungaroring": "hungaroring",
        "zandvoort": "zandvoort",
        "monza": "monza",
        "baku": "baku",
        "singapore": "marina_bay",
        "austin": "americas",
        "mexico_city": "rodriguez",
        "interlagos": "interlagos",
        "las_vegas": "las_vegas",
        "lusail": "losail",
        "yas_marina": "yas_marina",
    }

    ergast_circuit_id = ergast_id_map.get(circuit_key, circuit_key)

    async def fetch_ergast():
        async with httpx.AsyncClient(timeout=15.0) as client:
            # All race winners at this circuit
            winners_resp = await client.get(
                f"{ERGAST_BASE}/circuits/{ergast_circuit_id}/results/1.json?limit=200"
            )
            winners_data = winners_resp.json().get("MRData", {}).get("RaceTable", {}).get("Races", [])

            winner_counts: dict = {}
            podium_counts: dict = {}
            pole_counts: dict = {}
            laps_led: dict = {}
            race_history: list = []

            for race in winners_data:
                year = race.get("season", "")
                r = race.get("Results", [{}])[0]
                drv = r.get("Driver", {})
                full_name = f"{drv.get('givenName','')} {drv.get('familyName','')}".strip()
                winner_counts[full_name] = winner_counts.get(full_name, 0) + 1
                race_history.append({
                    "year": year,
                    "winner": full_name,
                    "team": r.get("Constructor", {}).get("name", ""),
                    "laps": r.get("laps", ""),
                })

            # Qualifying pole positions
            poles_resp = await client.get(
                f"{ERGAST_BASE}/circuits/{ergast_circuit_id}/qualifying/1.json?limit=200"
            )
            poles_data = poles_resp.json().get("MRData", {}).get("RaceTable", {}).get("Races", [])
            for race in poles_data:
                q = race.get("QualifyingResults", [{}])[0] if race.get("QualifyingResults") else {}
                drv = q.get("Driver", {})
                full_name = f"{drv.get('givenName','')} {drv.get('familyName','')}".strip()
                if full_name:
                    pole_counts[full_name] = pole_counts.get(full_name, 0) + 1

            # Podiums (top 3)
            for pos in [1, 2, 3]:
                pod_resp = await client.get(
                    f"{ERGAST_BASE}/circuits/{ergast_circuit_id}/results/{pos}.json?limit=200"
                )
                pod_data = pod_resp.json().get("MRData", {}).get("RaceTable", {}).get("Races", [])
                for race in pod_data:
                    r = race.get("Results", [{}])[0]
                    drv = r.get("Driver", {})
                    full_name = f"{drv.get('givenName','')} {drv.get('familyName','')}".strip()
                    if full_name:
                        podium_counts[full_name] = podium_counts.get(full_name, 0) + 1

            def top1(d: dict):
                if not d:
                    return None
                name, count = max(d.items(), key=lambda x: x[1])
                return {"driver": name, "count": count}

            # Most recent winners first, normalized to {year, driver, team}
            recent = [
                {"year": int(r["year"]) if str(r["year"]).isdigit() else r["year"],
                 "driver": r["winner"], "team": r["team"]}
                for r in reversed(race_history)
            ][:10]

            lap_record = None
            if circuit.get("lap_record_time"):
                lap_record = {
                    "time": circuit.get("lap_record_time"),
                    "driver": circuit.get("lap_record_driver"),
                    "year": circuit.get("lap_record_year"),
                    "pre_2026": circuit.get("lap_record_pre_2026", True),
                }

            return {
                "circuit_key": circuit_key,
                "most_wins": top1(winner_counts),
                "most_poles": top1(pole_counts),
                "most_podiums": top1(podium_counts),
                "lap_record": lap_record,
                "recent_winners": recent,
                "total_races_held": len(winners_data),
            }

    try:
        result = await fetch_ergast()
    except Exception:
        # Never 500 on a historical-data hiccup — return what we know locally
        lap_record = None
        if circuit.get("lap_record_time"):
            lap_record = {
                "time": circuit.get("lap_record_time"),
                "driver": circuit.get("lap_record_driver"),
                "year": circuit.get("lap_record_year"),
                "pre_2026": circuit.get("lap_record_pre_2026", True),
            }
        result = {
            "circuit_key": circuit_key,
            "most_wins": None,
            "most_poles": None,
            "most_podiums": None,
            "lap_record": lap_record,
            "recent_winners": [],
            "total_races_held": 0,
        }
    cache_set(ck, result)
    return result


# ---------------------------------------------------------------------------
# Real track outlines
#
# `data/circuits.py` carries an `svgPath` per circuit. Those paths are
# hand-drawn approximations that do not resemble the circuits they claim to be
# — Bahrain and Zandvoort render as near-identical scribbles. They are not
# derived from anything; do not render them.
#
# FastF1 has the real thing: the car's logged X/Y position around a flying lap,
# plus `circuit_info.rotation`, which is the angle that puts the track in the
# orientation everyone recognises. That data only exists for a session that has
# actually run, so for an upcoming round we walk back through previous seasons
# at the same circuit until we find one.
# ---------------------------------------------------------------------------

OUTLINE_VIEWBOX = 1000
_OUTLINE_PAD = 40
# How many seasons back to look for a session at this circuit before giving up.
_OUTLINE_MAX_LOOKBACK = 6


def _rotate_xy(xy: np.ndarray, degrees: float) -> np.ndarray:
    """FastF1's documented rotation for drawing a circuit right-way-up."""
    rad = degrees / 180 * np.pi
    mat = np.array([[np.cos(rad), np.sin(rad)], [-np.sin(rad), np.cos(rad)]])
    return np.matmul(xy, mat)


def _svg_path_from_xy(xy: np.ndarray) -> str:
    """Fit rotated track coordinates into a square viewBox and emit a path.

    Aspect ratio is preserved — a circuit stretched to fill the box would be a
    different shape, which is the whole problem we are fixing. Y is flipped
    because SVG's Y axis grows downward and the telemetry's does not.
    """
    xs, ys = xy[:, 0], xy[:, 1]
    span = max(float(xs.max() - xs.min()), float(ys.max() - ys.min()))
    if span <= 0:
        return ""
    usable = OUTLINE_VIEWBOX - 2 * _OUTLINE_PAD
    scale = usable / span
    # Centre the shorter axis inside the square.
    off_x = _OUTLINE_PAD + (usable - float(xs.max() - xs.min()) * scale) / 2
    off_y = _OUTLINE_PAD + (usable - float(ys.max() - ys.min()) * scale) / 2

    x0, y0 = float(xs.min()), float(ys.min())
    pts = []
    for x, y in zip(xs, ys):
        px = (float(x) - x0) * scale + off_x
        py = OUTLINE_VIEWBOX - ((float(y) - y0) * scale + off_y)
        pts.append(f"{px:.1f},{py:.1f}")
    return "M" + " L".join(pts) + " Z"


# A trace is rejected when its samples stall (median step of 0) or contain a
# teleport. 2026 Hungary is the worked example: every lap in that session has a
# median step of 0 and a 3472-unit jump, and drawing it produced a jagged
# polygon that was not the Hungaroring. Falling through to 2025 gives a clean
# trace (ratio 2.7), so the gate is on data quality, not just on exceptions.
_MAX_GAP_RATIO = 12.0
_LAP_CANDIDATES = 8


def _trace_score(xy: np.ndarray) -> float | None:
    """Max step / median step. Lower is smoother. None if the trace is unusable."""
    if xy is None or len(xy) < 50:
        return None
    gaps = np.linalg.norm(np.diff(xy, axis=0), axis=1)
    median = float(np.median(gaps))
    if median <= 0:            # stalled samples — the car "stops" repeatedly
        return None
    ratio = float(gaps.max()) / median
    return ratio if ratio <= _MAX_GAP_RATIO else None


def _best_pos_trace(session) -> np.ndarray | None:
    """Cleanest position trace among the session's quickest laps.

    The single fastest lap is not reliably the best-logged one, so score a
    handful and take the smoothest.
    """
    try:
        laps = session.laps.pick_quicklaps().sort_values("LapTime").head(_LAP_CANDIDATES)
    except Exception:  # noqa: BLE001 — no lap times to sort on
        laps = session.laps.head(_LAP_CANDIDATES)

    best, best_score = None, None
    for _, lap in laps.iterrows():
        try:
            pos = lap.get_pos_data()
            xy = pos.loc[:, ("X", "Y")].to_numpy(dtype=float)
        except Exception:  # noqa: BLE001 — no position data for this lap
            continue
        score = _trace_score(xy)
        if score is not None and (best_score is None or score < best_score):
            best, best_score = xy, score
    return best


def _build_outline(circuit_key: str, season: int) -> dict:
    circuit = CIRCUITS.get(circuit_key) or {}
    location = circuit.get("location") or circuit.get("short_name") or circuit_key
    base = {
        "circuit_key": circuit_key,
        "name": circuit.get("name", ""),
        "path": "",
        "view_box": f"0 0 {OUTLINE_VIEWBOX} {OUTLINE_VIEWBOX}",
        "corners": [],
        "rotation": 0.0,
        "source": None,
        "available": False,
    }

    # Newest first: a recent layout beats an old one if the circuit was changed.
    for year in range(season, season - _OUTLINE_MAX_LOOKBACK, -1):
        for code in ("R", "Q"):
            try:
                s = fastf1.get_session(year, location, code)
                s.load(laps=True, telemetry=True, weather=False, messages=False)
                raw_xy = _best_pos_trace(s)
                if raw_xy is None:
                    continue  # whole session's position data is unusable

                ci = s.get_circuit_info()
                rotation = float(getattr(ci, "rotation", 0.0) or 0.0)

                xy = _rotate_xy(raw_xy, rotation)
                path = _svg_path_from_xy(xy)
                if not path:
                    continue

                corners = []
                raw = getattr(ci, "corners", None)
                if raw is not None and len(raw) > 0:
                    cxy = _rotate_xy(raw.loc[:, ("X", "Y")].to_numpy(dtype=float), rotation)
                    # Map corner markers through the same fit as the path.
                    xs, ys = xy[:, 0], xy[:, 1]
                    span = max(float(xs.max() - xs.min()), float(ys.max() - ys.min()))
                    usable = OUTLINE_VIEWBOX - 2 * _OUTLINE_PAD
                    scale = usable / span
                    off_x = _OUTLINE_PAD + (usable - float(xs.max() - xs.min()) * scale) / 2
                    off_y = _OUTLINE_PAD + (usable - float(ys.max() - ys.min()) * scale) / 2
                    for (cx, cy), (_, row) in zip(cxy, raw.iterrows()):
                        corners.append({
                            "number": int(row.get("Number", 0) or 0),
                            "letter": str(row.get("Letter", "") or ""),
                            "x": round((cx - float(xs.min())) * scale + off_x, 1),
                            "y": round(OUTLINE_VIEWBOX - ((cy - float(ys.min())) * scale + off_y), 1),
                        })

                return {
                    **base,
                    "path": path,
                    "corners": corners,
                    "rotation": rotation,
                    "source": {"year": year, "session": code, "location": str(location)},
                    "available": True,
                }
            except Exception:  # noqa: BLE001 — no session that year, or no position data
                continue

    return base


@router.get("/{circuit_key}/outline")
async def get_circuit_outline(circuit_key: str, season: int = 2026):
    """Real track outline, traced from logged car position around a flying lap.

    Permanently disk-cached: a circuit's shape doesn't change between requests,
    and when a layout genuinely is revised the resolved source year changes with
    it. Delete the cache entry to re-trace.
    """
    if circuit_key not in CIRCUITS:
        raise HTTPException(status_code=404, detail=f"Circuit '{circuit_key}' not found")

    ck = f"circuit_outline_{circuit_key}_{season}"
    hit = cache_get(ck) or disk_cache_get(ck)
    if hit is not None:
        return hit

    result = await asyncio.to_thread(_build_outline, circuit_key, season)
    cache_set(ck, result)
    if result.get("available"):
        disk_cache_set(ck, result)
    return result
