"""Tests of scripts/perf/real-work/driver.py that need no homeserver, and of the workload profiles it reads."""

from __future__ import annotations

import contextlib
import io
import json
import random
import re
import statistics
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import driver  # noqa: E402

WORKLOADS = Path(__file__).resolve().parents[3] / "e2e" / "perf" / "workloads"
NO_PAUSE = {"p50": 0, "p90": 0, "max": 0}
REPLY = {
    "words": {"p50": 150, "p90": 800, "max": 2800},
    "wps": 30,
    "reasoning": {"p50": 600, "p90": 3000, "max": 8000},
    "tools": {"p50": 2, "p90": 7, "max": 11},
    "toolsec": {"p50": 10, "p90": 60, "max": 120},
}
AGENT = "@mindroom_helper_x:matrix.localhost"
ROOM = "!lobby:matrix.localhost"


def message(event_id: str, sender: str, content: dict) -> dict:
    return {"type": "m.room.message", "event_id": event_id, "sender": sender, "content": content}


def reply_event(event_id: str, root: str) -> dict:
    relation = {"rel_type": "m.thread", "event_id": root}
    return message(event_id, AGENT, {"msgtype": "m.text", "body": "Thinking...", "m.relates_to": relation})


def edit_event(event_id: str, target: str, status: str) -> dict:
    return message(
        event_id,
        AGENT,
        {
            "msgtype": "m.text",
            "body": "* text",
            "m.new_content": {"msgtype": "m.text", "body": "text", "io.mindroom.stream_status": status},
            "m.relates_to": {"rel_type": "m.replace", "event_id": target},
        },
    )


def batch(timeline: list[dict], ephemeral: list[dict] | None = None) -> dict:
    room = {"timeline": {"events": timeline}, "ephemeral": {"events": ephemeral or []}}
    return {"next_batch": "s1", "rooms": {"join": {ROOM: room}}}


class SampleTest(unittest.TestCase):
    def test_sample_stays_in_range(self) -> None:
        rng = random.Random(7)
        draws = [driver.sample({"p50": 4, "p90": 9, "max": 19}, rng) for _ in range(1000)]
        self.assertTrue(all(0 <= draw <= 19 for draw in draws))
        self.assertTrue(3 <= statistics.median(draws) <= 5)
        self.assertGreater(max(draws), 9)

    def test_sample_of_a_constant(self) -> None:
        self.assertEqual(driver.sample(NO_PAUSE, random.Random(1)), 0)


class PromptTest(unittest.TestCase):
    def test_prompt_history_is_instant(self) -> None:
        prompt = driver.work_prompt(REPLY, random.Random(1), live=False)
        self.assertTrue(prompt.startswith("#work "))
        self.assertIn(" wps=0 ", prompt)
        self.assertIn(" toolsec=0 ", prompt)
        self.assertEqual(prompt, driver.work_prompt(REPLY, random.Random(1), live=False))
        self.assertNotEqual(prompt, driver.work_prompt(REPLY, random.Random(2), live=False))

    def test_prompt_with_links(self) -> None:
        reply = REPLY | {"links": {"p50": 3, "p90": 3, "max": 3}}
        prompt = driver.work_prompt(reply, random.Random(1), live=True)
        self.assertRegex(prompt, r" toolsec=\d+(\.\d+)? links=3 seed=\d+$")
        # The other draws are those of the profile without links.
        plain = driver.work_prompt(REPLY, random.Random(1), live=True)
        self.assertEqual(prompt.split(" links=")[0], plain.split(" seed=")[0])

    def test_prompt_with_tool_output_and_background_jobs(self) -> None:
        jobs = {"bg": {"p50": 2, "p90": 2, "max": 2}, "bgsec": {"p50": 300, "p90": 300, "max": 300}}
        reply = REPLY | {"toolout": 700} | jobs
        live = driver.work_prompt(reply, random.Random(1), live=True)
        self.assertRegex(live, r" toolsec=\d+(\.\d+)? toolout=700 bg=2 bgsec=\d+ seed=\d+$")
        # History replies print as much but start no job, and draw the same.
        history = driver.work_prompt(reply, random.Random(1), live=False)
        self.assertRegex(history, r" toolsec=0 toolout=700 seed=\d+$")
        self.assertEqual(live.split(" seed=")[1], history.split(" seed=")[1])
        # The other draws are those of the profile without them.
        plain = driver.work_prompt(REPLY, random.Random(1), live=True)
        self.assertEqual(live.split(" toolout=")[0], plain.split(" seed=")[0])
        jobs_prompt = driver.jobs_prompt(reply, random.Random(1))
        self.assertRegex(jobs_prompt, r"^#work words=12 wps=0 tools=0 bg=1 bgsec=\d+ seed=")

    def test_prompt_live_keeps_the_pace(self) -> None:
        prompt = driver.work_prompt(REPLY, random.Random(1), live=True)
        self.assertIn(" wps=30 ", prompt)
        self.assertRegex(prompt, r"^#work words=\d+ wps=30 reasoning=\d+ tools=\d+ toolsec=\d+(\.\d+)? seed=\d+$")
        self.assertNotIn("scout", prompt)


class AgentPromptTest(unittest.TestCase):
    def test_threads_go_round_the_workers(self) -> None:
        workers = [driver.worker_for(index, 3) for index in range(5)]
        self.assertEqual(workers, ["worker1", "worker2", "worker3", "worker1", "worker2"])
        self.assertIsNone(driver.worker_for(4, 1))

    def test_prompt_names_the_worker(self) -> None:
        worker = driver.worker_for(4, 3)
        prompt = driver.work_prompt(REPLY, random.Random(1), live=True, worker=worker)
        self.assertIn("worker2", prompt)
        self.assertIn("#work words=", prompt)
        self.assertNotIn("worker", driver.work_prompt(REPLY, random.Random(1), live=True))

    def test_stack_without_a_worker_is_refused(self) -> None:
        stack = {"agents": {"router": "@a:x", "worker1": "@b:x", "worker2": "@c:x"}}
        driver.check_workers(stack, 2)
        driver.check_workers(stack, 1)
        with self.assertRaisesRegex(ValueError, "worker3"):
            driver.check_workers(stack, 3)

    def test_old_profiles_have_one_agent(self) -> None:
        profile = json.loads((WORKLOADS / "real-work-smoke.json").read_text())
        profile.pop("agents", None)
        self.assertEqual(driver.check_profile(profile)["agents"], 1)
        profile["agents"] = 0
        with self.assertRaisesRegex(ValueError, "agents"):
            driver.check_profile(profile)


