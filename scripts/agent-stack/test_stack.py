"""Tests of scripts/agent-stack/stack.py and stub_model.py that need no backend, and of the e2e scripts' private
directories (scripts/private-dir.sh) and slot teardown (scripts/e2e-slot.sh)."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import io
import json
import os
import shutil
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
        for tag in ("#slow", "#stopme", "#long", "#multi", "#pause", "#approve", "#title", "#tag", "#expire", "#job"):
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


def checked_dir(directory: str, **fields: object) -> dict:
    """A plugin directory as check_plugin_dirs records it, with nothing in it but `fields`."""
    empty = {"plugin": None, "tools": [], "scenarios": None, "scenarioModule": None, "origins": False}
    return {"dir": directory, **empty, **fields}


def up_args(**changes: object) -> argparse.Namespace:
    """The arguments of `stack.py <slot> up` without options, with `changes` applied."""
    values = {
        "model": "stub",
        "calls": None,
        "calls_profile": "realtime",
        "client_sessions": False,
        "computers": False,
        "computer_image": None,
        "computer_tools": "browser_mcp",
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
        environment = {
            "E2E_AGENT_STACK_ROOT": directory.name,
            "E2E_AGENT_MODEL": "",
            "E2E_PLUGIN_DIRS": "",
            "E2E_COMPUTER_IMAGE": "",
        }
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

    def up_args_of(self, *argv: str) -> argparse.Namespace:
        """The arguments that `stack.py 5 up <argv>` starts the stack with."""
        with mock.patch.object(stack, "up", return_value={}) as up:
            self.assertEqual(self.main("5", "up", *argv), 0)
        return up.call_args.args[1]

    def test_computers_bring_the_client_session_settings(self) -> None:
        self.assertTrue(self.up_args_of("--computers").client_sessions)

    def computers_of(self, *argv: str) -> dict | None:
        """The computers that `stack.py 5 up <argv>` asks for."""
        return stack.computers_setting(self.up_args_of(*argv), "0123456789abcdef")

    def test_computers_run_the_browser_in_a_worker_of_the_image_built_from_the_commit(self) -> None:
        self.assertIsNone(self.computers_of())
        built = {"image": "mindroom-client-e2e-worker:0123456789ab", "tools": ["browser_mcp"]}
        self.assertEqual(self.computers_of("--computers"), built)
        # An image from the environment applies only to a stack with computers.
        with mock.patch.dict(os.environ, {"E2E_COMPUTER_IMAGE": "worker:env"}):
            self.assertIsNone(self.computers_of())
            self.assertEqual(self.computers_of("--computers")["image"], "worker:env")

    def test_a_given_image_and_tools_replace_the_built_image_and_the_browser_alone(self) -> None:
        computers = self.computers_of("--computers", "--computer-image", "worker:given", "--computer-tools", "browser_mcp,shell")
        self.assertEqual(computers, {"image": "worker:given", "tools": ["browser_mcp", "shell"]})

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
        self.start_process = patches.enter_context(mock.patch.object(stack, "start_process", return_value=0))
        patches.enter_context(mock.patch.object(stack, "wait_until", return_value=backend_state))
        return patches

    def test_a_new_slot_without_keys_and_its_files_are_the_owners_only(self) -> None:
        with self.starting():
            self.assertEqual(self.main("7", "up"), 0)
        self.assertEqual(self.mode(self.slot_dir), 0o700)
        for name in ("state.json", ".env", "config.yaml"):
            self.assertEqual(self.mode(self.slot_dir / name), 0o600, name)

    def started_env_and_state(self, *plugin_dirs: dict) -> tuple[dict[str, str], dict]:
        """The backend's .env settings and the state of a start with these checked plugin directories."""
        with (
            self.starting(),
            mock.patch.dict(os.environ, {"E2E_PLUGIN_DIRS": "/plugins"}),
            mock.patch.object(stack, "check_plugin_dirs", return_value=list(plugin_dirs)),
        ):
            self.assertEqual(self.main("7", "up"), 0)
        return self.slot_env(), stack.read_state(self.slot_dir)

    def slot_env(self) -> dict[str, str]:
        """The backend's .env settings of the slot's last start."""
        return dict(line.split("=", 1) for line in (self.slot_dir / ".env").read_text().splitlines() if line)

    def test_a_plugin_with_origins_turns_the_backend_origins_on_at_the_slot_port(self) -> None:
        apps = checked_dir("/plugins/apps", plugin="apps", origins=True)
        greeter = checked_dir("/plugins/greeter", plugin="greeter")
        env, state = self.started_env_and_state(greeter, apps)
        self.assertEqual(env["MINDROOM_PLUGIN_ORIGIN_PORT"], "29807")
        self.assertEqual(state["pluginOriginPort"], 29807)
        # Plugins without an origin_module leave origins off.
        env, state = self.started_env_and_state(greeter)
        self.assertNotIn("MINDROOM_PLUGIN_ORIGIN_PORT", env)
        self.assertIsNone(state["pluginOriginPort"])

    def test_the_stub_plays_the_scenario_files_and_modules_of_the_plugin_dirs(self) -> None:
        greeter = checked_dir(
            "/plugins/greeter",
            plugin="greeter",
            tools=["greeter"],
            scenarios="/plugins/greeter/e2e/stub-scenarios.json",
            scenarioModule="/plugins/greeter/e2e/stub_scenarios.py",
        )
        pages = checked_dir("/plugins/pages", scenarioModule="/plugins/pages/e2e/stub_scenarios.py")
        _, state = self.started_env_and_state(greeter, pages)
        stub = next(call.args[0] for call in self.start_process.call_args_list if "--log" in call.args[0])
        self.assertEqual(
            stub[stub.index("--tag") + 2 :],
            [
                "--scenarios",
                "/plugins/greeter/e2e/stub-scenarios.json",
                "--scenario-module",
                "/plugins/greeter/e2e/stub_scenarios.py",
                "--scenario-module",
                "/plugins/pages/e2e/stub_scenarios.py",
            ],
        )
        self.assertEqual(state["pluginDirs"], [greeter, pages])

    def started_with_computers(self, *argv: str) -> tuple[dict[str, str], dict, mock.Mock]:
        """The backend's .env settings, the state and the image build of a start with computers; the containers
        of an earlier start are never looked for, since this machine's Docker may run a real slot 7."""
        with (
            self.starting(),
            mock.patch.object(stack, "build_worker_image") as build,
            mock.patch.object(stack, "remove_workers"),
        ):
            self.assertEqual(self.main("7", "up", "--computers", *argv), 0)
        return self.slot_env(), stack.read_state(self.slot_dir), build

    def test_computers_build_their_image_from_the_commit_unless_one_is_given(self) -> None:
        tag = f"mindroom-client-e2e-worker:{'a' * 12}"
        env, state, build = self.started_with_computers()
        build.assert_called_once_with(Path("/mindroom"), "a" * 40, tag)
        self.assertEqual(env["MINDROOM_DOCKER_WORKER_IMAGE"], tag)
        self.assertEqual(state["computers"], {"image": tag, "tools": ["browser_mcp"]})
        env, state, build = self.started_with_computers("--computer-image", "worker:given")
        build.assert_not_called()
        self.assertEqual(env["MINDROOM_DOCKER_WORKER_IMAGE"], "worker:given")
        self.assertEqual(state["computers"], {"image": "worker:given", "tools": ["browser_mcp"]})

    def fake_docker(self, rm_error: str = "") -> Path:
        """A docker CLI on PATH that logs each call, lists two containers and fails `rm` with `rm_error`; returns its
        log."""
        bin_dir = self.root / "bin"
        bin_dir.mkdir(exist_ok=True)
        docker = bin_dir / "docker"
        fail = f'[ "$1" = rm ] && echo "{rm_error}" >&2 && exit 1\n' if rm_error else ""
        docker.write_text(f'#!/bin/sh\necho "$*" >> "$0.log"\n{fail}[ "$1" = ps ] && printf \'c1\\nc2\\n\'\nexit 0\n')
        docker.chmod(0o755)
        patcher = mock.patch.dict(os.environ, {"PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}"})
        patcher.start()
        self.addCleanup(patcher.stop)
        return bin_dir / "docker.log"

    def test_down_removes_the_worker_containers_of_the_slot_by_its_label(self) -> None:
        calls = self.fake_docker()
        self.slot_dir.mkdir(mode=0o700)
        computers = {"image": "worker:given", "tools": ["browser_mcp"]}
        (self.slot_dir / "state.json").write_text(json.dumps({"slot": 7, "computers": computers}))
        self.assertEqual(self.main("7", "down"), 0)
        self.assertEqual(
            calls.read_text().splitlines(),
            ["ps --all --quiet --filter label=mindroom-client-e2e.slot=7", "rm --force c1 c2"],
        )
        self.assertFalse(self.slot_dir.exists())

    def test_a_failed_removal_keeps_the_slot_so_down_can_try_again(self) -> None:
        self.fake_docker("Cannot connect to the Docker daemon")
        self.slot_dir.mkdir(mode=0o700)
        computers = {"image": "worker:given", "tools": ["browser_mcp"]}
        (self.slot_dir / "state.json").write_text(json.dumps({"slot": 7, "computers": computers}))
        self.assertEqual(self.main("7", "down"), 1)
        self.assertIn("Cannot connect to the Docker daemon", self.stderr.getvalue())
        self.assertTrue((self.slot_dir / "state.json").exists())
        calls = self.fake_docker()
        self.assertEqual(self.main("7", "down"), 0)
        self.assertIn("rm --force c1 c2", calls.read_text().splitlines())
        self.assertFalse(self.slot_dir.exists())

    def test_down_of_a_stack_without_computers_leaves_docker_alone(self) -> None:
        calls = self.fake_docker()
        self.slot_dir.mkdir(mode=0o700)
        (self.slot_dir / "state.json").write_text(json.dumps({"slot": 7, "computers": None}))
        self.assertEqual(self.main("7", "down"), 0)
        self.assertFalse(calls.exists())

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

    def test_a_missing_root_is_made_the_owners_only_whatever_the_umask(self) -> None:
        root = self.root / "new" / "agents"
        # A umask that lets the group write, as many systems give their users.
        os.umask(0o002)
        with mock.patch.dict(os.environ, {"E2E_AGENT_STACK_ROOT": str(root)}):
            self.assertEqual(stack.stack_root(), root)
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


