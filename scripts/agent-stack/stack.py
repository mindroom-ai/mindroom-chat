#!/usr/bin/env python3
"""Run a real MindRoom backend, driven by a stub model, against one end-to-end slot's homeserver.

Usage: python3 scripts/agent-stack/stack.py <slot 0-50> up|down|status [--checkout DIR] [--ref REV]

  up      start the stack, or reuse the one already running for this slot, and print its state as JSON
  down    stop the slot's stack and delete its storage
  status  print the state of the running stack, or exit 1

The backend comes from a MindRoom checkout (--checkout, $E2E_MINDROOM_CHECKOUT, default
/home/basnijholt/Work/dev/mindroom) at a commit (--ref, $E2E_MINDROOM_REF, default the checkout's origin/main
when it has one, otherwise HEAD). The checkout is only read: `git archive` copies the commit to
$E2E_AGENT_STACK_ROOT/src/<sha> (default /tmp/mindroom-client-agents), where `uv sync` makes its environment.

Each start gets a new MindRoom namespace, so the agents (@mindroom_<agent>_<namespace>), their rooms and the
test account never meet accounts an earlier start left on the homeserver. The model is
scripts/agent-stack/stub_model.py, an OpenAI-compatible server that never calls a real model.

Ports for slot N: homeserver 28100+N (slot 0: 28008, as scripts/e2e-slot.sh), MindRoom API 29600+N, stub
model 29700+N. Exit codes: 3 no MindRoom checkout, 4 no homeserver, 1 anything else.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_CHECKOUT = "/home/basnijholt/Work/dev/mindroom"
SERVER_NAME = "matrix.localhost"
TESTER_PASSWORD = "agent-stack-password"
EXIT_NO_CHECKOUT = 3
EXIT_NO_HOMESERVER = 4
AGENTS = {
    "helper": "Helper",
    "scout": "Scout",
}


class StackError(Exception):
    def __init__(self, message: str, code: int = 1) -> None:
        super().__init__(message)
        self.code = code


def log(message: str) -> None:
    print(f"agent-stack: {message}", file=sys.stderr, flush=True)


def ports(slot: int) -> dict[str, int]:
    return {
        "matrix": 28008 if slot == 0 else 28100 + slot,
        "api": 29600 + slot,
        "stub": 29700 + slot,
    }


def stack_root() -> Path:
    return Path(
        os.environ.get("E2E_AGENT_STACK_ROOT")
        or Path(os.environ.get("TMPDIR", "/tmp")) / "mindroom-client-agents"
    )


@contextlib.contextmanager
def locked(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


# Matrix and HTTP helpers


def http_json(
    method: str, url: str, body: object | None = None, token: str | None = None, timeout: float = 10.0
):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return error.code, {"error": raw.decode(errors="replace")}
    except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as error:
        return 0, {"error": str(error)}


def matrix(homeserver: str, method: str, path: str, body: object | None = None, token: str | None = None):
    return http_json(method, f"{homeserver}/_matrix/client/v3{path}", body, token)


def token_is_valid(homeserver: str, token: str | None) -> bool:
    if not token:
        return False
    status, _ = matrix(homeserver, "GET", "/account/whoami", token=token)
    return status == 200


def wait_until(description: str, check, timeout: float, interval: float = 1.0, on_fail=None):
    deadline = time.monotonic() + timeout
    while True:
        result = check()
        if result:
            return result
        if time.monotonic() > deadline:
            detail = on_fail() if on_fail else ""
            raise StackError(f"timed out after {timeout:.0f} s waiting for {description}{detail}")
        time.sleep(interval)


# The MindRoom source and its environment


def resolve_checkout(arg: str | None) -> Path:
    checkout = Path(arg or os.environ.get("E2E_MINDROOM_CHECKOUT") or DEFAULT_CHECKOUT).expanduser()
    pyproject = checkout / "pyproject.toml"
    if not pyproject.is_file() or 'name = "mindroom"' not in pyproject.read_text():
        raise StackError(f"no MindRoom checkout at {checkout}", EXIT_NO_CHECKOUT)
    if not (checkout / ".git").exists():
        raise StackError(f"{checkout} is not a git checkout", EXIT_NO_CHECKOUT)
    return checkout


def git(checkout: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(checkout), *args], check=True, capture_output=True, text=True
    ).stdout.strip()


def resolve_commit(checkout: Path, ref: str | None) -> str:
    ref = ref or os.environ.get("E2E_MINDROOM_REF")
    if not ref:
        has_main = subprocess.run(
            ["git", "-C", str(checkout), "rev-parse", "--verify", "--quiet", "origin/main^{commit}"],
            capture_output=True,
        )
        ref = "origin/main" if has_main.returncode == 0 else "HEAD"
    try:
        return git(checkout, "rev-parse", "--verify", f"{ref}^{{commit}}")
    except subprocess.CalledProcessError as error:
        raise StackError(f"{ref} is not a commit in {checkout}") from error


def package_version(checkout: Path, sha: str) -> str:
    """The version hatch-vcs would compute; the copy has no .git to compute it from."""
    try:
        described = git(checkout, "describe", "--tags", "--long", "--match", "v*", sha)
    except subprocess.CalledProcessError:
        return "0.0.0"
    tag, distance, _ = described.rsplit("-", 2)
    version = tag.removeprefix("v")
    return version if distance == "0" else f"{version}.post{distance}"


def prepare_source(checkout: Path, sha: str) -> Path:
    """Copy the commit out of the checkout once and give it a virtual environment."""
    source = stack_root() / "src" / sha
    with locked(stack_root() / "src" / f"{sha}.lock"):
        if (source / ".complete").exists():
            return source
        shutil.rmtree(source, ignore_errors=True)
        source.mkdir(parents=True)
        log(f"copying MindRoom {sha[:12]} from {checkout}")
        archive = subprocess.Popen(["git", "-C", str(checkout), "archive", sha], stdout=subprocess.PIPE)
        assert archive.stdout is not None
        with tarfile.open(fileobj=archive.stdout, mode="r|") as tar:
            tar.extractall(source, filter="data")
        if archive.wait() != 0:
            raise StackError(f"git archive {sha} failed")
        log("installing its environment with uv sync (the first time takes a while)")
        env = {
            **os.environ,
            "SETUPTOOLS_SCM_PRETEND_VERSION": package_version(checkout, sha),
            "UV_PROJECT_ENVIRONMENT": str(source / ".venv"),
        }
        env.pop("VIRTUAL_ENV", None)
        result = subprocess.run(
            ["uv", "sync", "--frozen", "--no-dev", "--project", str(source)],
            env=env,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise StackError(f"uv sync failed:\n{result.stderr[-3000:]}")
        (source / ".complete").touch()
    return source


# Processes


def alive(pid: int | None, marker: str) -> bool:
    if not pid:
        return False
    try:
        cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
    except OSError:
        return False
    return marker in cmdline


def stop_process(pid: int | None, marker: str) -> None:
    """Stop a process group this script started; a PID that now names another program is left alone."""
    if not alive(pid, marker):
        return
    assert pid is not None
    with contextlib.suppress(ProcessLookupError):
        os.killpg(pid, signal.SIGTERM)
    deadline = time.monotonic() + 20
    while alive(pid, marker) and time.monotonic() < deadline:
        time.sleep(0.2)
    if alive(pid, marker):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(pid, signal.SIGKILL)


def start_process(command: list[str], *, cwd: Path, env: dict[str, str], log_path: Path) -> int:
    with log_path.open("ab") as output:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    return process.pid


# Configuration


def config_yaml(tester_id: str, stub_url: str, approval_expiry_days: float) -> str:
    agent_tools = """      - shell
      - scheduler
      - thread_summary
      - thread_tags
      - thread_resolution
      - thread_model
      - chat_ui:
          enable_show_canvas: true"""
    return f"""# Written by scripts/agent-stack/stack.py; the stub model picks a scenario from hashtags in the message.
