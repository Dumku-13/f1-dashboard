"""Validation for URLs that one user hands to every other user's browser.

Feed posts carry an `image_url`. The backend never fetches it — the viewer's
browser does — so this is not an SSRF guard in the usual sense; there is no
server-side request to forge. What it protects is the *viewer*:

  - `http://` on an https page is mixed content, which browsers block anyway,
    so it renders as a broken image and looks like our bug;
  - `user:pass@host` in an image src leaks credentials into the referrer and
    into anyone's browser history;
  - a private/loopback literal (`http://192.168.1.1/reboot`) is a poster
    aiming at whatever sits at that address on the *reader's* network;
  - odd ports are almost never a real CDN and often are a probe.

Deliberately no DNS resolution: it would block the request thread on a
hostile nameserver, and it would still be defeated by rebinding a second
later. Cheap literal checks catch the abuse that is actually attempted, and
the honest answer for anything subtler is that we do not fetch the URL.
"""

import ipaddress
from urllib.parse import urlsplit

MAX_URL_LEN = 300

# Hostnames that mean "the machine reading this page". Not exhaustive by
# design — the IP-literal check below is what does the real work.
_LOCAL_NAMES = {"localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"}


def _is_private_host(host: str) -> bool:
    """True when the host is an IP literal pointing somewhere non-public."""
    bare = host.strip("[]")  # IPv6 literals arrive bracketed
    if bare.lower() in _LOCAL_NAMES:
        return True
    try:
        ip = ipaddress.ip_address(bare)
    except ValueError:
        return False  # a name, not a literal — see the module docstring
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def safe_image_url(raw: str | None) -> str | None:
    """Return the URL if it is safe to hand to another user's browser.

    None for "no image given"; raises ValueError with a message meant for the
    poster when the URL is present but unusable.
    """
    url = (raw or "").strip()
    if not url:
        return None
    if len(url) > MAX_URL_LEN:
        raise ValueError(f"that image link is too long (max {MAX_URL_LEN} characters)")

    try:
        parts = urlsplit(url)
    except ValueError:
        raise ValueError("that image link doesn't parse as a URL")

    if parts.scheme != "https":
        # Named separately from the generic failure because http:// is the
        # mistake people actually make, and "use https" is a fix they can act on.
        raise ValueError("image links must start with https://")
    if not parts.hostname:
        raise ValueError("that image link has no host")
    if parts.username or parts.password:
        raise ValueError("image links can't carry a username or password")
    if _is_private_host(parts.hostname):
        raise ValueError("that image link points at a private address")

    try:
        port = parts.port
    except ValueError:
        raise ValueError("that image link has an invalid port")
    if port is not None and port != 443:
        raise ValueError("image links must use the standard https port")

    return url
