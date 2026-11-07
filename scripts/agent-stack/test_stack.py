"""Tests of scripts/agent-stack/stack.py that need no backend: its configs, provider keys, usage summary and joins."""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

TESTER = "@tester_t1:matrix.localhost"
STUB_URL = "http://127.0.0.1:29716/v1"


class ConfigTests(unittest.TestCase):
    def test_stub_config_runs_two_agents_on_the_stub(self) -> None:
        config = stack.config_yaml("stub", TESTER, STUB_URL, 0.0003)
        self.assertIn(f"base_url: {STUB_URL}", config)
        self.assertIn("  scout:\n", config)
        self.assertIn("router:\n  model: default\n", config)
        self.assertNotIn("thread_summary_model", config)
        self.assertNotIn("anthropic", config)

    def test_real_config_runs_the_helper_on_haiku_and_luna_for_the_rest(self) -> None:
        config = stack.config_yaml("real", TESTER, STUB_URL, 0.0003)
        self.assertIn("provider: anthropic\n    id: claude-haiku-5-5\n", config)
        self.assertIn("  luna:\n    provider: openai\n    id: gpt-6-luna\n", config)
        self.assertIn("router:\n  model: luna\n", config)
        self.assertIn("  thread_summary_model: luna\n", config)
        self.assertNotIn("  scout:", config)
        self.assertNotIn(STUB_URL, config)
        # Every scenario of the stub has a line in the script.
        script = "\n".join(stack.REAL_INSTRUCTIONS)
        for tag in ("#slow", "#stopme", "#long", "#multi", "#approve", "#title", "#tag", "#expire", "#job"):
            self.assertIn(f"{tag}:", script)

    def test_a_key_in_the_environment_never_reaches_the_config(self) -> None:
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-test-secret", "OPENAI_API_KEY": "sk-two"}):
            config = stack.config_yaml("real", TESTER, STUB_URL, 0.0003)
        self.assertNotIn("sk-test-secret", config)
        self.assertNotIn("sk-two", config)


class ProviderKeyTests(unittest.TestCase):
    def test_only_the_provider_keys_are_taken(self) -> None:
        env = {"ANTHROPIC_API_KEY": "a", "OPENAI_API_KEY": "", "GITHUB_TOKEN": "g"}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(stack.provider_keys(), {"ANTHROPIC_API_KEY": "a"})


CONSOLE_LINE = (
    "2026-11-04T17:00:03.689917Z [info     ] LLM usage                      "
    "[mindroom.providers.pipeline.request_log] agent_id=helper cache_read_ratio=0.0 cache_read_tokens=0 "
    "cache_write_tokens=18382 context_input_tokens=18386 input_tokens=4 model_id=claude-haiku-5-5 "
    "model_name=default output_tokens=13 provider=Anthropic reasoning_tokens=0 stop_reason=end "
    "uncached_input_tokens=18386 usage_available=True"
)
JSON_LINE = json.dumps(
    {
        "event": "LLM usage",
        "model_name": "luna",
        "model_id": "gpt-6-luna",
        "context_input_tokens": 1000,
        "uncached_input_tokens": 400,
        "cache_read_tokens": 600,
        "cache_write_tokens": 0,
        "output_tokens": 100,
        "reasoning_tokens": 50,
    }
)


