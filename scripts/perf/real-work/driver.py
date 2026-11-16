#!/usr/bin/env python3
"""Keep a number of agent replies streaming in the lobby of an agent stack, shaped by a workload profile.

Usage: python3 scripts/perf/real-work/driver.py --stack <state.json> --profile <profile.json>
       --phase history|live [--history <file>] [--streams N] [--seconds S] [--seed N] --out <file>

  --stack    the state that `python3 scripts/agent-stack/stack.py <slot> up` (or `status`) prints
  --profile  a workload profile, e2e/perf/workloads/<name>.json

The stack's stub model answers each `#work` prompt this script posts as the stack's tester
(scripts/agent-stack/stub_model.py), so the real backend writes the events: live frames, edits, jobs state.

history  creates the profile's quiet rooms, then gives each of its threads its turns in the lobby, `historyStreams`
         (or --streams) replies at once, with the stub at full speed (`wps=0 toolsec=0`). Writes --out as
         {"room": str, "threads": [root ID...], "quietRooms": [room ID...]} and exits 0 once every thread has its
         turns; a reply that never ends (the profile's `live.stuckSeconds`) fails the run with exit 1.
live     reads that file (--history) and keeps `live.streams` (or --streams) replies streaming in its threads at the
         profile's pace: a thread whose reply ended gets its next turn after a pause from `live.pauseSeconds`. Every
         5 s it appends one JSON line to --out, {"t": unix s, "target", "streaming", "frames", "edits", "jobs",
         "stuck"}: the streams asked for, the replies under way at that moment, and the live frames, agent edits,
         jobs state writes and replies given up as stuck that its own /sync saw in those 5 s. It runs for --seconds,
         or until SIGTERM or SIGINT, and exits 0; it stops with exit 2 when, after the first 30 s, the last 30 s
         held under 80 % of the target on average, so a backend that cannot keep up never passes as a light load.

A profile's distributions are {"p50": n, "p90": n, "max": n}; a draw is piecewise linear through 0, the median, the
90th percentile and the maximum. --seed (default 1) fixes every draw.
"""

from __future__ import annotations

import argparse
import json
import random
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from matrix_http import call, http_json, quote, send  # noqa: E402

WINDOW_SECONDS = 5
# The start of a live run is left out of the shortfall check, and the check averages over this long.
SHORTFALL_GRACE_SECONDS = 30
SHORTFALL_SHARE = 0.8
# A reply whose stream status is one of these has ended (MindRoom's src/mindroom/constants.py).
ENDED_STATUSES = frozenset({"completed", "cancelled", "interrupted", "error"})
STREAM_STATUS = "io.mindroom.stream_status"
LIVE_FRAME = "io.mindroom.live"
JOBS_STATE = "io.mindroom.background_jobs"
DIST_KEYS = ("p50", "p90", "max")
DISTS = ("turns", "reply.words", "reply.reasoning", "reply.tools", "reply.toolsec", "live.pauseSeconds")
PROFILE_KEYS = (
    "name",
    "quietRooms",
    "quietMessages",
    "threads",
    "reply.wps",
    "live.streams",
    "live.stuckSeconds",
    "historyStreams",
    *(f"{dist}.{key}" for dist in DISTS for key in DIST_KEYS),
)


# Profiles


def check_profile(profile: dict) -> dict:
    """The profile, when it has every key of the schema; ValueError names the first one it lacks."""
    for path in PROFILE_KEYS:
        value: object = profile
        for key in path.split("."):
            if not isinstance(value, dict) or key not in value:
                raise ValueError(f"the profile has no {path}")
            value = value[key]
    return profile


def load_profile(path: Path) -> dict:
    return check_profile(json.loads(Path(path).read_text()))


def sample(dist: dict, rng: random.Random) -> float:
    """A draw from {"p50", "p90", "max"}: piecewise linear through (0, 0), (0.5, p50), (0.9, p90) and (1, max)."""
    share = rng.random()
    points = ((0.0, 0.0), (0.5, dist["p50"]), (0.9, dist["p90"]), (1.0, dist["max"]))
    for (low, low_value), (high, high_value) in zip(points, points[1:]):
        if share <= high:
            return max(0.0, low_value + (high_value - low_value) * (share - low) / (high - low))
    return max(0.0, float(dist["max"]))