class SchedulerTest(unittest.TestCase):
    def scheduler(self, streams: int, threads: int, stuck_seconds: float = 600) -> driver.Scheduler:
        scheduler = driver.Scheduler(streams, NO_PAUSE, stuck_seconds, random.Random(1))
        for index in range(threads):
            scheduler.add(f"$r{index}")
        return scheduler

    def test_scheduler_keeps_target(self) -> None:
        scheduler = self.scheduler(3, 5)
        first = scheduler.ready(0)
        self.assertEqual(len(first), 3)
        for root in first:
            scheduler.started(root, 0)
            scheduler.reply_started(root, f"reply to {root}", 0)
        self.assertEqual(scheduler.streaming(0), 3)
        self.assertEqual(scheduler.ready(0), [])
        self.assertEqual(scheduler.reply_finished(f"reply to {first[0]}", 1), first[0])
        self.assertEqual(scheduler.streaming(1), 2)
        more = scheduler.ready(1)
        self.assertEqual(len(more), 1)
        self.assertNotIn(more[0], first[1:])
        scheduler.started(more[0], 1)
        scheduler.reply_started(more[0], "next reply", 1)
        self.assertEqual(scheduler.streaming(1), 3)

    def test_unanswered_turn_is_not_streaming(self) -> None:
        scheduler = self.scheduler(2, 2)
        for root in scheduler.ready(0):
            scheduler.started(root, 0)
        self.assertEqual(scheduler.posted(), 2)
        self.assertEqual(scheduler.streaming(0), 0)
        self.assertEqual(scheduler.ready(0), [])  # the turns still hold their places
        scheduler.reply_started("$r0", "$reply", 3)
        self.assertEqual(scheduler.streaming(3), 1)

    def test_silent_reply_stops_streaming_after_15_seconds(self) -> None:
        scheduler = self.scheduler(1, 1)
        scheduler.started("$r0", 0)
        scheduler.reply_started("$r0", "$reply", 0)
        self.assertEqual(scheduler.streaming(15), 1)
        self.assertEqual(scheduler.streaming(15.5), 0)
        scheduler.reply_active("$reply", 16)  # a frame or an edit
        self.assertEqual(scheduler.streaming(31), 1)
        self.assertEqual(scheduler.streaming(31.5), 0)
        self.assertEqual(scheduler.posted(), 1)

    def test_reply_outside_a_turn_does_not_count(self) -> None:
        scheduler = self.scheduler(1, 1)
        scheduler.reply_started("$r0", "$old", 0)  # no turn under way
        scheduler.reply_active("$unknown", 0)
        self.assertEqual(scheduler.streaming(0), 0)
        self.assertIsNone(scheduler.reply_finished("$old", 0))

    def test_idle_threads_go_first(self) -> None:
        scheduler = self.scheduler(1, 2)
        (first,) = scheduler.ready(0)
        scheduler.started(first, 0)
        scheduler.finished(first, 1)
        self.assertNotEqual(scheduler.ready(1), [first])

    def test_pause_holds_a_thread_back(self) -> None:
        rng = random.Random(1)
        rng.random = lambda: 0.5  # type: ignore[method-assign]  # the median: a pause of 10
        scheduler = driver.Scheduler(1, {"p50": 10, "p90": 20, "max": 30}, 600, rng)
        scheduler.add("$a")
        scheduler.started("$a", 0)
        scheduler.finished("$a", 5)
        self.assertEqual(scheduler.ready(14), [])
        self.assertEqual(scheduler.ready(15), ["$a"])

    def test_stuck_reply_frees_thread(self) -> None:
        scheduler = self.scheduler(1, 1)
        scheduler.started("$r0", 0)
        scheduler.reply_started("$r0", "$reply", 0)
        scheduler.reply_active("$reply", 600)
        self.assertEqual(scheduler.sweep_stuck(600), [])
        self.assertEqual(scheduler.sweep_stuck(601), ["$r0"])
        self.assertEqual(scheduler.streaming(601), 0)
        self.assertEqual(scheduler.posted(), 0)
        self.assertEqual(scheduler.sweep_stuck(602), [])
        self.assertEqual(scheduler.ready(602), ["$r0"])

    def test_late_end_of_a_swept_reply_keeps_the_next_turn(self) -> None:
        scheduler = self.scheduler(1, 1)
        scheduler.started("$r0", 0)
        scheduler.reply_started("$r0", "$first", 1)
        scheduler.sweep_stuck(601)
        scheduler.started("$r0", 602)
        scheduler.reply_started("$r0", "$second", 603)
        scheduler.reply_active("$first", 604)
        self.assertIsNone(scheduler.reply_finished("$first", 604))
        self.assertEqual(scheduler.posted(), 1)
        self.assertEqual(scheduler.streaming(604), 1)
        self.assertEqual(scheduler.reply_finished("$second", 605), "$r0")
        self.assertEqual(scheduler.posted(), 0)

    def test_dropped_thread_gets_no_turn(self) -> None:
        scheduler = self.scheduler(2, 2)
        scheduler.drop("$r0")
        self.assertEqual(scheduler.ready(0), ["$r1"])

    def test_late_finish_of_an_idle_thread_is_ignored(self) -> None:
        scheduler = self.scheduler(1, 1)
        self.assertFalse(scheduler.finished("$r0", 0))
        self.assertFalse(scheduler.finished("$unknown", 0))
        self.assertEqual(scheduler.posted(), 0)


def counts(**values: object) -> dict:
    return {"frames": 0, "edits": 0, "jobs": 0, "started": [], "active": [], "finished": [], **values}


def frame(reply: str) -> dict:
    return {"type": "io.mindroom.live", "content": {"v": 1, "reply": reply, "sid": "s", "seq": 1}}


