"""Bot protection for the endpoints where nobody has proved who they are.

**Why not a CAPTCHA.** Turnstile and hCaptcha both mean loading a third
party's script into the page, which the CSP in next.config.ts forbids and
which would make the "no third-party anything" line in the FAQ and the
storage notice untrue. Neither is a change worth making quietly, so this is
self-hosted instead.

**What this is.** A proof-of-work challenge: the client must find a counter
whose SHA-256 digest starts with N zero bits before the server will look at
the request. One person registering pays a couple of hundred milliseconds
once. A script creating ten thousand accounts pays that ten thousand times,
serially, in a language it does not get to choose.

**What this is not.** It is a cost, not a wall. Someone determined, with a
GPU or a rented cloud, will still get through — the same is true of every
CAPTCHA. What it removes is the cheap, high-volume, one-line-of-Python abuse
that a public form otherwise attracts, and it does that without shipping
anybody's browsing habits to a third party.

The existing rate limits are the other half: they are all per *name*, which a
bot sidesteps by rotating names, so they need something that costs per
*request* standing behind them.
"""

import hashlib
import hmac
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException

DB_PATH = Path(__file__).resolve().parent / "bot.db"

# Difficulty in leading zero BITS of the digest. Each extra bit doubles the
# expected work, so these are chosen against how much a human should wait:
#
#   17 bits ≈ 131k hashes ≈ 0.2-0.5s in the browser — registration, once.
#   14 bits ≈  16k hashes ≈ 30-60ms — sign-in, every time, unnoticeable.
#   15 bits ≈  33k hashes ≈ 60-120ms — a guest posting to the feed.
#
# Registration is the expensive one because a squatted paddock name is the
# costliest thing to undo. Sign-in is cheap per attempt but is paid on every
# credential-stuffing guess, which is where it adds up.
DIFFICULTY = {
    "register": 17,
    "login": 14,
    "content": 15,
    # The one scope where a request costs real money rather than a row in
    # SQLite — every call is a billed LLM request on our key. Priced like
    # registration (~0.2-0.5s) because unlike a feed post there is no cheap
    # way to undo the spend, and a question is not something anyone asks in a
    # tight loop.
    "engineer": 17,
}

# A challenge is worthless after this, which caps how far ahead a bot can
# usefully pre-compute a stockpile of solved challenges.
CHALLENGE_TTL_S = 300

#: Field separator in the X-Pow header. Must not appear in any field — the
#: nonce is urlsafe-base64, the signature is hex, and `issued` is a float
#: whose decimal point ruled out the obvious choice.
PROOF_SEPARATOR = "~"

