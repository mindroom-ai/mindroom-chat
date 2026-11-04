"""Seed a disposable Tuwunel with MindRoom-style content for reference screenshots.

Usage: scripts/e2e-slot.sh <N> python3 scripts/reference/seed.py [suffix]
Prints the signed-in user, password, room, thread roots (r1..r4) and the direct room as JSON.
The screenshots in docs/design/reference/ show this data in MindRoom Chat; compare against them.

Avatars come from two folders: $E2E_SEED_AGENT_AVATARS (research.png, code.png, mind.png; default
/home/basnijholt/Work/dev/assets/avatars/painted/agents, the MindRoom assets repository) and
$E2E_SEED_PEOPLE_AVATARS (priya.png, maya.png, tom.png; default
/home/basnijholt/Work/dev/demo/world/avatars/people, the MindRoom demo repository). An account whose
picture is missing gets none, with a note on stderr.
"""

import functools
import json
import os
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from matrix_http import call as matrix_call, homeserver_url, quote as q, register as register_account, send as send_event

HS = homeserver_url()
SERVER = "matrix.localhost"
PW = "reference-pass-1"
AGENTS = os.environ.get("E2E_SEED_AGENT_AVATARS") or "/home/basnijholt/Work/dev/assets/avatars/painted/agents"
PEOPLE = os.environ.get("E2E_SEED_PEOPLE_AVATARS") or "/home/basnijholt/Work/dev/demo/world/avatars/people"

call = functools.partial(matrix_call, HS)


def register(username, display, avatar):
    account = register_account(HS, username, PW)
    tok, uid = account["access_token"], account["user_id"]
    call("PUT", f"/_matrix/client/v3/profile/{q(uid)}/displayname", tok, {"displayname": display})
    if not os.path.isfile(avatar):
        print(f"seed: no avatar for {display} ({avatar} is missing; see E2E_SEED_*_AVATARS)", file=sys.stderr)
        return {"id": uid, "tok": tok, "name": display}
    with open(avatar, "rb") as f:
        mxc = call("POST", "/_matrix/media/v3/upload?filename=a.png", tok, raw=f.read(), content_type="image/png")["content_uri"]
    call("PUT", f"/_matrix/client/v3/profile/{q(uid)}/avatar_url", tok, {"avatar_url": mxc})
    return {"id": uid, "tok": tok, "name": display}


def send(user, room, content, etype="m.room.message"):
    return send_event(HS, user["tok"], room, content, etype)


def mention(user):
    return f'<a href="https://matrix.to/#/{user["id"]}">{user["name"]}</a>'


def root(user, room, target, text):
    return send(user, room, {
        "msgtype": "m.text", "body": f"@{target['name']} {text}", "format": "org.matrix.custom.html",
        "formatted_body": f"{mention(target)} {text}", "m.mentions": {"user_ids": [target["id"]]}})


def in_thread(root_id, last_id):
    return {"rel_type": "m.thread", "event_id": root_id, "is_falling_back": True, "m.in_reply_to": {"event_id": last_id}}


def reply(user, room, root_id, last_id, body, html=None, extra=None, msgtype="m.text"):
    c = {"msgtype": msgtype, "body": body, "m.relates_to": in_thread(root_id, last_id)}
    if html:
        c.update({"format": "org.matrix.custom.html", "formatted_body": html})
    c.update(extra or {})
    return send(user, room, c)


def trace(*calls):
    # Version 2, as MindRoom sends it (tool_system/events.py): this client shows a call's arguments and result only
    # from a version 2 trace. Arguments read `name=value, ...` like MindRoom's previews; a running call has no result.
    events = []
    for n, a, r, done in calls:
        event = {"type": "tool_call_completed" if done else "tool_call_started", "tool_name": n, "args_preview": a}
        if done:
            event["result_preview"] = r
        events.append(event)
    return {"version": 2, "events": events}


def run(display, config, model_id, provider, status="completed"):
    return {"version": 1, "run_id": uuid.uuid4().hex, "session_id": uuid.uuid4().hex, "status": status,
            "model": {"config": config, "display_name": display, "id": model_id, "provider": provider}}


