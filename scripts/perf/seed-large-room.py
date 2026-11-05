"""Seed a large threaded room on a disposable homeserver and write the manifest that
e2e/timeline/perf-large-room-streaming.live.spec.ts reads from PERF_STRESS_MANIFEST.

Usage: scripts/e2e-slot.sh <N> python3 scripts/perf/seed-large-room.py <manifest.json> [threads] [replies] [edits]

Registers a fresh account (printed with its password), creates one room and fills it with
<threads> thread roots (default 300), <replies> replies in each (default 5) and <edits> m.replace
edits of every reply (default 2): 300 * (1 + 5 * 3) = 4800 message events by default. Run the spec
with E2E_USERNAME and E2E_PASSWORD set to the printed account and E2E_HOMESERVER to the slot.
"""

import json
import sys
import urllib.parse
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from matrix_http import call, homeserver_url, register as register_account, send as send_event

HS = homeserver_url()
PASSWORD = "perf-large-room-1"


def register(username):
    account = register_account(HS, username, PASSWORD)
    return account["user_id"], account["access_token"]


def send(token, room, content):
    return send_event(HS, token, room, content)


def seed_thread(token, room, index, replies, edits):
    root = send(token, room, {"msgtype": "m.text", "body": f"Large room thread {index}: what changed in build {index}?"})
    latest = root
    for reply in range(1, replies + 1):
        latest = send(token, room, {
            "msgtype": "m.text",
            "body": f"Reply {reply} in thread {index}",
            "m.relates_to": {"rel_type": "m.thread", "event_id": root, "is_falling_back": True,
                             "m.in_reply_to": {"event_id": latest}},
        })
        for edit in range(1, edits + 1):
            text = f"Reply {reply} in thread {index}, revision {edit}"
            send(token, room, {
                "msgtype": "m.text",
                "body": f"* {text}",
                "m.new_content": {"msgtype": "m.text", "body": text},
                "m.relates_to": {"rel_type": "m.replace", "event_id": latest},
            })
    return {"index": index, "rootId": root, "latestReplyId": latest, "complete": True}


def main():
    manifest_path = sys.argv[1]
    threads, replies, edits = (int(value) for value in (sys.argv[2:5] + ["300", "5", "2"][len(sys.argv[2:5]):]))
    username = f"perflarge{uuid.uuid4().hex[:8]}"
    user_id, token = register(username)
    room = call(HS, "POST", "/_matrix/client/v3/createRoom", token, {
        "name": f"Large room ({threads} threads)", "preset": "private_chat"})["room_id"]
    with ThreadPoolExecutor(max_workers=8) as pool:
        seeded = list(pool.map(lambda index: seed_thread(token, room, index, replies, edits), range(threads)))
    manifest = {
        "version": 1,
        "homeserver": urllib.parse.urlsplit(HS)._replace(path="").geturl().rstrip("/"),
        "username": username,
        "userId": user_id,
        "roomId": room,
        "config": {"threads": threads, "replies": replies, "edits": edits},
        "threads": seeded,
    }
    with open(manifest_path, "w") as file:
        json.dump(manifest, file, indent=1)
    print(json.dumps({"username": username, "password": PASSWORD, "userId": user_id, "roomId": room,
                      "events": threads * (1 + replies * (1 + edits))}))


if __name__ == "__main__":
    main()
