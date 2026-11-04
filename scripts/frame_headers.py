"""Framing headers for serve.py, from scripts/frame-headers.json.

The same rule as `vite preview` (scripts/frame-headers.mjs): only this origin may frame the app,
and nothing may frame the pairing page, in any spelling the router renders it under: any letter
case, escaped letters, repeated slashes, a base path.

    python3 scripts/frame_headers.py /connect /CONNECT/ /home/
prints each path's headers as JSON, one line each, which src/frameHeaders.test.ts compares with
the JavaScript rule.
"""

import json
import sys
from pathlib import Path
from urllib.parse import unquote

POLICY = json.loads(Path(__file__).with_name("frame-headers.json").read_text(encoding="utf-8"))


def is_pairing_page_path(path: str) -> bool:
    """Whether the last segment of the decoded path reads the pairing page's name."""
    segments = [segment for segment in unquote(path).lower().split("/") if segment]
    return bool(segments) and segments[-1] == POLICY["pairingPage"]


def framing_headers(path: str) -> dict[str, str]:
    """The framing headers for a request path (a query is ignored)."""
    # Split by hand: urlsplit reads //connect as a host named connect.
    pathname = path.split("?", 1)[0]
    key = "pairingPageHeaders" if is_pairing_page_path(pathname) else "otherPageHeaders"
    return dict(POLICY[key])


def with_framing_headers(handler_class):
    """An http.server handler class that adds the framing headers to every response it sends."""

    class FramedHandler(handler_class):
        def end_headers(self):
            for name, value in framing_headers(self.path).items():
                self.send_header(name, value)
            super().end_headers()

    FramedHandler.__name__ = f"Framed{handler_class.__name__}"
    return FramedHandler


if __name__ == "__main__":
    for request_path in sys.argv[1:]:
        print(json.dumps(framing_headers(request_path), sort_keys=True))
