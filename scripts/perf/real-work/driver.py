#!/usr/bin/env python3
"""Keep a number of agent replies streaming in the lobby of an agent stack, shaped by a workload profile.

Usage: python3 scripts/perf/real-work/driver.py --stack <state.json> --profile <profile.json>
       --phase history|live [--history <file>] [--streams N] [--seconds S] [--ramp S] [--seed N] --out <file>

  --stack    the state that `python3 scripts/agent-stack/stack.py <slot> up` (or `status`) prints
  --profile  a workload profile, e2e/perf/workloads/<name>.json

A profile's `agents` (default 1) spreads the threads over the stack's stub agents: with more than one, thread i's
turns name worker{i % agents + 1} first, which the stub's router answers with, and the run exits 1 when the stack
state lacks one (start it with `stack.py <slot> up --agents N`). One agent gets 30 live frames a second per room
from the homeserver, about 3 streams' worth, so a load of more streams needs one agent per 3.

The stack's stub model answers each `#work` prompt this script posts as the stack's tester
(scripts/agent-stack/stub_model.py), so the real backend writes the events: live frames, edits, jobs state.

history  creates the profile's quiet rooms, then gives each of its threads its turns in the lobby, `historyStreams`
         (or --streams) replies at once, with the stub at full speed (`wps=0 toolsec=0`). A profile's
         `resolvedThreads` (default 0) of them get their turns first and are then marked resolved, as the person
         does to a thread that is done; Chat's Compact view leaves those out, and the live phase gives them no
         turn. A profile's `heavy` ({"threads": n, "turns": distribution}, default none) gives the first n open
         threads their turns from that distribution instead: the long threads a person keeps working in. At the
         first jobs state write of an agent the tester marks the room read (an unthreaded read receipt on that
         event, as "Mark as read" sends; a refused one is sent again), once: after the history that follows, a
         client no longer holds that event, as in a room the person marked read long ago, and Chat then looks for
         it in every thread. At the end the tester reads every open thread (a read receipt with the thread's ID on
         its newest reply, tried three times), as a person who keeps up. Writes --out as {"room": str, "threads":
         [root ID of an open thread...], "heavyThreads": [root ID...] (the first of `threads`), "resolvedThreads":
         [root ID...], "quietRooms": [room ID...]} and exits 0 once every thread has its turns; a reply that never
         ends, no turn posted or ended for the profile's `live.stuckSeconds`, or a thread the homeserver did not
         let the tester resolve fails the run with exit 1.
live     reads that file (--history) and keeps `live.streams` (or --streams) replies streaming in its threads at the
         profile's pace: a thread whose reply ended gets its next turn after a pause from `live.pauseSeconds`. With
         --ramp S the first of those threads (as many as the streams) get their first turn at a time drawn evenly
         from the first S seconds and the others none before that, so the replies are not all in the same part of
         their course afterwards; the shortfall check then starts 15 s after the ramp. Every
         5 s it appends one JSON line to --out, {"t": unix s, "target", "streaming", "frames", "edits", "jobs",
         "stuck"}: the streams asked for, the replies that were live (averaged over those 5 s, rounded), and the live
         frames, agent edits, jobs state writes and replies given up as stuck that its own /sync saw in them. A
         reply is live from the
         agent's reply event until its final edit, while the last 15 s brought a frame or an edit of it; a turn
         the backend has not answered yet is not. It runs for --seconds, or until SIGTERM or SIGINT, and exits 0;
         it stops with exit 2 when, after the first 30 s, the last 10 s held under 80 % of the target on average,
         so a backend that cannot keep up never passes as a light load. A post or /sync that fails is logged and
         tried again, so a homeserver or backend that stays away ends the run the same way.

A /sync answer whose lobby timeline left events out (Tuwunel gives at most 100 at a time) has them read back with
/messages, ahead of its own and each event counted once; a gap over 50 pages of 100 events, or a page that fails three
times, ends the run with exit 1.

A profile's distributions are {"p50": n, "p90": n, "max": n}; a draw is piecewise linear through 0, the median, the
90th percentile and the maximum. --seed (default 1) fixes the sequence of draws (the replies' shapes and the
pauses, in the order the run asks for them), not which thread gets which: that follows the order in which the
backend ends the replies. A profile's `reply.links` (a distribution, default none) is how many links a reply's
text holds (the stub's `links=` knob).
"""

