"""OpenAI-compatible Chat Completions server for the agent specs; it never calls a real model.

scripts/agent-stack/stack.py starts it with the MindRoom backend's own Python (which has aiohttp):
    python stub_model.py --port 29716 --log requests.jsonl

The person's latest message picks a scenario by hashtag:

  #slow        30 words, one every 0.25 s
  #stopme      400 words, one every 0.25 s (long enough to press Stop)
  #long        a long Markdown reply (80 numbered lines)
  #think       reasoning first, then the answer
  #markdown    a table, a code block and a list
  #error       the provider answers 500
  #ask         a streamed reply that ends in a question with two options, for answering by reaction
  #shell       one shell call         #multi   three shell calls
  #pause       two shell calls, with 3.5 s of thinking before the second
  #approve     a shell call that needs approval (the backend's approval script looks for needs-approval)
  #bidi        the same, its command holding a right-to-left override (U+202E ... U+202C)
  #title       set_thread_summary      #tag     tag_thread      #resolve   resolve_thread (needs approval)
  #expire      untag_thread, whose approval expires quickly
  #schedule    a reminder in 150 s     #schedulesoon   a reminder in 20 s
  #canvas      show_canvas with a page that submits a color
  #canvasrtl   the same page, titled in Arabic around a Latin file name
  #job         a shell call that runs 45 s as a background job
  #terminal    terminal_open, then terminal_run of an echo in the terminal it opened (stack.py --terminals)

--scenarios FILE (repeatable; stack.py passes each plugin directory's e2e/stub-scenarios.json) adds tool scenarios in
the same shape as TOOL_SCENARIOS below, as JSON: {"#hashtag": [["tool_function", {"argument": "value"}], ...]}.
--scenario-module FILE (repeatable; stack.py passes each plugin directory's e2e/stub_scenarios.py) is Python that may
define two names, for steps that need what only the turn knows (an id an earlier call returned, the person's words):
  SCENARIOS  {"#hashtag": [("tool_function", arguments), ...]}, where arguments is a dict or a function of the Turn
             below that returns one; a function that returns a str ends the scenario with that text instead.
  REPLIES    {"#hashtag": function}: the function of the Turn returns the text of the reply, with no tool call.
A step function sees a Turn: `results` (the turn's tool results so far, as text, in order), `said` (the person's
latest words), `system` (the system and developer messages, joined) and `tools` (the tool names offered). Files and
modules are read for every request, so an edit applies at once. A hashtag the stub already has gets a file's steps,
and a module's win over both. A file or module that cannot be read, and a step function that fails, make the reply say
why, naming the file and the hashtag (for a file or module, those of the latest message).

Anything else gets a short echo naming the model ("Hello from **stub-fast**. You said: <message>").
A call's notes (structured, about the call's <transcript>) say "Stub notes of the call." and "stub" in each list.
When MindRoom reports that background jobs ended, the stub collects them with the job tool and reports
the result. After a tool result the scenario calls its next tool or answers with the last result. Structured-output
requests (the router, thread summaries and tags, schedule parsing) get JSON built from their schema.
Every request is appended to the --log file as one JSON line.

It also stands in for speech-to-text (/v1/audio/transcriptions, OpenAI's form): it hears nothing and answers with the
length its WAV's header gives, "Stand-in transcript of 4.5 seconds of speech."
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import re
import runpy
import time
import uuid
import wave
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

from aiohttp import web

TRANSIENT_PREFIX = "<mindroom_transient_context>"
JOBS_ENDED = "background jobs you started earlier in this conversation have ended"

CANVAS_PAGE = (
    "<!doctype html><html><body style='font-family:sans-serif;padding:16px'>"
    "<h1>Pick a color</h1><button id='red'>Red</button> <button id='blue'>Blue</button>"
    "<script>for (const id of ['red', 'blue']) document.getElementById(id).onclick = () =>"
    " window.mindroom.submit({color: id});</script></body></html>"
)

# A tool step's arguments may hold this key: how long, in seconds, the model thinks before the call. It is not sent.
THINK_SECONDS = "_think_seconds"

def terminal_command(turn: Turn) -> dict | str:
    """#terminal's second step: the command, in the terminal whose ID terminal_open answered."""
    opened = re.fullmatch(r"Opened terminal (\S+)\.", turn.results[-1].strip())
    if not opened:
        return f"The terminal did not open: {turn.results[-1]}"
    # The terminal prints stub-terminal-42, which the typed line does not hold.
    return {"session_id": opened.group(1), "command": "echo stub-terminal-$((6 * 7))"}