models:
  default:
    provider: openai
    id: stub-fast
    display_name: Stub Fast
    api: chat_completions
    context_window: 128000
    extra_kwargs:
      base_url: {stub_url}
  deep:
    provider: openai
    id: stub-deep
    display_name: Stub Deep
    api: chat_completions
    context_window: 128000
    extra_kwargs:
      base_url: {stub_url}

agents:
  helper:
    display_name: Helper
    role: Test agent driven by a stub model
    model: default
    rooms: [lobby]
    tools:
{agent_tools}
  scout:
    display_name: Scout
    role: Second test agent on the deep stub model
    model: deep
    rooms: [lobby]
    tools: [shell]

router:
  model: default

tool_approval:
  default: auto_approve
  rules:
    - match: resolve_thread
      action: require_approval
    - match: untag_thread
      action: require_approval
      timeout_days: {approval_expiry_days}
    - match: run_shell_command
      script: ./approval_scripts/shell_review.py

background_tool_jobs:
  approval_wait_timeout: 20

defaults:
  markdown: true

administrators:
  - "{tester_id}"
room_defaults:
  invite_users:
    - "{tester_id}"

timezone: UTC
memory: none
"""


SHELL_REVIEW = '''import json


def check(tool_name, arguments, agent_name):
    """Shell calls whose arguments say needs-approval wait for a person."""
    return "needs-approval" in json.dumps(arguments)
'''


# Commands


def read_state(slot_dir: Path) -> dict | None:
    try:
        return json.loads((slot_dir / "state.json").read_text())
    except (OSError, json.JSONDecodeError):
        return None


def running(state: dict | None, slot_dir: Path) -> bool:
    if not state:
        return False
    marker = str(slot_dir)
    return alive(state["pids"].get("backend"), marker) and alive(state["pids"].get("stub"), marker)


def stop(slot_dir: Path) -> None:
    state = read_state(slot_dir)
    if state:
        for name in ("backend", "stub"):
            stop_process(state["pids"].get(name), str(slot_dir))
    shutil.rmtree(slot_dir, ignore_errors=True)


def up(slot: int, args: argparse.Namespace) -> dict:
    checkout = resolve_checkout(args.checkout)
    port = ports(slot)
    homeserver = f"http://127.0.0.1:{port['matrix']}"
    if http_json("GET", f"{homeserver}/_matrix/client/versions")[0] != 200:
        raise StackError(
            f"no homeserver at {homeserver}; start the slot's homeserver first", EXIT_NO_HOMESERVER
        )
    sha = resolve_commit(checkout, args.ref)
    slot_dir = stack_root() / f"slot-{slot}"
    state = read_state(slot_dir)
    if (
        running(state, slot_dir)
        and state["sha"] == sha
        and state["homeserver"] == homeserver
        and token_is_valid(homeserver, state["tester"]["accessToken"])
        and token_is_valid(homeserver, state["routerToken"])
    ):
        return state
    if state:
        log("the running stack is stale (other commit, stopped, or its homeserver was reset); restarting it")
    stop(slot_dir)

    source = prepare_source(checkout, sha)
    venv_bin = source / ".venv" / "bin"
    slot_dir.mkdir(parents=True)
    namespace = "t" + secrets.token_hex(4)
    tester = f"tester_{namespace}"
    status, body = matrix(
        homeserver,
        "POST",
        "/register",
        {"username": tester, "password": TESTER_PASSWORD, "auth": {"type": "m.login.dummy"}},
    )
    if status != 200:
        raise StackError(f"registering {tester} failed: {status} {body}")
    tester_id = body["user_id"]
    tester_token = body["access_token"]
    matrix(homeserver, "PUT", f"/profile/{tester_id}/displayname", {"displayname": "Tester"}, tester_token)

    (slot_dir / "approval_scripts").mkdir()
    (slot_dir / "approval_scripts" / "shell_review.py").write_text(SHELL_REVIEW)
    (slot_dir / "home").mkdir()
    (slot_dir / "stub").mkdir()
    stub_url = f"http://127.0.0.1:{port['stub']}/v1"
    config_path = slot_dir / "config.yaml"
    config_path.write_text(config_yaml(tester_id, stub_url, args.approval_expiry_days))
    api_url = f"http://127.0.0.1:{port['api']}"
    (slot_dir / ".env").write_text(
        "\n".join(
            [
                f"MATRIX_HOMESERVER={homeserver}",
                f"MATRIX_SERVER_NAME={SERVER_NAME}",
                "MATRIX_SSL_VERIFY=false",
                f"MINDROOM_NAMESPACE={namespace}",
                "OPENAI_API_KEY=stub-key-no-model-is-called",
                f"MINDROOM_API_KEY={secrets.token_hex(16)}",
                "MINDROOM_AUTO_BUILD_FRONTEND=0",
                "",
            ]
        )
    )
    env = {
        "PATH": f"{venv_bin}:{os.environ.get('PATH', '/usr/bin:/bin')}",
        "HOME": str(slot_dir / "home"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "TZ": "UTC",
        "MINDROOM_CONFIG_PATH": str(config_path),
        "PYTHONUNBUFFERED": "1",
    }
    state = {
        "slot": slot,
        "sha": sha,
        "checkout": str(checkout),
        "namespace": namespace,
        "homeserver": homeserver,
        "serverName": SERVER_NAME,
        "apiUrl": api_url,
        "stubUrl": stub_url,
        "dir": str(slot_dir),
        "logs": {"backend": str(slot_dir / "backend.log"), "stub": str(slot_dir / "stub.log")},
        "stubRequests": str(slot_dir / "stub" / "requests.jsonl"),
        "pids": {},
    }

    state["pids"]["stub"] = start_process(
        [
            str(venv_bin / "python"),
            str(HERE / "stub_model.py"),
            "--port",
            str(port["stub"]),
            "--log",
            state["stubRequests"],
            "--tag",
            str(slot_dir),
        ],
        cwd=slot_dir,
        env=env,
        log_path=slot_dir / "stub.log",
    )
    (slot_dir / "state.json").write_text(json.dumps(state, indent=1))
    wait_until("the stub model", lambda: http_json("GET", f"{stub_url}/models")[0] == 200, 60, 0.5)

    log(f"starting MindRoom {sha[:12]} (namespace {namespace}) on {api_url}")
    state["pids"]["backend"] = start_process(
        [
            str(venv_bin / "mindroom"),
            "run",
            "--config",
            str(config_path),
            "--storage-path",
            str(slot_dir / "storage"),
            "--api-port",
            str(port["api"]),
            "--api-host",
            "127.0.0.1",
            "--no-service",
        ],
        cwd=slot_dir,
        env=env,
        log_path=slot_dir / "backend.log",
    )
    (slot_dir / "state.json").write_text(json.dumps(state, indent=1))

    def backend_log_tail() -> str:
        try:
            text = (slot_dir / "backend.log").read_text(errors="replace")
        except OSError:
            return ""
        return "\n--- backend.log ---\n" + text[-4000:]

    def backend_alive() -> None:
        if not alive(state["pids"]["backend"], str(slot_dir)):
            raise StackError(f"MindRoom exited while starting{backend_log_tail()}")

    def healthy() -> bool:
        backend_alive()
        return http_json("GET", f"{api_url}/api/health", timeout=5)[0] == 200

    wait_until("the MindRoom API", healthy, 240, 1, backend_log_tail)

    def matrix_state() -> dict | None:
        backend_alive()
        path = slot_dir / "storage" / "matrix_state.yaml"
        if not path.exists():
            return None
        # The file is YAML; the backend's own Python reads it, so this script stays free of packages.
        result = subprocess.run(
            [
                str(venv_bin / "python"),
                "-c",
                "import json, sys, yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))",
                str(path),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            return None
        data = json.loads(result.stdout) or {}
        rooms = data.get("rooms") or {}
        accounts = data.get("accounts") or {}
        if not (rooms.get("lobby") or {}).get("room_id") or not data.get("space_room_id"):
            return None
        if not all((accounts.get(f"agent_{name}") or {}).get("access_token") for name in ["router", *AGENTS]):
            return None
        return data

    data = wait_until("the agents' accounts and rooms", matrix_state, 240, 1, backend_log_tail)
    lobby = data["rooms"]["lobby"]["room_id"]
    space = data["space_room_id"]
    accounts = data["accounts"]
    agent_ids = {
        name: f"@{accounts[f'agent_{name}']['username']}:{accounts[f'agent_{name}']['domain']}"
        for name in ["router", *AGENTS]
    }

    def joined(room_id: str) -> bool:
        backend_alive()
        status, _ = matrix(homeserver, "POST", f"/join/{urllib.request.quote(room_id)}", {}, tester_token)
        return status == 200

    wait_until("the invites to the lobby and the space", lambda: joined(lobby) and joined(space), 120, 1)

    def agents_in_lobby() -> bool:
        backend_alive()
        status, body = matrix(
            homeserver, "GET", f"/rooms/{urllib.request.quote(lobby)}/joined_members", token=tester_token
        )
        return status == 200 and all(agent in body.get("joined", {}) for agent in agent_ids.values())

    wait_until("the agents to join the lobby", agents_in_lobby, 120, 1, backend_log_tail)

    state.update(
        {
            "tester": {
                "userId": tester_id,
                "username": tester,
                "password": TESTER_PASSWORD,
                "accessToken": tester_token,
            },
            "routerToken": accounts["agent_router"]["access_token"],
            "agents": agent_ids,
            "agentNames": {"router": "MindRoom", **AGENTS},
            "rooms": {"lobby": lobby, "space": space},
            "approvalExpirySeconds": round(args.approval_expiry_days * 86400),
        }
    )
    (slot_dir / "state.json").write_text(json.dumps(state, indent=1))
    log(f"ready: {tester_id} in lobby {lobby}")
    return state


def public_state(state: dict) -> dict:
    return {key: value for key, value in state.items() if key != "routerToken"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("slot", type=int)
    parser.add_argument("command", choices=["up", "down", "status"])
    parser.add_argument(
        "--checkout", help=f"MindRoom checkout (default $E2E_MINDROOM_CHECKOUT or {DEFAULT_CHECKOUT})"
    )
    parser.add_argument(
        "--ref", help="commit to run (default $E2E_MINDROOM_REF, else origin/main, else HEAD)"
    )
    parser.add_argument(
        "--approval-expiry-days",
        type=float,
        default=0.0003,
        help="expiry of untag_thread approvals, which the expiry spec waits for (default 0.0003, 26 s)",
    )
    args = parser.parse_args()
    if not 0 <= args.slot <= 50:
        parser.error("slot must be 0-50")
    slot_dir = stack_root() / f"slot-{args.slot}"
    try:
        with locked(stack_root() / f"slot-{args.slot}.lock"):
            if args.command == "down":
                stop(slot_dir)
                return 0
            if args.command == "status":
                state = read_state(slot_dir)
                if not running(state, slot_dir):
                    log("not running")
                    return 1
                print(json.dumps(public_state(state), indent=1))
                return 0
            state = up(args.slot, args)
            print(json.dumps(public_state(state), indent=1))
            return 0
    except StackError as error:
        log(str(error))
        return error.code


if __name__ == "__main__":
    sys.exit(main())
