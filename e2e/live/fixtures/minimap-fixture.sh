#!/usr/bin/env bash
# Seeds the "Minimap Long Room" fixture for e2e/live/minimap-verify.spec.ts:
# a private room with a thread of alternating human questions and
# @mindroom_sarro agent answers (io.mindroom.ai_run metadata), long enough
# to overflow a short viewport. Requires the local Tuwunel live fixtures
# (invite-tester / mindroom_* users) described in the team docs.
set -e
HS=${E2E_HOMESERVER:-http://127.0.0.1:8008}
# Local-dev fixture credentials only; override for a differently-seeded homeserver.
HUMAN_PW=${E2E_HUMAN_PASSWORD:-invite-pw-2026}
AGENT_PW=${E2E_AGENT_PASSWORD:-agent-pw-2026}
HUMAN_TOK=$(curl -s -X POST $HS/_matrix/client/v3/login -d "{\"type\":\"m.login.password\",\"identifier\":{\"type\":\"m.id.user\",\"user\":\"invite-tester\"},\"password\":\"$HUMAN_PW\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
AGENT_TOK=$(curl -s -X POST $HS/_matrix/client/v3/login -d "{\"type\":\"m.login.password\",\"identifier\":{\"type\":\"m.id.user\",\"user\":\"mindroom_sarro\"},\"password\":\"$AGENT_PW\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
ROOM=$(curl -s -X POST "$HS/_matrix/client/v3/createRoom?access_token=$HUMAN_TOK" -d '{"name":"Minimap Long Room","preset":"private_chat","invite":["@mindroom_sarro:localhost"]}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["room_id"])')
curl -s -X POST "$HS/_matrix/client/v3/rooms/$ROOM/join?access_token=$AGENT_TOK" -d '{}' > /dev/null
LOREM="This is a deliberately long explanatory paragraph so the thread overflows the viewport. It repeats detail about configuration, environments, ports, tokens, fixtures, pagination, caching, rendering, and scroll behavior so that every reply occupies substantial vertical space in the timeline for scrolling checks. It keeps going with more filler about timelines, threads, edits, streams, tool traces, and message previews to be extra sure."
send() { curl -s -X PUT "$HS/_matrix/client/v3/rooms/$ROOM/send/m.room.message/$(uuidgen)?access_token=$1" -d "$2" | python3 -c 'import json,sys;print(json.load(sys.stdin)["event_id"])'; }
ROOT=$(send $HUMAN_TOK "{\"msgtype\":\"m.text\",\"body\":\"Root question: how does the whole local stack fit together? $LOREM\"}")
for i in 1 2 3 4 5; do
  send $AGENT_TOK "{\"msgtype\":\"m.text\",\"body\":\"Answer number $i. $LOREM $LOREM\",\"m.relates_to\":{\"rel_type\":\"m.thread\",\"event_id\":\"$ROOT\"},\"io.mindroom.ai_run\":{\"version\":1,\"status\":\"completed\"}}" > /dev/null
  send $HUMAN_TOK "{\"msgtype\":\"m.text\",\"body\":\"Question number $i about the setup?\",\"m.relates_to\":{\"rel_type\":\"m.thread\",\"event_id\":\"$ROOT\"}}" > /dev/null
done
send $AGENT_TOK "{\"msgtype\":\"m.text\",\"body\":\"Final answer wrapping everything up. $LOREM\",\"m.relates_to\":{\"rel_type\":\"m.thread\",\"event_id\":\"$ROOT\"},\"io.mindroom.ai_run\":{\"version\":1,\"status\":\"completed\"}}" > /dev/null
echo "ROOM=$ROOM"