TOOL_SCENARIOS: dict[str, list[Step]] = {
    "#shell": [("run_shell_command", {"args": "echo hello from the stub"})],
    "#multi": [
        ("run_shell_command", {"args": "echo step one"}),
        ("run_shell_command", {"args": "sleep 10; echo step two"}),
        ("run_shell_command", {"args": "echo step three"}),
    ],
    # Longer between the calls than the client's jobs bar holds a finished call.
    "#pause": [
        ("run_shell_command", {"args": "sleep 1; echo first step"}),
        ("run_shell_command", {"args": "sleep 1; echo second step", THINK_SECONDS: 3.5}),
    ],
    "#approve": [("run_shell_command", {"args": "echo needs-approval: deploy the stub"})],
    "#bidi": [("run_shell_command", {"args": "echo needs-approval hello \u202e; echo pwned-by-bidi #\u202c done"})],
    "#title": [("set_thread_summary", {"summary": "Stub picked this title from a tool call"})],
    "#tag": [("tag_thread", {"tag": "stub-tag", "note": "tagged by the stub model"})],
    "#resolve": [("resolve_thread", {})],
    "#expire": [("untag_thread", {"tag": "stub-tag"})],
    "#schedulesoon": [("schedule", {"request": "in 20 seconds remind me to stretch", "new_thread": False})],
    "#schedule": [("schedule", {"request": "in 150 seconds remind me to stretch", "new_thread": False})],
    "#canvas": [("show_canvas", {"title": "Stub canvas", "html": CANVAS_PAGE})],
    "#canvasrtl": [("show_canvas", {"title": "لوحة التخطيط deploy.yaml للإطلاق", "html": CANVAS_PAGE})],
    "#job": [
        ("run_shell_command", {"args": "sleep 45; echo background job finished", "background_after": 0})
    ],
    "#terminal": [("terminal_open", {}), ("terminal_run", terminal_command)],
}
TEXT_SCENARIOS = ("#stopme", "#slow", "#long", "#think", "#markdown", "#error", "#ask")

# #ask: a short stream (each word an edit) ending in MindRoom's interactive block, which the backend turns into the
# message's question and its reaction buttons.
ASK_SECONDS_PER_WORD = 0.1
ASK_QUESTION = {
    "question": "Which deck should I polish for Thursday?",
    "options": [
        {"emoji": "✅", "label": "v3 final", "value": "v3"},
        {"emoji": "📄", "label": "v4 draft", "value": "v4"},
    ],
}


@dataclass(frozen=True)
class Turn:
    """What a step function of a --scenario-module sees (the docstring)."""

    results: tuple[str, ...]
    said: str
    system: str
    tools: tuple[str, ...]


Step = tuple[str, dict | Callable[[Turn], dict | str]]


def guarded(
    module: Path, tag: str, function: Callable[[Turn], object], text_only: bool = False
) -> Callable[[Turn], dict | str]:
    """`function`, with its failure, or an answer it may not give (a REPLIES one gives a text), as a text naming the
    step."""
    failed = f"The stub's scenario {tag} of {module} failed"
    wanted = "a text" if text_only else "a dict of arguments or a text"

    def step(turn: Turn) -> dict | str:
        try:
            answer = function(turn)
        except Exception as error:
            return f"{failed}: {type(error).__name__}: {error}"
        if isinstance(answer, str) or (isinstance(answer, dict) and not text_only):
            return answer
        return f"{failed}: it gave {type(answer).__name__}, not {wanted}"

    return step