class PrivateDirTests(unittest.TestCase):
    """scripts/private-dir.sh, which checks the e2e scripts' roots as stack_root() checks this script's."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        # A umask that lets the group write, as many systems give their users.
        self.addCleanup(os.umask, os.umask(0o002))

    def private_dir(self, path: str) -> subprocess.CompletedProcess:
        helper = Path(__file__).resolve().parents[1] / "private-dir.sh"
        command = 'set -euo pipefail; . "$1"; private_dir "$2"'
        return subprocess.run(["bash", "-c", command, "test", helper, path], capture_output=True, text=True)

    def test_a_missing_root_and_its_missing_parents_are_made_the_owners_only_whatever_the_umask(self) -> None:
        self.root.chmod(0o755)
        root = self.root / "new" / "e2e"
        self.assertEqual(self.private_dir(f"{root}/").returncode, 0)
        self.assertEqual(root.stat().st_mode & 0o777, 0o700)
        self.assertEqual(root.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.root.stat().st_mode & 0o777, 0o755, "a parent that was there stays as it was")

    def test_a_missing_root_under_a_default_acl_is_still_the_owners_only(self) -> None:
        # A default ACL replaces the umask for what is created under it.
        setfacl = ["setfacl", "-d", "-m", "g::rwx,o::rwx", str(self.root)]
        if not shutil.which("setfacl") or subprocess.run(setfacl, capture_output=True, check=False).returncode:
            self.skipTest("needs setfacl and a file system with ACLs")
        root = self.root / "e2e"
        self.assertEqual(self.private_dir(str(root)).returncode, 0)
        self.assertEqual(root.stat().st_mode & 0o777, 0o700)

    def test_a_root_that_is_a_symlink_another_users_or_writable_by_others_is_refused_untouched(self) -> None:
        target = self.root / "target"
        target.mkdir(mode=0o700)
        (self.root / "link").symlink_to(target)
        (self.root / "file").touch(mode=0o600)
        roots = {
            "a symlink": (f"{self.root}/link", 0o700),
            "a symlink with a trailing slash": (f"{self.root}/link//", 0o700),
            "a file": (f"{self.root}/file", 0o700),
            "writable by its group": (str(target), 0o770),
            "writable by others": (str(target), 0o707),
        }
        if os.geteuid() != 0:
            roots["another user's"] = ("/usr", 0o700)
        for name, (root, mode) in roots.items():
            target.chmod(mode)
            with self.subTest(name):
                result = self.private_dir(root)
                self.assertEqual(result.returncode, 1)
                self.assertIn(root.rstrip("/"), result.stderr)
                self.assertEqual(list(target.iterdir()), [])
        target.chmod(0o755)
        self.assertEqual(self.private_dir(str(target)).returncode, 0, "a directory others may only read")


class SlotTeardownTests(unittest.TestCase):
    """scripts/e2e-slot.sh stops the slot's agent stack with the homeserver of a --fresh run."""

    def test_a_refused_agent_stack_root_is_named(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            # A stand-in for Docker that starts and stops nothing.
            (tmp / "bin").mkdir()
            docker = tmp / "bin" / "docker"
            docker.write_text("#!/bin/sh\nexit 0\n")
            docker.chmod(0o755)
            (tmp / "elsewhere").mkdir()
            (tmp / "agents").symlink_to(tmp / "elsewhere")
            env = {
                **os.environ,
                "PATH": f"{tmp / 'bin'}{os.pathsep}{os.environ['PATH']}",
                "E2E_SNAPSHOT_ROOT": str(tmp / "e2e"),
                "E2E_AGENT_STACK_ROOT": str(tmp / "agents"),
                "E2E_MAX_CONCURRENT": "0",
            }
            script = Path(__file__).resolve().parents[1] / "e2e-slot.sh"
            result = subprocess.run(["bash", str(script), "99", "--fresh", "true"], capture_output=True, text=True, env=env)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(f"agent-stack: refusing {tmp / 'agents'}:", result.stderr)


class SlotTests(unittest.TestCase):
    def test_no_two_slots_up_to_99_share_a_port(self) -> None:
        self.assertEqual(
            stack.ports(42), {"matrix": 28142, "app": 4342, "api": 29642, "stub": 29742, "origin": 29842}
        )
        self.assertEqual(
            stack.ports(0), {"matrix": 28008, "app": 4200, "api": 29600, "stub": 29700, "origin": 29800}
        )
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
        # The slot's workers carry its name and label, so `down` finds the ones its backend left.
        self.assertEqual(json.loads(settings.pop("MINDROOM_DOCKER_WORKER_LABELS_JSON")), {"mindroom-client-e2e.slot": "42"})
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
                "MINDROOM_DOCKER_WORKER_NAME_PREFIX": "mindroom-client-e2e-slot-42",
                "MINDROOM_DOCKER_WORKER_READY_TIMEOUT_SECONDS": "300",
            },
        )

    def test_computers_give_the_helper_a_worker_browser_and_keep_other_tools_on_the_backend(self) -> None:
        computers = {"image": "worker:given", "tools": ["browser_mcp"]}
        config = stack.config_yaml("stub", TESTER, STUB_URL, 0.0003, computers=computers)
        helper, scout = config.split("  helper:\n", 1)[1].split("  scout:\n", 1)
        self.assertIn("      - browser_mcp\n", helper)
        self.assertIn("    tools: [shell]\n", scout)
        self.assertIn('defaults:\n  markdown: true\n  worker_tools: ["browser_mcp"]\n  worker_scope: user_agent\n', config)
        # A shell beside the browser, which can open what the shell serves.
        computers["tools"] = ["browser_mcp", "shell"]
        config = stack.config_yaml("stub", TESTER, STUB_URL, 0.0003, computers=computers)
        self.assertIn('  worker_tools: ["browser_mcp", "shell"]\n  worker_scope: user_agent\n', config)
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
        sessions = {**state, "clientSessions": True, "computers": None}
        # A stack that the script started before these options is one without them.
        self.assertTrue(stack.started_with(state, up_args(), sha, homeserver))
        self.assertTrue(stack.started_with({**sessions, "computers": False}, up_args(client_sessions=True), sha, homeserver))
        self.assertTrue(stack.started_with(sessions, up_args(client_sessions=True), sha, homeserver))
        self.assertFalse(stack.started_with(sessions, up_args(), sha, homeserver))
        self.assertFalse(stack.started_with(sessions, up_args(client_sessions=True, computers=True), sha, homeserver))
        computers = {**sessions, "computers": {"image": "worker:given", "tools": ["browser_mcp"]}}
        given = up_args(client_sessions=True, computers=True, computer_image="worker:given")
        self.assertTrue(stack.started_with(computers, given, sha, homeserver))
        self.assertFalse(stack.started_with(computers, up_args(client_sessions=True, computers=True), sha, homeserver))
        with_shell = up_args(
            client_sessions=True, computers=True, computer_image="worker:given", computer_tools="browser_mcp,shell"
        )
        self.assertFalse(stack.started_with(computers, with_shell, sha, homeserver))
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
        stack.build_worker_image(self.checkout, self.sha, tag)
        stack.build_worker_image(self.checkout, self.sha, tag)
        self.assertEqual(
            (self.root / "docker.log").read_text().splitlines(),
            [f"image inspect {tag}", f"build --quiet --tag {tag} --file {self.DOCKERFILE} -", f"image inspect {tag}"],
        )
        with tarfile.open(self.root / "context.tar") as context:
            self.assertIn(self.DOCKERFILE, context.getnames())

    def test_a_failed_build_stops_the_start_with_its_error(self) -> None:
        with mock.patch.dict(os.environ, {"FAKE_DOCKER_FAIL": "no space left on device"}):
            with self.assertRaises(stack.StackError) as raised:
                stack.build_worker_image(self.checkout, self.sha, "mindroom-client-e2e-worker:0123456789ab")
        self.assertIn("no space left on device", str(raised.exception))


