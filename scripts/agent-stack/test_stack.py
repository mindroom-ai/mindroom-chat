"""Tests of scripts/agent-stack/stack.py and stub_model.py that need no backend."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import io
import json
import os
import signal
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

# The stub runs in the backend's environment, which has aiohttp; these tests reach it through a stand-in.
with mock.patch.dict(sys.modules, {"aiohttp": mock.MagicMock()}):
    import stub_model  # noqa: E402

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
    values = {
        "model": "stub",
        "calls": None,
        "calls_profile": "realtime",
        "client_sessions": False,
        "computers": False,
        "approval_expiry_days": 0.0003,
    }
    return argparse.Namespace(**{**values, **changes})


class CommandLineTests(unittest.TestCase):
    def setUp(self) -> None:
        # main() installs its own SIGTERM handler; the tests after these get the earlier one back.
        self.addCleanup(signal.signal, signal.SIGTERM, signal.getsignal(signal.SIGTERM))
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        # A real model or plugin directories that the shell running the tests sets stay out of them.
        environment = {"E2E_AGENT_STACK_ROOT": directory.name, "E2E_AGENT_MODEL": "", "E2E_PLUGIN_DIRS": ""}
        patcher = mock.patch.dict(os.environ, environment)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.root = Path(directory.name)
        self.slot_dir = self.root / "slot-7"
        # The usual umask, which lets other users read what a process writes; the tests after these get theirs back.
        self.addCleanup(os.umask, os.umask(0o022))

    def main(self, *argv: str) -> object:
        self.stderr = io.StringIO()
        with (
            mock.patch.object(sys, "argv", ["stack.py", *argv]),
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(self.stderr),
        ):
            try:
                return stack.main()
            except SystemExit as exit_:
                return exit_.code

    def test_slots_up_to_99_are_accepted(self) -> None:
        # 1: no stack runs on the slot; 2: the slot is refused.
        self.assertEqual(self.main("99", "status"), 1)
        self.assertEqual(self.main("100", "status"), 2)

    def test_computers_bring_the_client_session_settings(self) -> None:
        with mock.patch.object(stack, "up", return_value={}) as up:
            self.assertEqual(self.main("5", "up", "--computers"), 0)
        self.assertTrue(up.call_args.args[1].client_sessions)

    def mode(self, path: Path) -> int:
        return path.stat().st_mode & 0o777

    def found_homeserver_and_checkout(self) -> contextlib.ExitStack:
        patches = contextlib.ExitStack()
        patches.enter_context(mock.patch.object(stack, "resolve_checkout", return_value=Path("/mindroom")))
        patches.enter_context(mock.patch.object(stack, "resolve_commit", return_value="a" * 40))
        patches.enter_context(mock.patch.object(stack, "http_json", return_value=(200, {})))
        return patches

    def starting(self) -> contextlib.ExitStack:
        """A start whose processes never run but whose every wait finds the backend's accounts and rooms."""
        accounts = {
            f"agent_{name}": {"username": f"mindroom_{name}", "domain": "matrix.localhost", "access_token": "token"}
            for name in ("router", "helper", "scout")
        }
        backend_state = {"rooms": {"lobby": {"room_id": "!lobby"}}, "space_room_id": "!space", "accounts": accounts}
        patches = self.found_homeserver_and_checkout()
        patches.enter_context(mock.patch.object(stack, "prepare_source", return_value=Path("/mindroom-source")))
        account = {"user_id": TESTER, "access_token": "tester-token"}
        self.register = patches.enter_context(mock.patch.object(stack, "register", return_value=account))
        patches.enter_context(mock.patch.object(stack, "matrix", return_value=(200, {})))
        patches.enter_context(mock.patch.object(stack, "start_process", return_value=0))
        patches.enter_context(mock.patch.object(stack, "wait_until", return_value=backend_state))
        return patches

    def test_a_new_slot_without_keys_and_its_files_are_the_owners_only(self) -> None:
        with self.starting():
            self.assertEqual(self.main("7", "up"), 0)
        self.assertEqual(self.mode(self.slot_dir), 0o700)
        for name in ("state.json", ".env", "config.yaml"):
            self.assertEqual(self.mode(self.slot_dir / name), 0o600, name)

    def test_each_start_signs_the_test_account_up_with_a_password_of_its_own(self) -> None:
        passwords = []
        for _ in range(2):
            # The second start finds the first one's processes gone, so it starts again.
            with self.starting():
                self.assertEqual(self.main("7", "up"), 0)
            password = self.register.call_args.args[2]
            self.assertEqual(stack.read_state(self.slot_dir)["tester"]["password"], password)
            passwords.append(password)
        self.assertGreaterEqual(len(passwords[0]), 32)
        self.assertNotEqual(passwords[0], passwords[1])

    def test_a_slot_an_older_start_left_readable_becomes_the_owners_only(self) -> None:
        self.slot_dir.mkdir()
        (self.slot_dir / "state.json").write_text("{}")
        for command in ("up", "status"):
            self.slot_dir.chmod(0o755)
            with (
                self.found_homeserver_and_checkout(),
                mock.patch.object(stack, "running", return_value=True),
                mock.patch.object(stack, "started_with", return_value=True),
                mock.patch.object(stack, "token_is_valid", return_value=True),
            ):
                self.assertEqual(self.main("7", command), 0, command)
            self.assertEqual(self.mode(self.slot_dir), 0o700, command)

    def test_a_missing_root_is_made_the_owners_only(self) -> None:
        root = self.root / "new" / "agents"
        with mock.patch.dict(os.environ, {"E2E_AGENT_STACK_ROOT": str(root)}):
            self.assertEqual(self.main("7", "status"), 1)
        self.assertEqual(self.mode(root), 0o700)

    def test_a_root_that_is_a_symlink_another_users_or_writable_by_others_is_refused_untouched(self) -> None:
        target = self.root / "target"
        target.mkdir(mode=0o700)
        (self.root / "link").symlink_to(target)
        (self.root / "file").touch(mode=0o600)
        roots = {
            "a symlink": (self.root / "link", 0o700, os.geteuid()),
            "a file": (self.root / "file", 0o700, os.geteuid()),
            "another user's": (target, 0o700, os.geteuid() + 1),
            "writable by its group": (target, 0o770, os.geteuid()),
            "writable by others": (target, 0o707, os.geteuid()),
        }
        for name, (root, mode, user) in roots.items():
            target.chmod(mode)
            with (
                self.subTest(name),
                mock.patch.dict(os.environ, {"E2E_AGENT_STACK_ROOT": str(root)}),
                mock.patch.object(os, "geteuid", return_value=user),
            ):
                self.assertEqual(self.main("7", "status"), 1)
                self.assertIn(f"refusing {root}:", self.stderr.getvalue())
                self.assertEqual(list(target.iterdir()), [])


