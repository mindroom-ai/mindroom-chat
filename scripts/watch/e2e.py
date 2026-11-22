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
  listen   a text message that a second account, registered for the run, answers in its thread with a voice
           message (voice-answer.opus beside this script, sent as the backend's voice tool sends one, after the
           agent's own reply): the thread on the watch holds the message, the agent's reply and the voice
           answer in order, and the audio plays to its end (not run in an encrypted room: the script cannot
           encrypt the answer)
  resolve  the newest thread marked done: its com.mindroom.thread.tags state appears
  long_thread  a room of its own with 12 short threads and a long one (150 replies, each streamed in 3 edits):
           the first 10 rows show from the thread list alone (at most 2 requests and 30 KB, before any thread or the
           room's state is read) with the titles and edited replies the homeserver bundles, and the long
           thread's row then says what its full read finds

It prints one line per scenario, PASS or FAIL with the reason, keeps screenshots in --out, and exits 1 on a failure.
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import secrets
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

    def register(self, name: str) -> tuple[str, str]:
        """A new account on a homeserver with open registration; returns its user id and access token."""
        body = {"username": name, "password": secrets.token_hex(16), "auth": {"type": "m.login.dummy"}}
        status, answer = self.call("POST", "/_matrix/client/v3/register", body)
        if status == 401:
            body["auth"]["session"] = answer["session"]
            status, answer = self.call("POST", "/_matrix/client/v3/register", body)
        if status != 200:
            raise RuntimeError(f"registering {name} failed: {status} {answer}")
        return answer["user_id"], answer["access_token"]

    def upload(self, data: bytes, content_type: str, token: str) -> str:
        request = urllib.request.Request(self.url + "/_matrix/media/v3/upload", data,
                                         {"Content-Type": content_type, "Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(request) as response:
            return json.load(response)["content_uri"]

    def send(self, room: str, content: dict, token: str) -> str:
        path = f"/_matrix/client/v3/rooms/{urllib.parse.quote(room)}/send/m.room.message/{secrets.token_hex(8)}"
        status, body = self.call("PUT", path, content, token)
        if status != 200:
            raise RuntimeError(f"sending failed: {status} {body}")
        return body["event_id"]

    def events(self, room: str, limit: int = 40) -> list[dict]:
        _, body = self.call("GET", f"/_matrix/client/v3/rooms/{urllib.parse.quote(room)}/messages?dir=b&limit={limit}",
                            token=self.token)
        return body.get("chunk", [])[::-1]

    def state(self, room: str) -> list[dict]:
        _, body = self.call("GET", f"/_matrix/client/v3/rooms/{urllib.parse.quote(room)}/state", token=self.token)
        return body if isinstance(body, list) else []

    def create_room(self, name: str, invite: list[str]) -> str:
        status, body = self.call("POST", "/_matrix/client/v3/createRoom",
                                 {"name": name, "preset": "private_chat", "invite": invite}, self.token)
        if status != 200:
            raise RuntimeError(f"creating room failed: {status} {body}")
        return body["room_id"]


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
            name: str, during=None) -> str:
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
    started = time.time()
    if during:
        during()
    time.sleep(max(0, seconds - (time.time() - started)))
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
    parser.add_argument("--only", help="comma-separated subset of scenarios to run")
    args = parser.parse_args()
    selected = set(args.only.split(",")) if args.only else None
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    server = Homeserver(args.homeserver, args.user, args.password)
    udid = simulator(args.simulator)
    me = server.login()["user_id"]
    results = []

    def scenario(name: str, hooks: dict[str, str], seconds: int, check, during=None, room_id: str | None = None) -> None:
        if selected is not None and name not in selected:
            return
        target_room = room_id or args.room
        before = {event["event_id"] for event in server.events(target_room)}
        log = run_app(udid, args.app, server.credentials(), target_room, hooks, seconds, out, name,
                      during and (lambda: during(before)))
        new = [event for event in server.events(target_room) if event["event_id"] not in before]
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

    spoken: dict[str, str] = {}

    def thread_of(root: str) -> list[dict]:
        return [e for e in server.events(args.room)
                if (e.get("content", {}).get("m.relates_to") or {}).get("event_id") == root]

    def answer_by_voice(before: set[str]) -> None:
        """While the app runs: waits for its message and the agent's reply, then answers with a voice message."""
        def wait(find, seconds: int):
            deadline = time.time() + seconds
            while time.time() < deadline:
                if found := find():
                    return found
                time.sleep(2)
            return None

        try:
            root = wait(lambda: next((e["event_id"] for e in server.events(args.room) if e["event_id"] not in before
                                      and e["sender"] == me and e["type"] == "m.room.message"), None), 45)
            if not root:
                raise RuntimeError("no message from the watch")
            # The agent's reply, not the router's relay of the message to it.
            reply = wait(lambda: next((e["event_id"] for e in thread_of(root) if e["sender"] != me
                                       and "com.mindroom.original_sender" not in e["content"]), None), 30)
            if not reply:
                raise RuntimeError("no agent reply in the message's thread")
            speaker, token = server.register(f"watch-e2e-voice-{secrets.token_hex(4)}")
            room = urllib.parse.quote(args.room)
            # The room may be invite-only: an invite that is not needed, or not allowed, changes nothing.
            server.call("POST", f"/_matrix/client/v3/rooms/{room}/invite", {"user_id": speaker}, server.token)
            status, body = server.call("POST", f"/_matrix/client/v3/join/{room}", {}, token)
            if status != 200:
                raise RuntimeError(f"the second account could not join the room: {status} {body}")
            audio = Path(__file__).with_name("voice-answer.opus").read_bytes()
            details = {"duration": 1500, "waveform": [200, 600, 900, 600, 200]}
            spoken.update(root=root, reply=reply, voice=server.send(args.room, {
                "msgtype": "m.audio", "body": "voice-message.opus", "url": server.upload(audio, "audio/ogg", token),
                "info": {"mimetype": "audio/ogg", "size": len(audio), "duration": 1500},
                "org.matrix.msc3245.voice": {}, "org.matrix.msc1767.audio": details,
                "m.relates_to": {"rel_type": "m.thread", "event_id": root, "is_falling_back": True,
                                 "m.in_reply_to": {"event_id": reply}}}, token))
        except (RuntimeError, urllib.error.URLError) as error:
            spoken["problem"] = str(error)

    def listen(_new, log):
        if "voice" not in spoken:
            return f"the voice answer was not sent: {spoken.get('problem')}"
        root, voice = spoken["root"], spoken["voice"]
        lines = log.splitlines()
        threads = [line.split(f"thread {root} ")[-1].strip().split(",") for line in lines if f"thread {root} " in line]
        expected = [root, spoken["reply"], voice]
        if not threads or [event for event in threads[-1] if event in expected] != expected:
            return f"the thread on the watch is {threads[-1] if threads else 'not read'}, without {expected} in order"
        if "sound failed" in log or f"sound {voice}" not in log:
            return "the voice answer did not play"
        return None if "sound ended" in log.split(f"sound {voice}")[-1] else "the voice answer did not play to its end"

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
    if any(event.get("type") == "m.room.encryption" for event in server.state(args.room)):
        print("SKIP listen: the room is encrypted", flush=True)
    else:
        scenario("listen", {"MINDROOM_WATCH_E2E_SEND_TEXT": "Tell me aloud", "MINDROOM_WATCH_E2E_OPEN": "newest",
                            "MINDROOM_WATCH_E2E_LISTEN": "voice"}, 90, listen, answer_by_voice)
    scenario("resolve", {"MINDROOM_WATCH_E2E_RESOLVE": "newest"}, 25, resolve)

    if selected is None or "long_thread" in selected:
        replier, replier_token = server.register(f"watch-e2e-long-{secrets.token_hex(4)}")
        long_room = server.create_room("Watch Placeholder Room", [replier])
        status, body = server.call("POST", f"/_matrix/client/v3/join/{urllib.parse.quote(long_room)}", {}, replier_token)
        if status != 200:
            raise RuntimeError(f"long_thread replier could not join room: {status} {body}")

        # Seed 12 short placeholder threads + 1 long thread (150 replies, each streamed with 3 edits = 600 events):
        # two pages of the thread list.
        for idx in range(1, 13):
            r = server.send(long_room, {"msgtype": "m.text", "body": f"Placeholder topic {idx}"}, server.token)
            server.send(long_room, {
                "msgtype": "m.text", "body": f"Placeholder reply for topic {idx}",
                "m.relates_to": {"rel_type": "m.thread", "event_id": r, "is_falling_back": True,
                                 "m.in_reply_to": {"event_id": r}},
            }, replier_token)
            server.send(long_room, {
                "msgtype": "m.notice", "body": f"Sample Topic {idx}",
                "io.mindroom.thread_summary": {"version": 1, "summary": f"Sample Topic {idx}"},
                "m.relates_to": {"rel_type": "m.thread", "event_id": r, "is_falling_back": True,
                                 "m.in_reply_to": {"event_id": r}},
            }, replier_token)

        long_root = server.send(long_room, {"msgtype": "m.text", "body": "Long thread placeholder prompt"}, server.token)
        server.send(long_room, {
            "msgtype": "m.notice", "body": "Long Streamed Thread",
            "io.mindroom.thread_summary": {"version": 1, "summary": "Long Streamed Thread"},
            "m.relates_to": {"rel_type": "m.thread", "event_id": long_root, "is_falling_back": True,
                             "m.in_reply_to": {"event_id": long_root}},
        }, replier_token)

        prev = long_root
        for i in range(1, 151):
            reply_id = server.send(long_room, {
                "msgtype": "m.text", "body": f"Placeholder step {i}: starting…",
                "io.mindroom.stream_status": "streaming",
                "m.relates_to": {"rel_type": "m.thread", "event_id": long_root, "is_falling_back": True,
                                 "m.in_reply_to": {"event_id": prev}},
            }, replier_token)
            for rev in (1, 2, 3):
                final = rev == 3
                body_text = (f"Placeholder step {i} of 150 complete." if final
                             else f"Placeholder step {i}: draft {rev} with sample streaming text")
                new_content = {"msgtype": "m.text", "body": body_text,
                               "io.mindroom.stream_status": "completed" if final else "streaming"}
                server.send(long_room, {
                    "msgtype": "m.text", "body": f"* {body_text}",
                    "m.new_content": new_content,
                    "m.relates_to": {"rel_type": "m.replace", "event_id": reply_id},
                }, replier_token)
            prev = reply_id

        def check_long_thread(_new, log):
            lines = log.splitlines()

            def read(line: str) -> tuple[str, str, int] | None:
                """A request for the room's threads, one event or what relates to it, or the room's state, as the
                app logs it when it starts ("http GET <path>") and when its answer is in ("http done <path> <bytes>")."""
                match = re.search(rf"http (GET|done) \S*/rooms/{re.escape(long_room)}/"
                                  r"(threads|state|relations/\S+|event/\S+|context/\S+)(?: (\d+))?$", line)
                return match and (match[1], match[2].split("/")[0], int(match[3] or 0))

            def at(index: int) -> datetime.datetime:
                return datetime.datetime.strptime(lines[index][:23], "%Y-%m-%d %H:%M:%S.%f")

            painted = next((i for i, line in enumerate(lines)
                            if (match := re.search(r"refresh painted rows=(\d+)", line)) and int(match[1]) >= 10), None)
            if painted is None:
                return "the room's first 10 rows did not show with the thread list's first page"
            before = [found for line in lines[:painted] if (found := read(line))]
            early = [kind for verb, kind, _ in before if verb == "GET" and kind != "threads"]
            if early:
                return f"read before the first rows showed: {early}"
            requests = sum(1 for verb, _, _ in before if verb == "GET")
            size = sum(size for verb, _, size in before if verb == "done")
            first = next((i for i, line in enumerate(lines) if (found := read(line)) and found[1] == "threads"), None)
            if first is None:
                return "the app's log has no request for the room's thread list"
            done = next((i for i in range(painted, len(lines)) if "refresh done " in lines[i]), None)
            if done is None:
                return "the refresh did not finish"
            if not lines[done].endswith("rows=13"):
                return "the refresh did not end with the room's 13 rows (the list's second page)"
            all_reads = [found for line in lines[first:done] if (found := read(line))]
            print(f"  long_thread: first rows after {(at(painted) - at(first)).total_seconds() * 1000:.0f} ms, "
                  f"{requests} request(s), {size} bytes; every thread read after "
                  f"{(at(done) - at(first)).total_seconds() * 1000:.0f} ms, "
                  f"{sum(1 for verb, _, _ in all_reads if verb == 'GET')} requests, "
                  f"{sum(size for verb, _, size in all_reads if verb == 'done')} bytes", flush=True)
            if requests > 2 or size > 30_000:
                return f"the first rows took {requests} requests and {size} bytes (at most 2 and 30000)"
            # What the list alone says of a thread, before any thread is read: the title and the newest reply the
            # homeserver bundles with the root, the reply as its bundled edit left it.
            listed = {match[1]: match[2] for line in lines[:painted]
                      if (match := re.search(r"listed (\$\S+) (.*)$", line))}
            if not listed.get(long_root, "").endswith(": Placeholder step 150 of 150 complete."):
                return f"the long thread's row before its read is {listed.get(long_root)!r}"
            if not any(re.fullmatch(r"Sample Topic 12 \| .*: Placeholder reply for topic 12", row) for row in listed.values()):
                return f"no row with its bundled title and reply before any read: {sorted(listed.values())}"
            shown = next((i for i, line in enumerate(lines) if f"row {long_root} " in line), None)
            read_at = next((i for i, line in enumerate(lines) if f"hydrated {long_root} " in line), None)
            if shown is None or read_at is None or shown > read_at:
                return "the long thread's row did not show before the thread was read"
            # What reading the whole thread finds: its title, the last reply as its last edit left it, no chip.
            final = lines[read_at].split(f"hydrated {long_root} ")[-1]
            if not (final.startswith("idle(") and " Long Streamed Thread | " in final
                    and final.endswith(": Placeholder step 150 of 150 complete.")):
                return f"the long thread's row after its read is {final!r}"
            return None

        scenario("long_thread", {"MINDROOM_WATCH_E2E_SCROLL_ROWS": "1"}, 25, check_long_thread, room_id=long_room)

    return 1 if any(problem for _, problem in results) else 0


if __name__ == "__main__":
    sys.exit(main())