def tool_scenarios(files: list[Path], modules: Iterable[Path] = ()) -> dict[str, list[Step]]:
    """TOOL_SCENARIOS with the scenarios of the --scenarios files and then the --scenario-module modules; a ValueError
    names a file or module that is missing, fails or is not in their shape."""
    scenarios: dict[str, list[Step]] = dict(TOOL_SCENARIOS)
    for file in files:
        try:
            for tag, steps in json.loads(file.read_text()).items():
                scenarios[tag.lower()] = [(name, args) for name, args in steps]
        except (OSError, ValueError, TypeError, AttributeError) as error:
            raise ValueError(f"{file}: {type(error).__name__}: {error}") from error
    for module in modules:
        try:
            names = runpy.run_path(str(module))
            for tag, steps in names.get("SCENARIOS", {}).items():
                key = tag.lower()
                scenarios[key] = [
                    (name, guarded(module, key, args) if callable(args) else args) for name, args in steps
                ]
            for tag, reply in names.get("REPLIES", {}).items():
                scenarios[tag.lower()] = [("", guarded(module, tag.lower(), reply, text_only=True))]
        except Exception as error:
            raise ValueError(f"{module}: {type(error).__name__}: {error}") from error
    return scenarios


def has_tag(text: str, tag: str) -> bool:
    """Whether `text` holds the whole hashtag: #shell is not in #shell2 or #shell-check."""
    return re.search(re.escape(tag) + r"(?![\w-])", text) is not None


def text_of(content: object) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text"
        )
    return ""


def is_person_message(message: dict) -> bool:
    return message.get("role") == "user" and not text_of(message.get("content")).lstrip().startswith(
        TRANSIENT_PREFIX
    )


def latest_person_index(messages: list[dict]) -> int:
    """MindRoom appends transient context notes as user messages; skip them to find what the person wrote."""
    for index in range(len(messages) - 1, -1, -1):
        if is_person_message(messages[index]):
            return index
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") == "user":
            return index
    return -1


MESSAGE_BLOCK = re.compile(r"<msg\b[^>]*?from=\"([^\"]*)\"[^>]*><!\[CDATA\[(.*?)\]\]>", re.S)


ROUTER_HANDOFF = re.compile(r"^@mindroom_\S+ could you help with this\?$")


def person_said(messages: list[dict]) -> str:
    """The person's latest words. MindRoom wraps each message as <msg from=...><![CDATA[...]]>, older ones with a
    time prefix; the router's handoff to an agent ("@mindroom_helper... could you help with this?") arrives in
    the person's name, so it is skipped."""
    for message in reversed(messages):
        if not is_person_message(message):
            continue
        for sender, text in reversed(MESSAGE_BLOCK.findall(text_of(message.get("content")))):
            text = re.sub(r"^\[\d{4}-\d\d-\d\d \d\d:\d\d UTC\] ", "", text.strip())
            if "mindroom_" not in sender and not ROUTER_HANDOFF.match(text):
                return text
    index = latest_person_index(messages)
    return text_of(messages[index].get("content")).strip() if index >= 0 else ""


def current_turn_text(messages: list[dict]) -> str:
    """The person's messages since the last final assistant answer (coalesced messages arrive together)."""
    start = 0
    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        if (
            message.get("role") == "assistant"
            and not message.get("tool_calls")
            and text_of(message.get("content")).strip()
        ):
            start = index + 1
            break
    return "\n".join(text_of(m.get("content")) for m in messages[start:] if is_person_message(m))


# Structured output


def schedule_delay(text: str) -> int:
    match = re.search(r"in (\d+) seconds", text)
    return int(match.group(1)) if match else 150