def work_prompt(reply: dict, rng: random.Random, live: bool) -> str:
    """A `#work` prompt for the stub model with a reply drawn from the profile's `reply`. History replies come at
    full speed (`wps=0 toolsec=0`) and are otherwise the replies the same draws give a live run."""
    words = max(1, round(sample(reply["words"], rng)))
    reasoning = round(sample(reply["reasoning"], rng))
    tools = round(sample(reply["tools"], rng))
    toolsec = round(sample(reply["toolsec"], rng), 1)
    seed = rng.randrange(1, 1_000_000)
    wps = reply["wps"] if live else 0
    return (
        f"#work words={words} wps={wps:g} reasoning={reasoning} tools={tools} "
        f"toolsec={toolsec if live else 0:g} seed={seed}"
    )


# Turns


class Scheduler:
    """Which threads get a turn: at most `streams` replies at once, the thread that waited longest first, and
    after a reply a pause drawn from `pause` before that thread's next turn. Times are seconds on any one clock."""

    def __init__(self, streams: int, pause: dict, stuck_seconds: float, rng: random.Random) -> None:
        self.streams = streams
        self.pause = pause
        self.stuck_seconds = stuck_seconds
        self.rng = rng
        # Thread to the time its next turn may start, the longest idle first.
        self._idle: dict[str, float] = {}
        # Thread to the time its reply started.
        self._busy: dict[str, float] = {}

    def add(self, thread: str) -> None:
        self._idle[thread] = 0.0

    def drop(self, thread: str) -> None:
        """The thread gets no more turns."""
        self._idle.pop(thread, None)
        self._busy.pop(thread, None)

    def ready(self, now: float) -> list[str]:
        """The threads to start a turn in now; the caller reports each with `started`."""
        free = max(0, self.streams - len(self._busy))
        return [thread for thread, at in self._idle.items() if at <= now][:free]

    def started(self, thread: str, now: float) -> None:
        self._idle.pop(thread, None)
        self._busy[thread] = now

    def finished(self, thread: str, now: float) -> bool:
        """Frees the thread whose reply ended; False for a thread that had none under way."""
        if self._busy.pop(thread, None) is None:
            return False
        self._idle[thread] = now + sample(self.pause, self.rng)
        return True

    def streaming(self) -> int:
        return len(self._busy)

    def sweep_stuck(self, now: float) -> list[str]:
        """Frees and returns the threads whose reply started more than `stuck_seconds` ago."""
        stuck = [thread for thread, at in self._busy.items() if now - at > self.stuck_seconds]
        for thread in stuck:
            self.finished(thread, now)
        return stuck


# What a sync saw


def count_sync(batch: dict, room: str, agent_ids: set[str], reply_roots: dict[str, str]) -> dict:
    """The load one /sync answer shows in `room`: live frames, the agents' edits and jobs state writes, and the
    thread roots whose reply ended. `reply_roots` (reply event ID to its thread root) is filled here and kept by
    the caller across answers, since a reply's edits come in later answers than the reply."""
    joined = ((batch.get("rooms") or {}).get("join") or {}).get(room) or {}
    counts: dict = {"frames": 0, "edits": 0, "jobs": 0, "finished": []}
    for event in (joined.get("ephemeral") or {}).get("events") or []:
        if event.get("type") == LIVE_FRAME:
            counts["frames"] += 1
    events = [*((joined.get("state") or {}).get("events") or []), *((joined.get("timeline") or {}).get("events") or [])]
    for event in events:
        if event.get("sender") not in agent_ids:
            continue
        if event.get("type") == JOBS_STATE:
            counts["jobs"] += 1
        if event.get("type") != "m.room.message":
            continue
        content = event.get("content") or {}
        relation = content.get("m.relates_to") or {}
        if relation.get("rel_type") == "m.replace":
            counts["edits"] += 1
            root = reply_roots.get(relation.get("event_id", ""))
            status = (content.get("m.new_content") or {}).get(STREAM_STATUS)
        elif relation.get("rel_type") == "m.thread":
            root = reply_roots[event["event_id"]] = relation["event_id"]
            status = content.get(STREAM_STATUS)
        else:
            continue
        if root is not None and status in ENDED_STATUSES and root not in counts["finished"]:
            counts["finished"].append(root)
    return counts


