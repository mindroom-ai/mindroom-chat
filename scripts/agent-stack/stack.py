#!/usr/bin/env python3
"""Run a real MindRoom backend, driven by a stub model or a real one, against one end-to-end slot's homeserver.

Usage: python3 scripts/agent-stack/stack.py <slot 0-99> up|down|status|usage [--model stub|real]
       [--transcription stub|real] [--calls SERVICE_URL [--calls-profile realtime|live]] [--client-sessions]
       [--computers [--computer-image IMAGE] [--computer-tools LIST]] [--checkout DIR] [--ref REV]

  up      start the stack, or reuse the one already running for this slot, and print its state as JSON
  down    stop the slot's stack and delete its storage and worker containers (a real-model stack first saves its
          usage, see below)
  status  print the state of the running stack, or exit 1
  usage   print the model calls and tokens of the running stack's backend log as JSON

The backend comes from a MindRoom checkout (--checkout, $E2E_MINDROOM_CHECKOUT, default
/home/basnijholt/Work/dev/mindroom) at a commit (--ref, $E2E_MINDROOM_REF, default the checkout's origin/main
when it has one, otherwise HEAD). The checkout is only read: `git archive` copies the commit to
$E2E_AGENT_STACK_ROOT/src/<sha> (default /tmp/mindroom-client-agents), where `uv sync` makes its environment.

Each start gets a new MindRoom namespace, so the agents (@mindroom_<agent>_<namespace>), their rooms and the
test account never meet accounts an earlier start left on the homeserver. The model is
scripts/agent-stack/stub_model.py, an OpenAI-compatible server that never calls a real model.

Ports for slot N: homeserver 28100+N (slot 0: 28008, as scripts/e2e-slot.sh), MindRoom API 29600+N, stub
model 29700+N, plugin origins 29800+N; each range holds 100 ports, so slots 0-99 never share one. Exit codes: 3 no
MindRoom checkout, 4 no homeserver, 5 no provider keys for --model real, --transcription real or --calls, 1 anything
else.

--model real (or $E2E_AGENT_MODEL=real) runs the helper on Claude Haiku 5.5, with GPT-6 Luna as the thread's other
model, the router's and the thread summaries' model. The helper's instructions turn the stub's hashtags into a script
the model follows, so the same specs drive it. The keys come from this script's environment only: the caller sources
them into the command that runs it (`set -a; . <key file>; set +a; ...`), and they reach the backend's process
environment and nothing else; no file this script writes holds one. The backend may still put them in its own state,
so set $E2E_AGENT_STACK_ROOT to a private directory for a real-model stack. `down` writes the stack's model calls and
tokens to $E2E_AGENT_STACK_ROOT/usage/ before it deletes the stack.

--calls SERVICE_URL makes the helper answer MatrixRTC voice calls on the MatrixRTC authorization
service at that URL (the slot's scripts/e2e-rtc.sh service), with a realtime OpenAI voice model: gpt-realtime-2.1-mini
(--calls-profile realtime, the default) or gpt-live-1 (live). It needs OPENAI_API_KEY in the environment, which, like
the real model's keys, reaches only the backend's process; the stub models keep a placeholder key of their own. The
backend then runs from an environment with MindRoom's matrix_calls extra ($E2E_AGENT_STACK_ROOT/src/<sha>-matrix_calls).
`usage` and `down` also report the voice models' tokens, which the backend keeps in the helper's session database.

--client-sessions lets the slot's Chat (http://127.0.0.1:4300+N, slot 0: 4200) sign in to the backend's client
sessions, which plugin routes accept: the Chat origin goes into MINDROOM_COMPUTER_ALLOWED_ORIGINS, and the API's URL
into MINDROOM_PUBLIC_URL, which makes it the OpenID audience and the origin the agents publish. Sign-in also needs a
homeserver that binds OpenID tokens, MindRoom's Tuwunel with TUWUNEL_MINDROOM_OPENID_AUDIENCE=true, as
e2e/docker-compose.yaml starts it for every slot; on any other, POST /api/client-sessions answers 403.

--computers gives the helper a Worker Computer (MindRoom's docs/tools/worker-computer.md): MindRoom runs Docker
workers with the computer security policy from mindroom-client-e2e-worker:<commit>, an image the first start builds
from the commit (a few minutes), or from --computer-image IMAGE ($E2E_COMPUTER_IMAGE), which must speak the
backend's worker protocol. The tools of --computer-tools (comma-separated, default browser_mcp) run in the agents'
workers and every other tool in the backend: with browser_mcp,shell the helper's browser opens what its shell serves
on the worker's loopback. The slot's worker containers are named mindroom-client-e2e-slot-N-* and labelled
mindroom-client-e2e.slot=N, and `down` removes those that the backend left. It needs Docker and implies
--client-sessions, since Chat opens a computer through the same origin settings.

A MindRoom commit with call transcripts (src/mindroom/call_transcripts) runs with `calls.transcripts` on; the slot's
Chat calls their client routes with --client-sessions. Its speech-to-text is a stand-in in stub_model.py that answers
from each WAV's header, and the stub model writes the notes. --transcription real (or $E2E_AGENT_TRANSCRIPTION=real,
and always with --model real) transcribes with OpenAI's speech-to-text and has GPT-6 Luna write the notes instead (a
`notes` model entry beside the stub models, or the real models' own `luna`), with OPENAI_API_KEY from the
environment. `usage` and `down` count the notes model's tokens but not speech-to-text's cost: it has no `LLM usage`
line in the backend log.

$E2E_PLUGIN_DIRS names plugin directories, separated like PATH; a relative one is relative to this repository (in a
scripts/e2e-slot.sh snapshot, to the snapshot). Each part of a directory is optional:
  mindroom.plugin.json and its modules  a MindRoom plugin (MindRoom's docs/plugins.md). `mindroom plugins check --json`
                                        checks it before the stack starts or is reused, and a failed check refuses the
                                        start with its detail; the backend then loads it and the helper offers its tools.
                                        A manifest with an `origin_module` turns plugin origins on: the backend serves
                                        its pages at http://<label>.<plugin name>.localhost:29800+N, the state's
                                        pluginOriginPort (null without one). Chat frames those pages and signs in to
                                        the plugin's routes only with --client-sessions, which a spec passes itself.
  e2e/stub-scenarios.json               more scenarios for the stub model (stub_model.py --scenarios).
  e2e/fixtures/*.html                   fixture pages. The slot's Chat serves each directory at
                                        /e2e-plugins/<directory name>/ (scripts/e2e-plugin-pages.mjs), so a page is at
                                        /e2e-plugins/<directory name>/e2e/fixtures/<page>.html.
e2e/fixtures/sample-plugin is one, which e2e/messages/agent-plugin-directory.spec.ts uses, and
e2e/fixtures/origin-plugin, with e2e/plugins/agent-plugin-origin.spec.ts, has plugin origins.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
import re
import secrets
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from matrix_http import http_json, register

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[1]
DEFAULT_CHECKOUT = "/home/basnijholt/Work/dev/mindroom"
SERVER_NAME = "matrix.localhost"
EXIT_NO_CHECKOUT = 3
EXIT_NO_HOMESERVER = 4
EXIT_NO_KEYS = 5
MODES = ("stub", "real")
# The agents of each mode. A real model runs only the helper, so the router never needs a model to pick one and the
# helper gets the person's own message, not the router's handoff.
AGENTS = {
    "stub": {"helper": "Helper", "scout": "Scout"},
    "real": {"helper": "Helper"},
}
# The thread's two models in each mode: the room default and the one the model picker switches to.
MODELS = {
    "stub": {
        "first": {"key": "default", "id": "stub-fast", "displayName": "Stub Fast"},
        "second": {"key": "deep", "id": "stub-deep", "displayName": "Stub Deep"},
    },
    "real": {
        "first": {"key": "default", "id": "claude-haiku-5-5", "displayName": "Claude Haiku 5.5"},
        "second": {"key": "luna", "id": "gpt-6-luna", "displayName": "GPT-6 Luna"},
    },
}
# USD per million tokens, from the providers' price pages; the backend prices each reply with them.
REAL_PRICING = {
    "default": {"input": 0.1, "output": 0.5, "cache_read": 0.01, "cache_write": 0.2},
    "luna": {"input": 0.1, "output": 0.5, "cache_read": 0.01, "cache_write": 0.125},
}
PROVIDER_KEYS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY")
REQUIRED_REAL_KEYS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY")
# The voice models a calls stack can give the helper, as MindRoom call profiles (docs/voice-calls.md).
CALL_PROFILES = {
    "realtime": {"backend": "realtime", "model": "gpt-realtime-2.1-mini"},
    "live": {"backend": "live", "model": "gpt-live-1"},
}
CALLS_EXTRA = "matrix_calls"
# Worker Computers (--computers) run in MindRoom's Docker workers, which need its docker extra and an image built
# from the commit with this Dockerfile (docs/tools/worker-computer.md).
DOCKER_EXTRA = "docker"
WORKER_DOCKERFILE = "local/instances/deploy/Dockerfile.mindroom"
# Each worker container of slot N carries this label with the value N.
SLOT_LABEL = "mindroom-client-e2e.slot"
# The parts of a plugin directory that this script reads ($E2E_PLUGIN_DIRS, see the docstring).
PLUGIN_MANIFEST = "mindroom.plugin.json"
PLUGIN_SCENARIOS = "e2e/stub-scenarios.json"
TRANSCRIPTION_MODES = ("stub", "real")
# The model that writes a call's notes when a stub-model stack transcribes with OpenAI. With the stand-in the stub
# model writes them, and a real-model stack has its own GPT-6 Luna write them.
NOTES_MODEL = {"key": "notes", "id": "gpt-6-luna", "displayName": "GPT-6 Luna"}
NOTES_PRICING = REAL_PRICING["luna"]
# The stand-in speech-to-text model of stub_model.py.
STUB_STT_MODEL = "stub-transcribe"


class StackError(Exception):
    def __init__(self, message: str, code: int = 1) -> None:
        super().__init__(message)
        self.code = code


def log(message: str) -> None:
    print(f"agent-stack: {message}", file=sys.stderr, flush=True)


def ports(slot: int) -> dict[str, int]:
    """The slot's ports; each service has a range of 100, so slots 0-99 never share one."""
    return {
        "matrix": 28008 if slot == 0 else 28100 + slot,
        # The slot's Chat (scripts/e2e-slot.sh), the origin client sessions and computers admit.
        "app": 4200 if slot == 0 else 4300 + slot,
        "api": 29600 + slot,
        "stub": 29700 + slot,
        "origin": 29800 + slot,
    }