class UsageTests(unittest.TestCase):
    def test_usage_sums_and_prices_console_and_json_lines(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            slot_dir = Path(directory)
            lines = [CONSOLE_LINE, "something else", JSON_LINE, CONSOLE_LINE]
            (slot_dir / "backend.log").write_text("\n".join(lines) + "\n")
            summary = stack.usage_summary({"model": "real", "slot": 16, "namespace": "t1"}, slot_dir)
        self.assertEqual(summary["calls"], 3)
        haiku = summary["models"]["default"]
        self.assertEqual(haiku["calls"], 2)
        self.assertEqual(haiku["context_input_tokens"], 36772)
        self.assertEqual(haiku["output_tokens"], 26)
        # 8 plain input tokens, 36764 cache writes, 26 output tokens at the Haiku prices.
        self.assertAlmostEqual(haiku["usd"], round((8 * 0.1 + 36764 * 0.2 + 26 * 0.5) / 1e6, 4))
        luna = summary["models"]["luna"]
        self.assertAlmostEqual(luna["usd"], round((400 * 0.1 + 600 * 0.01 + 100 * 0.5) / 1e6, 4))
        self.assertAlmostEqual(summary["usd"], round(haiku["usd"] + luna["usd"], 4), places=4)

    def test_a_stub_stack_has_no_price(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            slot_dir = Path(directory)
            (slot_dir / "backend.log").write_text(CONSOLE_LINE + "\n")
            summary = stack.usage_summary({"model": "stub"}, slot_dir)
        self.assertEqual(summary["calls"], 1)
        self.assertEqual(summary["usd"], 0)
        self.assertNotIn("usd", summary["models"]["default"])


class FakeHomeserver:
    """Joins succeed for invited accounts only; records who invited whom."""

    def __init__(self, invited_rooms: set[str]) -> None:
        self.invited_rooms = set(invited_rooms)
        self.invites: list[tuple[str, str, str | None]] = []

    def matrix(self, _homeserver: str, method: str, path: str, body: object = None, token: str | None = None):
        assert method == "POST"
        if path.startswith("/join/"):
            room = urllib.parse.unquote(path.removeprefix("/join/"))
            return (200, {"room_id": room}) if room in self.invited_rooms else (403, {"errcode": "M_FORBIDDEN"})
        room = urllib.parse.unquote(path.removeprefix("/rooms/").removesuffix("/invite"))
        assert isinstance(body, dict)
        self.invites.append((room, body["user_id"], token))
        self.invited_rooms.add(room)
        return 200, {}


class JoinTests(unittest.TestCase):
    ROOMS = {"lobby": "!lobby:matrix.localhost", "space": "!space:matrix.localhost"}
    TESTER = {"userId": TESTER, "accessToken": "tester-token"}

    def join(self, server: FakeHomeserver, answers: dict) -> bool:
        with mock.patch.object(stack, "matrix", server.matrix), mock.patch.object(stack, "log"):
            return stack.join_rooms("http://hs", self.ROOMS, self.TESTER, "router-token", answers)

    def test_the_router_invites_to_a_space_whose_invite_the_backend_skipped(self) -> None:
        # The lobby's invite arrived, the space's never will: the backend's member list of the space failed.
        server = FakeHomeserver({self.ROOMS["lobby"]})
        answers: dict[str, str] = {}
        self.assertTrue(self.join(server, answers))
        self.assertEqual(server.invites, [(self.ROOMS["space"], TESTER, "router-token")])
        self.assertEqual(answers, {"lobby": "200", "space": "200"})

    def test_nothing_is_invited_while_the_backend_has_not_invited_to_the_lobby(self) -> None:
        server = FakeHomeserver(set())
        answers: dict[str, str] = {}
        self.assertFalse(self.join(server, answers))
        self.assertEqual(server.invites, [])
        self.assertEqual(answers, {"lobby": "403 M_FORBIDDEN"})


class CallsTests(unittest.TestCase):
    SERVICE = "http://127.0.0.1:29521"

    def calls(self, profile: str = "realtime") -> dict | None:
        args = mock.Mock(calls=self.SERVICE + "/", calls_profile=profile)
        return stack.calls_setting(args)

    def test_no_calls_without_the_option(self) -> None:
        self.assertIsNone(stack.calls_setting(mock.Mock(calls=None, calls_profile="realtime")))
        self.assertNotIn("calls:", stack.config_yaml("stub", TESTER, STUB_URL, 0.0003))

    def test_the_helper_answers_calls_on_the_slot_service_with_the_cheap_realtime_model(self) -> None:
        calls = self.calls()
        self.assertEqual(calls, {"serviceUrl": self.SERVICE, "profile": "realtime", "model": "gpt-realtime-2.1-mini"})
        config = stack.config_yaml("stub", TESTER, STUB_URL, 0.0003, calls)
        self.assertIn(f"calls:\n  enabled: true\n  livekit_service_url: {self.SERVICE}\n", config)
        self.assertIn("      backend: realtime\n      model: gpt-realtime-2.1-mini\n", config)
        self.assertIn("      credentials_service: openai\n", config)
        self.assertIn("  agents:\n    helper: voice\n", config)

    def test_the_live_profile_speaks_through_gpt_live(self) -> None:
        config = stack.config_yaml("real", TESTER, STUB_URL, 0.0003, self.calls("live"))
        self.assertIn("      backend: live\n      model: gpt-live-1\n", config)

    def test_the_stub_models_keep_a_key_of_their_own_when_calls_bring_the_real_one(self) -> None:
        config = stack.config_yaml("stub", TESTER, STUB_URL, 0.0003, self.calls())
        # MindRoom gives a model's own key precedence over OPENAI_API_KEY, so the stub never receives the real one.
        self.assertEqual(config.count("      api_key: stub-key-no-model-is-called\n"), 2)

    def test_voice_usage_comes_from_the_session_database(self) -> None:
        # Realtime calls count tokens; GPT-Live bills the call's seconds.
        usage = {
            "kind": "realtime_voice",
            "model": "gpt-realtime-2.1-mini",
            "metrics": {
                "input_tokens": 14392,
                "output_tokens": 542,
                "audio_input_tokens": 52,
                "audio_output_tokens": 355,
            },
            "requests": [{}, {}],
        }
        with tempfile.TemporaryDirectory() as directory:
            slot_dir = Path(directory)
            folder = slot_dir / "storage" / "agents" / "helper" / "sessions"
            folder.mkdir(parents=True)
            with contextlib.closing(sqlite3.connect(folder / "helper.db")) as connection:
                connection.execute("CREATE TABLE helper_sessions_usage (id INTEGER PRIMARY KEY, usage_data TEXT)")
                connection.execute("INSERT INTO helper_sessions_usage (usage_data) VALUES (?)", (json.dumps(usage),))
                connection.execute("INSERT INTO helper_sessions_usage (usage_data) VALUES (?)", ('{"kind": "run"}',))
                live = {"kind": "live_voice", "model": "gpt-live-1", "voice_seconds": 15.94, "voice_finalized": True}
                connection.execute("INSERT INTO helper_sessions_usage (usage_data) VALUES (?)", (json.dumps(live),))
                connection.commit()
            summary = stack.usage_summary({"model": "stub", "calls": self.calls()}, slot_dir)
        self.assertEqual(
            summary["voice"],
            [
                {
                    "kind": "realtime_voice",
                    "model": "gpt-realtime-2.1-mini",
                    "responses": 2,
                    "seconds": 0.0,
                    "input_tokens": 14392,
                    "output_tokens": 542,
                    "cache_read_tokens": 0,
                    "audio_input_tokens": 52,
                    "audio_output_tokens": 355,
                },
                {
                    "kind": "live_voice",
                    "model": "gpt-live-1",
                    "responses": 0,
                    "seconds": 15.9,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cache_read_tokens": 0,
                    "audio_input_tokens": 0,
                    "audio_output_tokens": 0,
                },
            ],
        )


def up_args(**changes: object) -> argparse.Namespace:
    """The arguments of `stack.py <slot> up` without options, with `changes` applied."""
    values = {"model": "stub", "calls": None, "calls_profile": "realtime", "client_sessions": False, "computers": False}
    return argparse.Namespace(**{**values, **changes})


class SlotTests(unittest.TestCase):
    def test_slots_up_to_99_are_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {"E2E_AGENT_STACK_ROOT": directory}):
            for slot, code in (("99", 1), ("100", 2)):
                with mock.patch.object(sys, "argv", ["stack.py", slot, "status"]), contextlib.redirect_stderr(io.StringIO()):
                    try:
                        result = stack.main()
                    except SystemExit as exit_:
                        result = exit_.code
                # 1: no stack runs on the slot; 2: the slot is refused.
                self.assertEqual(result, code, f"slot {slot}")

    def test_no_two_slots_up_to_99_share_a_port(self) -> None:
        self.assertEqual(stack.ports(42), {"matrix": 28142, "app": 4342, "api": 29642, "stub": 29742})
        self.assertEqual(stack.ports(0), {"matrix": 28008, "app": 4200, "api": 29600, "stub": 29700})
        taken = [port for slot in range(100) for port in stack.ports(slot).values()]
        self.assertEqual(len(taken), len(set(taken)))


class OptionTests(unittest.TestCase):
    def settings(self, slot: int, client_sessions: bool, image: str | None = None) -> dict[str, str]:
        return dict(line.split("=", 1) for line in stack.option_env(slot, client_sessions, image))

    def test_client_sessions_admit_the_slot_chat_and_bind_tokens_to_the_api_url(self) -> None:
        settings = self.settings(42, True)
        self.assertEqual(settings.pop("MINDROOM_PUBLIC_URL"), "http://127.0.0.1:29642")
        self.assertEqual(json.loads(settings.pop("MINDROOM_COMPUTER_ALLOWED_ORIGINS")), ["http://127.0.0.1:4342"])
        self.assertEqual(settings, {})
        self.assertEqual(json.loads(self.settings(0, True)["MINDROOM_COMPUTER_ALLOWED_ORIGINS"]), ["http://127.0.0.1:4200"])
        self.assertEqual(stack.option_env(42, False, None), [])

    def test_computers_run_docker_workers_from_the_image_and_admit_the_slot_chat(self) -> None:
        settings = self.settings(42, False, "mindroom-client-e2e-worker:0123456789ab")
        self.assertGreaterEqual(len(settings.pop("MINDROOM_SANDBOX_PROXY_TOKEN")), 32)
        self.assertEqual(json.loads(settings.pop("MINDROOM_COMPUTER_ALLOWED_ORIGINS")), ["http://127.0.0.1:4342"])
        self.assertEqual(
            settings,
            {
                "MINDROOM_PUBLIC_URL": "http://127.0.0.1:29642",
                "MINDROOM_WORKER_BACKEND": "docker",
                "MINDROOM_DOCKER_WORKER_IMAGE": "mindroom-client-e2e-worker:0123456789ab",
                "MINDROOM_DOCKER_WORKER_SECURITY_POLICY": "computer",
                "MINDROOM_WORKER_COMPUTER_ENABLED": "true",
            },
        )

    def test_computers_give_the_helper_a_worker_browser_and_keep_other_tools_on_the_backend(self) -> None:
        config = stack.config_yaml("stub", TESTER, STUB_URL, 0.0003, computers=True)
        helper, scout = config.split("  helper:\n", 1)[1].split("  scout:\n", 1)
        self.assertIn("      - browser_mcp\n", helper)
        self.assertIn("    tools: [shell]\n", scout)
        self.assertIn("defaults:\n  markdown: true\n  worker_tools: [browser_mcp]\n  worker_scope: user_agent\n", config)
        plain = stack.config_yaml("stub", TESTER, STUB_URL, 0.0003)
        self.assertNotIn("browser_mcp", plain)
        self.assertNotIn("worker_", plain)

    def test_a_running_stack_is_reused_only_with_the_options_it_started_with(self) -> None:
        sha, homeserver = "a" * 40, "http://127.0.0.1:28142"
        state = {"model": "stub", "calls": None, "sha": sha, "homeserver": homeserver}
        sessions = {**state, "clientSessions": True, "computers": False}
        self.assertTrue(stack.started_with(sessions, up_args(client_sessions=True), sha, homeserver))
        self.assertFalse(stack.started_with(sessions, up_args(), sha, homeserver))
        self.assertFalse(stack.started_with(sessions, up_args(client_sessions=True, computers=True), sha, homeserver))
        self.assertFalse(stack.started_with(sessions, up_args(client_sessions=True), "b" * 40, homeserver))


# Stands in for the docker CLI: logs each call, keeps the build context, and builds once unless told to fail.
FAKE_DOCKER = """#!/bin/sh
echo "$*" >> "$FAKE_DOCKER_DIR/docker.log"
case "$1" in
  image) test -e "$FAKE_DOCKER_DIR/built" ;;
  build)
    cat > "$FAKE_DOCKER_DIR/context.tar"
    if [ -n "$FAKE_DOCKER_FAIL" ]; then echo "$FAKE_DOCKER_FAIL" >&2; exit 1; fi
    touch "$FAKE_DOCKER_DIR/built" ;;
esac
"""


class WorkerImageTests(unittest.TestCase):
    DOCKERFILE = "local/instances/deploy/Dockerfile.mindroom"

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.checkout = self.root / "mindroom"
        (self.checkout / self.DOCKERFILE).parent.mkdir(parents=True)
        (self.checkout / self.DOCKERFILE).write_text("FROM scratch\n")
        git = ["git", "-C", str(self.checkout), "-c", "user.name=Test", "-c", "user.email=test@example.org"]
        for command in (["init", "-q"], ["add", "."], ["-c", "commit.gpgsign=false", "commit", "-qm", "worker"]):
            subprocess.run([*git, *command], check=True)
        self.sha = subprocess.run([*git, "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
        (self.root / "bin").mkdir()
        (self.root / "bin" / "docker").write_text(FAKE_DOCKER)
        (self.root / "bin" / "docker").chmod(0o755)
        environment = {
            "PATH": f"{self.root / 'bin'}:{os.environ['PATH']}",
            "E2E_AGENT_STACK_ROOT": str(self.root / "stacks"),
            "FAKE_DOCKER_DIR": str(self.root),
        }
        for patcher in (mock.patch.dict(os.environ, environment), mock.patch.object(stack, "log")):
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_the_image_of_a_commit_is_built_once_from_its_archive(self) -> None:
        tag = f"mindroom-client-e2e-worker:{self.sha[:12]}"
        self.assertEqual(stack.worker_image(self.checkout, self.sha), tag)
        self.assertEqual(stack.worker_image(self.checkout, self.sha), tag)
        self.assertEqual(
            (self.root / "docker.log").read_text().splitlines(),
            [f"image inspect {tag}", f"build --quiet --tag {tag} --file {self.DOCKERFILE} -", f"image inspect {tag}"],
        )
        with tarfile.open(self.root / "context.tar") as context:
            self.assertIn(self.DOCKERFILE, context.getnames())

    def test_a_failed_build_stops_the_start_with_its_error(self) -> None:
        with mock.patch.dict(os.environ, {"FAKE_DOCKER_FAIL": "no space left on device"}):
            with self.assertRaises(stack.StackError) as raised:
                stack.worker_image(self.checkout, self.sha)
        self.assertIn("no space left on device", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
