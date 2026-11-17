#!/usr/bin/env python3
"""A fresh, throwaway MindRoom deployment for trying a change by hand: `just live up`, `down` and `status`.

Usage: python3 scripts/live.py up [--slot N] [--backend DIR] [--helper-model luna|haiku] [--env-file FILE] [--json]
       python3 scripts/live.py down [--slot N | --all-mine]
       python3 scripts/live.py status [--json]

`up` picks a free e2e slot in 50-99 (or --slot N) and starts, all on that slot:
  1. its own empty Tuwunel homeserver on 28100+N (`scripts/e2e-slot.sh N up`, e2e/docker-compose.yaml);
  2. this checkout's Chat, the Vite dev server (`vite --host 127.0.0.1 --port 4300+N --strictPort`), whose
     /config.json lists only that homeserver, so /login opens on it (scripts/e2e-client-config.mjs). A checkout
     without node_modules gets `npm ci` first;
  3. a MindRoom backend (scripts/agent-stack/stack.py N up --model live): a Helper agent, a normal assistant on GPT-6
     Luna (or Claude Haiku 5.5 with --helper-model haiku; both are in the config's models), and a fresh test account
     invited to the lobby.
It then prints the login URL, username, password, agents, lobby, logs and the config file (the backend reloads it:
edit it to change agents or models), and writes them as JSON to $MINDROOM_LIVE_ROOT/slot-N.json (default
/tmp/mindroom-live); --json prints that JSON alone. When a step fails, `up` stops what it started and shows that
step's last log lines.

The backend comes from --backend DIR, a MindRoom checkout or worktree, with its uncommitted changes to tracked files
(`git stash create` makes a commit of them without touching a branch, the stash or the index; untracked files are
left out unless they are `git add`ed); a clean one runs its HEAD. Without --backend it is origin/main of
$E2E_MINDROOM_CHECKOUT, else the first of ~/repos/dev/mindroom and ~/Work/dev/mindroom that exists, and `up` says how
old that commit is (`git fetch` there for a newer one).

The helper needs OPENAI_API_KEY (and ANTHROPIC_API_KEY with --helper-model haiku). Keys missing from the environment
are read from --env-file (default ~/.mindroom-chat/.env when it exists); only those two names are read, and they go
to the backend's process alone, never to a file this script writes or its output.

`down --slot N` stops slot N's Chat, backend and homeserver and deletes their data (`scripts/e2e-slot.sh N down`);
without options it stops the one deployment this checkout started, and --all-mine stops every one this checkout
started. It does nothing for a slot without a deployment. `status` lists every live deployment with its URLs.

This is the way to test a change live: never on the lab or production deployments.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "agent-stack"))
import stack  # noqa: E402

REPOSITORY = Path(__file__).resolve().parents[1]
SLOTS = range(50, 100)
KEY_NAMES = ("OPENAI_API_KEY", "ANTHROPIC_API_KEY")
DEFAULT_ENV_FILE = "~/.mindroom-chat/.env"
MIN_NODE = 24
# The ports of slot N beside the stack's (stack.ports): the call service of scripts/e2e-rtc.sh.
RTC_PORT_BASES = (29200, 29300, 29400, 29500)


class LiveError(Exception):
    """A step of `up` failed; `log` is the file whose last lines say why."""

    def __init__(self, message: str, log: Path | None = None) -> None:
        super().__init__(message)
        self.log = log


def say(message: str) -> None:
    print(f"live: {message}", file=sys.stderr, flush=True)


# Pure parts


def read_key_file(text: str, names: tuple[str, ...]) -> dict[str, str]:
    """The values of `names` in a dotenv file's text (`NAME=value`, `export NAME=value`, quotes and comments)."""
    found = {}
    for line in text.splitlines():
        match = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
        if not match or match.group(1) not in names:
            continue
        value = match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        else:
            value = re.sub(r"\s+#.*$", "", value)
        if value:
            found[match.group(1)] = value
    return found


