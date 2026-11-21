#!/bin/bash
# The behaviour probe of the Mac voice recorder (README.md beside it). Run it on the Mac, in the
# checkout whose `App` scheme was built with the hooks of patch.py into build/mac-voice:
#   docs/mac-voice-probe/run.sh            every case
#   docs/mac-voice-probe/run.sh 3 7        the cases with these numbers
# It starts the probe build once per case, and stops only that build (by its path, never by name:
# another MindRoom may run). It empties Application Support/MindRoomVoiceRecorder first.
set -u
app="$PWD/build/mac-voice/Build/Products/Debug-maccatalyst/MindRoom.chat.app"
dir="$HOME/Library/Application Support/MindRoomVoiceRecorder"
log=/tmp/mac-voice-probe.log
want=" $* "

launch() { # launch <log> <mode> [NAME=value ...]: the hooks' variables without their MINDROOM_VOICE_
  local out=$1 mode=$2 args=(--env MINDROOM_VOICE_PROBE="$2" --env MINDROOM_VOICE_TONE=1); shift 2
  for variable in "$@"; do args+=(--env "MINDROOM_VOICE_$variable"); done
  : > "$out"
  open -n "${args[@]}" --stderr "$out" "$app"
}
await() { timeout "${3:-60}" bash -c "until grep -q '$1' '$2'; do sleep 0.5; done" || echo "  TIMEOUT waiting for: $1"; }
quit() { for pid in $(pgrep -f '[b]uild/mac-voice/.*/MacOS/'); do kill "$pid"; done; sleep 1; }
said() { grep -o "..:..:..\.... .*MindRoom voice probe: .*" "$1" | sed -E 's/MindRoom.chat\[[0-9:]+\] MindRoom voice probe: //; s/<AVAudioFormat 0x[0-9a-f]+: *//g; s/>//g' | cut -c1-400; }
id_of() { grep -o "$1: started .*" "$2" | awk '{print $3}'; }

# The file's format and length, and whether the probe's 440 Hz tone runs through it without a gap.
check() {
  [ -f "$1" ] || { echo "  no file $1"; return; }
  echo "  afinfo: $(afinfo "$1" | grep -E 'Data format|estimated duration' | sed -E 's/ +/ /g; s/, aac.*//' | tr '\n' ';')"
  ffmpeg -v error -y -i "$1" -ac 1 -ar 16000 -f s16le /tmp/mac-voice-probe.raw
  python3 - <<'PY'
import array
a = array.array('h'); a.frombytes(open('/tmp/mac-voice-probe.raw', 'rb').read())
rate = 16000; body = a[800:len(a) - 800]  # without AAC's lead-in and the fade at the end
crossings = [i for i in range(1, len(body)) if (body[i - 1] < 0) != (body[i] < 0)]
jumps = sum(1 for x, y in zip(crossings, crossings[1:]) if abs((y - x) - rate / 880) > 3)
quiet = longest = 0
for i in range(0, len(body) - 80, 80):
    quiet = quiet + 1 if max(abs(x) for x in body[i:i + 80]) < 1638 else 0
    longest = max(longest, quiet)
print(f"  decoded: {len(a) / rate:.3f} s, tone {len(crossings) / 2 / (len(body) / rate):.1f} Hz, longest quiet stretch {longest * 5} ms, phase jumps {jumps}")
PY
}

number=0
case_() { # case_ <title> <expected> <mode> [NAME=value ...]
  number=$((number + 1))
  [ "$want" = "  " ] || [[ "$want" == *" $number "* ]] || return 1
  echo "== $number. $1"; echo "  expect: $2"
}
run() { # as case_, then one launch of <mode>, its log and its file
  case_ "$@" || return 0
  local mode=$3; shift 3
  launch $log "$mode" "$@"; await "$mode result" $log 90
  said $log | sed 's/^/  /'
  check "$dir/$(id_of "$mode" $log).m4a"
  quit
}

quit; [ -d "$dir" ] && trash "$dir"