def shortfall(windows: list[dict]) -> bool:
    """Whether a live run fell short: after its first 30 s, the last 30 s of windows held under 80 % of the
    target on average."""
    if not windows:
        return False
    counted = [window for window in windows if window["t"] - windows[0]["t"] >= SHORTFALL_GRACE_SECONDS]
    recent = [window for window in counted if windows[-1]["t"] - window["t"] < SHORTFALL_GRACE_SECONDS]
    target = sum(window["target"] for window in recent)
    return target > 0 and sum(window["streaming"] for window in recent) < SHORTFALL_SHARE * target


# The homeserver


class Lobby:
    """The stack's lobby as its tester: turns in, the agents' events out."""

    def __init__(self, stack: dict) -> None:
        self.homeserver: str = stack["homeserver"]
        self.token: str = stack["tester"]["accessToken"]
        self.room: str = stack["rooms"]["lobby"]
        members = call(
            self.homeserver, "GET", f"/_matrix/client/v3/rooms/{quote(self.room)}/joined_members", self.token
        )
        self.agents = {user for user in members["joined"] if user.startswith("@mindroom_")}
        if not self.agents:
            raise RuntimeError(f"no agent has joined {self.room}")
        sync_filter = {
            "room": {
                "rooms": [self.room],
                "ephemeral": {"types": [LIVE_FRAME]},
                "timeline": {"limit": 100},
            }
        }
        self._query = f"timeout=1000&filter={quote(json.dumps(sync_filter, separators=(',', ':')))}"
        self._since = ""
        self.reply_roots: dict[str, str] = {}

    def sync(self) -> dict:
        """What the next /sync answer shows (count_sync); zeros when the homeserver gave no usable answer."""
        since = f"&since={quote(self._since)}" if self._since else ""
        status, batch = http_json(
            "GET", f"{self.homeserver}/_matrix/client/v3/sync?{self._query}{since}", token=self.token, timeout=30
        )
        if not 200 <= status < 300 or "next_batch" not in batch:
            time.sleep(0.5)
            batch = {}
        elif self._since and ((batch.get("rooms") or {}).get("join") or {}).get(self.room, {}).get("timeline", {}).get(
            "limited"
        ):
            log("a /sync answer left events out (over 100 since the last one); a reply's end may go unseen")
        self._since = batch.get("next_batch", self._since)
        return count_sync(batch, self.room, self.agents, self.reply_roots)

    def post_turn(self, root: str | None, body: str) -> str:
        """Posts a person's turn: a new thread's root, or a reply in the thread of `root`. Its event ID."""
        content: dict = {"msgtype": "m.text", "body": body}
        if root is not None:
            content["m.relates_to"] = {
                "rel_type": "m.thread",
                "event_id": root,
                "is_falling_back": True,
                "m.in_reply_to": {"event_id": root},
            }
        return send(self.homeserver, self.token, self.room, content)


def log(text: str) -> None:
    print(f"driver: {text}", file=sys.stderr, flush=True)


def create_quiet_rooms(lobby: Lobby, rooms: int, messages: int) -> list[str]:
    """The account's other rooms: `rooms` rooms of the tester alone, with `messages` plain messages each."""

    def create(index: int) -> str:
        body = {"name": f"Quiet room {index + 1}", "preset": "private_chat"}
        room = call(lobby.homeserver, "POST", "/_matrix/client/v3/createRoom", lobby.token, body)["room_id"]
        for number in range(1, messages + 1):
            content = {"msgtype": "m.text", "body": f"Quiet room {index + 1}, message {number}"}
            send(lobby.homeserver, lobby.token, room, content)
        return room

    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(create, range(rooms)))


# The phases