def stack_root() -> Path:
    """The root of the source trees, slots and locks, created owner-only when it is missing. A root that is not a
    directory, belongs to another user or that others may write to stops the script, untouched."""
    # Not under $TMPDIR: `nix develop` gives each shell its own, and a slot's stack must be found
    # (and stopped by `scripts/e2e-slot.sh <slot> down`) from every shell on the machine.
    root = Path(os.environ.get("E2E_AGENT_STACK_ROOT") or "/tmp/mindroom-client-agents")
    with contextlib.suppress(FileExistsError):
        root.mkdir(mode=0o700, parents=True)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
        raise StackError(
            f"refusing {root}: it must be a directory (not a symlink) of the current user that no one else may write to"
        )
    return root


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


def matrix(homeserver: str, method: str, path: str, body: object | None = None, token: str | None = None):
    return http_json(method, f"{homeserver}/_matrix/client/v3{path}", body, token)


def token_is_valid(homeserver: str, token: str | None) -> bool:
    if not token:
        return False
    status, _ = matrix(homeserver, "GET", "/account/whoami", token=token)
    return status == 200


def join_rooms(homeserver: str, rooms: dict[str, str], tester: dict, router_token: str, answers: dict) -> bool:
    """One try to join the test account to the lobby, then the space; true once it is in both.

    MindRoom invites the account to the space before the lobby. A space that still refuses the account once the
    lobby took it lost that invite: the backend skips it when its member list of the new space races a membership
    change (`room_invitations_skipped_members_unavailable`), and nothing retries it. The router, which made the
    space, then invites the account itself.
    """
    for name in ("lobby", "space"):
        path = f"/join/{urllib.request.quote(rooms[name])}"
        status, body = matrix(homeserver, "POST", path, {}, tester["accessToken"])
        if status == 403 and name == "space":
            invite = f"/rooms/{urllib.request.quote(rooms[name])}/invite"
            invited, _ = matrix(homeserver, "POST", invite, {"user_id": tester["userId"]}, router_token)
            log(f"the backend skipped the space invite; the router invited the test account ({invited})")
            status, body = matrix(homeserver, "POST", path, {}, tester["accessToken"])
        answers[name] = f"{status} {body.get('errcode') or ''}".strip()
        if status != 200:
            return False
    return True


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