from __future__ import annotations

import argparse
import json
import random
import signal
import sys
import time
from collections import deque
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from matrix_http import call, http_json, quote, send  # noqa: E402

WINDOW_SECONDS = 5
# The start of a live run is left out of the shortfall check, which then averages over the last windows.
SHORTFALL_RAMP_SECONDS = 30
SHORTFALL_AVERAGE_SECONDS = 10
SHORTFALL_SHARE = 0.8
# A reply stops counting as live this long after its last frame or edit: three of the snapshot frames the backend
# sends every 5 s.
LIVE_SECONDS = 15
# A reply whose stream status is one of these has ended.
ENDED_STATUSES = frozenset({"complete", "completed", "done", "error", "failed", "stopped", "cancelled", "interrupted"})
STREAM_STATUS = "io.mindroom.stream_status"
LIVE_FRAME = "io.mindroom.live"
JOBS_STATE = "io.mindroom.background_jobs"
THREAD_TAGS = "com.mindroom.thread.tags"
# The lobby events a limited /sync answer left out are read back with /messages, this many a page, over at most
# this many pages; an event the driver processed already, of the last SEEN_EVENTS, ends the read and counts once.
GAP_PAGE_EVENTS = 100
GAP_PAGES = 50
SEEN_EVENTS = 20_000
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
    # Old profiles have one agent, the router's pick.
    agents = profile.setdefault("agents", 1)
    if not isinstance(agents, int) or isinstance(agents, bool) or agents < 1:
        raise ValueError("the profile's agents must be an integer of 1 or more")
    # Old profiles resolve no thread.
    resolved = profile.setdefault("resolvedThreads", 0)
    if not isinstance(resolved, int) or isinstance(resolved, bool) or not 0 <= resolved < profile["threads"]:
        raise ValueError("the profile's resolvedThreads must be an integer from 0 to one under its threads")
    # Old profiles have no heavy thread and no link.
    heavy = profile.setdefault("heavy", {"threads": 0, "turns": profile["turns"]})
    count = heavy.get("threads") if isinstance(heavy, dict) else None
    if not isinstance(count, int) or isinstance(count, bool) or not 0 <= count <= profile["threads"] - resolved:
        raise ValueError("the profile's heavy.threads must be an integer from 0 to the number of its open threads")
    for name, dist in (("heavy.turns", heavy.get("turns")), ("reply.links", profile["reply"].get("links"))):
        if name == "reply.links" and dist is None:
            continue
        if not isinstance(dist, dict) or any(key not in dist for key in DIST_KEYS):
            raise ValueError(f"the profile's {name} must have {', '.join(DIST_KEYS)}")
    return profile


def worker_for(index: int, agents: int) -> str | None:
    """The stub agent that thread `index` is addressed to when the profile has several agents, else None."""
    return f"worker{index % agents + 1}" if agents > 1 else None


def check_workers(stack: dict, agents: int) -> None:
    """ValueError naming the first of worker1 .. worker{agents} that the stack state lacks (stack.py --agents)."""
    if agents > 1:
        for number in range(1, agents + 1):
            if f"worker{number}" not in (stack.get("agents") or {}):
                raise ValueError(f"the stack has no agent worker{number} (start it with stack.py --agents {agents})")


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


