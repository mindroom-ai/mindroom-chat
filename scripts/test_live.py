"""Tests of scripts/live.py that start nothing: key files, slot picking, the state and its summary, and `down`."""

from __future__ import annotations

import contextlib
import io
import os
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import live  # noqa: E402

STACK_STATE = {
    "homeserver": "http://127.0.0.1:28157",
    "serverName": "matrix.localhost",
    "sha": "0123456789abcdef0123",
    "apiUrl": "http://127.0.0.1:29657",
    "dir": "/tmp/mindroom-client-agents/slot-57",
    "logs": {"backend": "/tmp/mindroom-client-agents/slot-57/backend.log"},
    "models": {"first": {"key": "default", "id": "gpt-6-luna", "displayName": "GPT-6 Luna"}},
    "tester": {"userId": "@tester_t1:matrix.localhost", "username": "tester_t1", "password": "pw", "accessToken": "x"},
    "agents": {"router": "@mindroom_router_t1:matrix.localhost", "helper": "@mindroom_helper_t1:matrix.localhost"},
    "agentNames": {"router": "MindRoom", "helper": "Helper"},
    "rooms": {"lobby": "!lobby:matrix.localhost", "space": "!space:matrix.localhost"},
}


class KeyFileTests(unittest.TestCase):
    TEXT = "\n".join(
        [
            "# provider keys",
            "OPENAI_API_KEY=sk-open",
            "export ANTHROPIC_API_KEY='sk-ant # not a comment'",
            "GITHUB_TOKEN=gh-secret",
            "OTHER = value # a comment",
            "",
        ]
    )

    def test_only_the_named_keys_are_read_with_quotes_and_export(self) -> None:
        self.assertEqual(
            live.read_key_file(self.TEXT, live.KEY_NAMES),
            {"OPENAI_API_KEY": "sk-open", "ANTHROPIC_API_KEY": "sk-ant # not a comment"},
        )
        self.assertEqual(live.read_key_file(self.TEXT, ("OTHER",)), {"OTHER": "value"})

    def test_empty_values_and_other_names_are_left_out(self) -> None:
        self.assertEqual(live.read_key_file("OPENAI_API_KEY=\nOPENAI_API_KEY_2=x\n", live.KEY_NAMES), {})

    def test_the_file_only_fills_keys_the_environment_lacks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text(self.TEXT)
            self.assertEqual(
                live.missing_keys({"OPENAI_API_KEY": "from-env"}, env_file),
                {"ANTHROPIC_API_KEY": "sk-ant # not a comment"},
            )
            self.assertEqual(live.missing_keys({"OPENAI_API_KEY": "a", "ANTHROPIC_API_KEY": "b"}, env_file), {})
            self.assertEqual(live.missing_keys({}, Path(directory) / "missing"), {})


class SlotTests(unittest.TestCase):
    def test_the_first_slot_nothing_uses_is_picked(self) -> None:
        self.assertEqual(live.pick_slot(range(50, 55), lambda slot: slot in {50, 51, 53}), 52)
        self.assertIsNone(live.pick_slot(range(50, 52), lambda slot: True))

    def taken(self, slot: int, projects: set[str] = frozenset(), live_slots: set[int] = frozenset()) -> bool:
        with (
            tempfile.TemporaryDirectory() as directory,
            mock.patch.dict(os.environ, {"E2E_AGENT_STACK_ROOT": directory}),
        ):
            return live.slot_taken(slot, set(projects), set(live_slots))

    def test_a_slot_is_taken_by_a_deployment_a_compose_project_or_a_stack(self) -> None:
        with mock.patch.object(live, "port_in_use", return_value=False):
            self.assertFalse(self.taken(57))
            self.assertTrue(self.taken(57, live_slots={57}))
            self.assertTrue(self.taken(57, projects={"mindroom-client-e2e-57"}))
            self.assertFalse(self.taken(57, projects={"mindroom-client-e2e-5", "mindroom-client-e2e-570"}))
            with tempfile.TemporaryDirectory() as directory:
                (Path(directory) / "slot-57").mkdir()
                with mock.patch.dict(os.environ, {"E2E_AGENT_STACK_ROOT": directory}):
                    self.assertTrue(live.slot_taken(57, set(), set()))

    def test_a_listener_on_any_port_of_the_slot_takes_it(self) -> None:
        ports = live.slot_ports(57)
        self.assertEqual(sorted(ports), [4357, 28157, 29257, 29357, 29457, 29557, 29657, 29757, 29857, 29957])
        with mock.patch.object(live, "port_in_use", side_effect=lambda port: port == 29757):
            self.assertTrue(self.taken(57))

    def test_a_port_with_a_listener_is_in_use(self) -> None:
        with socket.socket() as server:
            server.bind(("127.0.0.1", 0))
            server.listen()
            self.assertTrue(live.port_in_use(server.getsockname()[1]))