# A form that comes back faster than a human could plausibly fill it is a
# script. The clock here is the server's own signed `issued` timestamp, not a
# number the client sends, so there is nothing to forge.
MIN_FILL_S = {
    "register": 1.5,
    "login": 0.0,   # a password manager fills and submits genuinely fast
    "content": 0.0,
    "engineer": 0.0,  # a quick-prompt chip is one tap — no floor to enforce
}


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
        # Spent challenges. Without this a single solved proof could be
        # replayed forever, which would make the whole exercise decorative.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS spent_proofs (
                nonce TEXT PRIMARY KEY,
                spent_at REAL NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_spent_at ON spent_proofs (spent_at)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS guard_secret (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                secret TEXT NOT NULL
            )
            """
        )


_init()


def _secret() -> bytes:
    """The HMAC key challenges are signed with.

    Persisted rather than generated per process on purpose: under
    `uvicorn --workers N` every worker runs this module separately, and a
    per-process key would mean a challenge issued by one worker is rejected
    as forged by the next — an intermittent failure that would be miserable
    to diagnose. Stored in the database so all workers read the same value,
    and restarting only invalidates challenges if the file is deleted.
    """
    with db() as conn:
        row = conn.execute("SELECT secret FROM guard_secret WHERE id = 1").fetchone()
        if row is not None:
            return bytes.fromhex(row["secret"])
        fresh = secrets.token_bytes(32)
        # INSERT OR IGNORE: two workers starting at once both find no row.
        conn.execute(
            "INSERT OR IGNORE INTO guard_secret (id, secret) VALUES (1, ?)", (fresh.hex(),)
        )
        row = conn.execute("SELECT secret FROM guard_secret WHERE id = 1").fetchone()
    return bytes.fromhex(row["secret"])


def _sign(scope: str, nonce: str, issued: float, difficulty: int) -> str:
    payload = f"{scope}:{nonce}:{issued:.3f}:{difficulty}".encode()
    return hmac.new(_secret(), payload, hashlib.sha256).hexdigest()


def issue_challenge(scope: str) -> dict:
    """A fresh challenge for `scope`, signed so it cannot be edited."""
    if scope not in DIFFICULTY:
        raise HTTPException(400, "unknown challenge scope")
    nonce = secrets.token_urlsafe(12)
    issued = time.time()
    difficulty = DIFFICULTY[scope]
    return {
        "scope": scope,
        "nonce": nonce,
        "issued": round(issued, 3),
        "difficulty": difficulty,
        "signature": _sign(scope, nonce, issued, difficulty),
    }


def _leading_zero_bits(digest: bytes) -> int:
    bits = 0
    for byte in digest:
        if byte == 0:
            bits += 8
            continue
        # bit_length() of a non-zero byte gives the position of its highest
        # set bit, so 8 - that is how many zeros precede it.
        bits += 8 - byte.bit_length()
        break
    return bits


def solve(nonce: str, difficulty: int, limit: int = 1 << 26) -> int:
    """Reference solver — the server never needs this, but a test does."""
    for counter in range(limit):
        digest = hashlib.sha256(f"{nonce}:{counter}".encode()).digest()
        if _leading_zero_bits(digest) >= difficulty:
            return counter
    raise RuntimeError("no solution found within limit")


def verify_proof(scope: str, header: str | None) -> None:
    """Check the `X-Pow` header, or raise.

    Format: `nonce~issued~difficulty~signature~counter` — one header rather
    than five, and out of the request body so it can be applied to any
    endpoint without changing its model.

    `~` and not `.`, because `issued` is a float and carries a dot of its own;
    splitting on `.` produced six fields and rejected every valid proof.
    """
    required_difficulty = DIFFICULTY.get(scope)
    if required_difficulty is None:
        raise HTTPException(400, "unknown challenge scope")

    if not header:
        raise HTTPException(428, "this form needs a moment to warm up — try again")

    parts = header.split(PROOF_SEPARATOR)
    if len(parts) != 5:
        raise HTTPException(400, "malformed proof of work")
    nonce, issued_raw, difficulty_raw, signature, counter_raw = parts

    try:
        issued = float(issued_raw)
        difficulty = int(difficulty_raw)
        counter = int(counter_raw)
    except ValueError:
        raise HTTPException(400, "malformed proof of work")

    # Signature first: everything below trusts these values, so nothing else
    # is worth checking until we know the server issued them unaltered.
    expected = _sign(scope, nonce, issued, difficulty)
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(403, "that challenge isn't one we issued")

    if difficulty < required_difficulty:
        # Only reachable if DIFFICULTY was lowered and then raised again while
        # an old challenge was still in flight; cheap to rule out regardless.
        raise HTTPException(403, "challenge too easy — request a new one")

    age = time.time() - issued
    if age > CHALLENGE_TTL_S:
        raise HTTPException(408, "that took too long — try again")
    if age < 0:
        raise HTTPException(403, "that challenge isn't one we issued")
    if age < MIN_FILL_S.get(scope, 0.0):
        # Server-signed clock, so this is a real measurement of how long the
        # form was open, not a self-reported one.
        raise HTTPException(429, "that was too quick — take another run at it")

    if counter < 0:
        raise HTTPException(400, "malformed proof of work")
    digest = hashlib.sha256(f"{nonce}:{counter}".encode()).digest()
    if _leading_zero_bits(digest) < required_difficulty:
        raise HTTPException(403, "proof of work is incorrect")

    # Spend it. UNIQUE on nonce makes this the atomic bit: two requests racing
    # with the same proof, and exactly one of them commits.
    now = time.time()
    with db() as conn:
        try:
            conn.execute(
                "INSERT INTO spent_proofs (nonce, spent_at) VALUES (?, ?)", (nonce, now)
            )
        except sqlite3.IntegrityError:
            raise HTTPException(403, "that proof was already used")
        # Nothing older than the TTL can still be accepted, so nothing older
        # needs remembering.
        conn.execute("DELETE FROM spent_proofs WHERE spent_at < ?", (now - CHALLENGE_TTL_S,))


def check_honeypot(value: str | None) -> None:
    """Reject a form where the invisible field came back filled.

    Catches the naive end of the spectrum — form-filling bots that populate
    every input they can find. Costs a human nothing, because a human never
    sees the field. Deliberately generic error text: telling a bot exactly
    which trap it stepped in is how the trap stops working.
    """
    if value:
        raise HTTPException(400, "that didn't look right — try again")