def has_call_transcripts(checkout: Path, sha: str) -> bool:
    """Whether the commit transcribes calls between people (`calls.transcripts`)."""
    found = subprocess.run(
        ["git", "-C", str(checkout), "cat-file", "-e", f"{sha}:src/mindroom/call_transcripts"], capture_output=True
    )
    return found.returncode == 0


def package_version(checkout: Path, sha: str) -> str:
    """The version hatch-vcs would compute; the copy has no .git to compute it from."""
    try:
        described = git(checkout, "describe", "--tags", "--long", "--match", "v*", sha)
    except subprocess.CalledProcessError:
        return "0.0.0"
    tag, distance, _ = described.rsplit("-", 2)
    version = tag.removeprefix("v")
    return version if distance == "0" else f"{version}.post{distance}"


def prepare_source(checkout: Path, sha: str, extras: tuple[str, ...] = ()) -> Path:
    """Copy the commit out of the checkout once and give it a virtual environment (with MindRoom's `extras`).

    Each set of extras has its own copy: `uv sync` without an extra would take it out of an environment another
    stack runs from.
    """
    name = "-".join((sha, *extras))
    source = stack_root() / "src" / name
    with locked(stack_root() / "src" / f"{name}.lock"):
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
            ["uv", "sync", "--frozen", "--no-dev", *(f"--extra={extra}" for extra in extras), "--project", str(source)],
            env=env,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise StackError(f"uv sync failed:\n{result.stderr[-3000:]}")
        (source / ".complete").touch()
    return source


def build_worker_image(checkout: Path, sha: str, image: str) -> None:
    """Builds `image`, of the commit's Worker Computers, once: MindRoom refuses a worker whose protocol differs from
    the backend's."""
    with locked(stack_root() / "src" / f"{sha}-worker.lock"):
        if subprocess.run(["docker", "image", "inspect", image], capture_output=True).returncode == 0:
            return
        log(f"building the worker image {image} (the first time takes a few minutes)")
        archive = subprocess.Popen(["git", "-C", str(checkout), "archive", sha], stdout=subprocess.PIPE)
        # Closing this end once the build ends stops an archive the build did not read to its end.
        with archive.stdout:
            build = subprocess.run(
                ["docker", "build", "--quiet", "--tag", image, "--file", WORKER_DOCKERFILE, "-"],
                stdin=archive.stdout,
                capture_output=True,
                text=True,
            )
        if archive.wait() != 0 or build.returncode != 0:
            raise StackError(f"building {image} failed:\n{build.stderr[-3000:]}")


def plugin_dir_paths() -> list[Path]:
    """The directories $E2E_PLUGIN_DIRS names."""
    entries = os.environ.get("E2E_PLUGIN_DIRS", "").split(os.pathsep)
    return [(REPOSITORY / entry).resolve() for entry in entries if entry]


def check_plugin_dirs(venv_bin: Path, directories: list[Path]) -> list[dict]:
    """Each plugin directory as the state records it: its MindRoom plugin's name and tools, which
    `mindroom plugins check --json` reports, whether its manifest names an origin_module, and its scenario file. A
    plugin that fails the check refuses the start."""
    checked = []
    for directory in directories:
        if not directory.is_dir():
            raise StackError(f"E2E_PLUGIN_DIRS names {directory}, which is not a directory")
        plugin, tools, origins = None, [], False
        if (directory / PLUGIN_MANIFEST).is_file():
            result = subprocess.run(
                [str(venv_bin / "mindroom"), "plugins", "check", "--json", str(directory)],
                capture_output=True,
                text=True,
                # Provider keys reach the backend's process only (the docstring).
                env={name: value for name, value in os.environ.items() if name not in PROVIDER_KEYS},
            )
            try:
                report = json.loads(result.stdout)
            except json.JSONDecodeError:
                # A MindRoom without --json says why on stderr only.
                report = {"status": "failed", "detail": result.stderr.strip()[-3000:]}
            if report.get("status") != "compatible":
                raise StackError(f"the plugin in {directory} failed `mindroom plugins check`: {report.get('detail')}")
            plugin, tools = report["name"], report["tools"]
            # The check loaded the manifest, so it is JSON.
            origins = bool(json.loads((directory / PLUGIN_MANIFEST).read_text()).get("origin_module"))
        scenarios = directory / PLUGIN_SCENARIOS
        checked.append(
            {
                "dir": str(directory),
                "plugin": plugin,
                "tools": tools,
                "scenarios": str(scenarios) if scenarios.is_file() else None,
                "origins": origins,
            }
        )
    return checked


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


def provider_keys() -> dict[str, str]:
    """The provider keys of this script's environment, for a real-model backend's process environment only."""
    return {name: os.environ[name] for name in PROVIDER_KEYS if os.environ.get(name)}


def option_env(slot: int, client_sessions: bool, image: str | None) -> list[str]:
    """The .env lines of --client-sessions, and of --computers (which implies it), whose Docker workers run `image`."""
    if not client_sessions:
        return []
    port = ports(slot)
    # The slot's Chat may call the API's client sessions, plugin routes and computers, and the API's URL is the OpenID
    # audience and the origin the agents publish, so a token Chat binds to it signs Chat in.
    lines = [
        f"MINDROOM_PUBLIC_URL=http://127.0.0.1:{port['api']}",
        f'MINDROOM_COMPUTER_ALLOWED_ORIGINS=["http://127.0.0.1:{port["app"]}"]',
    ]
    if image:
        lines += [
            "MINDROOM_WORKER_BACKEND=docker",
            f"MINDROOM_DOCKER_WORKER_IMAGE={image}",
            "MINDROOM_DOCKER_WORKER_SECURITY_POLICY=computer",
            "MINDROOM_WORKER_COMPUTER_ENABLED=true",
            f"MINDROOM_DOCKER_WORKER_NAME_PREFIX=mindroom-client-e2e-slot-{slot}",
            f"MINDROOM_DOCKER_WORKER_LABELS_JSON={json.dumps({SLOT_LABEL: str(slot)}, separators=(',', ':'))}",
            # A worker's first start on a busy machine can take longer than MindRoom's default of 60 s.
            "MINDROOM_DOCKER_WORKER_READY_TIMEOUT_SECONDS=300",
            # MindRoom derives each worker's token from it.
            f"MINDROOM_SANDBOX_PROXY_TOKEN={secrets.token_hex(16)}",
        ]
    return lines