class SlotTests(unittest.TestCase):
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
        settings = self.settings(42, True, "mindroom-client-e2e-worker:0123456789ab")
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
        state = {
            "model": "stub",
            "calls": None,
            "sha": sha,
            "homeserver": homeserver,
            "approvalExpiryDays": 0.0003,
        }
        sessions = {**state, "clientSessions": True, "computers": False}
        # A stack that the script started before these options is one without them.
        self.assertTrue(stack.started_with(state, up_args(), sha, homeserver))
        self.assertTrue(stack.started_with(sessions, up_args(client_sessions=True), sha, homeserver))
        self.assertFalse(stack.started_with(sessions, up_args(), sha, homeserver))
        self.assertFalse(stack.started_with(sessions, up_args(client_sessions=True, computers=True), sha, homeserver))
        self.assertFalse(stack.started_with(sessions, up_args(client_sessions=True, model="real"), sha, homeserver))
        calls = up_args(client_sessions=True, calls="http://127.0.0.1:29542")
        self.assertFalse(stack.started_with(sessions, calls, sha, homeserver))
        self.assertFalse(stack.started_with(sessions, up_args(client_sessions=True), "b" * 40, homeserver))
        self.assertFalse(stack.started_with(sessions, up_args(client_sessions=True), sha, "http://127.0.0.1:28143"))
        longer_expiry = up_args(client_sessions=True, approval_expiry_days=0.001)
        self.assertFalse(stack.started_with(sessions, longer_expiry, sha, homeserver))
        # 0.000301 days is 26 s too, rounded, but the backend's config would differ.
        nearly_the_same = up_args(client_sessions=True, approval_expiry_days=0.000301)
        self.assertFalse(stack.started_with(sessions, nearly_the_same, sha, homeserver))


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
        self.sha = stack.git(self.checkout, "rev-parse", "HEAD")
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


