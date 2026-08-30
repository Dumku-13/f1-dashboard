"""Identity binding — a claimed paddock name must belong to whoever claims it.

Every feature router keys its rows on a free-form `username` taken straight
from the client, which is what lets an unregistered visitor use the feed,
quiz, predictor and fantasy without ever making an account. That openness is
only safe while the names involved are anonymous: the moment a name is
registered in `users.db` it stands for a person, and without this check
anyone could post, vote, follow or delete as them.

So the rule is deliberately narrow:

    registered name  ->  the request must carry that account's bearer token
    unknown name     ->  guest, wave it through

Registering a paddock name is therefore what makes it un-spoofable, and the
guest flow (plus the adopt-your-guest-history feature documented in
routers/auth.py) survives intact.
"""

import sqlite3

from fastapi import HTTPException

# The token -> user lookup lives in the auth router: one implementation, so the
# sessions/users join and its expiry rule can't drift between call sites.
from routers.auth import bearer_token, db, user_for_token


def _account_for_name(name: str) -> sqlite3.Row | None:
    """The registered account owning `name`, if there is one.

    NOCASE to match the users.username collation — "Verstappen" and
    "verstappen" are the same account, so they must be the same identity here.
    """
    with db() as conn:
        return conn.execute(
            "SELECT id, username FROM users WHERE username = ? COLLATE NOCASE",
            (name,),
        ).fetchone()


def verify_identity(username: str, authorization: str | None) -> str:
    """Bind a claimed paddock name to the caller; return the name to write.

    Guests get their name back untouched. A signed-in user gets the account's
    canonical spelling instead of whatever casing they typed, so one account
    can't fork into two identities across the feature tables.
    """
    name = (username or "").strip()
    if not name:
        raise HTTPException(400, "a paddock name is required")

    account = _account_for_name(name)
    if account is None:
        return name  # unregistered — the guest path, open on purpose

    token = bearer_token(authorization)
    if token is None:
        raise HTTPException(401, "that paddock name belongs to an account — sign in to use it")

    user = user_for_token(token)
    if user is None:
        raise HTTPException(401, "session expired — sign in again")
    if user["id"] != account["id"]:
        raise HTTPException(403, "that paddock name isn't yours — race under your own")

    return account["username"]