def stub_models_yaml(stub_url: str) -> str:
    return f"""models:
  default:
    provider: openai
    id: stub-fast
    display_name: Stub Fast
    api: chat_completions
    context_window: 128000
    extra_kwargs:
      base_url: {stub_url}
      api_key: stub-key-no-model-is-called
  deep:
    provider: openai
    id: stub-deep
    display_name: Stub Deep
    api: chat_completions
    context_window: 128000
    extra_kwargs:
      base_url: {stub_url}
      api_key: stub-key-no-model-is-called
"""


def real_models_yaml() -> str:
    first, second = MODELS["real"]["first"], MODELS["real"]["second"]

    def pricing(key: str) -> str:
        return json.dumps(REAL_PRICING[key])

    return f"""models:
  {first["key"]}:
    provider: anthropic
    id: {first["id"]}
    display_name: {first["displayName"]}
    context_window: 200000
    pricing: {pricing(first["key"])}
  {second["key"]}:
    provider: openai
    id: {second["id"]}
    display_name: {second["displayName"]}
    context_window: 1050000
    pricing: {pricing(second["key"])}
"""


def notes_model_yaml() -> str:
    """The models entry of the notes model that real speech-to-text comes with."""
    return f"""  {NOTES_MODEL["key"]}:
    provider: openai
    id: {NOTES_MODEL["id"]}
    display_name: {NOTES_MODEL["displayName"]}
    context_window: 1050000
    pricing: {json.dumps(NOTES_PRICING)}
"""


# The stub's scenarios (stub_model.py) as a script for a real model; the specs send the same hashtags in both modes.
# Replies that the stub streams word by word are longer here, so a fast model still streams for a few seconds.
REAL_INSTRUCTIONS = [
    "An automated end-to-end test of a chat client drives you. Follow this script exactly and literally. Never add "
    "greetings, explanations, questions, or tool calls the script does not ask for, and never call a tool twice "
    "unless the script says so.",
    "Read the person's latest message. When it contains one of the hashtags below, do what that hashtag says. "
    "Otherwise reply with one line: 'You said: ' followed by the person's latest message, copied word for word.",
    "#slow: reply with exactly 30 lines and nothing else. Line N starts with wordN (word1 on the first line, word30 "
    "on the last) and goes on with one sentence of about twenty words about the weather. Each of word1 to word30 "
    "appears exactly once, and no other word starts with 'word' followed by a digit.",
    "#stopme: reply with word1 word2 word3 and so on up to word400, separated by single spaces, and nothing else. "
    "Never shorten or skip part of the sequence.",
    "#long: reply in Markdown with the line 'Here is a long reply.', then a numbered list of 80 items where item N "
    "reads 'Line N of a long reply, long enough to fill the thread.', then a last paragraph 'End of the long reply.'",
    "#markdown: reply in Markdown with a level-two heading, a table of three rows with the columns Item and Value, "
    "a fenced Python code block of two lines, a bulleted list of three items, some inline code, and a link to "
    "https://example.org.",
    "#think: think the question through first, then reply with the answer to: what is 17 times 23?",
    "#widetable: reply in Markdown with one sentence, then a table of 6 columns (Region, Quarter, Revenue in USD, "
    "Change versus last year, Main driver, Notes for the board) and 4 rows whose cells hold a few words each, then "
    "one closing sentence.",
    "#shell: call run_shell_command once with args 'echo hello from the stub', then reply with its output.",
    "#multi: call run_shell_command three times, one call at a time, each only after the previous result arrived: "
    "first with args 'echo step one', then with args 'sleep 10; echo step two', then with args 'echo step three'. "
    "Then reply 'Finished multi after 3 tool calls. Last result:' followed by the last call's output in a code "
    "block, and nothing about the other calls.",
    "#pause: call run_shell_command twice, one call at a time, the second only after the first result arrived: "
    "first with args 'sleep 1; echo first step', then with args 'sleep 1; echo second step'. Then reply 'Finished "
    "pause after 2 tool calls. Last result:' followed by the last call's output in a code block.",
    "#narrate (a real model's usual shape, which the stub has no scenario for): first write one sentence saying "
    "you will run a command, then call run_shell_command once with args 'echo narrated', then write two sentences "
    "about its output.",
    "#parallel: call run_shell_command twice in the same step, without waiting between them, with args "
    "'echo left' and 'echo right'; then reply with both outputs.",
    "#approve: call run_shell_command once with args 'echo needs-approval: deploy the stub'. When it returns, reply "
    "with its output. When the call was denied, reply 'The call was denied: ' followed by the reason, word for word.",
    "#title: call set_thread_summary once with summary 'Stub picked this title from a tool call', then reply 'Done.'",
    "#tag: call tag_thread once with tag 'stub-tag' and note 'tagged by the stub model', then reply 'Done.'",
    "#expire: call untag_thread once with tag 'stub-tag', then reply with what the tool returned.",
    "#resolve: call resolve_thread once, then reply with what the tool returned.",
    "#schedulesoon: call schedule once with request 'in 20 seconds remind me to stretch' and new_thread false, "
    "then reply 'Scheduled.'",
    "#schedule (without 'soon'): call schedule once with request 'in 150 seconds remind me to stretch' and "
    "new_thread false, then reply 'Scheduled.'",
    "#canvas: call show_canvas once with title 'Stub canvas' and exactly this html: "
    "<!doctype html><html><body style='font-family:sans-serif;padding:16px'><h1>Pick a color</h1>"
    "<button id='red'>Red</button> <button id='blue'>Blue</button><script>for (const id of ['red', 'blue']) "
    "document.getElementById(id).onclick = () => window.mindroom.submit({color: id});</script></body></html> "
    "Then reply 'Done.' When a later message brings data submitted from that canvas, reply 'You said: ' followed by "
    "the data as compact JSON without spaces, such as {\"color\":\"red\"}.",
    "#job: call run_shell_command once with args 'sleep 45; echo background job finished' and background_after 0, "
    "then reply 'Started.' When you are told that background jobs ended, collect them with the job tool and reply "
    "with the result.",
    "When a tool call is denied, quote the reason word for word. Never retry a denied or expired call.",
]


def calls_yaml(calls: dict | None, transcription: dict | None = None) -> str:
    """The calls section: the helper answers voice calls on the slot's MatrixRTC service with the chosen profile, and
    calls between people are transcribed."""
    if not calls and not transcription:
        return ""
    section = "\ncalls:\n"
    if calls:
        profile = CALL_PROFILES[calls["profile"]]
        section += f"""  enabled: true
  livekit_service_url: {calls["serviceUrl"]}
  profiles:
    voice:
      backend: {profile["backend"]}
      model: {profile["model"]}
      credentials_service: openai
      voice: marin
  agents:
    helper: voice
"""
    if transcription:
        section += f"""  transcripts:
    enabled: true
    notes_model: {transcription["notesModel"]}
    languages: [en]
"""
    return section