SAMPLE_PLUGIN = stack.REPOSITORY / "e2e" / "fixtures" / "sample-plugin"
SAMPLE_SCENARIOS = SAMPLE_PLUGIN / "e2e" / "stub-scenarios.json"

# Stands in for the backend's `mindroom` command: `plugins check --json <dir>` answers what the directory's
# check.json says, on stdout, with the exit code in check.code (MindRoom's own: 0 compatible, 1 failed).
FAKE_MINDROOM = """#!/bin/sh
echo "$* ${OPENAI_API_KEY:-without keys}" >> "$(dirname "$0")/mindroom.log"
cat "$4/check.json"
exit "$(cat "$4/check.code")"
"""


class PluginDirTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.venv_bin = self.root / "bin"
        self.venv_bin.mkdir()
        (self.venv_bin / "mindroom").write_text(FAKE_MINDROOM)
        (self.venv_bin / "mindroom").chmod(0o755)

    def plugin(self, name: str, report: dict, code: int = 0, scenarios: bool = False) -> Path:
        directory = self.root / name
        (directory / "e2e").mkdir(parents=True)
        (directory / "mindroom.plugin.json").write_text(json.dumps({"name": name}))
        (directory / "check.json").write_text(json.dumps(report))
        (directory / "check.code").write_text(str(code))
        if scenarios:
            (directory / "e2e" / "stub-scenarios.json").write_text("{}")
        return directory

    def test_the_directories_come_from_the_environment_relative_to_this_repository(self) -> None:
        value = os.pathsep.join(["e2e/fixtures/sample-plugin", str(self.root), ""])
        with mock.patch.dict(os.environ, {"E2E_PLUGIN_DIRS": value}):
            self.assertEqual(stack.plugin_dir_paths(), [SAMPLE_PLUGIN, self.root.resolve()])
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(stack.plugin_dir_paths(), [])

    def test_a_checked_plugin_brings_its_name_tools_and_scenarios(self) -> None:
        report = {"status": "compatible", "name": "greeter", "tools": ["greeter"], "hooks": [], "skills": []}
        greeter = self.plugin("greeter", report, scenarios=True)
        pages_only = self.root / "pages-only"
        (pages_only / "e2e" / "fixtures").mkdir(parents=True)
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test-secret"}):
            checked = stack.check_plugin_dirs(self.venv_bin, [greeter, pages_only])
        self.assertEqual(
            checked,
            [
                {
                    "dir": str(greeter),
                    "plugin": "greeter",
                    "tools": ["greeter"],
                    "scenarios": str(greeter / "e2e" / "stub-scenarios.json"),
                },
                {"dir": str(pages_only), "plugin": None, "tools": [], "scenarios": None},
            ],
        )
        # Only the directory with a plugin is checked, and the provider keys stay out of the check.
        log = (self.venv_bin / "mindroom.log").read_text()
        self.assertEqual(log, f"plugins check --json {greeter} without keys\n")

    def test_a_plugin_that_fails_its_check_refuses_the_start_with_the_detail(self) -> None:
        broken = self.plugin("broken", {"status": "failed", "detail": "Plugin module not found: tools.py"}, 1)
        with self.assertRaises(stack.StackError) as raised:
            stack.check_plugin_dirs(self.venv_bin, [broken])
        self.assertEqual(
            str(raised.exception),
            f"the plugin in {broken} failed `mindroom plugins check`: Plugin module not found: tools.py",
        )

    def test_a_check_without_json_refuses_the_start_with_its_error(self) -> None:
        # A MindRoom from before `plugins check --json` prints a usage error on stderr only.
        (self.venv_bin / "mindroom").write_text("#!/bin/sh\necho \"No such option: --json\" >&2\nexit 2\n")
        old = self.plugin("old", {})
        with self.assertRaises(stack.StackError) as raised:
            stack.check_plugin_dirs(self.venv_bin, [old])
        self.assertIn("failed `mindroom plugins check`: No such option: --json", str(raised.exception))

    def test_a_directory_that_is_not_there_refuses_the_start(self) -> None:
        with self.assertRaises(stack.StackError) as raised:
            stack.check_plugin_dirs(self.venv_bin, [self.root / "missing"])
        self.assertIn("E2E_PLUGIN_DIRS names", str(raised.exception))

    def test_the_backend_loads_the_plugins_and_the_helper_offers_their_tools(self) -> None:
        plugin_dirs = [
            {"dir": "/plugins/greeter", "plugin": "greeter", "tools": ["greeter", "waver"], "scenarios": None},
            {"dir": "/plugins/pages", "plugin": None, "tools": [], "scenarios": None},
        ]
        config = stack.config_yaml("stub", TESTER, STUB_URL, 0.0003, plugin_dirs=plugin_dirs)
        self.assertIn('\nplugins:\n  - path: "/plugins/greeter"\n', config)
        self.assertNotIn("/plugins/pages", config)
        helper, scout = config.split("  helper:\n", 1)[1].split("  scout:\n", 1)
        self.assertIn("          enable_show_canvas: true\n      - greeter\n      - waver\n", helper)
        self.assertIn("    tools: [shell]\n\nrouter:", scout)
        self.assertNotIn("plugins:", stack.config_yaml("stub", TESTER, STUB_URL, 0.0003))

    def test_a_running_stack_is_reused_only_with_the_plugin_dirs_it_started_with(self) -> None:
        sha, homeserver = "a" * 40, "http://127.0.0.1:28142"
        plugin_dirs = [{"dir": "/plugins/greeter", "plugin": "greeter", "tools": ["greeter"], "scenarios": None}]
        state = {
            "model": "stub",
            "calls": None,
            "approvalExpiryDays": 0.0003,
            "sha": sha,
            "homeserver": homeserver,
            "pluginDirs": plugin_dirs,
        }
        self.assertTrue(stack.started_with(state, up_args(), sha, homeserver, plugin_dirs))
        self.assertFalse(stack.started_with(state, up_args(), sha, homeserver))
        grown = [{**plugin_dirs[0], "tools": ["greeter", "waver"]}]
        self.assertFalse(stack.started_with(state, up_args(), sha, homeserver, grown))
        without = {key: value for key, value in state.items() if key != "pluginDirs"}
        self.assertTrue(stack.started_with(without, up_args(), sha, homeserver))
        self.assertFalse(stack.started_with(without, up_args(), sha, homeserver, plugin_dirs))

    def test_a_broken_plugin_leaves_the_running_stack_alone(self) -> None:
        with (
            mock.patch.dict(os.environ, {"E2E_PLUGIN_DIRS": str(self.root), "E2E_AGENT_STACK_ROOT": str(self.root)}),
            mock.patch.object(stack, "resolve_checkout", return_value=self.root),
            mock.patch.object(stack, "http_json", return_value=(200, {})),
            mock.patch.object(stack, "resolve_commit", return_value="a" * 40),
            mock.patch.object(stack, "prepare_source", return_value=self.root) as prepare,
            mock.patch.object(stack, "check_plugin_dirs", side_effect=stack.StackError("broken")) as check,
            mock.patch.object(stack, "stop") as stop,
            mock.patch.object(stack, "start") as start,
        ):
            with self.assertRaises(stack.StackError):
                stack.up(42, up_args(calls="http://127.0.0.1:29542", computers=True, checkout=None, ref=None))
        prepare.assert_called_once_with(self.root, "a" * 40, ("matrix_calls", "docker"))
        check.assert_called_once_with(self.root / ".venv" / "bin", [self.root.resolve()])
        stop.assert_not_called()
        start.assert_not_called()