class CountSyncTest(unittest.TestCase):
    def test_count_sync(self) -> None:
        jobs = {
            "type": "io.mindroom.background_jobs",
            "event_id": "$j",
            "sender": AGENT,
            "state_key": AGENT,
            "content": {"jobs": []},
        }
        reply_roots: dict[str, str] = {}
        seen = driver.count_sync(
            batch(
                [reply_event("$reply", "$r"), jobs, edit_event("$e", "$reply", "completed")],
                [{"type": "m.typing", "content": {"user_ids": []}}, frame("$reply"), frame("$other")],
            ),
            ROOM,
            {AGENT},
            reply_roots,
        )
        expected = counts(
            frames=2, edits=1, jobs=1, started=["$reply"], active=["$other", "$reply"], finished=["$reply"]
        )
        self.assertEqual({**seen, "active": sorted(seen["active"])}, expected)
        self.assertEqual(reply_roots, {"$reply": "$r"})

    def test_empty_batch(self) -> None:
        self.assertEqual(driver.count_sync({}, ROOM, {AGENT}, {}), counts())

    def test_reply_seen_in_an_earlier_batch(self) -> None:
        reply_roots: dict[str, str] = {}
        first = driver.count_sync(batch([reply_event("$reply", "$r")]), ROOM, {AGENT}, reply_roots)
        self.assertEqual(first, counts(started=["$reply"], active=["$reply"]))
        streaming = driver.count_sync(batch([edit_event("$e1", "$reply", "streaming")]), ROOM, {AGENT}, reply_roots)
        self.assertEqual(streaming, counts(edits=1, active=["$reply"]))
        done = driver.count_sync(batch([edit_event("$e2", "$reply", "error")]), ROOM, {AGENT}, reply_roots)
        self.assertEqual(done, counts(edits=1, active=["$reply"], finished=["$reply"]))
        self.assertEqual(reply_roots, {"$reply": "$r"})

    def test_every_final_status_ends_a_reply(self) -> None:
        final = ("complete", "completed", "done", "error", "failed", "stopped", "cancelled", "interrupted")
        for status in final:
            seen = driver.count_sync(batch([edit_event("$e", "$reply", status)]), ROOM, {AGENT}, {})
            self.assertEqual(seen["finished"], ["$reply"], status)
        for status in ("pending", "streaming", "approval_pending", None):
            seen = driver.count_sync(batch([edit_event("$e", "$reply", status)]), ROOM, {AGENT}, {})
            self.assertEqual(seen["finished"], [], status)

    def test_other_senders_and_rooms_do_not_count(self) -> None:
        person = "@tester:matrix.localhost"
        theirs = edit_event("$e", "$reply", "completed") | {"sender": person}
        self.assertEqual(driver.count_sync(batch([theirs]), ROOM, {AGENT}, {}), counts())
        elsewhere = driver.count_sync(
            batch([edit_event("$e", "$reply", "completed")], [frame("$reply")]), "!other:matrix.localhost", {AGENT}, {}
        )
        self.assertEqual(elsewhere, counts())

    def test_reply_that_starts_finished(self) -> None:
        event = reply_event("$reply", "$r")
        event["content"]["io.mindroom.stream_status"] = "completed"
        seen = driver.count_sync(batch([event]), ROOM, {AGENT}, {})
        self.assertEqual(seen, counts(started=["$reply"], active=["$reply"], finished=["$reply"]))

    def test_malformed_events_are_skipped(self) -> None:
        no_root = message("$a", AGENT, {"body": "x", "m.relates_to": {"rel_type": "m.thread"}})
        no_target = message("$b", AGENT, {"body": "x", "m.relates_to": {"rel_type": "m.replace"}})
        no_reply = {"type": "io.mindroom.live", "content": {}}
        reply_roots: dict[str, str] = {}
        seen = driver.count_sync(batch([no_root, no_target], [no_reply]), ROOM, {AGENT}, reply_roots)
        self.assertEqual(seen, counts(frames=1, edits=1))
        self.assertEqual(reply_roots, {})


class JobsStateEventTest(unittest.TestCase):
    @staticmethod
    def jobs(event_id: str, sender: str = AGENT) -> dict:
        return {"type": "io.mindroom.background_jobs", "event_id": event_id, "sender": sender, "state_key": sender}

    def test_first_jobs_state_write_of_an_agent(self) -> None:
        answer = batch([reply_event("$reply", "$r"), self.jobs("$jobs1"), self.jobs("$jobs2")])
        self.assertEqual(driver.jobs_state_event(answer, ROOM, {AGENT}), "$jobs1")

    def test_none_without_one(self) -> None:
        self.assertIsNone(driver.jobs_state_event(batch([reply_event("$reply", "$r")]), ROOM, {AGENT}))
        self.assertIsNone(driver.jobs_state_event(batch([self.jobs("$jobs", "@person:x")]), ROOM, {AGENT}))
        self.assertIsNone(driver.jobs_state_event(batch([self.jobs("$jobs")]), "!other:x", {AGENT}))
        self.assertIsNone(driver.jobs_state_event({}, ROOM, {AGENT}))


class ApplyCountsTest(unittest.TestCase):
    def test_counts_reach_the_scheduler(self) -> None:
        scheduler = driver.Scheduler(2, NO_PAUSE, 600, random.Random(1))
        scheduler.add("$r")
        scheduler.started("$r", 0)
        reply_roots = {"$reply": "$r", "$stray": "$elsewhere"}
        started = counts(started=["$reply", "$stray"], active=["$reply", "$stray"])
        self.assertEqual(driver.apply_counts(scheduler, started, reply_roots, 1), [])
        self.assertEqual(scheduler.streaming(1), 1)
        self.assertEqual(driver.apply_counts(scheduler, counts(active=["$reply"]), reply_roots, 10), [])
        self.assertEqual(scheduler.streaming(25), 1)
        ended = counts(active=["$reply", "$stray"], finished=["$stray", "$reply"])
        self.assertEqual(driver.apply_counts(scheduler, ended, reply_roots, 26), ["$r"])
        self.assertEqual(scheduler.posted(), 0)

    def test_threads_under_another_name(self) -> None:
        scheduler = driver.Scheduler(1, NO_PAUSE, 600, random.Random(1))
        scheduler.add("0")
        scheduler.started("0", 0)
        reply_roots = {"$reply": "$r", "$stray": "$elsewhere"}
        seen = counts(started=["$stray", "$reply"], active=["$reply"], finished=["$reply"])
        self.assertEqual(driver.apply_counts(scheduler, seen, reply_roots, 1, {"$r": "0"}), ["0"])