def voice_yaml(transcription: dict | None, stub_url: str) -> str:
    """The speech-to-text that call transcripts use: OpenAI's, or the stand-in of stub_model.py."""
    if not transcription:
        return ""
    if transcription["stt"] == "real":
        return """
voice:
  stt:
    provider: openai
    credentials_service: openai
"""
    return f"""
voice:
  stt:
    provider: openai_compatible
    host: {stub_url}
    model: {STUB_STT_MODEL}
"""


def config_yaml(
    mode: str,
    tester_id: str,
    stub_url: str,
    approval_expiry_days: float,
    calls: dict | None = None,
    computers: dict | None = None,
    plugin_dirs: list[dict] | None = None,
    transcription: dict | None = None,
) -> str:
    plugin_dirs = plugin_dirs or []
    agent_tools = """      - shell
      - scheduler
      - thread_summary
      - thread_tags
      - thread_resolution
      - thread_model
      - chat_ui:
          enable_show_canvas: true"""
    # The backend loads the plugin directories' plugins, and the helper offers their tools.
    agent_tools += "".join(f"\n      - {tool}" for directory in plugin_dirs for tool in directory["tools"])
    plugin_paths = "".join(f"  - path: {json.dumps(d['dir'])}\n" for d in plugin_dirs if d["plugin"])
    plugins = f"plugins:\n{plugin_paths}" if plugin_paths else ""
    # A Worker Computer is a browser in a worker of one person and agent; the tools that share it run there too, and
    # every other tool stays in the backend.
    worker_defaults = ""
    if computers:
        worker_defaults = f"  worker_tools: {json.dumps(computers['tools'])}\n  worker_scope: user_agent\n"
        agent_tools += "\n      - browser_mcp"
    if mode == "real":
        # JSON strings are YAML flow scalars, so the script needs no escaping of its own.
        instructions = "\n".join(f"      - {json.dumps(line)}" for line in REAL_INSTRUCTIONS)
        models = real_models_yaml()
        second = MODELS["real"]["second"]["key"]
        agents = f"""  helper:
    display_name: Helper
    role: Test agent that follows the script of an automated end-to-end test
    model: default
    rooms: [lobby]
    instructions:
{instructions}
    tools:
{agent_tools}
"""
        router_model = second
        summary_model = f"  thread_summary_model: {second}\n"
        header = "# Written by scripts/agent-stack/stack.py --model real; the helper follows a script keyed by hashtags."
    else:
        models = stub_models_yaml(stub_url)
        agents = f"""  helper:
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
"""
        router_model = "default"
        summary_model = ""
        header = "# Written by scripts/agent-stack/stack.py; the stub model picks a scenario from hashtags in the message."
    if transcription and transcription["notesModel"] == NOTES_MODEL["key"]:
        models += notes_model_yaml()
    return f"""{header}
{models}
agents:
{agents}
router:
  model: {router_model}

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
{worker_defaults}{summary_model}
administrators:
  - "{tester_id}"
room_defaults:
  invite_users:
    - "{tester_id}"

timezone: UTC
memory: none
{plugins}{calls_yaml(calls, transcription)}{voice_yaml(transcription, stub_url)}"""


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
    """A start that finished (`ready`) and whose processes still run."""
    if not state or not state.get("ready"):
        return False
    marker = str(slot_dir)
    pids = state.get("pids") or {}
    stub_ok = state.get("model") == "real" or alive(pids.get("stub"), marker)
    return alive(pids.get("backend"), marker) and stub_ok


def stop_processes(slot_dir: Path) -> None:
    state = read_state(slot_dir) or {}
    for name in ("backend", "stub"):
        stop_process((state.get("pids") or {}).get(name), str(slot_dir))


def remove_workers(slot: int) -> None:
    """Removes the slot's worker containers, which a backend that was killed or crashed leaves behind."""
    found = subprocess.run(
        ["docker", "ps", "--all", "--quiet", "--filter", f"label={SLOT_LABEL}={slot}"], capture_output=True, text=True
    )
    ids = found.stdout.split()
    removed = subprocess.run(["docker", "rm", "--force", *ids], capture_output=True, text=True) if ids else found
    if removed.returncode != 0:
        log(f"removing the worker containers of slot {slot} failed: {removed.stderr.strip()[-3000:]}")


def stop(slot_dir: Path) -> None:
    stop_processes(slot_dir)
    state = read_state(slot_dir)
    if state and state.get("computers"):
        remove_workers(state["slot"])
    save_usage(slot_dir)
    shutil.rmtree(slot_dir, ignore_errors=True)


# Model usage, from the `LLM usage` line the backend logs at the end of every provider request

# context_input_tokens is all the input a request held; uncached_input_tokens the part not read from a cache, so
# with cache_read_tokens and cache_write_tokens it prices the same way for every provider.
USAGE_FIELDS = (
    "context_input_tokens",
    "uncached_input_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "output_tokens",
    "reasoning_tokens",
)
LOG_PAIR = re.compile(r"(\w+)=('[^']*'|\"[^\"]*\"|\S+)")


def usage_records(log_path: Path) -> list[dict]:
    """The backend's `LLM usage` lines (JSON or key=value console lines) as dictionaries."""
    try:
        lines = log_path.read_text(errors="replace").splitlines()
    except OSError:
        return []
    records = []
    for line in lines:
        if "LLM usage" not in line:
            continue
        start = line.find("{")
        try:
            record = json.loads(line[start:]) if start >= 0 else None
        except json.JSONDecodeError:
            record = None
        if not isinstance(record, dict):
            record = {key: value.strip("'\"") for key, value in LOG_PAIR.findall(line)}
        records.append(record)
    return records