def schema_value(schema: dict, defs: dict, text: str, key: str = ""):
    """A value for one schema node; some field names get values that make the backend act."""
    if key == "execute_at":
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + schedule_delay(text)))
    if key in ("cron_schedule", "history_limit", "model", "created_by", "thread_id", "room_id"):
        return None
    if key == "message":
        return "@helper remind me to stretch"
    if key == "description":
        return "Stretch reminder"
    if "$ref" in schema:
        return schema_value(defs.get(schema["$ref"].rsplit("/", 1)[-1], {}), defs, text, key)
    for combination in ("anyOf", "oneOf"):
        if combination in schema:
            options = [option for option in schema[combination] if option.get("type") != "null"]
            return schema_value((options or schema[combination])[0], defs, text, key)
    if "enum" in schema:
        return schema["enum"][0]
    if "const" in schema:
        return schema["const"]
    kind = schema.get("type")
    if kind == "object" or "properties" in schema:
        return {
            name: schema_value(sub, defs, text, name) for name, sub in schema.get("properties", {}).items()
        }
    if kind == "array":
        if key == "tags":
            return ["stub-topic", "live-test"]
        return [schema_value(schema.get("items", {}), defs, text, key)]
    if kind == "boolean":
        return False
    if kind in ("integer", "number"):
        return schema.get("minimum", 1)
    if key in ("entity_name", "agent_name"):
        routed = text.split('Message: "', 1)[-1].lower()
        return "scout" if "scout" in routed else "helper"
    if key == "summary" and "<transcript>" in text:
        return "Stub notes of the call."
    if key == "summary":
        person = re.search(r"@tester_[a-z0-9]+:[a-z.]+: ([^\n]+)", text)
        words = " ".join((person.group(1) if person else text).replace("#", "").split()[:6])
        return f"Stub title: {words}"[:120]
    return "stub"


# Chat turns


def plan(body: dict, scenarios: dict[str, list[Step]]) -> tuple:
    """("text", markdown), ("slow", text, seconds per word), ("think", text), ("tool", name, args) or ("error",),
    with the tool scenarios of tool_scenarios."""
    messages = body.get("messages") or []
    index = latest_person_index(messages)
    latest = text_of(messages[index].get("content")).lower() if index >= 0 else ""
    text = current_turn_text(messages).lower()
    # The latest message decides when it names a scenario; otherwise the whole turn does.
    if any(has_tag(latest, tag) for tag in [*scenarios, *TEXT_SCENARIOS]):
        text = latest
    results = (
        [text_of(m.get("content")) for m in messages[index + 1 :] if m.get("role") == "tool"] if index >= 0 else []
    )
    last_result = results[-1][:400] if results else ""
    available = [tool.get("function", {}).get("name", "") for tool in body.get("tools") or []]
    # When background jobs end, MindRoom asks the agent to collect their results and report them.
    if JOBS_ENDED in latest and "job" in available:
        if not results:
            return ("tool", "job", {"action": "collect"})
        return ("text", f"The background job ended:\n\n```\n{last_result}\n```")
    for tag, steps in scenarios.items():
        if not has_tag(text, tag):
            continue
        if len(results) < len(steps):
            name, args = steps[len(results)]
            if callable(args):
                system = "\n".join(
                    text_of(m.get("content")) for m in messages if m.get("role") in ("system", "developer")
                )
                args = args(Turn(tuple(results), person_said(messages), system, tuple(available)))
                if isinstance(args, str):
                    return ("text", args)
            if name not in available:
                return (
                    "text",
                    f"The stub wanted `{name}`, but this agent has: {', '.join(available) or 'no tools'}.",
                )
            return ("tool", name, args)
        return (
            "text",
            f"Finished **{tag[1:]}** after {len(results)} tool call(s). Last result:\n\n```\n{last_result}\n```",
        )
    if results:
        return ("text", f"The tool said:\n\n```\n{last_result}\n```")
    if has_tag(text, "#stopme"):
        return ("slow", " ".join(f"word{i}" for i in range(1, 401)), 0.25)
    if has_tag(text, "#slow"):
        return ("slow", " ".join(f"word{i}" for i in range(1, 31)), 0.25)
    if has_tag(text, "#long"):
        lines = [f"{i}. Line {i} of a long stub reply, long enough to fill the thread." for i in range(1, 81)]
        return ("text", "Here is a long reply.\n\n" + "\n".join(lines) + "\n\nEnd of the long reply.")
    if has_tag(text, "#think"):
        return ("think", "I thought about it and the answer is **42**.")
    if has_tag(text, "#markdown"):
        return (
            "text",
            "## Stub report\n\n| Item | Value |\n| --- | --- |\n| alpha | 1 |\n| beta | 2 |\n\n"
            "```python\nprint('hello from the stub')\n```\n\n- one\n- two\n\nInline `code` and a [link](https://example.org).",
        )
    if has_tag(text, "#error"):
        return ("error",)
    if has_tag(text, "#ask"):
        block = json.dumps(ASK_QUESTION, ensure_ascii=False)
        return ("slow", f"Two versions are ready.\n\n```interactive\n{block}\n```", ASK_SECONDS_PER_WORD)
    return ("text", f"Hello from **{body.get('model')}**. You said: {person_said(messages)}")