def missing_keys(environ: dict[str, str], env_file: Path | None) -> dict[str, str]:
    """The keys of KEY_NAMES that the environment lacks, from the key file when there is one."""
    wanted = tuple(name for name in KEY_NAMES if not environ.get(name))
    if not wanted or env_file is None or not env_file.is_file():
        return {}
    return read_key_file(env_file.read_text(errors="replace"), wanted)


def slot_ports(slot: int) -> list[int]:
    return [*stack.ports(slot).values(), *(base + slot for base in RTC_PORT_BASES)]


def pick_slot(candidates, is_taken) -> int | None:
    """The first candidate slot that `is_taken` does not refuse."""
    return next((slot for slot in candidates if not is_taken(slot)), None)


def login_url(app_url: str, homeserver: str) -> str:
    return f"{app_url}/login/{urllib.parse.quote(homeserver, safe='')}"


def room_url(app_url: str, room_id: str) -> str:
    return f"{app_url}/home/{urllib.parse.quote(room_id, safe='')}"


def node_major(version: str) -> int:
    """The major version of `node --version` output (v24.1.0 -> 24); 0 when it is not one."""
    match = re.match(r"\s*v?(\d+)", version)
    return int(match.group(1)) if match else 0


def live_state(slot: int, stack_state: dict, chat: dict, backend: dict, state_file: Path, seconds: float) -> dict:
    """What `up` prints and writes, from stack.py's state and what this script started."""
    app_url = f"http://127.0.0.1:{stack.ports(slot)['app']}"
    homeserver = stack_state["homeserver"]
    names = stack_state.get("agentNames") or {}
    helper_model = (stack_state.get("models") or {}).get("first", {}).get("displayName")
    agents = [
        {
            "name": name,
            "displayName": names.get(name, name),
            "userId": user_id,
            **({"model": helper_model} if name != "router" else {"role": "router"}),
        }
        for name, user_id in (stack_state.get("agents") or {}).items()
    ]
    lobby = stack_state["rooms"]["lobby"]
    return {
        "slot": slot,
        "status": "ready",
        "chatUrl": app_url,
        "loginUrl": login_url(app_url, homeserver),
        "username": stack_state["tester"]["username"],
        "userId": stack_state["tester"]["userId"],
        "password": stack_state["tester"]["password"],
        "homeserver": homeserver,
        "serverName": stack_state.get("serverName"),
        "agents": agents,
        "lobby": {"roomId": lobby, "url": room_url(app_url, lobby)},
        "backend": {
            **backend,
            "commit": stack_state["sha"],
            "apiUrl": stack_state.get("apiUrl"),
            "log": (stack_state.get("logs") or {}).get("backend"),
            "config": str(Path(stack_state["dir"]) / "config.yaml"),
        },
        "chat": chat,
        "stateFile": str(state_file),
        "down": f"just live down --slot {slot}",
        "upSeconds": round(seconds),
    }


def summary(state: dict) -> str:
    """The short block `up` prints for a person."""
    agents = ", ".join(
        f"{agent['displayName']} {agent['userId']} ({agent.get('model') or agent.get('role')})"
        for agent in state["agents"]
    )
    backend = state["backend"]
    return "\n".join(
        [
            f"MindRoom live deployment on slot {state['slot']} is ready ({state['upSeconds']} s).",
            f"  Log in:     {state['loginUrl']}",
            f"  Username:   {state['username']}",
            f"  Password:   {state['password']}",
            f"  Lobby:      {state['lobby']['url']}",
            f"  Agents:     {agents}",
            f"  Homeserver: {state['homeserver']} (server name {state['serverName']})",
            f"  Backend:    MindRoom {backend['commit'][:12]}, {backend['source']}",
            f"              log {backend['log']}",
            f"  Config:     {backend['config']} (the backend reloads it: edit it to change agents or models)",
            f"  Chat:       {state['chatUrl']} from {state['chat']['checkout']}, log {state['chat']['log']}",
            f"  State:      {state['stateFile']}",
            f"  Stop it:    {state['down']}",
        ]
    )