def work_prompt(reply: dict, rng: random.Random, live: bool, worker: str | None = None) -> str:
    """A `#work` prompt for the stub model with a reply drawn from the profile's `reply`. History replies come at
    full speed (`wps=0 toolsec=0`) and are otherwise the replies the same draws give a live run. A `worker` is
    named first in the prompt, where the stub's router finds it. `reply.links`, when the profile has it, is how many
    links the reply's text holds."""
    words = max(1, round(sample(reply["words"], rng)))
    reasoning = round(sample(reply["reasoning"], rng))
    tools = round(sample(reply["tools"], rng))
    toolsec = round(sample(reply["toolsec"], rng), 1)
    seed = rng.randrange(1, 1_000_000)
    wps = reply["wps"] if live else 0
    # A profile without `reply.links` draws nothing for them, so its prompts stay what they were.
    links = f"links={round(sample(reply['links'], rng))} " if "links" in reply else ""
    return (
        f"{worker + ' ' if worker else ''}#work words={words} wps={wps:g} reasoning={reasoning} tools={tools} "
        f"toolsec={toolsec if live else 0:g} {links}seed={seed}"
    )


# Turns


class Scheduler:
    """Which threads get a turn: at most `streams` turns under way at once, the thread that waited longest first,
    and after a reply a pause drawn from `pause` before that thread's next turn. A turn is under way from its post
    until a reply to it ends or it is given up as stuck; its replies are the agents' messages in the thread since
    the post. Times are seconds on any one clock."""

    def __init__(self, streams: int, pause: dict, stuck_seconds: float, rng: random.Random) -> None:
        self.streams = streams
        self.pause = pause
        self.stuck_seconds = stuck_seconds
        self.rng = rng
        # Thread to the time its next turn may start, the longest idle first.
        self._idle: dict[str, float] = {}
        # Thread to the time its turn was posted.
        self._busy: dict[str, float] = {}
        # Reply event ID to the thread whose turn under way it answers, and to the time of its last activity.
        self._thread_of_reply: dict[str, str] = {}
        self._active_at: dict[str, float] = {}

    def add(self, thread: str, at: float = 0.0) -> None:
        """The thread may get its first turn from `at` on."""
        self._idle[thread] = at

    def drop(self, thread: str) -> None:
        """The thread gets no more turns."""
        self._idle.pop(thread, None)
        self._end_turn(thread)

    def ready(self, now: float) -> list[str]:
        """The threads to start a turn in now; the caller reports each with `started`."""
        free = max(0, self.streams - len(self._busy))
        return [thread for thread, at in self._idle.items() if at <= now][:free]

    def started(self, thread: str, now: float) -> None:
        self._idle.pop(thread, None)
        self._busy[thread] = now

    def reply_started(self, thread: str, reply: str, now: float) -> None:
        """An agent's message `reply` came in the thread; it answers the thread's turn under way, if any."""
        if thread in self._busy:
            self._thread_of_reply[reply] = thread
            self._active_at[reply] = now

    def reply_active(self, reply: str, now: float) -> None:
        """A live frame or an edit of `reply` came."""
        if reply in self._active_at:
            self._active_at[reply] = now

    def reply_finished(self, reply: str, now: float) -> str | None:
        """`reply` ended: frees and returns the thread whose turn under way it answers. None for any other reply,
        such as one of a turn given up as stuck, which must not end the thread's next turn."""
        thread = self._thread_of_reply.get(reply)
        return thread if thread is not None and self.finished(thread, now) else None

    def finished(self, thread: str, now: float) -> bool:
        """Frees the thread, whose turn is over; False for a thread that had none under way."""
        if not self._end_turn(thread):
            return False
        self._idle[thread] = now + sample(self.pause, self.rng)
        return True

    def _end_turn(self, thread: str) -> bool:
        if self._busy.pop(thread, None) is None:
            return False
        for reply in [reply for reply, owner in self._thread_of_reply.items() if owner == thread]:
            del self._thread_of_reply[reply]
            del self._active_at[reply]
        return True

    def posted(self) -> int:
        """The turns under way, answered or not."""
        return len(self._busy)

    def streaming(self, now: float) -> int:
        """The turns under way with a live reply: one with a frame, an edit or its first event in the last 15 s."""
        live = {self._thread_of_reply[reply] for reply, at in self._active_at.items() if now - at <= LIVE_SECONDS}
        return len(live)

    def sweep_stuck(self, now: float) -> list[str]:
        """Frees and returns the threads whose turn was posted more than `stuck_seconds` ago."""
        stuck = [thread for thread, at in self._busy.items() if now - at > self.stuck_seconds]
        for thread in stuck:
            self.finished(thread, now)
        return stuck