def summary(agent, room, root_id, last_id, title):
    now = datetime.now(UTC).isoformat()
    return reply(agent, room, root_id, last_id, title, msgtype="m.notice", extra={
        "io.mindroom.thread_summary": {"version": 1, "summary": title, "generated_at": now, "model": "haiku", "pinned": False}})


def tag(user, room, root_id, name):
    key = json.dumps([root_id, name], separators=(",", ":"))
    call("PUT", f"/_matrix/client/v3/rooms/{q(room)}/state/com.mindroom.thread.tags/{q(key)}", user["tok"],
         {"set_by": user["id"], "set_at": datetime.now(UTC).isoformat()})


def main():
    sfx = sys.argv[1] if len(sys.argv) > 1 else str(int(time.time()))[-5:]
    priya = register(f"priya{sfx}", "Priya Raman", f"{PEOPLE}/priya.png")
    maya = register(f"maya{sfx}", "Maya Chen", f"{PEOPLE}/maya.png")
    jonas = register(f"jonas{sfx}", "Tom Becker", f"{PEOPLE}/tom.png")
    research = register(f"mindroom_research{sfx}", "Research", f"{AGENTS}/research.png")
    code = register(f"mindroom_code{sfx}", "Code", f"{AGENTS}/code.png")
    mind = register(f"mindroom_mind{sfx}", "Mind", f"{AGENTS}/mind.png")
    everyone = [maya, jonas, research, code, mind]

    room = call("POST", "/_matrix/client/v3/createRoom", priya["tok"], {
        "name": "Launch War Room", "topic": "Everything for the Q4 instrument launch", "preset": "private_chat",
        "invite": [u["id"] for u in everyone]})["room_id"]
    for u in everyone:
        call("POST", f"/_matrix/client/v3/join/{q(room)}", u["tok"], {})
    for name in ("Design Review", "Kitchen"):
        r = call("POST", "/_matrix/client/v3/createRoom", priya["tok"], {"name": name, "preset": "private_chat", "invite": [maya["id"]]})["room_id"]
        call("POST", f"/_matrix/client/v3/join/{q(r)}", maya["tok"], {})
        send(maya, r, {"msgtype": "m.text", "body": "Draft is up, comments welcome."})
    dm = call("POST", "/_matrix/client/v3/createRoom", priya["tok"], {"name": "Priya's Desk", "preset": "private_chat", "invite": [mind["id"]], "is_direct": True})["room_id"]
    call("POST", f"/_matrix/client/v3/join/{q(dm)}", mind["tok"], {})
    send(mind, dm, {"msgtype": "m.text", "body": "Morning! Three things need you today."})

    # Thread 4 (oldest): resolved
    r4 = root(jonas, room, code, "is staging ready for the load test before go-live?")
    a = reply(code, room, r4, r4, "🔧 `run_shell_command` [1]\n\nLoad test passed at 2.1k rps with p99 at 180 ms. Closing LAUNCH-88.",
              extra={"io.mindroom.stream_status": "completed", "io.mindroom.tool_trace": trace(("run_shell_command", "command=k6 run load.js", "ok", True)),
                     "io.mindroom.ai_run": run("GPT-6.1 Sol", "sol", "gpt-6.1-sol", "openai")})
    summary(code, room, r4, a, "🧪 Staging load test before go-live")
    for t in ("launch", "infra", "resolved"):
        tag(priya, room, r4, t)

    send(maya, room, {"msgtype": "m.text", "body": "Standup moves to 11:00 today."})

    # Thread 1: completed, with table
    r1 = root(maya, room, research, "can you compare our Q3 churn against SaaS benchmarks and draft a short summary for the board deck?")
    body = ("🔧 `web_search` [1]\n\n🔧 `run_python_code` [2]\n\nQ3 monthly churn came in at **2.9%**, down from 3.4% in Q2.\n\n"
            "| Metric | Acme Q3 | Segment median | Top quartile |\n|---|---|---|---|\n| Monthly logo churn | 2.9% | 3.5% | 1.8% |\n| Net revenue retention | 108% | 102% | 115% |")
    html = ("<p>🔧 <code>web_search</code> [1]</p><p>🔧 <code>run_python_code</code> [2]</p><p>Q3 monthly churn came in at <strong>2.9%</strong>, down from 3.4% in Q2.</p>"
            "<table><thead><tr><th>Metric</th><th>Acme Q3</th><th>Segment median</th><th>Top quartile</th></tr></thead><tbody>"
            "<tr><td>Monthly logo churn</td><td>2.9%</td><td>3.5%</td><td>1.8%</td></tr><tr><td>Net revenue retention</td><td>108%</td><td>102%</td><td>115%</td></tr></tbody></table>")
    a = reply(research, room, r1, r1, body, html, {
        "io.mindroom.stream_status": "completed",
        "io.mindroom.tool_trace": trace(("web_search", "query=SaaS logo churn benchmarks 2026", "8 results", True),
                                        ("run_python_code", "code=churn = cancelled / start_of_month", "q3_churn=0.029", True)),
        "io.mindroom.ai_run": run("Claude Sonnet 5.5", "sonnet", "claude-sonnet-5-5", "anthropic")})
    s = summary(research, room, r1, a, "📊 Q3 churn vs. SaaS benchmarks")
    b = reply(maya, room, r1, s, "Great. Can you double-check where the top-quartile number comes from?")
    reply(research, room, r1, b, "🔧 `web_search` [1]\n\nIt's from the 2026 SaaS Benchmarks report (1,200 companies, $10-50M ARR). Top quartile is 1.8% monthly logo churn.",
          extra={"io.mindroom.stream_status": "completed", "io.mindroom.tool_trace": trace(("web_search", "query=2026 SaaS Benchmarks report", "1 result", True)),
                 "io.mindroom.ai_run": run("Claude Sonnet 5.5", "sonnet", "claude-sonnet-5-5", "anthropic")})
    for t in ("board-deck", "metrics"):
        tag(priya, room, r1, t)

    # Thread 2: approval pending
    r2 = root(jonas, room, code, "can you turn the cohort numbers into a chart for slide 6?")
    a = reply(code, room, r2, r2, "🔧 `read_file` [1]\n\n🔧 `run_shell_command` [2] ⏳\n\nLoaded 12 monthly cohorts from `cohorts_q3.csv`.", extra={
        "io.mindroom.stream_status": "approval_pending",
        "io.mindroom.tool_trace": trace(("read_file", "path=cohorts_q3.csv", "12 rows", True), ("run_shell_command", "command=python export_chart.py --slide 6", None, False)),
        "io.mindroom.ai_run": run("GPT-6.1 Sol", "sol", "gpt-6.1-sol", "openai", "running")})
    now = datetime.now(UTC)
    send(code, room, {
        "msgtype": "io.mindroom.tool_approval", "body": "🔒 Approval required: run_shell_command", "tool_name": "run_shell_command",
        "arguments": {"command": "python export_chart.py --slide 6 --format svg"}, "status": "pending", "approval_id": uuid.uuid4().hex,
        "approver_user_id": priya["id"], "requester_id": jonas["id"], "requested_at": now.isoformat(),
        "expires_at": datetime.fromtimestamp(now.timestamp() + 3600, UTC).isoformat(), "thread_id": r2, "agent_name": "code",
        "m.relates_to": in_thread(r2, a)}, etype="io.mindroom.tool_approval")
    summary(code, room, r2, a, "📈 Cohort chart for slide 6")
    tag(priya, room, r2, "board-deck")

    # Thread 3: streaming
    r3 = root(priya, room, mind, "draft the launch email for existing customers, friendly but short.")
    a = reply(mind, room, r3, r3, "🔧 `web_search` [1] ⏳\n\nSubject: Your workspace just got agents. Hi {first_name}, starting today every room can", extra={
        "io.mindroom.stream_status": "streaming", "io.mindroom.tool_trace": trace(("web_search", "query=launch email examples", None, False)),
        "io.mindroom.ai_run": run("Claude Opus 5.5", "opus", "claude-opus-5-5", "anthropic", "running")})
    summary(mind, room, r3, a, "✉️ Launch email draft")
    tag(priya, room, r3, "launch")

    print(json.dumps({"user": priya["id"].split(":")[0][1:], "password": PW, "room": room, "threads": [r1, r2, r3, r4], "dm": dm}))


if __name__ == "__main__":
    main()