def usage_summary(state: dict, slot_dir: Path) -> dict:
    """Calls, tokens and their price per model config of one stack's backend log."""
    models: dict[str, dict] = {}
    for record in usage_records(slot_dir / "backend.log"):
        name = str(record.get("model_name") or "?")
        entry = models.setdefault(
            name, {"modelId": record.get("model_id"), "calls": 0, **{field: 0 for field in USAGE_FIELDS}}
        )
        entry["calls"] += 1
        for field in USAGE_FIELDS:
            with contextlib.suppress(TypeError, ValueError):
                entry[field] += int(record.get(field) or 0)
    total_usd = 0.0
    real_notes = (state.get("transcription") or {}).get("stt") == "real"
    for name, entry in models.items():
        price = REAL_PRICING.get(name) if state.get("model") == "real" else None
        if name == NOTES_MODEL["key"] and real_notes:
            price = NOTES_PRICING
        if not price:
            continue
        # Cache writes are part of the uncached input and have their own price.
        plain_input = max(entry["uncached_input_tokens"] - entry["cache_write_tokens"], 0)
        usd = (
            plain_input * price["input"]
            + entry["cache_read_tokens"] * price["cache_read"]
            + entry["cache_write_tokens"] * price["cache_write"]
            + entry["output_tokens"] * price["output"]
        ) / 1_000_000
        entry["usd"] = round(usd, 4)
        total_usd += usd
    return {
        "slot": state.get("slot"),
        "namespace": state.get("namespace"),
        "model": state.get("model", "stub"),
        "calls": sum(entry["calls"] for entry in models.values()),
        "usd": round(total_usd, 4),
        "models": models,
        # Unpriced: the realtime models bill text and audio tokens at different rates.
        "voice": voice_usage(slot_dir),
    }


VOICE_USAGE_KINDS = ("realtime_voice", "live_voice")


def voice_usage(slot_dir: Path) -> list[dict]:
    """Each voice call's speech-model tokens (realtime) or billed seconds (GPT-Live), which the backend keeps in the
    agents' session databases, not its log."""
    calls = []
    for database in sorted((slot_dir / "storage" / "agents").glob("*/sessions/*.db")):
        try:
            with contextlib.closing(sqlite3.connect(f"file:{database}?mode=ro", uri=True)) as connection:
                tables = [
                    name
                    for (name,) in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
                    if name.endswith("_sessions_usage")
                ]
                rows = [row for table in tables for row in connection.execute(f'SELECT usage_data FROM "{table}"')]
        except sqlite3.Error:
            continue
        for (data,) in rows:
            try:
                usage = json.loads(data)
            except (TypeError, json.JSONDecodeError):
                continue
            if not isinstance(usage, dict) or usage.get("kind") not in VOICE_USAGE_KINDS:
                continue
            metrics = usage.get("metrics") or {}
            calls.append(
                {
                    "kind": usage["kind"],
                    "model": usage.get("model"),
                    "responses": len(usage.get("requests") or []),
                    # MindRoom's usage snapshot (usage/storage.py helper_usage_snapshot) for a live voice session.
                    "seconds": round(float(usage.get("voice_seconds") or 0), 1),
                    **{
                        field: int(metrics.get(field) or 0)
                        for field in (
                            "input_tokens",
                            "output_tokens",
                            "cache_read_tokens",
                            "audio_input_tokens",
                            "audio_output_tokens",
                        )
                    },
                }
            )
    return calls


def paid(state: dict) -> bool:
    """Whether the stack calls paid models: a real model, voice calls or real call transcripts."""
    return bool(
        state.get("model") == "real" or state.get("calls") or (state.get("transcription") or {}).get("stt") == "real"
    )


def save_usage(slot_dir: Path) -> None:
    """Keeps a paid stack's usage after `down` deletes its directory."""
    state = read_state(slot_dir)
    if not state or not paid(state) or not (slot_dir / "backend.log").exists():
        return
    summary = usage_summary(state, slot_dir)
    folder = stack_root() / "usage"
    folder.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%S")
    path = folder / f"slot-{state.get('slot')}-{state.get('namespace')}-{stamp}.json"
    path.write_text(json.dumps(summary, indent=1) + "\n")
    voice = f", {len(summary['voice'])} voice calls" if summary["voice"] else ""
    log(f"{summary['calls']} model calls, about {summary['usd']} USD{voice}; saved to {path}")


def calls_setting(args: argparse.Namespace) -> dict | None:
    """What --calls asks for, as the state records it, or None without calls."""
    if not args.calls:
        return None
    return {
        "serviceUrl": args.calls.rstrip("/"),
        "profile": args.calls_profile,
        "model": CALL_PROFILES[args.calls_profile]["model"],
    }


def computers_setting(args: argparse.Namespace, sha: str) -> dict | None:
    """What --computers asks for, as the state records it: the workers' image and the tools that run in them."""
    if not args.computers:
        return None
    return {
        "image": args.computer_image or f"mindroom-client-e2e-worker:{sha[:12]}",
        "tools": [tool for tool in args.computer_tools.split(",") if tool],
    }


def transcription_setting(args: argparse.Namespace, checkout: Path, sha: str) -> dict | None:
    """How the stack transcribes calls between people, as the state records it; None for a commit without them."""
    if not has_call_transcripts(checkout, sha):
        return None
    if args.model == "real":
        # Its own Luna writes the notes: a second entry of the same model would list it twice in the model picker.
        return {"stt": "real", "notesModel": MODELS["real"]["second"]["key"]}
    notes = NOTES_MODEL["key"] if args.transcription == "real" else MODELS["stub"]["first"]["key"]
    return {"stt": args.transcription, "notesModel": notes}


def started_with(
    state: dict,
    args: argparse.Namespace,
    sha: str,
    homeserver: str,
    plugin_dirs: list[dict] | None = None,
    transcription: dict | None = None,
) -> bool:
    """Whether a stack's state comes from a start with this model, calls, call transcripts, client sessions, computers,
    approval expiry and plugin directories (as check_plugin_dirs reports them), of this commit, on this homeserver; a
    state without clientSessions, computers or pluginDirs counts as one started without them."""
    return (
        state.get("model", "stub") == args.model
        and state.get("calls") == calls_setting(args)
        and state.get("transcription") == transcription
        and state.get("clientSessions", False) == args.client_sessions
        # Earlier starts recorded false without computers.
        and (state.get("computers") or None) == computers_setting(args, sha)
        and state.get("approvalExpiryDays") == args.approval_expiry_days
        and state.get("pluginDirs", []) == (plugin_dirs or [])
        and state.get("sha") == sha
        and state.get("homeserver") == homeserver
    )


def backend_bin(checkout: Path, sha: str, args: argparse.Namespace) -> Path:
    """The bin directory of the commit's environment, with the extras --calls (matrix_calls) and --computers (docker)
    need."""
    extras = (*((CALLS_EXTRA,) if args.calls else ()), *((DOCKER_EXTRA,) if args.computers else ()))
    return prepare_source(checkout, sha, extras) / ".venv" / "bin"