class TranscriptionTests(unittest.TestCase):
    STUB = {"stt": "stub", "notesModel": "default"}
    REAL = {"stt": "real", "notesModel": "notes"}
    REAL_MODEL = {"stt": "real", "notesModel": "luna"}

    def setting(self, model: str, transcription: str, has_them: bool = True) -> dict | None:
        args = mock.Mock(model=model, transcription=transcription)
        with mock.patch.object(stack, "has_call_transcripts", return_value=has_them):
            return stack.transcription_setting(args, Path("/checkout"), "abc")

    def test_a_mindroom_without_call_transcripts_runs_without_them(self) -> None:
        for model in stack.MODES:
            transcription = self.setting(model, "real", has_them=False)
            self.assertIsNone(transcription)
            config = stack.config_yaml(model, TESTER, STUB_URL, 0.0003, transcription=transcription)
            self.assertNotIn("transcripts:", config)
            self.assertNotIn("voice:", config)
            self.assertNotIn("  notes:\n", config)

    def test_the_stand_in_transcribes_and_the_stub_writes_the_notes(self) -> None:
        self.assertEqual(self.setting("stub", "stub"), self.STUB)
        config = stack.config_yaml("stub", TESTER, STUB_URL, 0.0003, transcription=self.STUB)
        self.assertIn("calls:\n  transcripts:\n    enabled: true\n    notes_model: default\n", config)
        self.assertIn(
            f"voice:\n  stt:\n    provider: openai_compatible\n    host: {STUB_URL}\n    model: stub-transcribe\n",
            config,
        )
        self.assertNotIn("gpt-6-luna", config)

    def test_real_transcripts_go_to_openai_and_luna_writes_the_notes(self) -> None:
        self.assertEqual(self.setting("stub", "real"), self.REAL)
        config = stack.config_yaml("stub", TESTER, STUB_URL, 0.0003, transcription=self.REAL)
        self.assertIn("  notes:\n    provider: openai\n    id: gpt-6-luna\n", config)
        self.assertIn("    notes_model: notes\n", config)
        self.assertIn("voice:\n  stt:\n    provider: openai\n    credentials_service: openai\n", config)
        self.assertNotIn("stub-transcribe", config)

    def test_a_real_model_stack_has_its_own_luna_write_the_notes(self) -> None:
        # It always transcribes for real: the stand-in lives in the stub, which it does not start.
        self.assertEqual(self.setting("real", "stub"), self.REAL_MODEL)
        self.assertEqual(self.setting("real", "real"), self.REAL_MODEL)
        config = stack.config_yaml("real", TESTER, STUB_URL, 0.0003, transcription=self.REAL_MODEL)
        self.assertIn("    notes_model: luna\n", config)
        self.assertIn("voice:\n  stt:\n    provider: openai\n", config)
        # One entry per model: the model picker finds GPT-6 Luna by its name.
        self.assertEqual(config.count("display_name: GPT-6 Luna\n"), 1)
        self.assertNotIn("  notes:\n", config)

    def test_real_transcripts_without_an_openai_key_do_not_start(self) -> None:
        args = mock.Mock(
            checkout=None, ref=None, model="stub", transcription="real", calls=None, calls_profile="realtime"
        )
        with (
            tempfile.TemporaryDirectory() as directory,
            mock.patch.dict(os.environ, {"E2E_AGENT_STACK_ROOT": directory, "ANTHROPIC_API_KEY": "a"}, clear=True),
            mock.patch.object(stack, "resolve_checkout", return_value=Path("/checkout")),
            mock.patch.object(stack, "http_json", return_value=(200, {})),
            mock.patch.object(stack, "resolve_commit", return_value="abc"),
            mock.patch.object(stack, "has_call_transcripts", return_value=True),
            mock.patch.object(stack, "start") as start,
            self.assertRaises(stack.StackError) as raised,
        ):
            stack.up(14, args)
        self.assertEqual(raised.exception.code, stack.EXIT_NO_KEYS)
        self.assertIn("--transcription real needs OPENAI_API_KEY", str(raised.exception))
        start.assert_not_called()

    def test_voice_calls_and_transcripts_share_one_calls_section(self) -> None:
        calls = {"serviceUrl": "http://127.0.0.1:29521", "profile": "realtime", "model": "gpt-realtime-2.1-mini"}
        config = stack.config_yaml("stub", TESTER, STUB_URL, 0.0003, calls, transcription=self.STUB)
        self.assertEqual(config.count("\ncalls:\n"), 1)
        self.assertIn("  agents:\n    helper: voice\n  transcripts:\n    enabled: true\n", config)

    def test_a_running_stack_is_reused_only_with_the_call_transcripts_it_started_with(self) -> None:
        sha, homeserver = "a" * 40, "http://127.0.0.1:28142"
        state = {"model": "stub", "calls": None, "sha": sha, "homeserver": homeserver, "approvalExpiryDays": 0.0003}
        transcribed = {**state, "transcription": self.STUB}
        self.assertTrue(stack.started_with(transcribed, up_args(), sha, homeserver, transcription=self.STUB))
        self.assertFalse(stack.started_with(transcribed, up_args(), sha, homeserver, transcription=self.REAL))
        self.assertFalse(stack.started_with(transcribed, up_args(), sha, homeserver))
        self.assertFalse(stack.started_with(state, up_args(), sha, homeserver, transcription=self.STUB))

    def test_only_the_notes_model_is_priced_beside_stub_models(self) -> None:
        notes = json.dumps(
            {"event": "LLM usage", "model_name": "notes", "uncached_input_tokens": 1000, "output_tokens": 100}
        )
        with tempfile.TemporaryDirectory() as directory:
            slot_dir = Path(directory)
            (slot_dir / "backend.log").write_text(f"{CONSOLE_LINE}\n{notes}\n")
            summary = stack.usage_summary({"model": "stub", "transcription": self.REAL}, slot_dir)
        self.assertNotIn("usd", summary["models"]["default"])
        self.assertAlmostEqual(summary["models"]["notes"]["usd"], round((1000 * 0.1 + 100 * 0.5) / 1e6, 4))
        self.assertTrue(stack.paid({"model": "stub", "transcription": self.REAL}))
        self.assertFalse(stack.paid({"model": "stub", "transcription": self.STUB}))


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

    def plugin(self, name: str, report: dict, code: int = 0, scenarios: bool = False, origins: bool = False) -> Path:
        directory = self.root / name
        (directory / "e2e").mkdir(parents=True)
        manifest = {"name": name, **({"origin_module": "origin.py"} if origins else {})}
        (directory / "mindroom.plugin.json").write_text(json.dumps(manifest))
        (directory / "check.json").write_text(json.dumps(report))
        (directory / "check.code").write_text(str(code))
        if scenarios:
            (directory / "e2e" / "stub-scenarios.json").write_text("{}")
            (directory / "e2e" / "stub_scenarios.py").write_text("")
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
        apps = self.plugin("apps", {**report, "name": "apps", "tools": []}, origins=True)
        pages_only = self.root / "pages-only"
        (pages_only / "e2e" / "fixtures").mkdir(parents=True)
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test-secret"}):
            checked = stack.check_plugin_dirs(self.venv_bin, [greeter, apps, pages_only])
        self.assertEqual(
            checked,
            [
                checked_dir(
                    str(greeter),
                    plugin="greeter",
                    tools=["greeter"],
                    scenarios=str(greeter / "e2e" / "stub-scenarios.json"),
                    scenarioModule=str(greeter / "e2e" / "stub_scenarios.py"),
                ),
                # Its manifest names an origin_module.
                checked_dir(str(apps), plugin="apps", origins=True),
                checked_dir(str(pages_only)),
            ],
        )
        # Only the directories with a plugin are checked, and the provider keys stay out of the check.
        log = (self.venv_bin / "mindroom.log").read_text()
        self.assertEqual(
            log, f"plugins check --json {greeter} without keys\nplugins check --json {apps} without keys\n"
        )

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