# What a sync saw


def joined_room(batch: dict, room: str) -> dict:
    """The part of a /sync answer about a joined room; {} when it has none."""
    return ((batch.get("rooms") or {}).get("join") or {}).get(room) or {}


def count_sync(batch: dict, room: str, agent_ids: set[str], reply_roots: dict[str, str]) -> dict:
    """The load one /sync answer shows in `room`: the numbers of live frames and of the agents' edits and jobs
    state writes, and by event ID the agents' thread replies that `started` (their first event), were `active` (that
    event, a frame or an edit) and `finished` (a final stream status). `reply_roots` (reply event ID to its thread
    root) is filled here and kept by the caller across answers, since a reply's edits come in later answers than
    the reply."""
    joined = joined_room(batch, room)
    counts: dict = {"frames": 0, "edits": 0, "jobs": 0, "started": [], "active": [], "finished": []}

    def note(key: str, reply: object) -> None:
        if isinstance(reply, str) and reply not in counts[key]:
            counts[key].append(reply)

    for event in (joined.get("ephemeral") or {}).get("events") or []:
        if event.get("type") == LIVE_FRAME:
            counts["frames"] += 1
            note("active", (event.get("content") or {}).get("reply"))
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
        target = relation.get("event_id")
        if relation.get("rel_type") == "m.replace":
            counts["edits"] += 1
            reply = target
            status = (content.get("m.new_content") or {}).get(STREAM_STATUS)
        elif relation.get("rel_type") == "m.thread" and isinstance(target, str) and "event_id" in event:
            reply = event["event_id"]
            reply_roots[reply] = target
            note("started", reply)
            status = content.get(STREAM_STATUS)
        else:
            continue
        note("active", reply)
        if status in ENDED_STATUSES:
            note("finished", reply)
    return counts


def jobs_state_event(batch: dict, room: str, agent_ids: set[str]) -> str | None:
    """The ID of the first jobs state write of an agent that a /sync answer shows in `room`; None without one."""
    joined = joined_room(batch, room)
    events = [*((joined.get("state") or {}).get("events") or []), *((joined.get("timeline") or {}).get("events") or [])]
    for event in events:
        event_id = event.get("event_id")
        if event.get("type") == JOBS_STATE and event.get("sender") in agent_ids and isinstance(event_id, str):
            return event_id
    return None


def apply_counts(
    scheduler: Scheduler,
    counts: dict,
    reply_roots: dict[str, str],
    now: float,
    thread_of_root: dict[str, str] | None = None,
) -> list[str]:
    """Tells the scheduler what a /sync answer showed (count_sync); the threads whose turn ended with it. The
    scheduler knows a thread by its root, or by what `thread_of_root` names it."""
    for reply in counts["started"]:
        root = reply_roots[reply]
        thread = root if thread_of_root is None else thread_of_root.get(root)
        if thread is not None:
            scheduler.reply_started(thread, reply, now)
    for reply in counts["active"]:
        scheduler.reply_active(reply, now)
    ended = (scheduler.reply_finished(reply, now) for reply in counts["finished"])
    return [thread for thread in ended if thread is not None]


def shortfall(windows: list[dict], ramp: float = 0.0) -> bool:
    """Whether a live run fell short: the windows of its last 10 s, all after its first 30 s (or 15 s after a
    longer `ramp`, in which the streams start one by one), held under 80 % of the target on average. One window
    never decides."""
    if not windows:
        return False
    first, last = windows[0]["t"], windows[-1]["t"]
    recent = [window for window in windows if last - window["t"] < SHORTFALL_AVERAGE_SECONDS]
    if len(recent) < 2 or recent[0]["t"] - first < max(SHORTFALL_RAMP_SECONDS, ramp + LIVE_SECONDS):
        return False
    return achieved_share(recent) < SHORTFALL_SHARE


