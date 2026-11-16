"""Tests of scripts/perf/real-work/driver.py that need no homeserver, and of the workload profiles it reads."""

from __future__ import annotations

import contextlib
import io
import json
import random
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
        code, lines, _ = self.run_live(lobby, 29, stuck_seconds=20)
        self.assertEqual(code, 0)
        self.assertEqual([line["stuck"] for line in lines], [0, 0, 0, 0, 3])
        # The second turns wait a tick for their replies.
        self.assertEqual([line["streaming"] for line in lines], [3, 3, 3, 3, 2])
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


class LobbySyncTest(unittest.TestCase):
    STACK = {"homeserver": "http://hs", "tester": {"accessToken": "token"}, "rooms": {"lobby": ROOM}}

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
        self.assertGreaterEqual(len(paths), 3)
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
