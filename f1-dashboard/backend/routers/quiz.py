"""Daily F1 Quiz — 10 deterministic questions per day, built from real
standings/results/circuit data (never invented facts).

Determinism: every random choice (which templates run, option shuffling,
which round/driver is picked) is drawn from `random.Random(f"f1quiz-{date}")`
so the same date always produces the same 10 questions in the same order.
"""

import asyncio
import json
import random
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import fastf1
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from auth_guard import verify_identity
from utils import cache_get, cache_set, disk_cache_get, disk_cache_set

from data.circuits import CIRCUITS
from routers.standings import _compute_standings

router = APIRouter()

DB_PATH = Path(__file__).resolve().parent.parent / "quiz.db"
YEAR = 2026
NUM_QUESTIONS = 10


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _init():
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                date TEXT NOT NULL,
                score INTEGER NOT NULL,
                answers TEXT NOT NULL,
                completed_at REAL NOT NULL,
                UNIQUE (username, date)
            )
            """
        )


_init()


class SubmitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=24)
    answers: list[int] = Field(min_length=NUM_QUESTIONS, max_length=NUM_QUESTIONS)


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Data access — cached standings + a random finished round's results
# ---------------------------------------------------------------------------

def _standings_for_quiz() -> dict:
    ck = f"standings_{YEAR}"
    cached = cache_get(ck)
    if cached:
        return cached
    result = _compute_standings(YEAR)
    cache_set(ck, result)
    return result


def _completed_rounds(standings: dict) -> list[dict]:
    return [r for r in standings.get("rounds", []) if r.get("status") == "complete"]


def _round_results(round_num: int) -> list[dict] | None:
    """Reuse sessions.py's disk cache if a previous /results call populated
    it; otherwise compute directly from fastf1 (best-effort, same shape)."""
    ck = f"results_{YEAR}_{round_num}_R"
    cached = cache_get(ck) or disk_cache_get(ck)
    if cached:
        return cached

    try:
        s = fastf1.get_session(YEAR, round_num, "R")
        s.load(telemetry=False, weather=False, messages=False, laps=False)
        res = s.results
        if res is None or len(res) == 0:
            return None
        rows = []
        for _, r in res.iterrows():
            pos = r.get("Position")
            rows.append({
                "position": None if pos is None or (isinstance(pos, float) and pos != pos) else int(pos),
                "abbreviation": str(r.get("Abbreviation", "")),
                "full_name": f"{r.get('FirstName','')} {r.get('LastName','')}".strip(),
                "team": str(r.get("TeamName", "")),
            })
        if rows:
            cache_set(ck, rows)
            disk_cache_set(ck, rows)
        return rows
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Question templates — each returns {question, options[4], answer_idx, category}
# or None if there isn't enough data to build one right now.
# ---------------------------------------------------------------------------

def _shuffle_options(rng: random.Random, correct: str, wrong: list[str]) -> tuple[list[str], int]:
    """Dedup wrong options against the correct answer, shuffle, return
    (options, answer_idx)."""
    seen = {correct}
    uniq_wrong = []
    for w in wrong:
        if w not in seen:
            seen.add(w)
            uniq_wrong.append(w)
    options = [correct] + uniq_wrong[:3]
    if len(options) < 4:
        return [], -1
    rng.shuffle(options)
    return options, options.index(correct)


def q_who_leads_championship(rng: random.Random, standings: dict) -> dict | None:
    drivers = standings.get("drivers", [])
    if len(drivers) < 4:
        return None
    leader = drivers[0]
    wrong = [d["name"] for d in drivers[1:6]]
    options, idx = _shuffle_options(rng, leader["name"], wrong)
    if idx < 0:
        return None
    return {
        "question": f"Who leads the {YEAR} Drivers' Championship?",
        "options": options,
        "answer_idx": idx,
        "category": "standings",
    }


def q_which_team_leads_wcc(rng: random.Random, standings: dict) -> dict | None:
    constructors = standings.get("constructors", [])
    if len(constructors) < 4:
        return None
    leader = constructors[0]
    wrong = [c["name"] for c in constructors[1:6]]
    options, idx = _shuffle_options(rng, leader["name"], wrong)
    if idx < 0:
        return None
    return {
        "question": f"Which team leads the {YEAR} Constructors' Championship?",
        "options": options,
        "answer_idx": idx,
        "category": "standings",
    }


def q_who_has_n_wins(rng: random.Random, standings: dict) -> dict | None:
    drivers = [d for d in standings.get("drivers", []) if d.get("wins", 0) > 0]
    if len(drivers) < 1 or len(standings.get("drivers", [])) < 4:
        return None
    # Only ask about a win tally that exactly one driver holds — otherwise the
    # question has several correct answers ("Which driver has 1 race win?" with
    # HAM, LEC and NOR all on 1) and every one but the sampled target is
    # graded wrong.
    unique = [d for d in drivers if sum(1 for o in drivers if o.get("wins", 0) == d["wins"]) == 1]
    if not unique:
        return None
    target = rng.choice(unique)
    n = target["wins"]
    others = [
        d["name"] for d in standings["drivers"]
        if d["name"] != target["name"] and d.get("wins", 0) != n
    ]
    if len(others) < 3:
        return None
    wrong = rng.sample(others, min(3, len(others)))
    options, idx = _shuffle_options(rng, target["name"], wrong)
    if idx < 0:
        return None
    plural = "win" if n == 1 else "wins"
    return {
        "question": f"Which driver has {n} race {plural} in {YEAR}?",
        "options": options,
        "answer_idx": idx,
        "category": "stats",
    }


def q_points_gap(rng: random.Random, standings: dict) -> dict | None:
    drivers = standings.get("drivers", [])
    if len(drivers) < 4:
        return None
    i = rng.randrange(0, min(len(drivers), 8) - 1)
    a, b = drivers[i], drivers[i + 1]
    gap = round(abs(a["points"] - b["points"]))
    correct = str(gap)
    deltas = [gap + d for d in (-8, -5, 5, 8, 12, -12) if gap + d >= 0]
    wrong = [str(g) for g in deltas]
    options, idx = _shuffle_options(rng, correct, wrong)
    if idx < 0:
        return None
    return {
        "question": f"How many points separate {a['abbreviation']} and {b['abbreviation']} in the standings?",
        "options": options,
        "answer_idx": idx,
        "category": "standings",
    }


def q_which_driver_drives_for_team(rng: random.Random, standings: dict) -> dict | None:
    drivers = standings.get("drivers", [])
    if len(drivers) < 4:
        return None
    target = rng.choice(drivers)
    same_team = [d["name"] for d in drivers if d["team"] == target["team"] and d["name"] != target["name"]]
    other_team = [d["name"] for d in drivers if d["team"] != target["team"]]
    if len(other_team) < 3:
        return None
    wrong = rng.sample(other_team, min(3, len(other_team)))
    options, idx = _shuffle_options(rng, target["name"], wrong)
    if idx < 0:
        return None
    _ = same_team  # not used as distractor — would be ambiguous (teammate also drives for team)
    return {
        "question": f"Which driver drives for {target['team']} in {YEAR}?",
        "options": options,
        "answer_idx": idx,
        "category": "teams",
    }


def q_who_won_round_n(rng: random.Random, standings: dict) -> dict | None:
    completed = _completed_rounds(standings)
    if not completed:
        return None
    candidates = list(completed)
    rng.shuffle(candidates)
    for rnd in candidates:
        results = _round_results(rnd["round"])
        if not results:
            continue
        winner_row = next((r for r in results if r.get("position") == 1), None)
        if not winner_row:
            continue
        winner_name = winner_row.get("full_name") or winner_row.get("abbreviation")
        if not winner_name:
            continue
        other_names = [
            (r.get("full_name") or r.get("abbreviation"))
            for r in results if r.get("position") not in (None, 1)
        ]
        other_names = [n for n in other_names if n]
        if len(other_names) < 3:
            continue
        wrong = rng.sample(other_names, 3)
        options, idx = _shuffle_options(rng, winner_name, wrong)
        if idx < 0:
            continue
        return {
            "question": f"Who won the {rnd['name']} ({YEAR})?",
            "options": options,
            "answer_idx": idx,
            "category": "results",
        }
    return None


def q_circuit_location(rng: random.Random, standings: dict) -> dict | None:
    keys = list(CIRCUITS.keys())
    if len(keys) < 4:
        return None
    key = rng.choice(keys)
    circuit = CIRCUITS[key]
    others = [k for k in keys if k != key]
    wrong = [CIRCUITS[k]["country"] for k in rng.sample(others, min(3, len(others)))]
    options, idx = _shuffle_options(rng, circuit["country"], wrong)
    if idx < 0:
        return None
    return {
        "question": f"In which country is the {circuit['name']} located?",
        "options": options,
        "answer_idx": idx,
        "category": "circuits",
    }


def q_how_many_rounds_completed(rng: random.Random, standings: dict) -> dict | None:
    completed = _completed_rounds(standings)
    n = len(completed)
    if n < 1:
        return None
    correct = str(n)
    deltas = [n + d for d in (-2, -1, 1, 2, 3) if n + d >= 0]
    wrong = [str(x) for x in deltas]
    options, idx = _shuffle_options(rng, correct, wrong)
    if idx < 0:
        return None
    return {
        "question": f"How many rounds of the {YEAR} season have been completed so far?",
        "options": options,
        "answer_idx": idx,
        "category": "calendar",
    }


def q_constructor_of_driver(rng: random.Random, standings: dict) -> dict | None:
    drivers = standings.get("drivers", [])
    if len(drivers) < 4:
        return None
    target = rng.choice(drivers)
    teams = list({d["team"] for d in drivers if d["team"] != target["team"]})
    if len(teams) < 3:
        return None
    wrong = rng.sample(teams, 3)
    options, idx = _shuffle_options(rng, target["team"], wrong)
    if idx < 0:
        return None
    return {
        "question": f"Which constructor does {target['name']} ({target['abbreviation']}) race for?",
        "options": options,
        "answer_idx": idx,
        "category": "teams",
    }


def q_position_of_driver(rng: random.Random, standings: dict) -> dict | None:
    drivers = standings.get("drivers", [])
    if len(drivers) < 4:
        return None
    target = rng.choice(drivers)
    correct = str(target["position"])
    others = [str(d["position"]) for d in drivers if d["position"] != target["position"]]
    if len(others) < 3:
        return None
    wrong = rng.sample(others, 3)
    options, idx = _shuffle_options(rng, correct, wrong)
    if idx < 0:
        return None
    return {
        "question": f"What position is {target['name']} ({target['abbreviation']}) currently in the standings?",
        "options": options,
        "answer_idx": idx,
        "category": "standings",
    }


TEMPLATES = [
    q_who_leads_championship,
    q_which_team_leads_wcc,
    q_who_has_n_wins,
    q_points_gap,
    q_which_driver_drives_for_team,
    q_who_won_round_n,
    q_circuit_location,
    q_how_many_rounds_completed,
    q_constructor_of_driver,
    q_position_of_driver,
]


def generate_daily_questions(date_str: str) -> list[dict]:
    """Deterministic 10-question set for a given YYYY-MM-DD date string."""
    rng = random.Random(f"f1quiz-{date_str}")
    standings = _standings_for_quiz()

    pool = list(TEMPLATES)
    rng.shuffle(pool)

    questions: list[dict] = []
    attempts = 0
    # Cycle through the (shuffled) template pool, allowing repeats of
    # data-rich templates (standings-based) if some templates can't produce
    # a question (e.g. no results cached yet), until we have 10.
    idx = 0
    guard = 0
    while len(questions) < NUM_QUESTIONS and guard < 200:
        guard += 1
        template = pool[idx % len(pool)]
        idx += 1
        try:
            q = template(rng, standings)
        except Exception:
            q = None
        if q is not None:
            questions.append(q)
        attempts += 1
        if attempts > 100:
            break

    return questions[:NUM_QUESTIONS]


def _questions_for_date(date_str: str) -> list[dict]:
    """The day's quiz, frozen once generated.

    The in-memory cache has a 300s TTL, so this used to regenerate several
    times a day off live standings — a player could be served one set and then
    graded against a different one on submit. Persist to disk instead: same
    questions and same answer key for the whole day.
    """
    ck = f"quiz_questions_{date_str}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    persisted = disk_cache_get(ck)
    if persisted:
        cache_set(ck, persisted)
        return persisted
    qs = generate_daily_questions(date_str)
    cache_set(ck, qs)
    if qs:
        disk_cache_set(ck, qs)
    return qs


def _public_questions(questions: list[dict]) -> list[dict]:
    """Strip answer indices for the un-played view."""
    return [
        {"question": q["question"], "options": q["options"], "category": q["category"]}
        for q in questions
    ]


# ---------------------------------------------------------------------------
# Streak calculation
# ---------------------------------------------------------------------------

def _compute_streak(conn: sqlite3.Connection, username: str) -> dict:
    rows = conn.execute(
        "SELECT date FROM attempts WHERE username = ? ORDER BY date DESC",
        (username,),
    ).fetchall()
    dates = {r["date"] for r in rows}
    if not dates:
        return {"streak": 0, "best_streak": 0, "last_played": None}

    today = datetime.now(timezone.utc).date()
    last_played = max(dates)

    # Current streak: consecutive days ending today or yesterday
    streak = 0
    if str(today) in dates or str(today - timedelta(days=1)) in dates:
        cursor = today if str(today) in dates else today - timedelta(days=1)
        while str(cursor) in dates:
            streak += 1
            cursor -= timedelta(days=1)

    # Best streak ever: scan sorted date set for longest consecutive run
    sorted_dates = sorted(datetime.strptime(d, "%Y-%m-%d").date() for d in dates)
    best = cur_run = 1
    for i in range(1, len(sorted_dates)):
        if (sorted_dates[i] - sorted_dates[i - 1]).days == 1:
            cur_run += 1
            best = max(best, cur_run)
        else:
            cur_run = 1
    best_streak = max(best, streak)

    return {"streak": streak, "best_streak": best_streak, "last_played": last_played}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/daily")
async def daily_quiz(username: str = Query("")):
    date_str = _today_str()
    questions = await asyncio.to_thread(_questions_for_date, date_str)
    if not questions:
        raise HTTPException(503, "quiz data not available yet — standings still loading")

    out = {"date": date_str, "questions": _public_questions(questions), "already_played": False}

    uname = username.strip()
    if uname:
        with db() as conn:
            row = conn.execute(
                "SELECT * FROM attempts WHERE username = ? AND date = ?",
                (uname, date_str),
            ).fetchone()
        if row:
            out["already_played"] = True
            answers = json.loads(row["answers"])
            revealed = [
                {
                    "question": q["question"],
                    "options": q["options"],
                    "category": q["category"],
                    "answer_idx": q["answer_idx"],
                }
                for q in questions
            ]
            out["questions"] = revealed
            out["my_attempt"] = {
                "score": row["score"],
                "answers": answers,
                "completed_at": row["completed_at"],
            }
    return out


@router.post("/submit")
async def submit_quiz(body: SubmitIn, authorization: str | None = Header(default=None)):
    date_str = _today_str()
    # A quiz score is a leaderboard position; an unbound name lets anyone post
    # a perfect run under someone else's.
    username = verify_identity(body.username, authorization)

    questions = await asyncio.to_thread(_questions_for_date, date_str)
    if not questions:
        raise HTTPException(503, "quiz data not available yet")

    with db() as conn:
        existing = conn.execute(
            "SELECT id FROM attempts WHERE username = ? AND date = ?",
            (username, date_str),
        ).fetchone()
        if existing:
            raise HTTPException(409, "already played today's quiz")

        correct = [q["answer_idx"] for q in questions]
        score = sum(1 for a, c in zip(body.answers, correct) if a == c)

        conn.execute(
            """
            INSERT INTO attempts (username, date, score, answers, completed_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (username, date_str, score, json.dumps(body.answers), time.time()),
        )
        streak = _compute_streak(conn, username)

    return {"score": score, "correct": correct, "streak": streak["streak"]}


@router.get("/streak")
async def get_streak(username: str = Query(...)):
    uname = username.strip()
    if not uname:
        raise HTTPException(400, "username required")
    with db() as conn:
        return _compute_streak(conn, uname)


@router.get("/leaderboard")
async def leaderboard():
    cutoff_date = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
    with db() as conn:
        rows = conn.execute(
            """
            SELECT username, SUM(score) AS total_score, COUNT(*) AS days_played
            FROM attempts
            WHERE date >= ?
            GROUP BY username
            ORDER BY total_score DESC, days_played DESC
            LIMIT 20
            """,
            (cutoff_date,),
        ).fetchall()
    return [dict(r) for r in rows]