class ShortfallTest(unittest.TestCase):
    def windows(self, share: float, seconds: int = 40) -> list[dict]:
        return [{"t": 1000 + t, "target": 10, "streaming": round(10 * share)} for t in range(0, seconds + 1, 5)]

    def test_shortfall(self) -> None:
        self.assertFalse(driver.shortfall(self.windows(0.9)))
        self.assertTrue(driver.shortfall(self.windows(0.7)))

    def test_the_first_30_seconds_do_not_count(self) -> None:
        self.assertFalse(driver.shortfall([]))
        self.assertFalse(driver.shortfall(self.windows(0.0, seconds=25)))
        # One window after the ramp never decides, and a window of the ramp is not averaged in.
        self.assertFalse(driver.shortfall(self.windows(0.0, seconds=30)))
        self.assertTrue(driver.shortfall(self.windows(0.0, seconds=35)))
        ramp = self.windows(0.0, seconds=25)
        self.assertFalse(driver.shortfall([*ramp, *(window | {"streaming": 9} for window in self.windows(1)[6:8])]))

    def test_one_low_window_is_not_a_shortfall(self) -> None:
        windows = self.windows(1.0, seconds=60)
        windows[-1]["streaming"] = 7
        self.assertFalse(driver.shortfall(windows))  # (1.0 + 0.7) / 2
        windows[-2]["streaming"] = 7
        self.assertTrue(driver.shortfall(windows))  # two low windows in a row

    def test_a_ramp_is_left_out(self) -> None:
        low = [{"t": 5 * index, "target": 10, "streaming": 2} for index in range(1, 16)]
        self.assertTrue(driver.shortfall(low))
        # 60 s of ramp and 15 s for the last stream to count as live: the windows up to 75 s do not decide.
        self.assertFalse(driver.shortfall(low, ramp=60))
        self.assertTrue(driver.shortfall([*low, {"t": 80, "target": 10, "streaming": 2}, {"t": 85, "target": 10, "streaming": 2}], ramp=60))

    def test_only_the_last_10_seconds_count(self) -> None:
        windows = self.windows(0.0, seconds=60)
        for window in windows[-2:]:
            window["streaming"] = 9
        self.assertFalse(driver.shortfall(windows))


class FakeLobby:
    """A lobby without a homeserver: `answer(now, posts)` gives each sync's counts, and each sync takes `tick`
    seconds of the clock."""

    room = ROOM

    def __init__(self, failing_posts: int = 0, tick: float = 1) -> None:
        self.now = 0.0
        self.tick = tick
        self.reply_roots: dict[str, str] = {}
        self.posts: list[tuple[float, str]] = []
        self.failed_posts = 0
        self.answer = lambda now, posts: counts()
        self._failing_posts = failing_posts
        self.resolved: list[str] = []
        self.resolves = True
        self.jobs_event: str | None = None
        self.latest_reply: dict[str, str] = {}
        # Unthreaded receipts by event, threaded ones as (event, thread root); the first `refused_receipts` fail.
        self.marked_read: list[str] = []
        self.thread_reads: list[tuple[str, str]] = []
        self.refused_receipts = 0

    def clock(self) -> float:
        return self.now

    def sync(self) -> dict:
        self.now += self.tick
        return self.answer(self.now, self.posts)

    def post_turn(self, root: str, body: str) -> str | None:
        if self.failed_posts < self._failing_posts:
            self.failed_posts += 1
            return None
        self.posts.append((self.now, root))
        return f"$turn{len(self.posts)}"

    def resolve(self, root: str) -> bool:
        if self.resolves:
            self.resolved.append(root)
        return self.resolves

    def mark_read(self, event_id: str, thread: str | None = None) -> bool:
        if self.refused_receipts > 0:
            self.refused_receipts -= 1
            return False
        if thread is None:
            self.marked_read.append(event_id)
        else:
            self.thread_reads.append((event_id, thread))
        return True


