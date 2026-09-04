"""Who is this request actually from — or an honest "we don't know".

Every per-IP rate limit in this app used to read `request.client.host`, which
is the address of whatever machine opened the TCP connection. Behind a proxy
that is the *proxy*, and both of our deployment shapes put a proxy there:

  Vercel -> Render     the peer is Render's edge, identical for every visitor
                       on earth. `MAX_LOGIN_FAILS_PER_IP = 20` then stops being
                       a per-visitor ceiling and becomes a site-wide switch:
                       twenty bad passwords from anybody locked *everyone* out
                       of signing in for fifteen minutes, and the registration
                       cap allowed five new accounts per hour in total.

  tunnel -> Next -> us the peer is 127.0.0.1, which uvicorn trusts by default,
                       so it rewrites `client.host` from `X-Forwarded-For` —
                       a header the client sends and Next passes straight
                       through. The limits became opt-in.

So the same field was either shared by everybody or chosen by the attacker.
Neither is a rate limit.

The fix is to stop guessing. `X-Forwarded-For` is only meaningful if you know
how many proxies are in front of you, because that count is what says which
entry is the real client and which are forgeable. That number is a property of
the deployment, not of the request, so it comes from the environment:

    TRUSTED_PROXY_HOPS=0   (default) nothing in front of us
    TRUSTED_PROXY_HOPS=1   one proxy  (Render, or Vercel straight to us)
    TRUSTED_PROXY_HOPS=2   two hops   (cloudflared -> Next -> here)

**When we cannot tell, we say so.** `client_ip()` returns None rather than a
plausible-looking wrong answer, and callers skip their per-IP check entirely.
That is deliberate: a limit that cannot identify who it is limiting either
punishes everyone or nobody, and of those two, nobody is the safe failure. The
per-name limits and the proof-of-work in bot_guard.py do not depend on knowing
the address, and they carry the load in the meantime.
"""

import ipaddress
import logging
import os

from fastapi import Request

log = logging.getLogger(__name__)

#: Number of proxies between the public internet and this process. See module
#: docstring — the default of 0 means "assume nothing", which is why an
#: unconfigured deployment behind a proxy gets None instead of a shared bucket.
try:
    TRUSTED_PROXY_HOPS = max(0, int(os.getenv("TRUSTED_PROXY_HOPS", "0")))
except ValueError:
    TRUSTED_PROXY_HOPS = 0

# Only warn once per process. This fires on a real misconfiguration, and one
# line per request would bury it in its own noise.
_warned = False


def _valid(addr: str) -> str | None:
    """The address if it is a real IP literal, else None.

    Anything in `X-Forwarded-For` is client-supplied until a trusted proxy has
    overwritten it, so a value that is not an address is not something to
    rate-limit on — it is something to ignore.
    """
    bare = addr.strip().strip("[]")
    if not bare:
        return None
    # A proxy may append "host:port"; the port is not part of the identity.
    if bare.count(":") == 1 and "." in bare:
        bare = bare.rsplit(":", 1)[0]
    try:
        return str(ipaddress.ip_address(bare))
    except ValueError:
        return None


def _forwarded_chain(request: Request) -> list[str]:
    """Every X-Forwarded-For entry, in order, across repeated headers."""
    chain: list[str] = []
    for value in request.headers.getlist("x-forwarded-for"):
        chain.extend(part for part in value.split(",") if part.strip())
    return chain


def client_ip(request: Request) -> str | None:
    """The caller's address, or None when it cannot be established.

    None is a real answer, not an error — see the module docstring. Callers
    must treat it as "skip the per-IP rule", never as a bucket key.
    """
    global _warned
    chain = _forwarded_chain(request)

    if TRUSTED_PROXY_HOPS == 0:
        if chain:
            # Someone in front of us is rewriting headers and we were not told
            # about them. We cannot tell a real client address from a spoofed
            # one, and `client.host` is that proxy — the shared-bucket bug.
            if not _warned:
                _warned = True
                log.warning(
                    "X-Forwarded-For is present but TRUSTED_PROXY_HOPS is 0, so the "
                    "client address cannot be established and per-IP limits are "
                    "disabled. Set TRUSTED_PROXY_HOPS to the number of proxies in "
                    "front of this service to turn them back on."
                )
            return None
        # No proxy headers and none expected: the peer really is the client.
        return request.client.host if request.client else None

    # Configured: each proxy appends the address it received the request from,
    # so with N trusted hops the client sits N from the end. Entries to the
    # left of it are whatever the client chose to send and are never read.
    if len(chain) < TRUSTED_PROXY_HOPS:
        # Shorter than the deployment promised — a direct hit on the backend,
        # or a stripped header. Either way this is not the shape we can read.
        return None
    return _valid(chain[-TRUSTED_PROXY_HOPS])