# Files and processes


def live_root() -> Path:
    """The owner-only directory of the deployments' states, logs and locks, as stack.py keeps its root."""
    root = Path(os.environ.get("MINDROOM_LIVE_ROOT") or "/tmp/mindroom-live")
    with contextlib.suppress(FileExistsError):
        root.mkdir(mode=0o700, parents=True)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
        raise LiveError(
            f"refusing {root}: it must be a directory (not a symlink) of yours that no one else may write to"
        )
    return root


def state_path(slot: int) -> Path:
    return live_root() / f"slot-{slot}.json"


def read_states() -> dict[int, dict]:
    states = {}
    for path in live_root().glob("slot-*.json"):
        with contextlib.suppress(OSError, json.JSONDecodeError, ValueError):
            states[int(path.stem.removeprefix("slot-"))] = json.loads(path.read_text())
    return states


def write_state(slot: int, state: dict) -> None:
    path = state_path(slot)
    partial = path.with_suffix(".partial")
    partial.write_text(json.dumps(state, indent=1) + "\n")
    partial.replace(path)


@contextlib.contextmanager
def locked(path: Path):
    with path.open("w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        # As servers bind: a port that closed connections leave in TIME_WAIT is free, one with a listener is not.
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return True
    return False


def docker_projects() -> set[str]:
    """The compose projects that have a container or a volume on this machine."""
    projects = set()
    for command in (
        ["docker", "ps", "--all", "--format", '{{.Label "com.docker.compose.project"}}'],
        ["docker", "volume", "ls", "--format", '{{.Label "com.docker.compose.project"}}'],
    ):
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            raise LiveError(f"`{' '.join(command[:3])}` failed: {result.stderr.strip()}")
        projects.update(line.strip() for line in result.stdout.splitlines() if line.strip())
    return projects


def slot_taken(slot: int, projects: set[str], live: set[int]) -> bool:
    """Whether anything on this machine may use slot N: a live deployment, its homeserver's compose project, an agent
    stack's state, or a listener on any of its ports."""
    stack_dir = Path(os.environ.get("E2E_AGENT_STACK_ROOT") or "/tmp/mindroom-client-agents") / f"slot-{slot}"
    return (
        slot in live
        or f"mindroom-client-e2e-{slot}" in projects
        or stack_dir.exists()
        or any(port_in_use(port) for port in slot_ports(slot))
    )


def run_logged(command: list[str], log: Path, *, env: dict[str, str] | None = None, cwd: Path = REPOSITORY) -> None:
    with log.open("ab") as output:
        result = subprocess.run(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=output)
    if result.returncode != 0:
        raise LiveError(f"`{' '.join(command)}` exited with {result.returncode}", log)


def tail(path: Path | None, keys: dict[str, str], lines: int = 30) -> str:
    if not path:
        return ""
    try:
        text = "\n".join(path.read_text(errors="replace").splitlines()[-lines:])
    except OSError:
        return ""
    for secret in keys.values():
        text = text.replace(secret, "[key]")
    return f"--- last lines of {path} ---\n{text}"


def page_status(url: str) -> int:
    """The HTTP status of a page; 0 without an answer."""
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except (urllib.error.URLError, OSError):
        return 0


def copy_lines(source, log: Path) -> None:
    """Copies stack.py's progress lines to its log and to this script's stderr."""
    with log.open("ab") as output:
        for line in source:
            output.write(line)
            output.flush()
            sys.stderr.write(line.decode(errors="replace"))
            sys.stderr.flush()


def git(checkout: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(checkout), *args], check=True, capture_output=True, text=True
    ).stdout.strip()


