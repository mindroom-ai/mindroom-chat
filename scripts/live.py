#!/usr/bin/env python3
"""A fresh, throwaway MindRoom deployment for trying a change by hand: `just live up`, `ask`, `run`, `down`, `status`.

Usage: python3 scripts/live.py up [--slot N] [--backend DIR] [--env-file FILE] [--json]
       python3 scripts/live.py ask <text> [--slot N] [--screenshot FILE]
       python3 scripts/live.py run <script.mjs> [args...]
       python3 scripts/live.py down [--slot N | --all-mine]
       python3 scripts/live.py status

`up` picks a free e2e slot in 50-99 (or --slot N), holding the slot's lock (scripts/e2e-slot.sh takes the same one
for its runs, and refuses a slot with a live deployment) while it starts, all on that slot:
  1. its own empty Tuwunel homeserver on 28100+N (`scripts/e2e-slot.sh N up`, e2e/docker-compose.yaml);
  2. this checkout's Chat, the Vite dev server (`vite --host 127.0.0.1 --port 4300+N --strictPort`), whose
     /config.json lists only that homeserver, so /login opens on it (scripts/e2e-client-config.mjs). A checkout
     without node_modules gets `npm ci` first;
  3. a MindRoom backend (scripts/agent-stack/stack.py N up --model live): a Helper agent, a normal assistant on GPT-6
     Luna (the config's `default`; `haiku`, Claude Haiku 5.5, is defined beside it), and a fresh test account invited
     to the lobby, where a plain message goes to the Helper (no mention needed).
It then prints the login URL, username, password, agents, lobby, logs and the config file (the backend reloads it:
edit it to change agents or models), and writes them as JSON to $MINDROOM_LIVE_ROOT/slot-N.json (default
/tmp/mindroom-live); --json prints that JSON alone. When a step fails, `up` stops what it started and says which step.

`ask` signs in to the deployment's Chat in Chromium (the only one running, or --slot N), sends the text to the lobby,
waits until the agent's reply is final, saves a screenshot (default $MINDROOM_LIVE_ROOT/slot-N-reply.png) and prints
the reply and the screenshot's path (scripts/live-ask.mjs). `run` runs a custom check, a Node script that imports
scripts/live-ask.mjs by its absolute path, with MINDROOM_LIVE_STATE naming the only ready deployment's state file.

`up`, `ask` and `run` need Node 24, and `ask` and `run` the Chromium of CHROMIUM_PATH; outside `nix develop` they
run themselves again inside it.

The backend comes from --backend DIR, a MindRoom checkout or worktree, with its uncommitted changes to tracked files
(`git stash create` makes a commit of them without touching a branch, the stash or the index; untracked files are
left out unless they are `git add`ed); a clean one runs its HEAD. Without --backend it is origin/main of
$E2E_MINDROOM_CHECKOUT, else the first of ~/repos/dev/mindroom and ~/Work/dev/mindroom that exists, and `up` says how
old that commit is.

The backend needs OPENAI_API_KEY, and ANTHROPIC_API_KEY once someone switches to `haiku`. Keys missing from the
environment are read from --env-file (default ~/.mindroom-chat/.env when it exists); only those two names are read,
and they go to the backend's process alone, never to a file this script writes or its output.

`down --slot N` stops slot N's Chat, backend and homeserver and deletes their data (`scripts/e2e-slot.sh N down`);
without options it stops the one deployment this checkout started, and --all-mine every one this checkout started.
When a part fails to stop, it keeps the deployment's state and logs and exits 1, so `down` again retries. `status`
lists every live deployment with its URLs and whether its Chat, homeserver and backend answer.

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
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "agent-stack"))
import stack  # noqa: E402

REPOSITORY = Path(__file__).resolve().parents[1]
ASK_SCRIPT = REPOSITORY / "scripts" / "live-ask.mjs"
SLOTS = range(50, 100)
KEY_NAMES = ("OPENAI_API_KEY", "ANTHROPIC_API_KEY")
DEFAULT_ENV_FILE = "~/.mindroom-chat/.env"
MIN_NODE = 24
# Set in the `nix develop` run of this script, so it never starts another.
IN_NIX = "MINDROOM_LIVE_IN_NIX"
# The ports of slot N beside the stack's (stack.ports): the call service of scripts/e2e-rtc.sh.
RTC_PORT_BASES = (29200, 29300, 29400, 29500)


class LiveError(Exception):
    """A step failed; `log` is the file whose last lines say why."""

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


def missing_keys(environ: dict[str, str], env_file: Path) -> dict[str, str]:
    """The keys of KEY_NAMES that the environment lacks, from the key file when there is one."""
    wanted = tuple(name for name in KEY_NAMES if not environ.get(name))
    if not wanted or not env_file.is_file():
        return {}
    return read_key_file(env_file.read_text(errors="replace"), wanted)


def slot_ports(slot: int) -> list[int]:
    return [*stack.ports(slot).values(), *(base + slot for base in RTC_PORT_BASES)]


def node_major(version: str) -> int:
    """The major version of `node --version` output (v24.1.0 -> 24); 0 when it is not one."""
    match = re.match(r"\s*v?(\d+)", version)
    return int(match.group(1)) if match else 0


def toolchain_problem(command: str, node_version: str, environ: dict[str, str]) -> str | None:
    """Why `command` cannot run in this shell, or None: an old or missing Node, or no Chromium for a browser."""
    if node_major(node_version) < MIN_NODE:
        return f"node {node_version.strip()} is too old" if node_version.strip() else "node is missing"
    if command != "up" and not environ.get("CHROMIUM_PATH"):
        return "CHROMIUM_PATH is not set"
    return None


def live_state(slot: int, stack_state: dict, chat: dict, backend: dict, seconds: float) -> dict:
    """What `up` prints and writes, from stack.py's state and what this script started."""
    app_url = f"http://127.0.0.1:{stack.ports(slot)['app']}"
    homeserver = stack_state["homeserver"]
    names = stack_state.get("agentNames") or {}
    helper_model = stack_state["models"]["first"]["displayName"]
    agents = [
        {
            "name": name,
            "displayName": names.get(name, name),
            "userId": user_id,
            **({"role": "router"} if name == "router" else {"model": helper_model}),
        }
        for name, user_id in stack_state["agents"].items()
    ]
    lobby = stack_state["rooms"]["lobby"]
    tester = stack_state["tester"]
    return {
        "slot": slot,
        "status": "ready",
        "chatUrl": app_url,
        "loginUrl": f"{app_url}/login/{urllib.parse.quote(homeserver, safe='')}",
        "username": tester["username"],
        "userId": tester["userId"],
        "password": tester["password"],
        # The Matrix API token of the same account, for checks from outside the page (scripts/live-ask.mjs).
        "accessToken": tester["accessToken"],
        "homeserver": homeserver,
        "agents": agents,
        "lobby": {"roomId": lobby, "url": f"{app_url}/home/{urllib.parse.quote(lobby, safe='')}"},
        "backend": {
            **backend,
            "commit": stack_state["sha"],
            "apiUrl": stack_state["apiUrl"],
            "log": stack_state["logs"]["backend"],
            "config": str(Path(stack_state["dir"]) / "config.yaml"),
        },
        "chat": chat,
        "stateFile": str(state_path(slot)),
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
            f"  Lobby:      {state['lobby']['url']} (a plain message goes to the Helper; no mention needed)",
            f"  Agents:     {agents}",
            f'  Browser:    just live ask "<text>" --slot {state["slot"]} (signs in, sends, waits, screenshots)',
            f"  Custom:     import {{ readState, launch, login, ask }} from '{ASK_SCRIPT}'; just live run <script.mjs>",
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


def agent_root() -> Path:
    """stack.py's root (stack.stack_root), without creating or checking it."""
    return Path(os.environ.get("E2E_AGENT_STACK_ROOT") or "/tmp/mindroom-client-agents")


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
    for kind in (["ps", "--all"], ["volume", "ls"]):
        command = ["docker", *kind, "--format", '{{.Label "com.docker.compose.project"}}']
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            raise LiveError(f"`docker {' '.join(kind)}` failed: {result.stderr.strip()}")
        projects.update(line.strip() for line in result.stdout.splitlines() if line.strip())
    return projects


def slot_lock(slot: int) -> Path:
    """The lock file that scripts/e2e-slot.sh holds for a run on slot N, and `up` while it starts one."""
    folder = Path(os.environ.get("E2E_SNAPSHOT_ROOT") or "/tmp/mindroom-client-e2e") / "slots"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{slot}.lock"


def claim_slot(slot: int, projects: set[str]):
    """The open, locked lock file of slot N when nothing uses the slot, else None."""
    handle = slot_lock(slot).open("a")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        return None
    # Read under the lock: a deployment that another `up` started has its state file by the time it lets go.
    if slot_taken(slot, projects):
        handle.close()
        return None
    handle.truncate(0)
    handle.write(f"scripts/live.py up, pid {os.getpid()}\n")
    handle.flush()
    return handle


def slot_taken(slot: int, projects: set[str]) -> bool:
    """Whether anything on this machine may use slot N: a live deployment, its homeserver's compose project, an agent
    stack's state, or a listener on any of its ports."""
    return (
        state_path(slot).exists()
        or f"mindroom-client-e2e-{slot}" in projects
        or (agent_root() / f"slot-{slot}").exists()
        or any(port_in_use(port) for port in slot_ports(slot))
    )


def run_logged(command: list[str], log: Path) -> None:
    with log.open("ab") as output:
        result = subprocess.run(command, cwd=REPOSITORY, stdin=subprocess.DEVNULL, stdout=output, stderr=output)
    if result.returncode != 0:
        raise LiveError(f"`{' '.join(command)}` exited with {result.returncode}", log)


def tail(path: Path, lines: int = 30) -> str:
    try:
        text = "\n".join(path.read_text(errors="replace").splitlines()[-lines:])
    except OSError:
        return ""
    return f"--- last lines of {path} ---\n{text}"


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
        source = f"the working tree of {checkout}" if dirty else f"HEAD of {checkout} (no uncommitted changes)"
        if untracked := git(checkout, "ls-files", "--others", "--exclude-standard"):
            source += f"; {len(untracked.splitlines())} untracked files left out (`git add` them to include them)"
        return checkout, sha, source
    try:
        sha = git(checkout, "rev-parse", "--verify", "origin/main^{commit}")
    except subprocess.CalledProcessError as error:
        raise LiveError(f"{checkout} has no origin/main; pass --backend {checkout} to run its working tree") from error
    age = git(checkout, "log", "-1", "--format=%cr", sha)
    return checkout, sha, f"origin/main of {checkout}, committed {age}; `git -C {checkout} fetch` brings a newer one"


def ensure_toolchain(command: str, argv: list[str]) -> None:
    """Runs this script again in the repository's `nix develop` when this shell lacks Node 24 (or Chromium)."""
    node = shutil.which("node")
    version = subprocess.run([node, "--version"], capture_output=True, text=True).stdout if node else ""
    problem = toolchain_problem(command, version, dict(os.environ))
    if not problem:
        return
    if os.environ.get(IN_NIX) or not shutil.which("nix"):
        raise LiveError(f"{problem}; run it in the repository's `nix develop` (`nix develop -c just live {command}`)")
    say(f"{problem}; running it again in `nix develop`")
    nix = ["nix", "develop", str(REPOSITORY), "--option", "warn-dirty", "false", "-c"]
    os.execvpe("nix", [*nix, "python3", str(Path(__file__).resolve()), *argv], {**os.environ, IN_NIX: "1"})


# Commands


def up(args: argparse.Namespace) -> int:
    started = time.monotonic()
    for tool in ("docker", "uv", "git"):
        if not shutil.which(tool):
            raise LiveError(f"`{tool}` is not on PATH")
    checkout, sha, source = backend_source(args.backend)
    env_file = Path(args.env_file or DEFAULT_ENV_FILE).expanduser()
    keys = {name: os.environ[name] for name in KEY_NAMES if os.environ.get(name)}
    keys.update(missing_keys(dict(os.environ), env_file))
    if "OPENAI_API_KEY" not in keys:
        raise LiveError(f"OPENAI_API_KEY is in neither the environment nor {env_file}; set it or pass --env-file FILE")
    # npm writes node_modules/.package-lock.json last, so an install that stopped halfway runs again.
    installed = REPOSITORY / "node_modules" / ".package-lock.json"
    if not installed.is_file():
        with locked(live_root() / "npm-ci.lock"):
            if not installed.is_file():
                say(f"{REPOSITORY} has no node_modules; running `npm ci --no-audit --no-fund` (a few minutes)")
                run_logged(["npm", "ci", "--no-audit", "--no-fund"], live_root() / "npm-ci.log")

    projects = docker_projects()
    for slot in [args.slot] if args.slot is not None else SLOTS:
        # Held until `up` ends; the state file marks the slot as this deployment's from then on.
        if lock := claim_slot(slot, projects):
            break
    else:
        where = f"slot {args.slot} is" if args.slot is not None else f"every slot of {SLOTS.start}-{SLOTS.stop - 1} is"
        raise LiveError(f"{where} in use (`just live status`, `docker ps`, `ss -ltn`)")
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
    step = "homeserver"
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
        cached = (agent_root() / "src" / sha / ".complete").exists()
        say(f"starting MindRoom {sha[:12]} ({source}){'' if cached else '; its first start installs it (minutes)'}")
        command = [sys.executable, str(REPOSITORY / "scripts" / "agent-stack" / "stack.py"), str(slot), "up"]
        command += ["--model", "live", "--client-sessions"]
        command += ["--checkout", str(checkout), "--ref", sha]
        # Its progress and errors (with the backend log's tail) go straight to this script's stderr.
        result = subprocess.run(
            command,
            cwd=REPOSITORY,
            env={**{name: value for name, value in os.environ.items() if name not in KEY_NAMES}, **keys},
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
        )
        if result.returncode != 0:
            raise LiveError(f"stack.py exited with {result.returncode}")
        stack_state = json.loads(result.stdout)

        step = "chat"
        deadline = time.monotonic() + 120
        while True:
            if not stack.alive(chat_pid, "vite"):
                raise LiveError("the Chat dev server exited", chat_log)
            status, config = stack.http_json("GET", f"{app_url}/config.json")
            if status == 200 and config.get("homeserverList") == [homeserver]:
                break
            if time.monotonic() > deadline:
                raise LiveError(f"{app_url}/config.json did not list {homeserver} within 120 s", chat_log)
            time.sleep(0.5)
    except BaseException as error:
        if isinstance(error, LiveError):
            say(f"step {step} failed: {error}")
            if error.log:
                print(tail(error.log), file=sys.stderr)
        elif isinstance(error, (KeyboardInterrupt, SystemExit)):
            say(f"stopped during step {step}")
        else:
            say(f"step {step} failed: {error!r}")
        say(f"stopping what this start started on slot {slot}")
        if not stop_slot(slot):
            say(f"some of it did not stop; `just live down --slot {slot}` tries again")
        return error.code if isinstance(error, SystemExit) and isinstance(error.code, int) else 1
    finally:
        lock.close()

    backend = {"checkout": str(checkout), "source": source}
    full = live_state(slot, stack_state, state["chat"], backend, time.monotonic() - started)
    write_state(slot, full)
    print(json.dumps(full, indent=1) if args.json else summary(full), flush=True)
    return 0


def ready_slot(slot: int | None) -> int:
    """Slot N when it has a ready deployment, or the only ready one."""
    ready = sorted(number for number, state in read_states().items() if state.get("status") == "ready")
    if slot is None and len(ready) != 1:
        found = f"slots {', '.join(map(str, ready))}; pass --slot N" if ready else "none; `just live up` starts one"
        raise LiveError(f"this needs exactly one ready live deployment, found {found}")
    slot = ready[0] if slot is None else slot
    if slot not in ready:
        raise LiveError(f"no ready live deployment on slot {slot} (`just live status`)")
    return slot


def ask(args: argparse.Namespace) -> int:
    text = " ".join(args.text).strip()
    if not text:
        raise LiveError('ask needs the text to send: just live ask "What is 17*23?"')
    slot = ready_slot(args.slot)
    screenshot = Path(args.screenshot or live_root() / f"slot-{slot}-reply.png").expanduser().resolve()
    return subprocess.run(["node", str(ASK_SCRIPT), str(state_path(slot)), text, str(screenshot)]).returncode


def run(script: str, script_args: list[str]) -> int:
    """Runs a custom check with Node, MINDROOM_LIVE_STATE naming the only ready deployment's state file (if one)."""
    env = dict(os.environ)
    with contextlib.suppress(LiveError):
        env["MINDROOM_LIVE_STATE"] = str(state_path(ready_slot(None)))
    return subprocess.run(["node", script, *script_args], env=env).returncode


def stop_slot(slot: int) -> bool:
    """Stops slot N's Chat, backend and homeserver, trying each, and deletes their data and this script's state of it.
    When a part fails, the state and logs stay so that `down` can try again; returns whether all stopped."""
    state = read_states().get(slot) or {}
    up_pid = state.get("upPid")
    if state.get("status") == "starting" and up_pid and up_pid != os.getpid() and stack.alive(up_pid, "live.py"):
        # An `up` still going stops what it started itself.
        os.kill(up_pid, signal.SIGTERM)
        deadline = time.monotonic() + 60
        while stack.alive(up_pid, "live.py") and time.monotonic() < deadline:
            time.sleep(0.5)
    chat_pid = (state.get("chat") or {}).get("pid")
    stack.stop_process(chat_pid, "vite")
    failed = ["Chat"] if stack.alive(chat_pid, "vite") else []
    # The homeserver, the agent stack and the call service, each tried (scripts/e2e-slot.sh `down`).
    teardown = subprocess.run(
        ["bash", str(REPOSITORY / "scripts" / "e2e-slot.sh"), str(slot), "down"],
        cwd=REPOSITORY,
        stdin=subprocess.DEVNULL,
        # Its Docker output says what it removed; stdout stays for --json.
        stdout=sys.stderr,
    )
    if teardown.returncode != 0:
        failed.append(f"`scripts/e2e-slot.sh {slot} down` (exit {teardown.returncode})")
    if failed:
        say(f"slot {slot}: {' and '.join(failed)} did not stop; its state stays in {state_path(slot)}")
        return False
    shutil.rmtree(live_root() / f"slot-{slot}", ignore_errors=True)
    state_path(slot).unlink(missing_ok=True)
    return True


def down(args: argparse.Namespace) -> int:
    states = read_states()
    if args.slot is not None:
        slots = [args.slot] if args.slot in states else []
        if not slots:
            say(f"no live deployment on slot {args.slot}")
    else:
        slots = sorted(slot for slot, state in states.items() if state["chat"]["checkout"] == str(REPOSITORY))
        if not slots:
            say(f"no live deployment from {REPOSITORY}")
        elif len(slots) > 1 and not args.all_mine:
            say(f"this checkout has deployments on slots {', '.join(map(str, slots))}; pass --slot N or --all-mine")
            return 2
    code = 0
    for slot in slots:
        say(f"stopping slot {slot}")
        if stop_slot(slot):
            say(f"slot {slot} is down")
        else:
            say(f"slot {slot} is not fully down; `just live down --slot {slot}` tries again")
            code = 1
    return code


def status(_args: argparse.Namespace) -> int:
    states = read_states()
    if not states:
        print("no live deployments (`just live up` starts one)")
    for slot, state in sorted(states.items()):
        if state.get("status") == "ready":
            parts = {
                "Chat": stack.alive(state["chat"].get("pid"), "vite"),
                "homeserver": stack.http_json("GET", f"{state['homeserver']}/_matrix/client/versions", timeout=3)[0],
                "backend": stack.http_json("GET", f"{state['backend']['apiUrl']}/api/health", timeout=3)[0],
            }
            gone = [name for name, answer in parts.items() if answer not in (True, 200)]
            health = f"broken ({', '.join(gone)} not answering)" if gone else "ready"
        else:
            health = "starting" if stack.alive(state.get("upPid"), "live.py") else "broken (its start was killed)"
        print(f"slot {slot}: {health}, Chat from {state['chat']['checkout']}")
        if state.get("loginUrl"):
            print(f"  {state['loginUrl']}  (username {state['username']}, password {state['password']})")
        print(f"  stop: just live down --slot {slot}")
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["run"]:
        # Everything after the script is the script's own.
        if len(argv) < 2:
            say("usage: just live run <script.mjs> [args...]")
            return 2
        try:
            ensure_toolchain("run", argv)
        except LiveError as error:
            say(str(error))
            return 1
        return run(argv[1], argv[2:])
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("command", choices=["up", "ask", "run", "down", "status"])
    parser.add_argument("text", nargs="*", help="ask: the message to send to the lobby")
    parser.add_argument("--slot", type=int, help="up: this slot instead of a free one; ask, down: this slot's")
    parser.add_argument("--all-mine", action="store_true", help="down: every deployment this checkout started")
    parser.add_argument("--backend", help="up: a MindRoom checkout whose working tree the backend runs")
    parser.add_argument("--env-file", help=f"up: where to read missing provider keys (default {DEFAULT_ENV_FILE})")
    parser.add_argument("--json", action="store_true", help="up: print only the state's JSON")
    parser.add_argument(
        "--screenshot", help="ask: where to save the screenshot (default $MINDROOM_LIVE_ROOT/slot-N-reply.png)"
    )
    args = parser.parse_args(argv)
    if args.slot is not None and not 1 <= args.slot <= 99:
        parser.error("--slot must be 1-99")
    if args.text and args.command != "ask":
        parser.error(f"{args.command} takes no text")
    os.umask(0o077)
    try:
        if args.command in ("up", "ask"):
            ensure_toolchain(args.command, argv)
        return {"up": up, "ask": ask, "down": down, "status": status}[args.command](args)
    except LiveError as error:
        say(str(error))
        if error.log:
            print(tail(error.log), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