class RunHistoryTest(unittest.TestCase):
    def run_history(self, lobby: FakeLobby, **profile_values: object) -> tuple[int, dict]:
        profile = json.loads((WORKLOADS / "real-work-smoke.json").read_text())
        profile |= {"quietRooms": 0, "threads": 5, "turns": {"p50": 1, "p90": 1, "max": 1}} | profile_values
        driver.check_profile(profile)

        def answer(now: float, posts: list[tuple[float, str | None]]) -> dict:
            """Each turn's reply starts and ends in the sync after it; a new thread's root is its own post."""
            seen = counts()
            for index, (_, root) in enumerate(posts):
                reply = f"$reply{index}"
                if reply not in lobby.reply_roots:
                    lobby.reply_roots[reply] = root or f"$turn{index + 1}"
                    lobby.latest_reply[lobby.reply_roots[reply]] = reply
                    seen["started"].append(reply)
                    seen["finished"].append(reply)
            return seen

        lobby.answer = answer
        # Every draw is its distribution's maximum, so a test knows each thread's turns.
        top = mock.patch.object(driver, "sample", lambda dist, rng: dist["max"])
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stderr(io.StringIO()), top:
            out = Path(directory) / "history.json"
            code = driver.run_history(lobby, profile, 2, random.Random(1), out)
            return code, json.loads(out.read_text()) if out.exists() else {}

    def test_every_thread_is_open_without_resolved_threads(self) -> None:
        lobby = FakeLobby()
        code, history = self.run_history(lobby)
        self.assertEqual(code, 0)
        self.assertEqual(len(history["threads"]), 5)
        self.assertEqual(history["resolvedThreads"], [])
        self.assertEqual(lobby.resolved, [])

    def test_resolved_threads_come_first_and_get_no_live_turns(self) -> None:
        lobby = FakeLobby()
        code, history = self.run_history(lobby, resolvedThreads=3)
        self.assertEqual(code, 0)
        # The first turns posted are the resolved threads' roots: the open threads are the newest.
        self.assertEqual(history["resolvedThreads"], ["$turn1", "$turn2", "$turn3"])
        self.assertEqual(history["threads"], ["$turn4", "$turn5"])
        self.assertEqual(lobby.resolved, history["resolvedThreads"])

    def test_refused_resolve_fails_the_history(self) -> None:
        lobby = FakeLobby()
        lobby.resolves = False
        code, history = self.run_history(lobby, resolvedThreads=3)
        self.assertEqual(code, 1)
        self.assertEqual(history, {})

    def test_room_is_marked_read_once_at_the_first_jobs_state_write(self) -> None:
        lobby = FakeLobby()
        lobby.jobs_event = "$jobs1"
        code, _ = self.run_history(lobby)
        self.assertEqual(code, 0)
        self.assertEqual(lobby.marked_read, ["$jobs1"])

    def test_room_without_jobs_state_is_not_marked_read(self) -> None:
        lobby = FakeLobby()
        code, _ = self.run_history(lobby)
        self.assertEqual(code, 0)
        self.assertEqual(lobby.marked_read, [])

    def test_refused_receipt_is_sent_again(self) -> None:
        lobby = FakeLobby()
        lobby.jobs_event = "$jobs1"
        lobby.refused_receipts = 2
        code, history = self.run_history(lobby)
        self.assertEqual(code, 0)
        self.assertEqual(lobby.marked_read, ["$jobs1"])
        self.assertEqual(len(history["threads"]), 5)

    def test_open_threads_are_read_up_to_their_newest_reply(self) -> None:
        lobby = FakeLobby()
        code, history = self.run_history(lobby, resolvedThreads=3, turns={"p50": 2, "p90": 2, "max": 2})
        self.assertEqual(code, 0)
        self.assertEqual(sorted(root for _, root in lobby.thread_reads), sorted(history["threads"]))
        for reply, root in lobby.thread_reads:
            self.assertEqual(lobby.latest_reply[root], reply)
        # The second turn's reply, not the first one's.
        replies_of = {root: [r for r, owner in lobby.reply_roots.items() if owner == root] for root in history["threads"]}
        self.assertTrue(all(len(replies) == 2 for replies in replies_of.values()), replies_of)
        self.assertEqual(lobby.marked_read, [])

    def test_thread_receipt_refused_three_times_is_given_up(self) -> None:
        lobby = FakeLobby()
        code, history = self.run_history(lobby, threads=1)
        self.assertEqual((code, len(lobby.thread_reads)), (0, 1))
        lobby = FakeLobby()
        lobby.refused_receipts = 3
        code, history = self.run_history(lobby, threads=1)
        self.assertEqual((code, lobby.thread_reads), (0, []))
        self.assertEqual(len(history["threads"]), 1)

    def test_heavy_threads_are_open_start_first_and_have_their_own_turns(self) -> None:
        lobby = FakeLobby()
        heavy = {"threads": 2, "turns": {"p50": 6, "p90": 6, "max": 6}}
        code, history = self.run_history(lobby, resolvedThreads=2, heavy=heavy)
        self.assertEqual(code, 0)
        # Two streams at once: the heavy threads' roots are the first two posts.
        self.assertEqual(history["heavyThreads"], ["$turn1", "$turn2"])
        self.assertEqual(history["threads"][:2], history["heavyThreads"])
        self.assertEqual(len(history["threads"]), 3)
        turns = {root: 1 + sum(1 for _, posted in lobby.posts if posted == root) for root in history["threads"]}
        self.assertEqual([turns[root] for root in history["threads"]], [6, 6, 1])

    def test_profile_without_heavy_has_none(self) -> None:
        _, history = self.run_history(FakeLobby())
        self.assertEqual(history["heavyThreads"], [])
        profile = json.loads((WORKLOADS / "real-work-smoke.json").read_text())
        for bad in ({"threads": profile["threads"] + 1, "turns": NO_PAUSE}, {"threads": 1}, {"threads": 1.5, "turns": NO_PAUSE}):
            with self.assertRaisesRegex(ValueError, "heavy"):
                driver.check_profile(profile | {"heavy": bad})
        with self.assertRaisesRegex(ValueError, "heavy.threads"):
            driver.check_profile(profile | {"resolvedThreads": 2, "heavy": {"threads": 2, "turns": NO_PAUSE}})
        with self.assertRaisesRegex(ValueError, "reply.links"):
            driver.check_profile(profile | {"reply": profile["reply"] | {"links": 2}})

    def test_background_jobs_need_their_seconds(self) -> None:
        profile = json.loads((WORKLOADS / "real-work-smoke.json").read_text())
        self.assertEqual(driver.check_profile(json.loads(json.dumps(profile)))["live"]["jobs"], 0)
        jobs = {"bg": NO_PAUSE, "bgsec": NO_PAUSE}
        driver.check_profile(profile | {"reply": profile["reply"] | jobs | {"toolout": 700}})
        with self.assertRaisesRegex(ValueError, "reply.bg and reply.bgsec"):
            driver.check_profile(profile | {"reply": profile["reply"] | {"bg": NO_PAUSE}})
        with self.assertRaisesRegex(ValueError, "reply.toolout"):
            driver.check_profile(profile | {"reply": profile["reply"] | {"toolout": -1}})
        with self.assertRaisesRegex(ValueError, "live.jobs"):
            driver.check_profile(profile | {"live": profile["live"] | {"jobs": 2}})

    def test_resolved_threads_leave_one_open(self) -> None:
        profile = json.loads((WORKLOADS / "real-work-smoke.json").read_text())
        self.assertEqual(driver.check_profile(dict(profile))["resolvedThreads"], 0)
        for bad in (profile["threads"], -1, 1.5, True):
            with self.assertRaisesRegex(ValueError, "resolvedThreads"):
                driver.check_profile(profile | {"resolvedThreads": bad})