def run_history(lobby: Lobby, profile: dict, streams: int, rng: random.Random, out: Path) -> int:
    quiet_rooms = create_quiet_rooms(lobby, profile["quietRooms"], profile["quietMessages"])
    log(f"{len(quiet_rooms)} quiet rooms")
    scheduler = Scheduler(streams, {"p50": 0, "p90": 0, "max": 0}, profile["live"]["stuckSeconds"], rng)
    # A thread is its number until its first turn gives it a root.
    turns_left = {str(index): max(1, round(sample(profile["turns"], rng))) for index in range(profile["threads"])}
    total = sum(turns_left.values())
    roots: dict[str, str] = {}
    thread_of_root: dict[str, str] = {}
    for thread in turns_left:
        scheduler.add(thread)
    lobby.sync()
    reported = time.monotonic()
    while turns_left:
        now = time.monotonic()
        for thread in scheduler.ready(now):
            root = lobby.post_turn(roots.get(thread), work_prompt(profile["reply"], rng, live=False))
            if thread not in roots:
                roots[thread] = root
                thread_of_root[root] = thread
            scheduler.started(thread, now)
        counts = lobby.sync()
        now = time.monotonic()
        for root in counts["finished"]:
            thread = thread_of_root.get(root, "")
            if not scheduler.finished(thread, now):
                continue
            turns_left[thread] -= 1
            if turns_left[thread] == 0:
                del turns_left[thread]
                scheduler.drop(thread)
        stuck = scheduler.sweep_stuck(now)
        if stuck:
            log(f"no reply ended within {scheduler.stuck_seconds} s in: {', '.join(roots[thread] for thread in stuck)}")
            return 1
        if now - reported >= WINDOW_SECONDS:
            reported = now
            log(f"history: {total - sum(turns_left.values())} of {total} turns, {scheduler.streaming()} under way")
    out.write_text(json.dumps({"room": lobby.room, "threads": list(roots.values()), "quietRooms": quiet_rooms}) + "\n")
    log(f"history: {len(roots)} threads with {total} turns")
    return 0


def run_live(
    lobby: Lobby,
    profile: dict,
    history: dict,
    streams: int,
    seconds: float | None,
    rng: random.Random,
    out: Path,
) -> int:
    if history["room"] != lobby.room:
        raise RuntimeError(f"the history is of {history['room']}, the stack's lobby is {lobby.room}")
    stopped = []
    for number in (signal.SIGTERM, signal.SIGINT):
        signal.signal(number, lambda *_: stopped.append(True))
    scheduler = Scheduler(streams, profile["live"]["pauseSeconds"], profile["live"]["stuckSeconds"], rng)
    for root in history["threads"]:
        scheduler.add(root)
    lobby.sync()
    windows: list[dict] = []
    window = {"frames": 0, "edits": 0, "jobs": 0, "stuck": 0}
    started = time.monotonic()
    window_end = started + WINDOW_SECONDS
    with out.open("a") as lines:
        while not stopped and (seconds is None or time.monotonic() - started < seconds):
            now = time.monotonic()
            for root in scheduler.ready(now):
                lobby.post_turn(root, work_prompt(profile["reply"], rng, live=True))
                scheduler.started(root, now)
            if now >= window_end:
                window_end += WINDOW_SECONDS
                line = {"t": round(time.time()), "target": streams, "streaming": scheduler.streaming(), **window}
                windows.append(line)
                lines.write(json.dumps(line) + "\n")
                lines.flush()
                window = {"frames": 0, "edits": 0, "jobs": 0, "stuck": 0}
                if shortfall(windows):
                    recent = [entry["streaming"] for entry in windows[-SHORTFALL_GRACE_SECONDS // WINDOW_SECONDS :]]
                    log(f"shortfall: the target is {streams} streams, the last windows held {recent}")
                    return 2
            counts = lobby.sync()
            now = time.monotonic()
            for root in counts["finished"]:
                scheduler.finished(root, now)
            for key in ("frames", "edits", "jobs"):
                window[key] += counts[key]
            window["stuck"] += len(scheduler.sweep_stuck(now))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--stack", type=Path, required=True, help="the stack's state JSON (stack.py up or status)")
    parser.add_argument("--profile", type=Path, required=True, help="a workload profile (e2e/perf/workloads)")
    parser.add_argument("--phase", choices=("history", "live"), required=True)
    parser.add_argument("--history", type=Path, help="live: the file the history phase wrote")
    parser.add_argument("--streams", type=int, help="replies at once (default: the profile's)")
    parser.add_argument("--seconds", type=float, help="live: stop after this long (default: on SIGTERM)")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.phase == "live" and args.history is None:
        parser.error("--phase live needs --history")
    profile = load_profile(args.profile)
    lobby = Lobby(json.loads(args.stack.read_text()))
    rng = random.Random(args.seed)
    if args.phase == "history":
        return run_history(lobby, profile, args.streams or profile["historyStreams"], rng, args.out)
    history = json.loads(args.history.read_text())
    return run_live(lobby, profile, history, args.streams or profile["live"]["streams"], args.seconds, rng, args.out)


if __name__ == "__main__":
    sys.exit(main())