run "tone across a pause (1.5 s, pause 2.5 s, 1.5 s)" "3.0 s, 440 Hz, no gap; listed after the stop" paused
run "device change at 2 s of 6 s, same format" "about 5.9 s (the buffer in flight is lost), no gap" plain RECONFIG=2
run "device change at 2 s to 24 kHz mono" "about 5.9 s, 440 Hz (not 880)" plain RECONFIG=2 RATE=24000
run "device changes at 2 s and 4 s to 44.1 kHz stereo" "about 5.8 s, 440 Hz" plain RECONFIG=2,4 RATE=44100 CHANNELS=2
run "device change to 24 kHz during the pause" "3.0 s, 440 Hz, no gap" paused RECONFIG=2.5 RATE=24000
run "a device without a format for a moment after the change at 2 s" "one more try after 250 ms; about 5.6 s" plain RECONFIG=2 EMPTY=1
run "a device that keeps having no format" "the recording ends at 2 s (level NOT_RECORDING), and stop still answers its 2.0 s file, twice" plain RECONFIG=2 EMPTY=2
run "an interruption at 4 s" "ends at 4 s; stop answers the 4.0 s file" plain INTERRUPT=4
run "the writer's queue hangs for 3 s at 2 s" "level answers stay fast; 6.0 s, no gap" plain BLOCK=2,3
run "the writer's queue still hangs at the stop (8 s from 2 s)" "level answers stay fast; the first stop answers after 3 s, incomplete, with the 2 s on disk, not listed; the second, once the queue goes on, the whole 6.0 s" plain BLOCK=2,8
run "stop asked while the writer's queue hangs for 10 s" "stop answers after 3 s, incomplete, with the bytes on disk; not listed then" stopearly BLOCK=2,10
run "stop while the writer takes 14 s to finish the file" "stop answers after 3 s, incomplete; not listed until the writer is done" stopearly HOLD=14
run "8 s of buffers at once during a pause, into a writer that is not ready" "about 4 s of them wait, and go on to the writer during the pause; 11.0 s, no gap" paused FLOOD=80 SLOW=1
run "12 s of buffers at once during a pause (more than the 5 s that may wait)" "the recording ends (resume NOT_RECORDING) and keeps what the writer took, about 5 s; stop answers it, incomplete" paused FLOOD=120 SLOW=1
run "discard: forget of the live recording" "forget ok, not listed, a stop after it NOT_RECORDING; no file" discard
run "forget with an ID that is no UUID" "INVALID_ID for each; an absent UUID is ok" invalid

if case_ "kill -9 at 8 s, after a device change to 24 kHz at 2 s" "the file plays about 7 s at 440 Hz; a relaunch lists it with its owner"; then
  launch $log kill RECONFIG=2 RATE=24000; await "kill: started" $log; killed=$(id_of kill $log)
  sleep 8; kill -9 "$(pgrep -f '[b]uild/mac-voice/.*/MacOS/')"; sleep 1
  check "$dir/$killed.m4a"
  launch $log list; await "list result" $log
  echo "  relaunched: $(grep -o 'list result.*' $log | grep -o "$killed owner=[^,)]*" || echo 'NOT LISTED')"; quit
fi
for mode in stopreload reload; do
  if case_ "$mode: $([ $mode = reload ] && echo 'the page reloads while recording' || echo 'stop, then the page reloads, no forget')" "listed after the reload"; then
    launch $log $mode; await "list result" $log; left=$(id_of $mode $log)
    echo "  after the reload: $(grep -o 'list result.*' $log | grep -o "$left owner=[^,)]*" || echo 'NOT LISTED')"; quit
  fi
done
if case_ "a second process lists while the first records; a file without a lock" "neither is listed, and listing makes no .lock file"; then
  mkdir -p "$dir"; stray=11111111-2222-4333-8444-555555555555; echo x > "$dir/$stray.m4a"
  launch /tmp/mac-voice-probe-live.log plain; await "plain: started" /tmp/mac-voice-probe-live.log; live=$(id_of plain /tmp/mac-voice-probe-live.log)
  launch $log list; await "list result" $log
  echo "  the live $live listed: $(grep -o 'list result.*' $log | grep -c "$live"); the stray listed: $(grep -o 'list result.*' $log | grep -c "$stray"); its lock made: $(ls "$dir" | grep -c "$stray.lock")"
  await "plain result" /tmp/mac-voice-probe-live.log; quit; trash "$dir/$stray.m4a"
fi
echo "left in the folder: $(ls "$dir" 2>/dev/null | grep -c 'm4a$') recordings, $(ls "$dir" 2>/dev/null | grep -c 'lock$') locks"