class RunLiveTest(unittest.TestCase):
    def run_live(self, lobby: FakeLobby, seconds: float, stuck_seconds: int = 600) -> tuple[int, list[dict], str]:
        profile = json.loads((WORKLOADS / "real-work-smoke.json").read_text())
        profile["live"] |= {"stuckSeconds": stuck_seconds, "pauseSeconds": NO_PAUSE}
        history = {"room": ROOM, "threads": ["$r0", "$r1", "$r2"], "quietRooms": []}
        errors = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stderr(errors):
            out = Path(directory) / "live.jsonl"
            code = driver.run_live(lobby, profile, history, 3, seconds, random.Random(1), out, clock=lobby.clock)
            lines = [json.loads(line) for line in out.read_text().splitlines()]
        return code, lines, errors.getvalue()

    @staticmethod
    def replies(lobby: FakeLobby, ends_after: float | None):
        """A backend that starts a reply in the sync after each turn, sends frames of it, and ends it `ends_after`
        seconds after the turn (never, for None)."""
        answered: set[str] = set()

        def answer(now: float, posts: list[tuple[float, str]]) -> dict:
            seen = counts()
            for index, (at, root) in enumerate(posts):
                reply = f"$reply{index}"
                if reply not in answered:
                    answered.add(reply)
                    lobby.reply_roots[reply] = root
                    seen["started"].append(reply)
                    seen["active"].append(reply)
                elif ends_after is None or now - at < ends_after:
                    seen["frames"] += 1
                    seen["active"].append(reply)
                elif now - at < ends_after + lobby.tick:
                    seen["edits"] += 1
                    seen["finished"].append(reply)
            return seen

        return answer

    def test_jobs_under_way_start_in_the_threads_after_the_streams(self) -> None:
        lobby = FakeLobby(tick=0.25)
        lobby.answer = self.replies(lobby, ends_after=2)
        bodies: list[str] = []
        post = lobby.post_turn
        lobby.post_turn = lambda root, body: bodies.append(body) or post(root, body)  # type: ignore[method-assign]
        profile = json.loads((WORKLOADS / "real-work-smoke.json").read_text())
        profile["reply"] |= {"bg": NO_PAUSE, "bgsec": {"p50": 300, "p90": 300, "max": 300}}
        profile["live"] |= {"pauseSeconds": NO_PAUSE, "jobs": 2}
        history = {"room": ROOM, "threads": ["root0", "root1", "root2", "root3", "root4"], "quietRooms": []}
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stderr(io.StringIO()):
            driver.run_live(lobby, profile, history, 2, 10, random.Random(1), Path(directory) / "l", clock=lobby.clock)
        self.assertEqual([root for _, root in lobby.posts[:2]], ["root2", "root3"])
        self.assertTrue(all(re.search(r" tools=0 bg=1 bgsec=\d+ ", body) for body in bodies[:2]), bodies)
        # They hold their threads as turns, so the streams' first turns wait for their replies to end.
        self.assertEqual(sorted(root for _, root in lobby.posts[2:4]), ["root0", "root1"])
        self.assertGreater(lobby.posts[2][0], 0)
        self.assertFalse(any(" bg=" in body for body in bodies[2:]), bodies)

    def test_backend_that_keeps_up(self) -> None:
        lobby = FakeLobby(tick=0.25)
        lobby.answer = self.replies(lobby, ends_after=8)
        code, lines, _ = self.run_live(lobby, 60)
        self.assertEqual(code, 0)
        self.assertEqual(len(lines), 11)
        self.assertTrue(all(line["target"] == 3 and line["streaming"] == 3 for line in lines), lines)
        self.assertTrue(all(line["frames"] > 0 and line["stuck"] == 0 for line in lines), lines)
        self.assertGreater(sum(line["edits"] for line in lines), 15)
        self.assertEqual([line["t"] - lines[0]["t"] for line in lines], list(range(0, 55, 5)))
        self.assertEqual(sorted(lines[0]), ["edits", "frames", "jobs", "streaming", "stuck", "t", "target"])

    def first_posts(self, ramp: float, threads: int = 6, streams: int = 3) -> list[tuple[float, str]]:
        lobby = FakeLobby(tick=0.5)
        lobby.answer = self.replies(lobby, ends_after=None)
        profile = json.loads((WORKLOADS / "real-work-smoke.json").read_text())
        profile["live"] |= {"stuckSeconds": 600}
        history = {"room": ROOM, "threads": [f"$r{index}" for index in range(threads)], "quietRooms": []}
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stderr(io.StringIO()):
            out = Path(directory) / "live.jsonl"
            driver.run_live(lobby, profile, history, streams, 100, random.Random(1), out, clock=lobby.clock, ramp=ramp)
        return lobby.posts

    def test_first_turns_are_spread_over_the_ramp(self) -> None:
        posts = self.first_posts(ramp=60)
        # Replies that never end: only the first three threads get a turn, each at its own time within the ramp.
        self.assertEqual(sorted(root for _, root in posts), ["$r0", "$r1", "$r2"])
        times = sorted(at for at, _ in posts)
        self.assertTrue(all(0 <= at <= 61 for at in times), times)
        self.assertGreater(times[-1] - times[0], 10)
        self.assertEqual(posts, self.first_posts(ramp=60))
        # Without a ramp they start together, as before.
        self.assertEqual(len({at for at, _ in self.first_posts(ramp=0)}), 1)

    def test_other_threads_wait_for_the_end_of_the_ramp(self) -> None:
        lobby = FakeLobby(tick=0.5)
        lobby.answer = self.replies(lobby, ends_after=2)
        profile = json.loads((WORKLOADS / "real-work-smoke.json").read_text())
        profile["live"] |= {"pauseSeconds": {"p50": 1000, "p90": 1000, "max": 1000}}
        history = {"room": ROOM, "threads": [f"$r{index}" for index in range(6)], "quietRooms": []}
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stderr(io.StringIO()):
            out = Path(directory) / "live.jsonl"
            driver.run_live(lobby, profile, history, 3, 80, random.Random(1), out, clock=lobby.clock, ramp=60)
        later = [at for at, root in lobby.posts if root in ("$r3", "$r4", "$r5")]
        self.assertEqual(len(later), 3)
        self.assertTrue(all(at >= 60 for at in later), later)

    def test_backend_that_never_answers_is_a_shortfall(self) -> None:
        lobby = FakeLobby()
        code, lines, errors = self.run_live(lobby, 600)
        self.assertEqual(code, 2)
        self.assertEqual(len(lobby.posts), 3)
        self.assertEqual([line["streaming"] for line in lines], [0] * 8)  # 30 s of ramp, then two windows
        self.assertIn("shortfall: the target is 3 streams, the last 10 s held 0, 0 (0% of it", errors)

    def test_reply_that_never_ends_is_swept_and_counted(self) -> None:
        lobby = FakeLobby()
        lobby.answer = self.replies(lobby, ends_after=None)
        lobby.tick = 1.5  # syncs that do not land on the windows' ends
        code, lines, _ = self.run_live(lobby, 29, stuck_seconds=20)
        self.assertEqual(code, 0)
        self.assertEqual([line["t"] - lines[0]["t"] for line in lines], [0, 5, 10, 15, 20])
        self.assertEqual([line["stuck"] for line in lines], [0, 0, 0, 3, 0])
        # No reply is live between the sweep and the next sync.
        self.assertEqual([line["streaming"] for line in lines], [3, 3, 3, 2, 3])
        # Each thread got its next turn once its first was given up.
        self.assertEqual(sorted(root for _, root in lobby.posts), ["$r0", "$r0", "$r1", "$r1", "$r2", "$r2"])

    def test_failed_post_is_tried_again(self) -> None:
        lobby = FakeLobby(failing_posts=4)
        lobby.answer = self.replies(lobby, ends_after=8)
        code, lines, _ = self.run_live(lobby, 30)
        self.assertEqual(code, 0)
        self.assertEqual(lobby.failed_posts, 4)
        self.assertEqual(lobby.posts[0][0], 5)  # one try a tick, after the first sync
        self.assertEqual(lines[-1]["streaming"], 3)

    def test_posts_that_keep_failing_are_a_shortfall(self) -> None:
        code, _, _ = self.run_live(FakeLobby(failing_posts=10**6), 600)
        self.assertEqual(code, 2)

    def test_stop_ends_the_run(self) -> None:
        lobby = FakeLobby()
        profile = json.loads((WORKLOADS / "real-work-smoke.json").read_text())
        history = {"room": ROOM, "threads": ["$r0"], "quietRooms": []}
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "live.jsonl"
            code = driver.run_live(
                lobby, profile, history, 1, None, random.Random(1), out, lambda: lobby.now >= 7, lobby.clock
            )
            self.assertEqual(len(out.read_text().splitlines()), 1)
        self.assertEqual(code, 0)