def chunk(model: str, delta: dict, finish: str | None = None) -> dict:
    return {
        "id": "chatcmpl-stub",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }


def tool_call(name: str, args: dict) -> dict:
    return {
        "id": f"call_{uuid.uuid4().hex[:12]}",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(args)},
    }


class Stub:
    def __init__(self, log_path: Path, scenario_files: list[Path], scenario_modules: list[Path]) -> None:
        self.log_path = log_path
        self.scenario_files = scenario_files
        self.scenario_modules = scenario_modules

    def record(self, entry: dict) -> None:
        with self.log_path.open("a") as handle:
            handle.write(json.dumps(entry) + "\n")

    async def completions(self, request: web.Request) -> web.StreamResponse:
        body = await request.json()
        model = body.get("model", "stub")
        messages = body.get("messages") or []
        index = latest_person_index(messages)
        person_text = text_of(messages[index].get("content")) if index >= 0 else ""
        entry = {
            "time": time.time(),
            "model": model,
            "stream": bool(body.get("stream")),
            "structured": bool(body.get("response_format")),
            "tools": [tool.get("function", {}).get("name", "") for tool in body.get("tools") or []],
            "user": person_text[-400:],
            # The tail of the conversation as the model saw it, for debugging a scenario.
            "messages": [[m.get("role"), text_of(m.get("content"))[-600:]] for m in messages[-4:]],
        }
        if body.get("response_format"):
            schema = (body["response_format"].get("json_schema") or {}).get("schema") or {}
            step: tuple = ("text", json.dumps(schema_value(schema, schema.get("$defs", {}), person_text)))
        else:
            try:
                scenarios = tool_scenarios(self.scenario_files, self.scenario_modules)
            except ValueError as error:
                # The reply says why, in the thread the spec's author looks at, with the hashtags it was asked for.
                tags = " ".join(re.findall(r"#[\w-]+", person_said(messages).lower()))
                step = ("text", f"The stub could not read its scenarios{f' for {tags}' if tags else ''}: {error}")
            else:
                step = plan(body, scenarios)
        think = 0.0
        if step[0] == "tool" and THINK_SECONDS in step[2]:
            think = float(step[2][THINK_SECONDS])
            step = ("tool", step[1], {key: value for key, value in step[2].items() if key != THINK_SECONDS})
        entry["plan"] = (
            list(step[:3]) if step[0] == "tool" else [step[0], str(step[1])[:200] if len(step) > 1 else ""]
        )
        self.record(entry)
        if think:
            await asyncio.sleep(think)

        if step[0] == "error":
            return web.json_response(
                {"error": {"message": "stub provider failure", "type": "server_error"}}, status=500
            )
        if not body.get("stream"):
            message: dict = {"role": "assistant", "content": None if step[0] == "tool" else step[1]}
            if step[0] == "tool":
                message["tool_calls"] = [tool_call(step[1], step[2])]
            return web.json_response(
                {
                    "id": "chatcmpl-stub",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [
                        {
                            "index": 0,
                            "message": message,
                            "finish_reason": "tool_calls" if step[0] == "tool" else "stop",
                        }
                    ],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120},
                }
            )

        response = web.StreamResponse(
            headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"}
        )
        await response.prepare(request)

        async def send(payload: dict) -> None:
            await response.write(f"data: {json.dumps(payload)}\n\n".encode())

        await send(chunk(model, {"role": "assistant", "content": ""}))
        finish = "stop"
        if step[0] == "tool":
            await asyncio.sleep(0.3)
            call = tool_call(step[1], step[2])
            arguments = call["function"].pop("arguments")
            call["function"]["arguments"] = ""
            await send(chunk(model, {"tool_calls": [{"index": 0, **call}]}))
            await send(chunk(model, {"tool_calls": [{"index": 0, "function": {"arguments": arguments}}]}))
            finish = "tool_calls"
        elif step[0] == "think":
            for piece in [
                "Let me think. ",
                "The person wants a number. ",
                "Forty-two is traditional. ",
                "Done thinking.",
            ]:
                await send(chunk(model, {"reasoning_content": piece}))
                await asyncio.sleep(0.6)
            for word in step[1].split(" "):
                await send(chunk(model, {"content": word + " "}))
                await asyncio.sleep(0.05)
        else:
            delay = step[2] if step[0] == "slow" else 0.03
            words = step[1].split(" ")
            for position, word in enumerate(words):
                await send(chunk(model, {"content": word if position == len(words) - 1 else word + " "}))
                await asyncio.sleep(delay)
        await send(chunk(model, {}, finish))
        if (body.get("stream_options") or {}).get("include_usage"):
            await send(
                {
                    "id": "chatcmpl-stub",
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [],
                    "usage": {"prompt_tokens": 1200, "completion_tokens": 64, "total_tokens": 1264},
                }
            )
        await response.write(b"data: [DONE]\n\n")
        await response.write_eof()
        return response

    async def transcriptions(self, request: web.Request) -> web.Response:
        """Speech-to-text that hears nothing: the length of the recording, from its WAV header."""
        form = await request.post()
        upload = form.get("file")
        if not isinstance(upload, web.FileField):
            return web.json_response({"error": {"message": "no file", "type": "invalid_request_error"}}, status=400)
        try:
            seconds = wav_seconds(upload.file.read())
        except (wave.Error, EOFError, ZeroDivisionError):
            return web.json_response({"error": {"message": "not a WAV", "type": "invalid_request_error"}}, status=400)
        self.record(
            {
                "time": time.time(),
                "model": form.get("model"),
                "language": form.get("language"),
                "transcription": round(seconds, 2),
            }
        )
        return web.json_response({"text": f"Stand-in transcript of {seconds:.1f} seconds of speech."})


