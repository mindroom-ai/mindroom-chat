"""Small Matrix client-server helpers for the scripts that seed or drive a disposable homeserver.

Import from a script in a subdirectory with `sys.path.insert(0, str(Path(__file__).resolve().parents[1]))`.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid


def homeserver_url() -> str:
    """E2E_HOMESERVER, else the homeserver of the e2e slot in E2E_MATRIX_PORT (scripts/e2e-slot.sh), else slot 0."""
    return os.environ.get("E2E_HOMESERVER") or f"http://127.0.0.1:{os.environ.get('E2E_MATRIX_PORT', '28008')}"


def quote(value: str) -> str:
    """A room ID, user ID or state key as one path segment."""
    return urllib.parse.quote(value, safe="")


def http_json(
    method: str,
    url: str,
    body: object | None = None,
    token: str | None = None,
    timeout: float = 10.0,
    raw: bytes | None = None,
    content_type: str = "application/json",
) -> tuple[int, dict]:
    """The status and JSON body of a request; never raises. Status 0 means no answer."""
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Content-Type", content_type)
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            answer = response.read()
            return response.status, json.loads(answer) if answer else {}
    except urllib.error.HTTPError as error:
        answer = error.read()
        try:
            return error.code, json.loads(answer) if answer else {}
        except json.JSONDecodeError:
            return error.code, {"error": answer.decode(errors="replace")}
    except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as error:
        return 0, {"error": str(error)}


def call(
    homeserver: str,
    method: str,
    path: str,
    token: str | None = None,
    body: object | None = None,
    raw: bytes | None = None,
    content_type: str = "application/json",
    timeout: float = 60.0,
) -> dict:
    """The JSON answer to a request; raises RuntimeError on an error, except a 401 that starts user-interactive auth."""
    status, answer = http_json(method, homeserver + path, body, token, timeout, raw, content_type)
    if 200 <= status < 300 or (status == 401 and "session" in answer):
        return answer
    raise RuntimeError(f"{method} {path}: {status} {answer}")


def register(homeserver: str, username: str, password: str) -> dict:
    """Registers an account with the dummy auth stage; returns the answer with `user_id` and `access_token`."""
    body: dict = {"username": username, "password": password}
    answer = call(homeserver, "POST", "/_matrix/client/v3/register", body=body)
    if "access_token" not in answer:
        body["auth"] = {"type": "m.login.dummy", "session": answer["session"]}
        answer = call(homeserver, "POST", "/_matrix/client/v3/register", body=body)
    return answer


def send(homeserver: str, token: str, room_id: str, content: dict, event_type: str = "m.room.message") -> str:
    """Sends an event with a fresh transaction ID and returns its event ID."""
    path = f"/_matrix/client/v3/rooms/{quote(room_id)}/send/{event_type}/{uuid.uuid4().hex}"
    return call(homeserver, "PUT", path, token, content)["event_id"]
