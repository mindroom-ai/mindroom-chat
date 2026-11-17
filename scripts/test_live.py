"""Tests of scripts/live.py that start nothing: key files, slot claims, the state and its summary, and `down`."""

from __future__ import annotations

import contextlib
import io
import os
import socket
import subprocess
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


def private_slots(test: unittest.TestCase) -> Path:
    """Points live.SLOTS_DIR at a new temporary directory for the test, and returns it."""
    directory = tempfile.TemporaryDirectory()
    test.addCleanup(directory.cleanup)
    slots = Path(directory.name) / "slots"
    patcher = mock.patch.object(live, "SLOTS_DIR", slots)
    patcher.start()
    test.addCleanup(patcher.stop)
    return slots


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
    def setUp(self) -> None:
        self.slots = private_slots(self)
        self.root = self.slots.parent
        patcher = mock.patch.dict(os.environ, {"E2E_AGENT_STACK_ROOT": str(self.root / "agents")})
        patcher.start()
        self.addCleanup(patcher.stop)

    def taken(self, slot: int, projects: set[str] = frozenset()) -> bool:
        return live.slot_taken(slot, set(projects))

    def test_a_slot_is_taken_by_a_compose_project_or_a_stack(self) -> None:
        with mock.patch.object(live, "port_in_use", return_value=False):
            self.assertFalse(self.taken(57))
            self.assertTrue(self.taken(57, projects={"mindroom-client-e2e-57"}))
            self.assertFalse(self.taken(57, projects={"mindroom-client-e2e-5", "mindroom-client-e2e-570"}))
            self.assertFalse(self.taken(58))
            (self.root / "agents" / "slot-58").mkdir(parents=True)
            self.assertTrue(self.taken(58))

    def test_up_claims_a_slot_by_creating_its_state_file_and_skips_one_that_has_it(self) -> None:
        with mock.patch.object(live, "port_in_use", return_value=False):
            self.assertTrue(live.claim_slot(57, set(), {"status": "starting", "pid": 1}))
            self.assertEqual(live.read_states(), {57: {"status": "starting", "pid": 1}})
            self.assertEqual(live.state_path(57).stat().st_mode & 0o777, 0o600)
            self.assertFalse(live.claim_slot(57, set(), {"status": "starting", "pid": 2}))
            self.assertEqual(live.read_states()[57]["pid"], 1)
            self.assertFalse(live.claim_slot(58, {"mindroom-client-e2e-58"}, {}))
            self.assertFalse(live.state_path(58).exists())

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


class SharedSlotTests(unittest.TestCase):
    """scripts/e2e-slot.sh reads the real /tmp/mindroom-slots, which no root setting moves; this test gives slot 99 a
    state file there while no deployment has one, and the run's Docker always fails, so it never starts anything."""

    SLOT = 99

    def test_an_e2e_run_with_its_own_snapshot_root_refuses_a_live_deployment(self) -> None:
        if not live.claim_slot(self.SLOT, set(), {"status": "starting", "pid": os.getpid()}):
            self.skipTest(f"slot {self.SLOT} is in use on this machine")
        self.addCleanup(live.state_path(self.SLOT).unlink, missing_ok=True)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "bin").mkdir()
            (root / "bin" / "docker").write_text("#!/bin/sh\nexit 1\n")
            (root / "bin" / "docker").chmod(0o755)
            # Its own snapshot root, as scripts/perf/real-work/matrix.sh gives each run.
            env = {
                **os.environ,
                "E2E_SNAPSHOT_ROOT": str(root / "snapshots"),
                "PATH": f"{root / 'bin'}:{os.environ['PATH']}",
            }
            refused = subprocess.run(
                ["bash", str(live.REPOSITORY / "scripts" / "e2e-slot.sh"), str(self.SLOT), "true"],
                capture_output=True,
                text=True,
                timeout=60,
                env=env,
            )
        self.assertEqual(refused.returncode, 2, refused.stderr)
        self.assertIn(f"e2e-slot {self.SLOT}: a live deployment uses the slot", refused.stderr)