def limited(events: list[dict], prev_batch: str) -> dict:
    """A joined room of a /sync answer whose timeline left older events out."""
    return {"timeline": {"events": events, "limited": True, "prev_batch": prev_batch}}


class FakeHomeserver:
    """Answers /sync with `syncs` in turn and a backwards /messages page from token t with `pages[t]` (a server error
    for any other token); `asked` lists the tokens of the /messages asked."""

    def __init__(self, syncs: list[dict], pages: dict[str, dict]) -> None:
        self.syncs = list(syncs)
        self.pages = pages
        self.asked: list[str] = []

    def __call__(self, method: str, url: str, token: str | None = None, timeout: float = 10.0) -> tuple[int, object]:
        parsed = urllib.parse.urlparse(url)
        query = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/_matrix/client/v3/sync":
            return 200, self.syncs.pop(0)
        assert parsed.path == f"/_matrix/client/v3/rooms/{urllib.parse.quote(ROOM, safe='')}/messages", url
        assert (query["dir"], query["limit"]) == (["b"], ["100"]), url
        self.asked.append(query["from"][0])
        page = self.pages.get(query["from"][0])
        return (500, {"errcode": "M_UNKNOWN"}) if page is None else (200, page)


class LobbySyncTest(unittest.TestCase):
    STACK = {
        "homeserver": "http://hs",
        "tester": {"accessToken": "token", "userId": "@tester:matrix.localhost"},
        "rooms": {"lobby": ROOM},
    }

    def lobby(self) -> driver.Lobby:
        members = {"joined": {AGENT: {}, "@tester:matrix.localhost": {}}}
        with mock.patch.object(driver, "call", return_value=members):
            return driver.Lobby(self.STACK)

    def sync(self, lobby: driver.Lobby, answer: object) -> tuple[dict, str]:
        """The counts of one sync that the homeserver answers with `answer` (raised, when an exception), and the
        URL it asked."""
        http_json = mock.Mock(side_effect=answer if isinstance(answer, Exception) else None, return_value=answer)
        with (
            mock.patch.object(driver, "http_json", http_json),
            mock.patch.object(driver.time, "sleep"),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            return lobby.sync(), http_json.call_args.args[1]

    def test_agents_are_the_mindroom_members(self) -> None:
        self.assertEqual(self.lobby().agents, {AGENT})

    def test_unusable_answers_are_skipped(self) -> None:
        lobby = self.lobby()
        good = batch([reply_event("$reply", "$r")], [frame("$reply")])
        seen, url = self.sync(lobby, (200, good))
        self.assertEqual(seen, counts(frames=1, started=["$reply"], active=["$reply"]))
        self.assertNotIn("since=", url)
        self.assertIn("io.mindroom.live", urllib.parse.unquote(url))
        unusable = (
            json.JSONDecodeError("not JSON", "<html>", 0),
            (200, None),
            (200, ["a list"]),
            (200, {"no": "next_batch"}),
            (502, {"error": "bad gateway"}),
            (0, {"error": "timed out"}),
        )
        for answer in unusable:
            seen, url = self.sync(lobby, answer)
            self.assertEqual(seen, counts(), answer)
            self.assertIn("since=s1", url)
        later = batch([edit_event("$e", "$reply", "completed")]) | {"next_batch": "s2"}
        seen, _ = self.sync(lobby, (200, later))
        self.assertEqual(seen, counts(edits=1, active=["$reply"], finished=["$reply"]))
        self.assertIn("since=s2", self.sync(lobby, (200, {"next_batch": "s3"}))[1])

    @contextlib.contextmanager
    def homeserver(self, home: FakeHomeserver):
        with (
            mock.patch.object(driver, "http_json", home),
            mock.patch.object(driver.time, "sleep"),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            yield

    def test_a_limited_answer_reads_back_the_final_edit_it_left_out(self) -> None:
        lobby = self.lobby()
        scheduler = driver.Scheduler(1, NO_PAUSE, 1800, random.Random(1))
        scheduler.add("$r")
        scheduler.started("$r", 0)
        later = message("$later", "@tester:matrix.localhost", {"msgtype": "m.text", "body": "later"})
        # The first answer leaves the room's older events out; that is where the driver starts.
        first = {"next_batch": "s1", "rooms": {"join": {ROOM: limited([reply_event("$reply", "$r")], "p1")}}}
        second = {"next_batch": "s2", "rooms": {"join": {ROOM: limited([later], "p2")}}}
        # Newest first, back to the reply the first answer held.
        gap = [edit_event("$final", "$reply", "completed"), edit_event("$mid", "$reply", "streaming")]
        home = FakeHomeserver([first, second], {"p2": {"chunk": [*gap, reply_event("$reply", "$r")], "end": "p3"}})
        with self.homeserver(home):
            self.assertEqual(driver.apply_counts(scheduler, lobby.sync(), lobby.reply_roots, 1), [])
            seen = lobby.sync()
        self.assertEqual(seen, counts(edits=2, active=["$reply"], finished=["$reply"]))
        self.assertEqual(driver.apply_counts(scheduler, seen, lobby.reply_roots, 2), ["$r"])
        self.assertEqual(home.asked, ["p2"])

    def test_an_event_in_the_gap_and_in_the_answer_counts_once(self) -> None:
        lobby = self.lobby()
        jobs = {"type": driver.JOBS_STATE, "event_id": "$jobs", "sender": AGENT, "state_key": AGENT, "content": {}}
        first = {"next_batch": "s1", "rooms": {"join": {ROOM: limited([reply_event("$reply", "$r")], "p1")}}}
        second_room = limited([edit_event("$e2", "$reply", "streaming")], "p2") | {"state": {"events": [jobs]}}
        second = {"next_batch": "s2", "rooms": {"join": {ROOM: second_room}}}
        third_room = limited([edit_event("$e1", "$reply", "streaming")], "p3")
        third = {"next_batch": "s3", "rooms": {"join": {ROOM: third_room}}}
        page = [edit_event("$e2", "$reply", "streaming"), jobs, edit_event("$e1", "$reply", "streaming")]
        pages = {"p2": {"chunk": [*page, reply_event("$reply", "$r")], "end": "x"}, "p3": {"chunk": [], "end": "y"}}
        home = FakeHomeserver([first, second, third], pages)
        with self.homeserver(home):
            lobby.sync()
            self.assertEqual(lobby.sync(), counts(edits=2, jobs=1, active=["$reply"]))
            # A later answer that holds an event read back before counts nothing of it.
            self.assertEqual(lobby.sync(), counts())
        self.assertEqual(home.asked, ["p2", "p3"])

    def test_a_gap_over_the_page_cap_stops_the_driver(self) -> None:
        lobby = self.lobby()
        first = {"next_batch": "s1", "rooms": {"join": {ROOM: limited([reply_event("$reply", "$r")], "p0")}}}
        second = {"next_batch": "s2", "rooms": {"join": {ROOM: limited([], "p1")}}}
        pages = {
            f"p{n}": {"chunk": [edit_event(f"$e{n}", "$reply", "streaming")], "end": f"p{n + 1}"} for n in range(1, 99)
        }
        home = FakeHomeserver([first, second], pages)
        with self.homeserver(home), self.assertRaises(SystemExit) as stopped:
            lobby.sync()
            lobby.sync()
        self.assertIn(ROOM, str(stopped.exception.code))
        self.assertIn("50 pages", str(stopped.exception.code))
        self.assertEqual(len(home.asked), 50)

    def test_a_page_that_fails_three_times_stops_the_driver(self) -> None:
        lobby = self.lobby()
        first = {"next_batch": "s1", "rooms": {"join": {ROOM: limited([reply_event("$reply", "$r")], "p0")}}}
        second = {"next_batch": "s2", "rooms": {"join": {ROOM: limited([], "p1")}}}
        home = FakeHomeserver([first, second], {})
        with self.homeserver(home), self.assertRaises(SystemExit) as stopped:
            lobby.sync()
            lobby.sync()
        self.assertIn(ROOM, str(stopped.exception.code))
        self.assertEqual(home.asked, ["p1", "p1", "p1"])

    def test_failed_post_gives_none(self) -> None:
        lobby = self.lobby()
        with contextlib.redirect_stderr(io.StringIO()) as errors:
            with mock.patch.object(driver, "send", side_effect=RuntimeError("PUT /send: 0 {'error': 'refused'}")):
                self.assertIsNone(lobby.post_turn("$r", "#work"))
            with mock.patch.object(driver, "send", return_value="$turn") as send:
                self.assertEqual(lobby.post_turn("$r", "#work"), "$turn")
        self.assertIn("a turn was not posted", errors.getvalue())
        self.assertEqual(send.call_args.args[3]["m.relates_to"]["event_id"], "$r")


class ProfilesTest(unittest.TestCase):
    def test_profiles_load(self) -> None:
        paths = sorted(WORKLOADS.glob("*.json"))
        self.assertGreaterEqual(len(paths), 4)
        for path in paths:
            with self.subTest(path.name):
                self.assertEqual(driver.load_profile(path)["name"], path.stem)

    def test_profile_without_a_key_is_refused(self) -> None:
        profile = json.loads((WORKLOADS / "real-work-smoke.json").read_text())
        del profile["live"]["stuckSeconds"]
        with self.assertRaisesRegex(ValueError, "live.stuckSeconds"):
            driver.check_profile(profile)
        profile = json.loads((WORKLOADS / "real-work-smoke.json").read_text())
        del profile["reply"]["words"]["p90"]
        with self.assertRaisesRegex(ValueError, "reply.words.p90"):
            driver.check_profile(profile)


if __name__ == "__main__":
    unittest.main()