class StateTests(unittest.TestCase):
    def state(self) -> dict:
        chat = {"checkout": "/repo", "pid": 1, "log": "/tmp/mindroom-live/slot-57/chat.log"}
        backend = {"checkout": "/mindroom", "source": "origin/main of /mindroom, committed 2 hours ago"}
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.dict(os.environ, {"MINDROOM_LIVE_ROOT": directory}):
                return live.live_state(57, STACK_STATE, chat, backend, 61.4)

    def test_the_state_has_the_urls_account_agents_and_files(self) -> None:
        state = self.state()
        self.assertEqual(state["chatUrl"], "http://127.0.0.1:4357")
        self.assertEqual(state["loginUrl"], "http://127.0.0.1:4357/login/http%3A%2F%2F127.0.0.1%3A28157")
        self.assertEqual(state["lobby"]["url"], "http://127.0.0.1:4357/home/%21lobby%3Amatrix.localhost")
        self.assertEqual((state["username"], state["password"]), ("tester_t1", "pw"))
        self.assertEqual(
            state["agents"],
            [
                {
                    "name": "router",
                    "displayName": "MindRoom",
                    "userId": STACK_STATE["agents"]["router"],
                    "role": "router",
                },
                {
                    "name": "helper",
                    "displayName": "Helper",
                    "userId": STACK_STATE["agents"]["helper"],
                    "model": "GPT-6 Luna",
                },
            ],
        )
        self.assertEqual(state["backend"]["config"], "/tmp/mindroom-client-agents/slot-57/config.yaml")
        self.assertEqual(state["backend"]["commit"], STACK_STATE["sha"])
        self.assertEqual(state["down"], "just live down --slot 57")
        self.assertEqual(state["upSeconds"], 61)
        # The tester's token, for Matrix API checks from outside the page (scripts/live-ask.mjs).
        self.assertEqual(state["accessToken"], "x")

    def test_the_summary_names_everything_a_person_needs(self) -> None:
        text = live.summary(self.state())
        for needed in (
            "slot 57 is ready (61 s)",
            "http://127.0.0.1:4357/login/http%3A%2F%2F127.0.0.1%3A28157",
            "Username:   tester_t1",
            "Password:   pw",
            "Helper @mindroom_helper_t1:matrix.localhost (GPT-6 Luna)",
            "MindRoom 0123456789ab, origin/main of /mindroom, committed 2 hours ago",
            "/tmp/mindroom-client-agents/slot-57/config.yaml",
            "just live down --slot 57",
            "no mention needed",
            'just live ask "<text>" --slot 57',
            f"from '{live.ASK_SCRIPT}'",
        ):
            self.assertIn(needed, text)

    def test_node_versions(self) -> None:
        self.assertEqual(live.node_major("v24.21.0\n"), 24)
        self.assertEqual(live.node_major("v22.1.0"), 22)
        self.assertEqual(live.node_major(""), 0)

    def test_an_old_or_missing_node_and_ask_without_chromium_need_nix(self) -> None:
        chromium = {"CHROMIUM_PATH": "/nix/store/chromium"}
        self.assertEqual(live.toolchain_problem("up", "v22.23.4\n", chromium), "node v22.23.4 is too old")
        self.assertEqual(live.toolchain_problem("ask", "", chromium), "node is missing")
        self.assertIsNone(live.toolchain_problem("up", "v24.21.0", {}))
        self.assertEqual(live.toolchain_problem("ask", "v24.21.0", {}), "CHROMIUM_PATH is not set")
        self.assertIsNone(live.toolchain_problem("ask", "v24.21.0", chromium))