def backend_source(backend: str | None) -> tuple[Path, str, str]:
    """The MindRoom checkout, the commit to run and a line saying where it comes from."""
    try:
        checkout = stack.resolve_checkout(backend)
    except stack.StackError as error:
        raise LiveError(f"{error}; pass --backend <a MindRoom checkout>") from error
    if backend:
        # A commit of the working tree's tracked changes, on no branch; empty when nothing changed.
        dirty = git(checkout, "stash", "create", "just live up: working tree")
        sha = dirty or git(checkout, "rev-parse", "HEAD")
        untracked = git(checkout, "ls-files", "--others", "--exclude-standard")
        source = f"the working tree of {checkout}" if dirty else f"HEAD of {checkout} (no uncommitted changes)"
        if untracked:
            count = len(untracked.splitlines())
            source += f"; {count} untracked files left out (`git add` them to include them)"
        return checkout, sha, source
    try:
        sha = git(checkout, "rev-parse", "--verify", "origin/main^{commit}")
    except subprocess.CalledProcessError as error:
        raise LiveError(f"{checkout} has no origin/main; pass --backend {checkout} to run its working tree") from error
    age = git(checkout, "log", "-1", "--format=%cr", sha)
    return checkout, sha, f"origin/main of {checkout}, committed {age}; `git -C {checkout} fetch` brings a newer one"


def check_tools() -> None:
    for tool in ("docker", "uv", "npm", "npx", "node", "git"):
        if not shutil.which(tool):
            raise LiveError(f"`{tool}` is not on PATH; run `nix develop -c just live up`")
    version = subprocess.run(["node", "--version"], capture_output=True, text=True).stdout
    if node_major(version) < MIN_NODE:
        raise LiveError(f"node {version.strip()} is too old (needs {MIN_NODE}+); run `nix develop -c just live up`")


# Commands