def wav_seconds(audio: bytes) -> float:
    """How long a WAV lasts by its header."""
    with wave.open(io.BytesIO(audio)) as recording:
        return recording.getnframes() / recording.getframerate()


async def list_models(_request: web.Request) -> web.Response:
    return web.json_response(
        {
            "object": "list",
            "data": [{"id": "stub-fast", "object": "model"}, {"id": "stub-deep", "object": "model"}],
        }
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="OpenAI-compatible stub model for the agent specs")
    parser.add_argument("--port", type=int, default=29700)
    parser.add_argument("--log", type=Path, default=Path("requests.jsonl"))
    parser.add_argument("--tag", help="ignored; marks the process as the stack's own")
    parser.add_argument(
        "--scenarios", type=Path, action="append", default=[], help="a JSON file of more tool scenarios (repeatable)"
    )
    parser.add_argument(
        "--scenario-module",
        type=Path,
        action="append",
        default=[],
        help="a Python file of more scenarios, computed from the turn (repeatable)",
    )
    args = parser.parse_args()
    args.log.parent.mkdir(parents=True, exist_ok=True)
    stub = Stub(args.log, args.scenarios, args.scenario_module)
    app = web.Application(client_max_size=64 * 1024 * 1024)
    app.router.add_post("/v1/chat/completions", stub.completions)
    app.router.add_post("/v1/audio/transcriptions", stub.transcriptions)
    app.router.add_get("/v1/models", list_models)
    web.run_app(app, host="127.0.0.1", port=args.port, print=None)


if __name__ == "__main__":
    main()