class ToolchainTests(unittest.TestCase):
    def run_ensure(self, environ: dict[str, str], nix: bool) -> mock.MagicMock:
        def which(name: str) -> str | None:
            return "/usr/bin/node" if name == "node" else ("/usr/bin/nix" if nix and name == "nix" else None)

        old_node = mock.Mock(stdout="v22.23.4\n")
        with (
            mock.patch.dict(os.environ, environ, clear=True),
            mock.patch.object(live.shutil, "which", side_effect=which),
            mock.patch.object(live.subprocess, "run", return_value=old_node),
            mock.patch.object(live.os, "execvpe") as execvpe,
            contextlib.redirect_stderr(io.StringIO()),
        ):
            live.ensure_toolchain("up", ["up", "--slot", "60"])
        return execvpe

    def test_an_old_node_runs_the_same_command_again_in_nix_develop_once(self) -> None:
        execvpe = self.run_ensure({}, nix=True)
        program, argv, env = execvpe.call_args.args
        self.assertEqual(program, "nix")
        self.assertEqual(argv[:3], ["nix", "develop", str(live.REPOSITORY)])
        self.assertEqual(argv[-5:], ["python3", str(Path(live.__file__).resolve()), "up", "--slot", "60"])
        self.assertEqual(env[live.IN_NIX], "1")

    def test_without_nix_or_inside_its_run_it_says_what_to_do(self) -> None:
        for environ, nix in (({}, False), ({live.IN_NIX: "1"}, True)):
            with self.assertRaises(live.LiveError) as raised:
                self.run_ensure(environ, nix)
            self.assertIn("node v22.23.4 is too old; run it in the repository's `nix develop`", str(raised.exception))


class DownTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name) / "live"
        patcher = mock.patch.dict(os.environ, {"MINDROOM_LIVE_ROOT": str(self.root)})
        patcher.start()
        self.addCleanup(patcher.stop)

    def write(self, slot: int, checkout: Path = live.REPOSITORY) -> None:
        live.write_state(slot, {"slot": slot, "status": "ready", "chat": {"checkout": str(checkout), "pid": None}})

    def run_main(self, *argv: str) -> tuple[int, list[int]]:
        with (
            mock.patch.object(live.subprocess, "run") as run,
            contextlib.redirect_stderr(io.StringIO()),
        ):
            code = live.main(list(argv))
        stopped = [int(call.args[0][2]) for call in run.call_args_list]
        return code, stopped

    def test_down_stops_this_checkouts_one_deployment_and_is_idempotent(self) -> None:
        self.write(61)
        self.write(62, Path("/elsewhere"))
        self.assertEqual(self.run_main("down"), (0, [61]))
        self.assertFalse((self.root / "slot-61.json").exists())
        self.assertTrue((self.root / "slot-62.json").exists())
        self.assertEqual(self.run_main("down"), (0, []))
        self.assertEqual(self.run_main("down", "--slot", "61"), (0, []))

    def test_two_of_this_checkout_need_a_slot_or_all_mine(self) -> None:
        self.write(61)
        self.write(63)
        self.assertEqual(self.run_main("down"), (2, []))
        self.assertEqual(self.run_main("down", "--all-mine"), (0, [61, 63]))

    def test_down_of_a_slot_runs_the_slot_teardown(self) -> None:
        self.write(62, Path("/elsewhere"))
        with mock.patch.object(live.subprocess, "run") as run, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(live.main(["down", "--slot", "62"]), 0)
        self.assertEqual(run.call_args.args[0][1:], [str(live.REPOSITORY / "scripts" / "e2e-slot.sh"), "62", "down"])

    def test_the_root_is_the_owners_only(self) -> None:
        live.live_root()
        self.assertEqual(self.root.stat().st_mode & 0o777, 0o700)


if __name__ == "__main__":
    unittest.main()