def up(args: argparse.Namespace) -> int:
    started = time.monotonic()
    check_tools()
    checkout, sha, source = backend_source(args.backend)
    env_file = Path(args.env_file).expanduser() if args.env_file else Path(DEFAULT_ENV_FILE).expanduser()
    keys = {name: os.environ[name] for name in KEY_NAMES if os.environ.get(name)}
    keys.update(missing_keys(dict(os.environ), env_file))
    needed = ["OPENAI_API_KEY", *(["ANTHROPIC_API_KEY"] if args.helper_model == "haiku" else [])]
    if missing := [name for name in needed if name not in keys]:
        raise LiveError(
            f"{' and '.join(missing)} is in neither the environment nor {env_file}; set it or pass --env-file FILE"
        )
    # npm writes node_modules/.package-lock.json last, so an install that stopped halfway runs again.
    installed = REPOSITORY / "node_modules" / ".package-lock.json"
    if not installed.is_file():
        with locked(live_root() / "npm-ci.lock"):
            if not installed.is_file():
                say(f"{REPOSITORY} has no node_modules; running `npm ci --no-audit --no-fund` (a few minutes)")
                run_logged(["npm", "ci", "--no-audit", "--no-fund"], live_root() / "npm-ci.log")

    with locked(live_root() / "pick.lock"):
        live = set(read_states())
        projects = docker_projects()
        if args.slot is not None:
            if slot_taken(args.slot, projects, live):
                raise LiveError(
                    f"slot {args.slot} is in use (`just live status`, `docker ps`, `ss -ltn`); pick another"
                )
            slot = args.slot
        else:
            slot = pick_slot(SLOTS, lambda n: slot_taken(n, projects, live))
            if slot is None:
                raise LiveError(f"no free slot in {SLOTS.start}-{SLOTS.stop - 1}")
        directory = live_root() / f"slot-{slot}"
        shutil.rmtree(directory, ignore_errors=True)
        directory.mkdir()
        state = {"slot": slot, "status": "starting", "upPid": os.getpid(), "chat": {"checkout": str(REPOSITORY)}}
        write_state(slot, state)
    say(f"slot {slot}")

    port = stack.ports(slot)
    homeserver = f"http://127.0.0.1:{port['matrix']}"
    app_url = f"http://127.0.0.1:{port['app']}"
    chat_log = directory / "chat.log"
    stack_log = directory / "stack.log"
    step = "homeserver"
    backend_process: subprocess.Popen | None = None
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    try:
        say(f"starting the homeserver on {homeserver}")
        run_logged(["bash", str(REPOSITORY / "scripts" / "e2e-slot.sh"), str(slot), "up"], directory / "homeserver.log")

        step = "chat"
        say(f"starting Chat on {app_url}")
        chat_env = {
            **{name: value for name, value in os.environ.items() if name not in KEY_NAMES},
            "MINDROOM_E2E_PROVISIONING_URL": app_url,
            "MINDROOM_E2E_HOMESERVER": homeserver,
            # Its own pre-bundle directory, as a slot's dev server has (vite.config.js).
            "E2E_APP_PORT": str(port["app"]),
        }
        chat_pid = stack.start_process(
            # `npx vite` without npm's process in between, so the recorded PID is the server's.
            [
                "node",
                "node_modules/vite/bin/vite.js",
                "--host",
                "127.0.0.1",
                "--port",
                str(port["app"]),
                "--strictPort",
            ],
            cwd=REPOSITORY,
            env=chat_env,
            log_path=chat_log,
        )
        state["chat"] = {"checkout": str(REPOSITORY), "pid": chat_pid, "log": str(chat_log)}
        write_state(slot, state)

        step = "backend"
        say(f"starting MindRoom {sha[:12]} ({source}); a commit's first start installs it, which takes a few minutes")
        backend_env = {**{name: value for name, value in os.environ.items() if name not in KEY_NAMES}, **keys}
        command = [
            sys.executable,
            str(REPOSITORY / "scripts" / "agent-stack" / "stack.py"),
            str(slot),
            "up",
            "--model",
            "live",
            "--helper-model",
            args.helper_model,
            "--client-sessions",
            "--checkout",
            str(checkout),
            "--ref",
            sha,
        ]
        backend_process = subprocess.Popen(
            command,
            cwd=REPOSITORY,
            env=backend_env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        progress = threading.Thread(target=copy_lines, args=(backend_process.stderr, stack_log), daemon=True)
        progress.start()
        assert backend_process.stdout is not None
        output = backend_process.stdout.read()
        backend_process.wait()
        progress.join()
        if backend_process.returncode != 0:
            raise LiveError(f"stack.py exited with {backend_process.returncode}", stack_log)
        stack_state = json.loads(output)

        step = "chat"

        def page_ready() -> bool:
            if not stack.alive(chat_pid, "vite"):
                raise LiveError("the Chat dev server exited", chat_log)
            status, config = stack.http_json("GET", f"{app_url}/config.json")
            return status == 200 and config.get("homeserverList") == [homeserver]

        deadline = time.monotonic() + 120
        while not page_ready():
            if time.monotonic() > deadline:
                raise LiveError(f"{app_url}/config.json did not list {homeserver} within 120 s", chat_log)
            time.sleep(0.5)
        if page_status(f"{app_url}/login") != 200:
            raise LiveError(f"{app_url}/login does not answer", chat_log)
    except BaseException as error:
        if backend_process and backend_process.poll() is None:
            backend_process.terminate()
            backend_process.wait()
        if isinstance(error, LiveError):
            say(f"step {step} failed: {error}")
            print(tail(error.log, keys), file=sys.stderr)
        elif isinstance(error, (KeyboardInterrupt, SystemExit)):
            say(f"stopped during step {step}")
        else:
            say(f"step {step} failed: {error!r}")
        say(f"stopping what this start started on slot {slot}")
        stop_slot(slot)
        return error.code if isinstance(error, SystemExit) and isinstance(error.code, int) else 1

    backend = {"checkout": str(checkout), "source": source, "stackLog": str(stack_log)}
    full = live_state(slot, stack_state, state["chat"], backend, state_path(slot), time.monotonic() - started)
    write_state(slot, full)
    print(json.dumps(full, indent=1) if args.json else summary(full), flush=True)
    return 0


def stop_slot(slot: int) -> None:
    """Stops slot N's Chat, backend and homeserver and deletes their data and this script's state of it."""
    state = read_states().get(slot) or {}
    up_pid = state.get("upPid")
    if state.get("status") == "starting" and up_pid and up_pid != os.getpid() and stack.alive(up_pid, "live.py"):
        # An `up` still going stops what it started itself.
        os.kill(up_pid, signal.SIGTERM)
        deadline = time.monotonic() + 60
        while stack.alive(up_pid, "live.py") and time.monotonic() < deadline:
            time.sleep(0.5)
    stack.stop_process((state.get("chat") or {}).get("pid"), "vite")
    subprocess.run(
        ["bash", str(REPOSITORY / "scripts" / "e2e-slot.sh"), str(slot), "down"],
        cwd=REPOSITORY,
        stdin=subprocess.DEVNULL,
        # Its Docker output says what it removed; stdout stays for --json.
        stdout=sys.stderr,
    )
    shutil.rmtree(live_root() / f"slot-{slot}", ignore_errors=True)
    state_path(slot).unlink(missing_ok=True)


def mine(states: dict[int, dict]) -> list[int]:
    return sorted(
        slot for slot, state in states.items() if (state.get("chat") or {}).get("checkout") == str(REPOSITORY)
    )


def down(args: argparse.Namespace) -> int:
    states = read_states()
    if args.slot is not None:
        slots = [args.slot] if args.slot in states else []
        if not slots:
            say(f"no live deployment on slot {args.slot}")
    else:
        slots = mine(states)
        if not slots:
            say(f"no live deployment from {REPOSITORY}")
        elif len(slots) > 1 and not args.all_mine:
            say(f"this checkout has deployments on slots {', '.join(map(str, slots))}; pass --slot N or --all-mine")
            return 2
    for slot in slots:
        say(f"stopping slot {slot}")
        stop_slot(slot)
        say(f"slot {slot} is down")
    return 0


def status(args: argparse.Namespace) -> int:
    states = read_states()
    rows = []
    for _slot, state in sorted(states.items()):
        if state.get("status") == "ready":
            chat = stack.alive((state.get("chat") or {}).get("pid"), "vite")
            server = stack.http_json("GET", f"{state['homeserver']}/_matrix/client/versions", timeout=3)[0] == 200
            health = "ready" if chat and server else "broken (Chat or homeserver gone)"
        else:
            health = "starting" if stack.alive(state.get("upPid"), "live.py") else "broken (its start was killed)"
        rows.append({**state, "health": health})
    if args.json:
        print(json.dumps(rows, indent=1))
        return 0
    if not rows:
        print("no live deployments (`just live up` starts one)")
    for row in rows:
        print(f"slot {row['slot']}: {row['health']}, Chat from {(row.get('chat') or {}).get('checkout')}")
        if row.get("loginUrl"):
            print(f"  {row['loginUrl']}  (username {row['username']}, password {row['password']})")
        print(f"  stop: just live down --slot {row['slot']}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("command", choices=["up", "down", "status"])
    parser.add_argument("--slot", type=int, help="up: this slot instead of a free one; down: stop this slot")
    parser.add_argument("--all-mine", action="store_true", help="down: every deployment this checkout started")
    parser.add_argument("--backend", help="up: a MindRoom checkout whose working tree the backend runs")
    parser.add_argument(
        "--helper-model",
        choices=sorted(stack.LIVE_MODELS),
        default="luna",
        help="up: the helper's model, luna (GPT-6 Luna, default) or haiku (Claude Haiku 5.5)",
    )
    parser.add_argument("--env-file", help=f"up: where to read missing provider keys (default {DEFAULT_ENV_FILE})")
    parser.add_argument("--json", action="store_true", help="up, status: print only JSON")
    args = parser.parse_args(argv)
    if args.slot is not None and not 1 <= args.slot <= 99:
        parser.error("--slot must be 1-99")
    os.umask(0o077)
    try:
        return {"up": up, "down": down, "status": status}[args.command](args)
    except LiveError as error:
        say(str(error))
        if error.log:
            print(tail(error.log, {}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