class StateTests(unittest.TestCase):
    def state(self) -> dict:
        chat = {"checkout": "/repo", "pid": 1, "log": "/tmp/mindroom-slots/57.live/chat.log"}
        backend = {"checkout": "/mindroom", "source": "origin/main of /mindroom, committed 2 hours ago"}
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(live, "SLOTS_DIR", Path(directory)):
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
        self.assertEqual(live.toolchain_problem("run", "v24.21.0", {}), "CHROMIUM_PATH is not set")


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
        self.root = private_slots(self)

    def write(self, slot: int, checkout: Path = live.REPOSITORY) -> None:
        state = {"slot": slot, "status": "ready", "chat": {"checkout": str(checkout), "pid": None}}
        live.write_state(slot, state)

    def run_main(self, *argv: str, returncode: int = 0) -> tuple[int, list[int]]:
        with (
            mock.patch.object(live.subprocess, "run", return_value=mock.Mock(returncode=returncode)) as run,
            contextlib.redirect_stderr(io.StringIO()),
        ):
            code = live.main(list(argv))
        stopped = [int(call.args[0][2]) for call in run.call_args_list]
        return code, stopped

    def test_down_stops_this_checkouts_one_deployment_and_is_idempotent(self) -> None:
        self.write(61)
        self.write(62, Path("/elsewhere"))
        self.assertEqual(self.run_main("down"), (0, [61]))
        self.assertFalse((self.root / "61.live.json").exists())
        self.assertTrue((self.root / "62.live.json").exists())
        self.assertEqual(self.run_main("down"), (0, []))
        self.assertEqual(self.run_main("down", "--slot", "61"), (0, []))

    def test_two_of_this_checkout_need_a_slot_or_all_mine(self) -> None:
        self.write(61)
        self.write(63)
        self.assertEqual(self.run_main("down"), (2, []))
        self.assertEqual(self.run_main("down", "--all-mine"), (0, [61, 63]))

    def test_down_of_a_slot_runs_the_slot_teardown(self) -> None:
        self.write(62, Path("/elsewhere"))
        with (
            mock.patch.object(live.subprocess, "run", return_value=mock.Mock(returncode=0)) as run,
            contextlib.redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(live.main(["down", "--slot", "62"]), 0)
        self.assertEqual(run.call_args.args[0][1:], [str(live.REPOSITORY / "scripts" / "e2e-slot.sh"), "62", "down"])

    def test_a_failed_teardown_keeps_the_state_and_logs_so_down_tries_again(self) -> None:
        self.write(61)
        (self.root / "61.live").mkdir()
        (self.root / "61.live" / "chat.log").write_text("vite\n")
        self.assertEqual(self.run_main("down", "--slot", "61", returncode=1), (1, [61]))
        self.assertTrue((self.root / "61.live.json").exists())
        self.assertTrue((self.root / "61.live" / "chat.log").exists())
        self.assertEqual(self.run_main("down", "--slot", "61"), (0, [61]))
        self.assertFalse((self.root / "61.live.json").exists())
        self.assertFalse((self.root / "61.live").exists())

    def test_status_names_a_backend_that_does_not_answer(self) -> None:
        live.write_state(
            61,
            {
                "slot": 61,
                "status": "ready",
                "chat": {"checkout": "/repo", "pid": 1},
                "homeserver": "http://127.0.0.1:28161",
                "backend": {"apiUrl": "http://127.0.0.1:29661"},
            },
        )
        answers = {"http://127.0.0.1:28161/_matrix/client/versions": 200, "http://127.0.0.1:29661/api/health": 0}
        with (
            mock.patch.object(live.stack, "alive", return_value=True),
            mock.patch.object(live.stack, "http_json", side_effect=lambda _m, url, **_: (answers[url], {})),
            contextlib.redirect_stdout(io.StringIO()) as out,
        ):
            live.main(["status"])
        self.assertIn("slot 61: broken (backend not answering)", out.getvalue())

    def test_run_passes_the_scripts_arguments_and_the_only_deployments_state(self) -> None:
        self.write(61)
        with (
            mock.patch.object(live, "ensure_toolchain"),
            mock.patch.object(live.subprocess, "run", return_value=mock.Mock(returncode=3)) as run,
        ):
            self.assertEqual(live.main(["run", "check.mjs", "--slot", "x"]), 3)
        self.assertEqual(run.call_args.args[0], ["node", "check.mjs", "--slot", "x"])
        self.assertEqual(run.call_args.kwargs["env"]["MINDROOM_LIVE_STATE"], str(self.root / "61.live.json"))


class BackendSourceTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        checkout = self.root / "work" / "mindroom"
        checkout.mkdir(parents=True)
        (checkout / "pyproject.toml").write_text('[project]\nname = "mindroom"\n')
        git = ["git", "-C", str(checkout), "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]
        for command in (["init", "-q"], ["add", "pyproject.toml"], ["commit", "-q", "-m", "one"]):
            subprocess.run([*git, *command], check=True, capture_output=True)
        subprocess.run([*git, "update-ref", "refs/remotes/origin/main", "HEAD"], check=True)
        self.checkout = checkout
        self.head = live.git(checkout, "rev-parse", "HEAD")
        cwd = os.getcwd()
        os.chdir(self.root / "work")
        self.addCleanup(os.chdir, cwd)

    def test_a_relative_backend_from_another_directory_becomes_absolute_with_its_edits(self) -> None:
        checkout, sha, source = live.backend_source("mindroom")
        self.assertEqual((checkout, sha), (self.checkout, self.head))
        self.assertIn(f"HEAD of {self.checkout} (no uncommitted changes)", source)
        with (self.checkout / "pyproject.toml").open("a") as edit:
            edit.write("# an edit\n")
        checkout, sha, source = live.backend_source("./mindroom/")
        self.assertEqual(checkout, self.checkout)
        self.assertNotEqual(sha, self.head)
        self.assertIn("# an edit", live.git(self.checkout, "show", f"{sha}:pyproject.toml"))
        self.assertEqual(source, f"the working tree of {self.checkout}")

    def test_a_relative_checkout_variable_becomes_absolute(self) -> None:
        with mock.patch.dict(os.environ, {"E2E_MINDROOM_CHECKOUT": "mindroom"}):
            checkout, sha, source = live.backend_source(None)
        self.assertEqual((checkout, sha), (self.checkout, self.head))
        self.assertTrue(source.startswith(f"origin/main of {self.checkout}, committed "))


if __name__ == "__main__":
    unittest.main()