TOOLS = [{"type": "function", "function": {"name": name}} for name in ("sample_make", "sample_use", "sample_greet")]


def chat(text: str, *later: dict) -> dict:
    """A request whose person wrote `text`, with the sample plugin's tools, followed by `later` messages."""
    return {"model": "stub-fast", "messages": [{"role": "user", "content": text}, *later], "tools": TOOLS}


# A --scenario-module: a step computed from the previous result, one from the person's words, one ending in a text,
# and a computed reply.
CHAIN_MODULE = """
SCENARIOS = {
    "#Chain": [
        ("sample_make", {"label": "first"}),
        ("sample_use", lambda turn: {"item_id": turn.results[0]}),
        ("sample_greet", lambda turn: {"name": turn.said.split()[-1]}),
        ("sample_greet", lambda turn: f"Made {turn.results[0]}, then: {turn.results[1]}"),
    ],
}
REPLIES = {"#prompted": lambda turn: " | ".join([turn.system, *turn.tools])}
"""


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
        # The reply quotes the first 400 characters of the result.
        _, text = stub_model.plan(chat("please #samplegreet", {"role": "tool", "content": "a" * 399 + "bc"}), scenarios)
        self.assertIn("a" * 399 + "b\n```", text)

    def test_ask_streams_a_question_with_options_for_reactions(self) -> None:
        kind, text, seconds = stub_model.plan(chat("which deck? #ask"), stub_model.tool_scenarios([]))
        self.assertEqual((kind, seconds), ("slow", stub_model.ASK_SECONDS_PER_WORD))
        block = text.split("```interactive\n", 1)[1].split("\n```", 1)[0]
        payload = json.loads(block)
        self.assertEqual(payload["question"], "Which deck should I polish for Thursday?")
        self.assertEqual([option["emoji"] for option in payload["options"]], ["✅", "📄"])

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

    def answer(self, scenario_files: list[Path], body: dict, modules: list[Path] | None = None) -> dict:
        """The stub's non-streamed answer to `body`, as it hands it to aiohttp."""
        stub = stub_model.Stub(self.root / "requests.jsonl", scenario_files, modules or [])
        request = mock.Mock(json=mock.AsyncMock(return_value=body))
        with mock.patch.object(stub_model, "web") as web:
            asyncio.run(stub.completions(request))
        return web.json_response.call_args.args[0]["choices"][0]["message"]

    def test_the_stub_answers_with_the_scenarios_of_its_files(self) -> None:
        message = self.answer([SAMPLE_SCENARIOS], chat("#samplegreet"))
        self.assertEqual(message["tool_calls"][0]["function"]["name"], "sample_greet")

    def test_the_stub_thinks_before_a_call_that_asks_for_it_and_never_sends_the_key(self) -> None:
        shell = [{"type": "function", "function": {"name": "run_shell_command"}}]
        first = {"model": "stub-fast", "messages": [{"role": "user", "content": "#pause"}], "tools": shell}
        second = {**first, "messages": [*first["messages"], {"role": "tool", "content": "first step"}]}
        with mock.patch.object(stub_model.asyncio, "sleep", mock.AsyncMock()) as sleep:
            message = self.answer([], first)
            sleep.assert_not_called()
            message = self.answer([], second)
            sleep.assert_awaited_once_with(3.5)
        arguments = json.loads(message["tool_calls"][0]["function"]["arguments"])
        self.assertEqual(arguments, {"args": "sleep 1; echo second step"})

    def test_the_stub_says_in_its_reply_that_a_file_is_broken(self) -> None:
        broken = self.scenarios("{not json")
        message = self.answer([broken], chat("hello"))
        self.assertTrue(message["content"].startswith(f"The stub could not read its scenarios: {broken}: "))
        message = self.answer([broken], chat("please #SampleGreet and #shell"))
        self.assertTrue(
            message["content"].startswith(f"The stub could not read its scenarios for #samplegreet #shell: {broken}: ")
        )

    def module(self, source: str) -> Path:
        path = self.root / f"stub_scenarios_{len(list(self.root.iterdir()))}.py"
        path.write_text(source)
        return path

    def turn(self, text: str, *results: str, developer: str = "") -> dict:
        body = chat(text, *({"role": "tool", "content": r} for r in results))
        if developer:
            system = {"role": "system", "content": "You are the helper."}
            body["messages"][:0] = [system, {"role": "developer", "content": developer}]
        return body

    def test_a_module_computes_steps_from_the_turn(self) -> None:
        scenarios = stub_model.tool_scenarios([], [self.module(CHAIN_MODULE)])
        said = "please #chain for Ada"
        self.assertEqual(
            stub_model.plan(self.turn(said), scenarios), ("tool", "sample_make", {"label": "first"})
        )
        self.assertEqual(
            stub_model.plan(self.turn(said, "item-7"), scenarios), ("tool", "sample_use", {"item_id": "item-7"})
        )
        self.assertEqual(
            stub_model.plan(self.turn(said, "item-7", "Used item-7"), scenarios),
            ("tool", "sample_greet", {"name": "Ada"}),
        )
        self.assertEqual(
            stub_model.plan(self.turn(said, "item-7", "Used item-7", "Hello Ada"), scenarios),
            ("text", "Made item-7, then: Used item-7"),
        )

    def test_the_sample_plugins_chain_uses_the_id_its_first_call_returned(self) -> None:
        scenarios = stub_model.tool_scenarios([], [SAMPLE_PLUGIN / "e2e" / "stub_scenarios.py"])
        self.assertEqual(stub_model.plan(self.turn("#chain"), scenarios), ("tool", "sample_make", {}))
        self.assertEqual(
            stub_model.plan(self.turn("#chain", "item-7"), scenarios), ("tool", "sample_use", {"item_id": "item-7"})
        )

    def test_a_reply_sees_the_system_prompt_and_the_tools(self) -> None:
        scenarios = stub_model.tool_scenarios([], [self.module(CHAIN_MODULE)])
        tools = "sample_make | sample_use | sample_greet"
        self.assertEqual(
            stub_model.plan(self.turn("#prompted", developer="Please be brief."), scenarios),
            ("text", f"You are the helper.\nPlease be brief. | {tools}"),
        )
        self.assertEqual(stub_model.plan(self.turn("#prompted"), scenarios), ("text", f" | {tools}"))

    def test_a_module_wins_over_a_file_and_a_file_over_the_built_in_ones(self) -> None:
        file = self.scenarios({"#shell": [["sample_greet", {"name": "file"}]], "#chain": [["sample_greet", {}]]})
        scenarios = stub_model.tool_scenarios([file], [self.module(CHAIN_MODULE)])
        self.assertEqual(stub_model.plan(chat("#shell"), scenarios), ("tool", "sample_greet", {"name": "file"}))
        self.assertEqual(stub_model.plan(self.turn("#chain"), scenarios), ("tool", "sample_make", {"label": "first"}))
        self.assertEqual(scenarios["#multi"], stub_model.TOOL_SCENARIOS["#multi"])

    def test_a_module_is_read_for_every_request(self) -> None:
        module = self.module('REPLIES = {"#ping": lambda turn: "one"}')
        self.assertEqual(self.answer([], chat("#ping"), [module])["content"], "one")
        module.write_text('REPLIES = {"#ping": lambda turn: "two"}')
        self.assertEqual(self.answer([], chat("#ping"), [module])["content"], "two")

    def test_a_module_that_fails_to_import_is_named_in_the_reply(self) -> None:
        for source in ("SCENARIOS = {", "raise RuntimeError('no fixture')", 'SCENARIOS = {"#a": [("only-a-name",)]}'):
            module = self.module(source)
            message = self.answer([], chat("#chain"), [module])
            self.assertTrue(
                message["content"].startswith(f"The stub could not read its scenarios for #chain: {module}: "), message
            )
        missing = self.root / "missing.py"
        self.assertIn(str(missing), self.answer([], chat("#samplegreet"), [missing])["content"])

    def test_a_step_that_fails_is_named_with_its_tag_in_the_reply(self) -> None:
        module = self.module(
            'SCENARIOS = {"#Chain": [("sample_greet", lambda turn: {"name": turn.results[0]})]}\n'
            'SCENARIOS["#odd"] = [("sample_greet", lambda turn: 5)]\n'
            'REPLIES = {"#dict": lambda turn: {"name": "Ada"}}'
        )
        message = self.answer([], chat("#chain"), [module])
        self.assertEqual(
            message["content"],
            f"The stub's scenario #chain of {module} failed: IndexError: tuple index out of range",
        )
        message = self.answer([], chat("#odd"), [module])
        self.assertEqual(
            message["content"],
            f"The stub's scenario #odd of {module} failed: it gave int, not a dict of arguments or a text",
        )
        message = self.answer([], chat("#dict"), [module])
        self.assertEqual(message["content"], f"The stub's scenario #dict of {module} failed: it gave dict, not a text")


if __name__ == "__main__":
    unittest.main()
