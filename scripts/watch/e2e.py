#!/usr/bin/env python3
"""End-to-end run of the Apple Watch app in a watchOS simulator against a homeserver with MindRoom agents.

Usage (on a Mac with Xcode and a watchOS simulator runtime):
  scripts/watch/e2e.py --app <MindRoomWatch.app, a DEBUG simulator build> --homeserver <URL> \\
      --user <name> --password <password> --room <room id> [--simulator <name>] [--out <dir>]

The account, the room and the agents come from the agent stack (`just agent-stack <n> up` prints them; the room is
its lobby, or an encrypted room the account created and invited the agents to). The homeserver must be reachable
from the simulator, so on the Mac's own 127.0.0.1 (an ssh -R tunnel when the stack runs elsewhere).

For each scenario the script mints a login token for the account the way the iPhone app does (password login, then
POST /login/get_token through interactive auth), reinstalls the app with an empty Keychain, launches it with the
DEBUG launch hooks of ios/Watch/MindRoomWatch/E2EHooks.swift, and checks the outcome on the homeserver and in the
app's log:

  voice    a 2 s tone sent as a voice message: a new message from the account, whose row on the watch names the
           recording (Send follows it to open the thread), and an agent reply in its thread
  approve  "#approve" (the stub's shell call that needs approval) approved from the watch: the card turns approved
  ask      "#ask" (a question with two options) answered from the watch with its first option
  resolve  the newest thread marked done: its com.mindroom.thread.tags state appears

It prints one line per scenario, PASS or FAIL with the reason, keeps screenshots in --out, and exits 1 on a failure.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BUNDLE = "chat.mindroom.app.watchkitapp"
DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer"


class Homeserver:
    def __init__(self, url: str, user: str, password: str):
        self.url = url.rstrip("/")
        self.user, self.password = user, password
        self.token = self.login()["access_token"]

    def call(self, method: str, path: str, body=None, token: str | None = None):
        request = urllib.request.Request(
            self.url + path,
            json.dumps(body).encode() if body is not None else None,
            {"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})},
            method=method,
        )
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def login(self):
        status, body = self.call("POST", "/_matrix/client/v3/login", {
            "type": "m.login.password", "identifier": {"type": "m.id.user", "user": self.user},
            "password": self.password, "initial_device_display_name": "watch e2e"})
        if status != 200:
            raise SystemExit(f"login failed: {status} {body}")
        return body

    def credentials(self) -> dict:
        """What the iPhone app sends the watch: a fresh login token of another session of the account."""
        phone = self.login()
        status, body = self.call("POST", "/_matrix/client/v1/login/get_token", {}, phone["access_token"])
        if status == 401:
            auth = {"type": "m.login.password", "identifier": {"type": "m.id.user", "user": self.user},
                    "password": self.password, "session": body["session"]}
            status, body = self.call("POST", "/_matrix/client/v1/login/get_token", {"auth": auth}, phone["access_token"])
        if status != 200:
            raise SystemExit(f"get_token failed: {status} {body}")
        return {"v": 1, "kind": "credentials", "homeserverUrl": self.url, "userId": phone["user_id"],
                "loginToken": body["login_token"], "expiresAt": time.time() * 1000 + body["expires_in_ms"]}

    def events(self, room: str, limit: int = 40) -> list[dict]:
        _, body = self.call("GET", f"/_matrix/client/v3/rooms/{urllib.parse.quote(room)}/messages?dir=b&limit={limit}",
                            token=self.token)
        return body.get("chunk", [])[::-1]

    def state(self, room: str) -> list[dict]:
        _, body = self.call("GET", f"/_matrix/client/v3/rooms/{urllib.parse.quote(room)}/state", token=self.token)
        return body if isinstance(body, list) else []


def simctl(*args: str, check: bool = True) -> str:
    env = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "DEVELOPER_DIR": DEVELOPER_DIR, "HOME": str(Path.home())}
    return subprocess.run(["xcrun", "simctl", *args], capture_output=True, text=True, check=check, env=env).stdout


def simulator(name: str) -> str:
    devices = json.loads(simctl("list", "devices", "available", "--json"))["devices"]
    for runtime, entries in devices.items():
        if "watchOS" in runtime:
            for device in entries:
                if device["name"] == name:
                    simctl("boot", device["udid"], check=False)
                    simctl("bootstatus", device["udid"], "-b", check=False)
                    return device["udid"]
    raise SystemExit(f"no watchOS simulator named {name!r}")


def app_log(udid: str, since: str) -> str:
    return simctl("spawn", udid, "log", "show", "--start", since, "--style", "compact", "--predicate",
                  f'subsystem == "{BUNDLE}"', check=False)


def run_app(udid: str, app: str, credentials: dict, room: str, hooks: dict[str, str], seconds: int, out: Path,
            name: str) -> str:
    simctl("terminate", udid, BUNDLE, check=False)
    simctl("uninstall", udid, BUNDLE, check=False)
    simctl("keychain", udid, "reset", check=False)
    simctl("install", udid, app)
    simctl("privacy", udid, "grant", "microphone", BUNDLE, check=False)
    since = time.strftime("%Y-%m-%d %H:%M:%S")
    env = {"MINDROOM_WATCH_E2E_CREDENTIALS": json.dumps(credentials), "MINDROOM_WATCH_E2E_ROOM": room, **hooks}
    launch_env = {f"SIMCTL_CHILD_{key}": value for key, value in env.items()}
    subprocess.run(["xcrun", "simctl", "launch", udid, BUNDLE], capture_output=True, check=True,
                   env={"PATH": "/usr/bin:/bin", "DEVELOPER_DIR": DEVELOPER_DIR, "HOME": str(Path.home()), **launch_env})
    time.sleep(seconds)
    simctl("io", udid, "screenshot", str(out / f"{name}.png"), check=False)
    return app_log(udid, since)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--app", required=True)
    parser.add_argument("--homeserver", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--room", required=True)
    parser.add_argument("--simulator", default="MindRoom Watch Spike")
    parser.add_argument("--out", default="/tmp/mindroom-watch-e2e")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    server = Homeserver(args.homeserver, args.user, args.password)
    udid = simulator(args.simulator)
    me = server.login()["user_id"]
    results = []

    def scenario(name: str, hooks: dict[str, str], seconds: int, check) -> None:
        before = {event["event_id"] for event in server.events(args.room)}
        log = run_app(udid, args.app, server.credentials(), args.room, hooks, seconds, out, name)
        new = [event for event in server.events(args.room) if event["event_id"] not in before]
        problem = check(new, log)
        results.append((name, problem))
        print(f"{'FAIL' if problem else 'PASS'} {name}{': ' + problem if problem else ''}", flush=True)

    def voice(new, log):
        mine = [e for e in new if e["sender"] == me and e["type"] in ("m.room.message", "m.room.encrypted")]
        if not mine:
            return "no message from the watch"
        root = mine[0]["event_id"]
        rows = [line for line in log.splitlines() if f"row {root} " in line]
        if not rows or not all("voice-message-e2e.m4a" in line for line in rows):
            return "the message's row does not name its recording"
        replies = [e for e in new if e["sender"] != me
                   and (e.get("content", {}).get("m.relates_to") or {}).get("event_id") == root]
        return None if replies else "no reply in the voice message's thread"

    def approve(_new, log):
        return None if " approved" in log and "card " in log else "the card did not turn approved on the watch"

    def ask(_new, log):
        return None if "answered" in log else "the question was not answered"

    def resolve(_new, log):
        resolved = [line.split("resolved ")[-1].strip() for line in log.splitlines() if "resolved $" in line]
        if not resolved:
            return "the watch resolved nothing"
        keys = {e.get("state_key") for e in server.state(args.room) if e.get("type") == "com.mindroom.thread.tags"
                and e.get("content")}
        return None if json.dumps([resolved[-1], "resolved"], separators=(",", ":")) in keys else "no resolved tag"

    scenario("voice", {"MINDROOM_WATCH_E2E_SEND_TONE": "2", "MINDROOM_WATCH_E2E_OPEN": "newest"}, 60, voice)
    scenario("approve", {"MINDROOM_WATCH_E2E_SEND_TEXT": "#approve", "MINDROOM_WATCH_E2E_OPEN": "newest",
                         "MINDROOM_WATCH_E2E_APPROVE": "approve"}, 45, approve)
    scenario("ask", {"MINDROOM_WATCH_E2E_SEND_TEXT": "#ask", "MINDROOM_WATCH_E2E_OPEN": "newest",
                     "MINDROOM_WATCH_E2E_ANSWER": "first"}, 45, ask)
    scenario("resolve", {"MINDROOM_WATCH_E2E_RESOLVE": "newest"}, 25, resolve)
    return 1 if any(problem for _, problem in results) else 0


if __name__ == "__main__":
    sys.exit(main())