def up(slot: int, args: argparse.Namespace) -> dict:
    checkout = resolve_checkout(args.checkout)
    port = ports(slot)
    homeserver = f"http://127.0.0.1:{port['matrix']}"
    if http_json("GET", f"{homeserver}/_matrix/client/versions")[0] != 200:
        raise StackError(
            f"no homeserver at {homeserver}; start the slot's homeserver first", EXIT_NO_HOMESERVER
        )
    sha = resolve_commit(checkout, args.ref)
    calls = calls_setting(args)
    transcription = transcription_setting(args, checkout, sha)
    # Before the stack is reused or stopped: a broken plugin leaves a running stack as it is, and a plugin that gained
    # a tool restarts it.
    directories = plugin_dir_paths()
    plugin_dirs = check_plugin_dirs(backend_bin(checkout, sha, args), directories) if directories else []
    slot_dir = stack_root() / f"slot-{slot}"
    state = read_state(slot_dir)
    if (
        running(state, slot_dir)
        and started_with(state, args, sha, homeserver, plugin_dirs, transcription)
        and token_is_valid(homeserver, (state.get("tester") or {}).get("accessToken"))
        and token_is_valid(homeserver, state.get("routerToken"))
    ):
        return state
    if state:
        log(
            "the stack is stale (other commit, model or options, stopped, a start that failed, or its homeserver was "
            "reset); "
            "restarting it"
        )
    real = args.model == "real"
    real_transcription = bool(transcription and transcription["stt"] == "real")
    keys = provider_keys() if real or calls or real_transcription else {}
    # A voice call speaks through OpenAI's realtime models; real call transcripts go to OpenAI's speech-to-text.
    required = (*(REQUIRED_REAL_KEYS if real else ()), *(("OPENAI_API_KEY",) if calls or real_transcription else ()))
    missing = [name for name in dict.fromkeys(required) if name not in keys]
    if missing:
        options = {"--model real": real, "--transcription real": real_transcription and not real, "--calls": calls}
        needs = " and ".join(option for option, on in options.items() if on)
        raise StackError(
            f"{needs} needs {' and '.join(missing)} in the environment; source the key file into the command",
            EXIT_NO_KEYS,
        )
    stop(slot_dir)
    try:
        return start(slot, args, checkout, sha, homeserver, port, slot_dir, keys, plugin_dirs, transcription)
    except BaseException:
        # Whatever this start launched stops; its logs stay in the slot directory until the next start.
        stop_processes(slot_dir)
        raise


def start(
    slot: int,
    args: argparse.Namespace,
    checkout: Path,
    sha: str,
    homeserver: str,
    port: dict[str, int],
    slot_dir: Path,
    keys: dict[str, str],
    plugin_dirs: list[dict],
    transcription: dict | None,
) -> dict:
    """Starts the stack with the checked `plugin_dirs`; `keys` (paid models only) go to the backend's process
    environment and nowhere else."""
    calls = calls_setting(args)
    venv_bin = backend_bin(checkout, sha, args)
    computers = computers_setting(args, sha)
    if computers and not args.computer_image:
        build_worker_image(checkout, sha, computers["image"])
    real = args.model == "real"
    agents = AGENTS[args.model]
    slot_dir.mkdir(parents=True)
    namespace = "t" + secrets.token_hex(4)
    tester = f"tester_{namespace}"
    password = secrets.token_hex(16)
    try:
        account = register(homeserver, tester, password)
    except RuntimeError as error:
        raise StackError(f"registering {tester} failed: {error}") from error
    tester_id = account["user_id"]
    tester_token = account["access_token"]
    matrix(homeserver, "PUT", f"/profile/{tester_id}/displayname", {"displayname": "Tester"}, tester_token)

    (slot_dir / "approval_scripts").mkdir()
    (slot_dir / "approval_scripts" / "shell_review.py").write_text(SHELL_REVIEW)
    (slot_dir / "home").mkdir()
    (slot_dir / "stub").mkdir()
    stub_url = f"http://127.0.0.1:{port['stub']}/v1"
    config_path = slot_dir / "config.yaml"
    config_path.write_text(
        config_yaml(
            args.model,
            tester_id,
            stub_url,
            args.approval_expiry_days,
            calls,
            computers,
            plugin_dirs,
            transcription,
        )
    )
    api_url = f"http://127.0.0.1:{port['api']}"
    origin_port = port["origin"] if any(d["origins"] for d in plugin_dirs) else None
    (slot_dir / ".env").write_text(
        "\n".join(
            [
                f"MATRIX_HOMESERVER={homeserver}",
                f"MATRIX_SERVER_NAME={SERVER_NAME}",
                "MATRIX_SSL_VERIFY=false",
                f"MINDROOM_NAMESPACE={namespace}",
                *([] if keys else ["OPENAI_API_KEY=stub-key-no-model-is-called"]),
                f"MINDROOM_API_KEY={secrets.token_hex(16)}",
                "MINDROOM_AUTO_BUILD_FRONTEND=0",
                *option_env(slot, args.client_sessions, computers["image"] if computers else None),
                # Under the default domain, localhost: browsers send every *.localhost host to this machine.
                *([f"MINDROOM_PLUGIN_ORIGIN_PORT={origin_port}"] if origin_port else []),
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
    backend_env = dict(env)
    if keys:
        backend_env.update(keys)
        # uv's Python may not find this machine's CA store, and the providers are HTTPS.
        ca_file = os.environ.get("SSL_CERT_FILE") or "/etc/ssl/certs/ca-certificates.crt"
        if Path(ca_file).is_file():
            backend_env["SSL_CERT_FILE"] = ca_file
    state = {
        "slot": slot,
        "model": args.model,
        "models": MODELS[args.model],
        "calls": calls,
        "transcription": transcription,
        "clientSessions": args.client_sessions,
        "computers": computers,
        # The config's timeout_days, exactly: approvalExpirySeconds below is rounded.
        "approvalExpiryDays": args.approval_expiry_days,
        "pluginDirs": plugin_dirs,
        "sha": sha,
        "checkout": str(checkout),
        "namespace": namespace,
        "homeserver": homeserver,
        "serverName": SERVER_NAME,
        "apiUrl": api_url,
        "pluginOriginPort": origin_port,
        "stubUrl": stub_url,
        "dir": str(slot_dir),
        "logs": {"backend": str(slot_dir / "backend.log"), "stub": str(slot_dir / "stub.log")},
        "stubRequests": str(slot_dir / "stub" / "requests.jsonl"),
        "pids": {},
    }

    if not real:
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
                *(arg for d in plugin_dirs if d["scenarios"] for arg in ("--scenarios", d["scenarios"])),
            ],
            cwd=slot_dir,
            env=env,
            log_path=slot_dir / "stub.log",
        )
        (slot_dir / "state.json").write_text(json.dumps(state, indent=1))
        wait_until("the stub model", lambda: http_json("GET", f"{stub_url}/models")[0] == 200, 60, 0.5)

    voice = f", calls on {calls['model']}" if calls else ""
    log(f"starting MindRoom {sha[:12]} (namespace {namespace}, {args.model} model{voice}) on {api_url}")
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
        env=backend_env,
        log_path=slot_dir / "backend.log",
    )
    (slot_dir / "state.json").write_text(json.dumps(state, indent=1))

    def backend_log_tail() -> str:
        try:
            text = (slot_dir / "backend.log").read_text(errors="replace")
        except OSError:
            return ""
        tail = text[-4000:]
        # A key the backend echoed never reaches the caller's output.
        for secret in keys.values():
            tail = tail.replace(secret, "[key]")
        return "\n--- backend.log ---\n" + tail

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
        if not all((accounts.get(f"agent_{name}") or {}).get("access_token") for name in ["router", *agents]):
            return None
        return data

    data = wait_until("the agents' accounts and rooms", matrix_state, 240, 1, backend_log_tail)
    lobby = data["rooms"]["lobby"]["room_id"]
    space = data["space_room_id"]
    accounts = data["accounts"]
    agent_ids = {
        name: f"@{accounts[f'agent_{name}']['username']}:{accounts[f'agent_{name}']['domain']}"
        for name in ["router", *agents]
    }

    # The homeserver's last answer to each join, for the message of a start that gives up here.
    join_answers: dict[str, str] = {}

    def joined() -> bool:
        backend_alive()
        return join_rooms(
            homeserver,
            {"lobby": lobby, "space": space},
            {"userId": tester_id, "accessToken": tester_token},
            accounts["agent_router"]["access_token"],
            join_answers,
        )

    wait_until(
        "the invites to the lobby and the space",
        joined,
        120,
        1,
        lambda: f" (last join answers: {join_answers}){backend_log_tail()}",
    )

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
                "password": password,
                "accessToken": tester_token,
            },
            "routerToken": accounts["agent_router"]["access_token"],
            "agents": agent_ids,
            "agentNames": {"router": "MindRoom", **agents},
            "rooms": {"lobby": lobby, "space": space},
            "approvalExpirySeconds": round(args.approval_expiry_days * 86400),
            # Only a start that got here is reused; any other state file is restarted.
            "ready": True,
        }
    )
    (slot_dir / "state.json").write_text(json.dumps(state, indent=1))
    log(f"ready: {tester_id} in lobby {lobby}")
    return state