def achieved_share(windows: list[dict]) -> float:
    """The mean of streaming over target in the windows."""
    return sum(window["streaming"] / window["target"] for window in windows) / len(windows)


# The homeserver


class Lobby:
    """The stack's lobby as its tester: turns in, the agents' events out."""

    def __init__(self, stack: dict) -> None:
        self.homeserver: str = stack["homeserver"]
        self.token: str = stack["tester"]["accessToken"]
        self.user: str = stack["tester"]["userId"]
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
                # Tuwunel gives at most 100 however many are asked for; sync reads back what a limited answer
                # left out.
                "timeline": {"limit": 100},
            }
        }
        self._query = f"timeout=1000&filter={quote(json.dumps(sync_filter, separators=(',', ':')))}"
        self._since = ""
        self.reply_roots: dict[str, str] = {}
        # The first jobs state write of an agent that a sync showed.
        self.jobs_event: str | None = None
        # Thread root to the newest reply of an agent in it that a sync showed.
        self.latest_reply: dict[str, str] = {}
        # The IDs of the last SEEN_EVENTS lobby events processed, and the same in the order they came.
        self._seen: set[str] = set()
        self._seen_order: deque[str] = deque()

    def sync(self) -> dict:
        """What the next /sync answer shows (count_sync); zeros when the homeserver gave no usable answer. When its
        timeline is limited (after the first answer), the events it left out count too, ahead of its own, and an
        event that came before counts once."""
        since = f"&since={quote(self._since)}" if self._since else ""
        url = f"{self.homeserver}/_matrix/client/v3/sync?{self._query}{since}"
        try:
            status, batch = http_json("GET", url, token=self.token, timeout=30)
        except ValueError:  # an answer that is not JSON
            status, batch = 0, {}
        if not 200 <= status < 300 or not isinstance(batch, dict) or "next_batch" not in batch:
            log(f"skipped a /sync answer (status {status})")
            time.sleep(0.5)
            batch = {}
        else:
            # A reply's start or end it left out would hold its turn until stuckSeconds.
            batch = self._unseen(batch, self._gap(batch) if self._since else [])
        self._since = batch.get("next_batch", self._since)
        if self.jobs_event is None:
            self.jobs_event = jobs_state_event(batch, self.room, self.agents)
        counts = count_sync(batch, self.room, self.agents, self.reply_roots)
        for reply in counts["started"]:
            self.latest_reply[self.reply_roots[reply]] = reply
        return counts

    def _gap(self, batch: dict) -> list[dict]:
        """The lobby events a limited timeline of `batch` left out, oldest first: read back from its start with
        /messages, up to the first event processed before or the room's beginning. Exits when that takes more than
        GAP_PAGES pages or a page cannot be read."""
        timeline = joined_room(batch, self.room).get("timeline") or {}
        if not timeline.get("limited"):
            return []
        token = timeline.get("prev_batch")
        if not isinstance(token, str):
            raise SystemExit(
                f"driver: a /sync answer left events of {self.room} out without a prev_batch to read them back from; "
                f"stopping, as its observations of the replies would be incomplete"
            )
        missed: list[dict] = []
        for _ in range(GAP_PAGES):
            page = self._messages(token)
            chunk = page.get("chunk") or []
            for event in chunk:
                if event.get("event_id") in self._seen:
                    return missed[::-1]
                missed.append(event)
            token = page.get("end")
            # The room's first event: no page, or no token for the one before.
            if not chunk or not isinstance(token, str):
                return missed[::-1]
        raise SystemExit(
            f"driver: the events a /sync answer left out of {self.room} take more than {GAP_PAGES} pages of "
            f"/messages; stopping, as its observations of the replies would be incomplete"
        )

    def _messages(self, token: str) -> dict:
        """One page of the lobby's events before `token`, newest first; tried three times, then the run exits."""
        path = f"/_matrix/client/v3/rooms/{quote(self.room)}/messages?dir=b&from={quote(token)}&limit={GAP_PAGE_EVENTS}"
        for attempt in range(1, 4):
            try:
                status, page = http_json("GET", self.homeserver + path, token=self.token, timeout=30)
            except ValueError:  # an answer that is not JSON
                status, page = 0, {}
            if 200 <= status < 300 and isinstance(page, dict):
                return page
            log(f"/messages of {self.room} failed (status {status}, try {attempt} of 3)")
            time.sleep(0.5)
        raise SystemExit(
            f"driver: /messages of {self.room} failed three times; stopping, as the events a /sync answer left out "
            f"cannot be read back"
        )

    def _unseen(self, batch: dict, gap: list[dict]) -> dict:
        """`batch` with the `gap` events ahead of its timeline's, less the lobby events processed before; records
        the rest as processed."""
        joined = joined_room(batch, self.room)
        if not joined:
            return batch

        def fresh(events: list[dict]) -> list[dict]:
            kept = []
            for event in events:
                event_id = event.get("event_id")
                if isinstance(event_id, str):
                    if event_id in self._seen:
                        continue
                    self._seen.add(event_id)
                    self._seen_order.append(event_id)
                    if len(self._seen_order) > SEEN_EVENTS:
                        self._seen.discard(self._seen_order.popleft())
                kept.append(event)
            return kept

        timeline = joined.get("timeline") or {}
        room = {
            **joined,
            "state": {"events": fresh((joined.get("state") or {}).get("events") or [])},
            "timeline": {**timeline, "events": fresh([*gap, *(timeline.get("events") or [])])},
        }
        return {**batch, "rooms": {**batch["rooms"], "join": {**batch["rooms"]["join"], self.room: room}}}

    def post_turn(self, root: str | None, body: str) -> str | None:
        """Posts a person's turn: a new thread's root, or a reply in the thread of `root`. Its event ID, or None
        when the post failed, which the caller tries again."""
        content: dict = {"msgtype": "m.text", "body": body}
        if root is not None:
            content["m.relates_to"] = {
                "rel_type": "m.thread",
                "event_id": root,
                "is_falling_back": True,
                "m.in_reply_to": {"event_id": root},
            }
        try:
            return send(self.homeserver, self.token, self.room, content)
        except (RuntimeError, ValueError, KeyError) as error:
            log(f"a turn was not posted: {error}")
            return None


    def mark_read(self, event_id: str, thread: str | None = None) -> bool:
        """A read receipt of the tester on `event_id`. Without `thread` it is unthreaded and reads the room and its
        threads up to there, as "Mark as read" does in Chat; with a thread's root it reads that thread, as opening
        it does. False when the homeserver refused it, which the caller tries again."""
        path = f"/_matrix/client/v3/rooms/{quote(self.room)}/receipt/m.read/{quote(event_id)}"
        try:
            call(self.homeserver, "POST", path, self.token, {} if thread is None else {"thread_id": thread})
        except (RuntimeError, ValueError) as error:
            log(f"a read receipt was not sent: {error}")
            return False
        return True

    def resolve(self, root: str) -> bool:
        """Marks the thread of `root` resolved, as the person does in Chat: the room state `com.mindroom.thread.tags`
        with the state key ["<root>","resolved"]. False when the homeserver refused it."""
        key = json.dumps([root, "resolved"], separators=(",", ":"))
        content = {"set_by": self.user, "set_at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())}
        path = f"/_matrix/client/v3/rooms/{quote(self.room)}/state/{THREAD_TAGS}/{quote(key)}"
        try:
            call(self.homeserver, "PUT", path, self.token, content)
        except (RuntimeError, ValueError) as error:
            log(f"a thread was not resolved: {error}")
            return False
        return True


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


def read_open_threads(lobby: Lobby, roots: list[str]) -> int:
    """The person keeps up with the open threads: a read receipt in each on its newest reply, tried up to three
    times. How many threads got none (a thread no agent replied in has nothing to read)."""
    unread = 0
    for root in roots:
        reply = lobby.latest_reply.get(root)
        if reply is None or not any(lobby.mark_read(reply, root) for _ in range(3)):
            unread += 1
    return unread


def run_history(lobby: Lobby, profile: dict, streams: int, rng: random.Random, out: Path) -> int:
    quiet_rooms = create_quiet_rooms(lobby, profile["quietRooms"], profile["quietMessages"])
    log(f"{len(quiet_rooms)} quiet rooms")
    scheduler = Scheduler(streams, {"p50": 0, "p90": 0, "max": 0}, profile["live"]["stuckSeconds"], rng)
    # A thread is its number until its first turn gives it a root. The first `heavy.threads` have the heavy turns.
    heavy_threads = profile["heavy"]["threads"]
    turns_left = {
        str(index): max(1, round(sample(profile["heavy"]["turns"] if index < heavy_threads else profile["turns"], rng)))
        for index in range(profile["threads"])
    }
    total = sum(turns_left.values())
    roots: dict[str, str] = {}
    thread_of_root: dict[str, str] = {}
    # The threads numbered from `open_threads` on are resolved once they have their turns. They get their turns
    # before the other open threads, so the open threads are the room's newest, and keep the numbers (and so the
    # workers) the live phase gives the threads it reads. The heavy threads start first: their many turns, one
    # after the other, then end with the rest and not long after it.
    open_threads = profile["threads"] - profile["resolvedThreads"]

    def order(name: str) -> tuple[int, int]:
        number = int(name)
        return (0 if number < heavy_threads else 1 if number >= open_threads else 2, number)

    for thread in sorted(turns_left, key=order):
        scheduler.add(thread)
    lobby.sync()
    marked_read = False
    reported = progressed = time.monotonic()
    while turns_left:
        now = time.monotonic()
        for thread in scheduler.ready(now):
            event_id = lobby.post_turn(
                roots.get(thread),
                work_prompt(profile["reply"], rng, live=False, worker=worker_for(int(thread), profile.get("agents", 1))),
            )
            if event_id is None:
                break
            if thread not in roots:
                roots[thread] = event_id
                thread_of_root[event_id] = thread
            scheduler.started(thread, now)
            progressed = now
        counts = lobby.sync()
        now = time.monotonic()
        if not marked_read and lobby.jobs_event is not None:
            # The person marked the room read once, early: the history that follows pushes the receipt's event out
            # of what a client loads, as in a room marked read long ago. A refused receipt is tried again.
            marked_read = lobby.mark_read(lobby.jobs_event)
        for thread in apply_counts(scheduler, counts, lobby.reply_roots, now, thread_of_root):
            progressed = now
            turns_left[thread] -= 1
            if turns_left[thread] == 0:
                del turns_left[thread]
                scheduler.drop(thread)
                if int(thread) >= open_threads and not lobby.resolve(roots[thread]):
                    return 1
        stuck = scheduler.sweep_stuck(now)
        if stuck:
            log(f"no reply ended within {scheduler.stuck_seconds} s in: {', '.join(roots[thread] for thread in stuck)}")
            return 1
        if now - progressed > scheduler.stuck_seconds:
            log(f"no turn was posted or ended for {scheduler.stuck_seconds} s")
            return 1
        if now - reported >= WINDOW_SECONDS:
            reported = now
            log(f"history: {total - sum(turns_left.values())} of {total} turns, {scheduler.posted()} under way")
    numbered = [roots[thread] for thread in sorted(roots, key=int)]
    history = {
        "room": lobby.room,
        "threads": numbered[:open_threads],
        "heavyThreads": numbered[:heavy_threads],
        "resolvedThreads": numbered[open_threads:],
        "quietRooms": quiet_rooms,
    }
    unread = read_open_threads(lobby, history["threads"])
    if unread:
        log(f"history: {unread} open threads got no read receipt")
    out.write_text(json.dumps(history) + "\n")
    log(f"history: {len(roots)} threads with {total} turns, {len(history['resolvedThreads'])} of them resolved")
    if not marked_read:
        log("history: no agent wrote jobs state, so the tester has no read receipt in the room")
    return 0


def run_live(
    lobby: Lobby,
    profile: dict,
    history: dict,
    streams: int,
    seconds: float | None,
    rng: random.Random,
    out: Path,
    stopped: Callable[[], bool] = lambda: False,
    clock: Callable[[], float] = time.monotonic,
    ramp: float = 0.0,
) -> int:
    """The live phase: 0 once `seconds` passed or `stopped` says so, 2 on a shortfall. The first `streams` threads
    get their first turn at a time drawn evenly from the first `ramp` seconds, and the others none before its end,
    so the replies under way are not all at the same point of their course when the ramp is over."""
    if history["room"] != lobby.room:
        raise RuntimeError(f"the history is of {history['room']}, the stack's lobby is {lobby.room}")
    scheduler = Scheduler(streams, profile["live"]["pauseSeconds"], profile["live"]["stuckSeconds"], rng)
    # The history lists the threads by number, so thread i keeps the worker it had there.
    worker_of = {root: worker_for(index, profile.get("agents", 1)) for index, root in enumerate(history["threads"])}
    lobby.sync()
    windows: list[dict] = []
    window = {"frames": 0, "edits": 0, "jobs": 0, "stuck": 0}
    started = ticked = window_started = clock()
    # Draws of their own, so the turns' draws are the same with and without a ramp.
    stagger = random.Random(rng.random()) if ramp > 0 else None
    for index, root in enumerate(history["threads"]):
        first = 0.0 if stagger is None else stagger.uniform(0, ramp) if index < streams else ramp
        scheduler.add(root, started + first)
    unix_offset = time.time() - started
    window_end = started + WINDOW_SECONDS
    # Live replies times the seconds they were live for, in this window.
    live_seconds = 0.0
    with out.open("a") as lines:
        while not stopped() and (seconds is None or clock() - started < seconds):
            now = clock()
            live_seconds += scheduler.streaming(now) * (now - ticked)
            ticked = now
            for root in scheduler.ready(now):
                if lobby.post_turn(root, work_prompt(profile["reply"], rng, live=True, worker=worker_of.get(root))) is None:
                    break
                scheduler.started(root, now)
            if now >= window_end:
                live = round(live_seconds / (now - window_started))
                # The time the window was due, so lines are 5 s apart however long the last /sync took.
                line = {"t": round(unix_offset + window_end), "target": streams, "streaming": live, **window}
                window_end += WINDOW_SECONDS
                window_started, live_seconds = now, 0.0
                windows.append(line)
                lines.write(json.dumps(line) + "\n")
                lines.flush()
                window = {"frames": 0, "edits": 0, "jobs": 0, "stuck": 0}
                if shortfall(windows, ramp):
                    recent = windows[-SHORTFALL_AVERAGE_SECONDS // WINDOW_SECONDS :]
                    held = ", ".join(str(entry["streaming"]) for entry in recent)
                    log(
                        f"shortfall: the target is {streams} streams, the last {SHORTFALL_AVERAGE_SECONDS} s held "
                        f"{held} ({achieved_share(recent):.0%} of it, under {SHORTFALL_SHARE:.0%})"
                    )
                    return 2
            counts = lobby.sync()
            now = clock()
            apply_counts(scheduler, counts, lobby.reply_roots, now)
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
    parser.add_argument("--ramp", type=float, default=0, help="live: spread the first turns over this many seconds")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.phase == "live" and args.history is None:
        parser.error("--phase live needs --history")
    profile = load_profile(args.profile)
    stack = json.loads(args.stack.read_text())
    try:
        check_workers(stack, profile["agents"])
    except ValueError as error:
        log(str(error))
        return 1
    lobby = Lobby(stack)
    rng = random.Random(args.seed)
    if args.phase == "history":
        return run_history(lobby, profile, args.streams or profile["historyStreams"], rng, args.out)
    history = json.loads(args.history.read_text())
    signals: list[int] = []
    for number in (signal.SIGTERM, signal.SIGINT):
        signal.signal(number, lambda received, _frame: signals.append(received))
    streams = args.streams or profile["live"]["streams"]
    return run_live(
        lobby, profile, history, streams, args.seconds, rng, args.out, stopped=lambda: bool(signals), ramp=args.ramp
    )


if __name__ == "__main__":
    sys.exit(main())
