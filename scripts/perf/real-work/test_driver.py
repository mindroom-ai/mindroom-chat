"""Tests of scripts/perf/real-work/driver.py that need no homeserver, and of the workload profiles it reads."""

from __future__ import annotations

import json
import random
import statistics
import sys
import unittest
from pathlib import Path

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

    def test_prompt_live_keeps_the_pace(self) -> None:
        prompt = driver.work_prompt(REPLY, random.Random(1), live=True)
        self.assertIn(" wps=30 ", prompt)
        self.assertRegex(prompt, r"^#work words=\d+ wps=30 reasoning=\d+ tools=\d+ toolsec=\d+(\.\d+)? seed=\d+$")
        self.assertNotIn("scout", prompt)


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
        self.assertEqual(scheduler.streaming(), 3)
        self.assertEqual(scheduler.ready(0), [])
        scheduler.finished(first[0], 1)
        self.assertEqual(scheduler.streaming(), 2)
        more = scheduler.ready(1)
        self.assertEqual(len(more), 1)
        self.assertNotIn(more[0], first[1:])
        scheduler.started(more[0], 1)
        self.assertEqual(scheduler.streaming(), 3)

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
        self.assertEqual(scheduler.sweep_stuck(600), [])
        self.assertEqual(scheduler.sweep_stuck(601), ["$r0"])
        self.assertEqual(scheduler.streaming(), 0)
        self.assertEqual(scheduler.sweep_stuck(602), [])
        self.assertEqual(scheduler.ready(602), ["$r0"])

    def test_dropped_thread_gets_no_turn(self) -> None:
        scheduler = self.scheduler(2, 2)
        scheduler.drop("$r0")
        self.assertEqual(scheduler.ready(0), ["$r1"])

    def test_late_finish_of_an_idle_thread_is_ignored(self) -> None:
        scheduler = self.scheduler(1, 1)
        scheduler.finished("$r0", 0)
        scheduler.finished("$unknown", 0)
        self.assertEqual(scheduler.streaming(), 0)


class CountSyncTest(unittest.TestCase):
    def test_count_sync(self) -> None:
        frames = [{"type": "io.mindroom.live", "content": {}}, {"type": "io.mindroom.live", "content": {}}]
        jobs = {
            "type": "io.mindroom.background_jobs",
            "event_id": "$j",
            "sender": AGENT,
            "state_key": AGENT,
            "content": {"jobs": []},
        }
        reply_roots: dict[str, str] = {}
        counts = driver.count_sync(
            batch(
                [reply_event("$reply", "$r"), jobs, edit_event("$e", "$reply", "completed")],
                [{"type": "m.typing", "content": {"user_ids": []}}, *frames],
            ),
            ROOM,
            {AGENT},
            reply_roots,
        )
        self.assertEqual(counts, {"frames": 2, "edits": 1, "jobs": 1, "finished": ["$r"]})
        self.assertEqual(reply_roots, {"$reply": "$r"})

    def test_empty_batch(self) -> None:
        zeros = {"frames": 0, "edits": 0, "jobs": 0, "finished": []}
        self.assertEqual(driver.count_sync({}, ROOM, {AGENT}, {}), zeros)

    def test_reply_seen_in_an_earlier_batch(self) -> None:
        reply_roots: dict[str, str] = {}
        first = driver.count_sync(batch([reply_event("$reply", "$r")]), ROOM, {AGENT}, reply_roots)
        self.assertEqual(first, {"frames": 0, "edits": 0, "jobs": 0, "finished": []})
        streaming = driver.count_sync(batch([edit_event("$e1", "$reply", "streaming")]), ROOM, {AGENT}, reply_roots)
        self.assertEqual(streaming, {"frames": 0, "edits": 1, "jobs": 0, "finished": []})
        done = driver.count_sync(batch([edit_event("$e2", "$reply", "error")]), ROOM, {AGENT}, reply_roots)
        self.assertEqual(done, {"frames": 0, "edits": 1, "jobs": 0, "finished": ["$r"]})

    def test_other_senders_and_rooms_do_not_count(self) -> None:
        person = "@tester:matrix.localhost"
        theirs = edit_event("$e", "$reply", "completed") | {"sender": person}
        reply_roots = {"$reply": "$r"}
        counts = driver.count_sync(batch([theirs]), ROOM, {AGENT}, reply_roots)
        self.assertEqual(counts, {"frames": 0, "edits": 0, "jobs": 0, "finished": []})
        elsewhere = driver.count_sync(
            batch([edit_event("$e", "$reply", "completed")]), "!other:matrix.localhost", {AGENT}, reply_roots
        )
        self.assertEqual(elsewhere, {"frames": 0, "edits": 0, "jobs": 0, "finished": []})

    def test_reply_that_starts_finished(self) -> None:
        event = reply_event("$reply", "$r")
        event["content"]["io.mindroom.stream_status"] = "completed"
        counts = driver.count_sync(batch([event]), ROOM, {AGENT}, {})
        self.assertEqual(counts["finished"], ["$r"])


class ShortfallTest(unittest.TestCase):
    def windows(self, share: float, seconds: int = 40) -> list[dict]:
        return [{"t": 1000 + t, "target": 10, "streaming": round(10 * share)} for t in range(0, seconds + 1, 5)]

    def test_shortfall(self) -> None:
        self.assertFalse(driver.shortfall(self.windows(0.9)))
        self.assertTrue(driver.shortfall(self.windows(0.7)))

    def test_the_first_30_seconds_do_not_count(self) -> None:
        self.assertFalse(driver.shortfall(self.windows(0.0, seconds=25)))
        slow_start = self.windows(0.0, seconds=25) + [{"t": 1030, "target": 10, "streaming": 9}]
        self.assertFalse(driver.shortfall(slow_start))
        self.assertFalse(driver.shortfall([]))

    def test_one_low_window_is_not_a_shortfall(self) -> None:
        windows = self.windows(1.0, seconds=60)
        windows[-1]["streaming"] = 5
        self.assertFalse(driver.shortfall(windows))


class ProfilesTest(unittest.TestCase):
    def test_profiles_load(self) -> None:
        names = sorted(path.name for path in WORKLOADS.glob("*.json"))
        self.assertEqual(names, ["real-work-50.json", "real-work-census.json", "real-work-smoke.json"])
        for name in names:
            with self.subTest(name):
                profile = driver.load_profile(WORKLOADS / name)
                self.assertEqual(profile["name"], name.removesuffix(".json"))

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