def public_state(state: dict) -> dict:
    return {key: value for key, value in state.items() if key not in ("routerToken", "ready")}


def exit_on_sigterm(_signum, _frame) -> None:
    # A caller that gives up (a spec's timeout) sends SIGTERM; exiting runs the cleanup of a failed start.
    sys.exit(143)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("slot", type=int)
    parser.add_argument("command", choices=["up", "down", "status", "usage"])
    parser.add_argument(
        "--model",
        choices=MODES,
        default=os.environ.get("E2E_AGENT_MODEL") or "stub",
        help="stub (default, or $E2E_AGENT_MODEL) or real: Claude Haiku 5.5 and GPT-6 Luna, with the keys of the "
        "environment",
    )
    parser.add_argument(
        "--transcription",
        choices=TRANSCRIPTION_MODES,
        default=os.environ.get("E2E_AGENT_TRANSCRIPTION") or "stub",
        help="call transcripts of a MindRoom that has them: stub (default, or $E2E_AGENT_TRANSCRIPTION), a stand-in "
        "speech-to-text and the stub model's notes, or real, OpenAI's speech-to-text and GPT-6 Luna's notes with "
        "OPENAI_API_KEY from the environment (--model real always transcribes for real)",
    )
    parser.add_argument(
        "--calls",
        metavar="SERVICE_URL",
        help="the helper answers voice calls on this MatrixRTC authorization service (scripts/e2e-rtc.sh env's "
        "E2E_LIVEKIT_SERVICE_URL); needs OPENAI_API_KEY in the environment",
    )
    parser.add_argument(
        "--calls-profile",
        choices=sorted(CALL_PROFILES),
        default="realtime",
        help="the helper's voice: realtime (gpt-realtime-2.1-mini, the default) or live (gpt-live-1)",
    )
    parser.add_argument(
        "--client-sessions",
        action="store_true",
        help="the slot's Chat may sign in to the backend's plugin routes with client sessions (needs a homeserver "
        "that binds OpenID tokens)",
    )
    parser.add_argument(
        "--computers",
        action="store_true",
        help="the helper gets a Worker Computer, in a Docker worker built from the same commit; implies "
        "--client-sessions",
    )
    parser.add_argument(
        "--computer-image",
        default=os.environ.get("E2E_COMPUTER_IMAGE") or None,
        help="with --computers, the workers' image instead of one built from the commit (default "
        "$E2E_COMPUTER_IMAGE); it must speak the backend's worker protocol",
    )
    parser.add_argument(
        "--computer-tools",
        metavar="LIST",
        default="browser_mcp",
        help="with --computers, the comma-separated tools that run in the agents' workers (default browser_mcp; "
        "browser_mcp,shell runs the shell beside the browser)",
    )
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
    if args.model not in MODES:
        parser.error(f"--model must be one of {', '.join(MODES)}")
    if args.transcription not in TRANSCRIPTION_MODES:
        parser.error(f"--transcription must be one of {', '.join(TRANSCRIPTION_MODES)}")
    if not 0 <= args.slot <= 99:
        parser.error("slot must be 0-99")
    # Chat opens a computer through the same origin settings as a client session.
    args.client_sessions = args.client_sessions or args.computers
    # A slot holds the stack's tokens and keys, so what this script and the stack's processes write is the owner's only.
    os.umask(0o077)
    signal.signal(signal.SIGTERM, exit_on_sigterm)
    try:
        root = stack_root()
        slot_dir = root / f"slot-{args.slot}"
        with locked(root / f"slot-{args.slot}.lock"):
            # Also a slot that an earlier version of this script left readable to others.
            if slot_dir.is_dir():
                slot_dir.chmod(0o700)
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
            if args.command == "usage":
                state = read_state(slot_dir)
                if not state:
                    log("no stack")
                    return 1
                print(json.dumps(usage_summary(state, slot_dir), indent=1))
                return 0
            state = up(args.slot, args)
            print(json.dumps(public_state(state), indent=1))
            return 0
    except StackError as error:
        log(str(error))
        return error.code


if __name__ == "__main__":
    sys.exit(main())