TOOLS = [{"type": "function", "function": {"name": "sample_greet"}}]


def chat(text: str, *later: dict) -> dict:
    """A request whose person wrote `text`, with the sample plugin's tool, followed by `later` messages."""
    return {"model": "stub-fast", "messages": [{"role": "user", "content": text}, *later], "tools": TOOLS}


class StubScenarioTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def scenarios(self, content: object) -> Path:
        path = self.root / f"scenarios-{len(list(self.root.iterdir()))}.json"
        path.write_text(content if isinstance(content, str) else json.dumps(content))
        return path

    def test_a_file_adds_scenarios_next_to_the_built_in_ones(self) -> None:
        override = self.scenarios({"#SHELL": [["run_shell_command", {"args": "echo replaced"}]]})
        scenarios = stub_model.tool_scenarios([SAMPLE_SCENARIOS, override])
        self.assertEqual(scenarios["#samplegreet"], [("sample_greet", {"name": "Ada"})])
        self.assertEqual(scenarios["#shell"], [("run_shell_command", {"args": "echo replaced"})])
        self.assertEqual(scenarios["#multi"], stub_model.TOOL_SCENARIOS["#multi"])

    def test_a_file_scenario_calls_its_tool_and_then_reports_the_result(self) -> None:
        scenarios = stub_model.tool_scenarios([SAMPLE_SCENARIOS])
        self.assertEqual(
            stub_model.plan(chat("please #samplegreet"), scenarios), ("tool", "sample_greet", {"name": "Ada"})
        )
        # A file's hashtag in the latest message decides over a built-in one earlier in the turn.
        turn = chat("#shell", {"role": "user", "content": "now #samplegreet"})
        self.assertEqual(stub_model.plan(turn, scenarios), ("tool", "sample_greet", {"name": "Ada"}))
        result = {"role": "tool", "content": "Hello Ada, from the sample plugin"}
        kind, text = stub_model.plan(chat("please #samplegreet", result), scenarios)
        self.assertEqual(kind, "text")
        self.assertIn("Finished **samplegreet** after 1 tool call(s)", text)
        self.assertIn("Hello Ada, from the sample plugin", text)

    def test_a_hashtag_matches_only_whole(self) -> None:
        greet = self.scenarios(
            {"#greet": [["sample_greet", {"name": "Ada"}]], "#greet2": [["sample_greet", {"name": "Bob"}]]}
        )
        shell = self.scenarios({"#shell-check": [["sample_greet", {"name": "Cy"}]]})
        scenarios = stub_model.tool_scenarios([greet, shell])
        for text, name in (("#greet2", "Bob"), ("#greet, please", "Ada"), ("run #shell-check", "Cy")):
            self.assertEqual(stub_model.plan(chat(text), scenarios), ("tool", "sample_greet", {"name": name}), text)

    def test_a_broken_file_is_named(self) -> None:
        for content in ("{not json", [["#a"]], {"#a": [["only-a-name"]]}, {"#a": 5}):
            path = self.scenarios(content)
            with self.assertRaises(ValueError) as raised:
                stub_model.tool_scenarios([path])
            self.assertTrue(str(raised.exception).startswith(f"{path}: "), raised.exception)
        with self.assertRaises(ValueError):
            stub_model.tool_scenarios([self.root / "missing.json"])

    def answer(self, scenario_files: list[Path], body: dict) -> dict:
        """The stub's non-streamed answer to `body`, as it hands it to aiohttp."""
        stub = stub_model.Stub(self.root / "requests.jsonl", scenario_files)
        request = mock.Mock(json=mock.AsyncMock(return_value=body))
        with mock.patch.object(stub_model, "web") as web:
            asyncio.run(stub.completions(request))
        return web.json_response.call_args.args[0]["choices"][0]["message"]

    def test_the_stub_answers_with_the_scenarios_of_its_files(self) -> None:
        message = self.answer([SAMPLE_SCENARIOS], chat("#samplegreet"))
        self.assertEqual(message["tool_calls"][0]["function"]["name"], "sample_greet")

    def test_the_stub_says_in_its_reply_that_a_file_is_broken(self) -> None:
        broken = self.scenarios("{not json")
        message = self.answer([broken], chat("#samplegreet"))
        self.assertTrue(message["content"].startswith(f"The stub could not read its scenarios: {broken}: "))


if __name__ == "__main__":
    unittest.main()
