# Call transcription: design

Status: 2026-11-07, decided by Bas Nijholt. One feature across two repositories: MindRoom (`mindroom-ai/mindroom`,
the server) and MindRoom Chat (`mindroom-ai/mindroom-chat`, this client). This document is the whole input for the
work; it describes what the software does and the contract between the two sides, not how to write it.

## What people get

- In a room where MindRoom's router is a member, a call between people is transcribed: each person's words appear
  under their name, live, while the call goes on.
- Anyone in the call can **pause** transcription for everyone, and anyone in it can resume it. While paused nothing
  anyone says is transcribed, and the live transcript shows a gap ("Paused").
- When the call starts, the room gets a call row ("Call started"). While the call is live the row shows who is in it,
  with **Join** and **Transcript**.
- When the call ends, the router posts one message in the call row's thread: the call's notes (what it was about,
  decisions, action items with who said they would do them, open questions), written by a model the operator chose,
  and the full transcript in MindRoom's existing structured transcript format (`io.mindroom.call_transcript`), which
  MindRoom Chat already shows as a transcript card with each speaker's avatar and name. Without a notes model the
  message carries the transcript and a one-line summary ("Call · 12 min").
- Calls with one of MindRoom's voice agents are not part of this: they already post their own transcript.
- Off unless the operator turns it on.

## Why this shape

- **The finished transcript lives in Matrix**, as one message: it is encrypted where the room is, shown to exactly
  the people the room's history visibility allows, searchable, and deleted by redacting it. The server keeps a call's
  lines only until that message is posted; after that it keeps only what it needs to not post twice.
- **Each person's app transcribes its own voice.** The app listens to the microphone track it already publishes to the
  call, cuts it into stretches of speech, and sends each stretch to MindRoom, which transcribes it. The speaker's name
  is the signed-in session's, never a guess; calls stay end-to-end encrypted; nobody extra joins the call.
- **Live updates come from polling**: an app in the call, or showing a live call, reads it every few seconds with a
  bearer token (no token in any URL). No stream to keep open, cap or reconnect.

## The server (MindRoom)

### Settings

`calls.transcripts` in MindRoom's config:

| Field | Default | What it is |
| --- | --- | --- |
| `enabled` | `false` | Transcribe calls between people. |
| `notes_model` | none | A top-level `models` entry that writes the notes; none writes no notes. Validated at load. |
| `languages` | `[]` | Language codes, hints for speech-to-text (the first is sent). |

Speech-to-text uses MindRoom's existing voice-message settings (`voice.stt`: provider, model, host, credentials).
Changes apply to the next request, without a restart. Turning `enabled` off stops all reading and posting in Matrix for
calls at once (no request for calls starts after it; one already under way may complete); while it is off, stored calls keep only the one-day limit below (a call not heard from for a day ends
and its message is given up). Turned back on, calls go on as before.

### A call

- A call belongs to one Matrix room; a room has at most one live call. Two people starting at once get the same call.
- **Who is in it.** A person is in the call while their app checks in (`calls.join`, `pause` or `speech` for the call)
  at least every 60 seconds; apps send a heartbeat every 20 seconds. An app that leaves is out at once. Only people
  whose apps take part are in the call: people on other Matrix apps are neither listed nor transcribed. MatrixRTC
  membership is not consulted.
- **Ending.** A call ends when nobody is in it, checked when someone leaves and every 15 seconds while it is live; it
  ended at its apps' last check-in or leave, not when that was noticed. After MindRoom starts, apps get a full minute to
  check in before anyone counts as gone.
- **The row.** When a call starts, the router posts a notice in the room: body `Call started`, content
  `io.mindroom.call: {"call_id": "<id>"}`. It wakes no agent and notifies nobody. If the router is not ready, it is
  posted once it is. When the call ends, the router edits the row (`m.replace`, still a notice): body
  `Call ended · N min`, `io.mindroom.call: {"call_id", "ended_at", "duration_seconds"}`; once the transcript message is
  posted it edits it again, adding `"transcript_event_id"`. An unedited row is a live call.
- **The transcript message.** About 20 seconds after the end (so late speech can arrive), if anyone spoke, the router
  posts one notice in the row's thread: body = the notes in Markdown (or `Call · N min` without a notes model), with
  `io.mindroom.call_transcript: {"duration_seconds", "turns": [{"sender": "<Matrix user ID>", "text"}]}` (paused
  stretches are not turns) and `io.mindroom.call_notes: {"call_id"}`. Too large for one event: the transcript goes into
  MindRoom's existing large-message sidecar, as voice agents' transcripts do; a message whose transcript cannot be sent
  is not sent without it. It wakes no agent, notifies nobody, and neutralises mentions in the notes. Failed notes are
  tried once more after 60 seconds, then the transcript is posted without them; a failed post is retried every minute.
  A call with no speech posts nothing; a call whose speech could not be transcribed at all posts the message with no
  turns and a body saying so. Afterwards the call's lines are deleted. A message not posted within a day of the end, or
  in a room the router has left or may not post in, is given up and its lines deleted, so the server never keeps them indefinitely; that
  holds after MindRoom was down for longer, too. A day after its end MindRoom does nothing more for a call: no message,
  no row edit.
- **Pause.** Anyone in the call can pause transcription, and anyone in it can resume it; the call records who paused.
  It stays paused until someone resumes or the call ends. While paused, speech is refused, and so is a stretch that
  overlapped a paused period, whenever it arrives; a stretch counts from when its app says it began until it arrives, so
  a device clock running behind cannot move speech said during a pause to before it. Each pause appears once in the live
  transcript as a gap.
- **Speech.** WAV, 16-bit PCM, mono, at most 30 seconds by its header and 1 MB; never written to disk (not even a
  temporary file); from a person currently in the call through their app; one stretch in flight per person and at most
  240 a minute (refusals say when to try again with `Retry-After`). A stretch said before its call ended is accepted
  for 20 seconds after the end (until the transcript message is due) and never later, so everything accepted is in the
  posted transcript and its notes. A stretch that fails to transcribe becomes a gap ("Not transcribed"); one in
  which no words were heard adds nothing. The call goes on.
- **Who may do what.** Starting or joining needs permission to post messages in the room (Matrix power levels);
  heartbeats from someone already in the call do not re-check it. Reading the live call needs room membership. A call's
  routes take the room from the call, never from the request, and answer 404 to anyone outside that room.
- The server logs each call's seconds of speech, and records the token usage of transcription and notes in MindRoom's
  system usage.

### Routes

Under `/api/call-transcripts/v1`, with MindRoom's client sessions (`Authorization: Bearer <session>`, from
`POST /api/client-sessions` with an audience-bound Matrix OpenID token), client-origin CORS (no cookies, `no-store`,
`Retry-After` readable). Every route answers 404 while `enabled` is false.

| Route | Answer |
| --- | --- |
| `POST /rooms/{room_id}/calls.join` | `{"call": Call}`: the live call, started if none; also the heartbeat |
| `POST /calls/{call_id}/leave` | `{}` |
| `POST /calls/{call_id}/pause` `{"paused": bool}` | `{"call": Call}` |
| `POST /calls/{call_id}/speech` multipart `audio` (WAV), `startedAt` (ISO time) | `{"line": Line \| null}` (a line, a gap, or null when no words were heard) |
| `GET /rooms/{room_id}/calls.live?after=<line id>` | `{"call": Call \| null, "lines": [Line], "names": {userId: displayName \| null}}`; `lines` are those after `after` (all without it) |

`Call`: `id`, `roomId`, `rowEventId` (null until posted), `startedAt`, `endedAt` (null while live), `members` (user
IDs whose apps are in the call now), `pausedBy` (user ID, or null when not paused). `Line`: `id`,
`callId`, `userId`, `saidAt`, `seconds`, `kind` (`speech` or `gap`), `text` (speech) or `reason` (`paused` or
`not-transcribed`). Refusals: HTTP status with `{"error": "<sentence>", "code": "<forbidden|not-found|invalid|paused|too-many-requests|unavailable|too-large>"}`.

## The client (MindRoom Chat)

- **Transcribing.** When this device is connected to a room call (not an agent call) in a room where MindRoom answers,
  the app joins the server's call, sends a heartbeat every 20 seconds (starting even if the first join failed), finds
  speech in the microphone track it publishes, and uploads each stretch. A muted microphone sends nothing. Switching
  microphones follows the new track. When the call ends on this device: stop listening, let queued uploads finish
  (each gives up after 30 seconds), then leave; a new join to the same room waits for that leave. A refused stretch
  (`too-many-requests`) is retried once after `Retry-After` (at most 10 s). While in the call it reads `calls.live`
  every 2 seconds (with `after`) for new lines and the paused state.
- **Finding speech.** A trained voice-activity model, Silero VAD, decides what is speech: it rates each 96 ms of the
  microphone, brought down to 16 kHz mono, for how likely it is to be someone talking, so typing, a fan or a door at
  the level of a voice does not count. It runs in the browser through `@ricky0123/vad-web` on the WebAssembly build of
  `onnxruntime-web`, with that wrapper's default model (`legacy`) and settings, none tuned here: speech begins at a
  rating of 0.3, ends after 1400 ms rated below 0.25, keeps the 800 ms before it, and a stretch with less than 400 ms of
  speech is dropped. The one setting of the app's own is the longest stretch, 30 seconds, the server's limit
  (`too-large` above it): longer talk goes on in the next stretch. Stretches are sent as 16 kHz mono 16-bit WAV. The
  model (about 1.8 MB) and the runtime (about 15 MB) load from the app's own origin when capture starts, never with the
  first page, and are cached like the app's other build files. Nothing is captured while paused.
- **Status.** Once a call route has answered in this call, if the server becomes unreachable or answers 5xx, the call
  goes on, the controls say "Transcripts are unavailable", nothing is sent, and the heartbeat keeps trying; the first
  answered heartbeat resumes. A live read that fails or takes longer than 10 seconds counts the same, and polling goes on. Before any call route has answered (for example a server that predates this feature,
  whose cross-origin rules refuse these routes), stay silent while the heartbeat keeps trying. A 404 or 403 means this
  room isn't transcribed: show nothing, send nothing. A refused join (`too-many-requests`) is retried after
  `Retry-After`, silently.
- **Pause** sits in the call's controls: a toggle button (an ordinary button, so keyboards and assistive technology
  work as usual) that pauses or resumes transcription for everyone. Pausing stops this device's capture at once, before
  the server answers; resuming waits for the server's answer, so nothing said before the server resumed is sent. Paused looks like the call controls' warning state, with "Paused by Ann" naming who paused. A
  refused request shows the state the server reports. The paused state comes from the server's answers (the join's too) and polls; a poll sent before a newer answer never
  undoes it.
- **Live transcript** opens in the room's side panel from Transcript (in the controls and on the row), reading the live
  call every 2 seconds while open: lines under display names, gaps, who is in the call, and a line saying the call is
  transcribed. Pause is also in its header
  while it shows this device's call. Closing it brings back the call panel if it replaced it.
- **The row** (`io.mindroom.call`, from a MindRoom agent only) renders from its latest edit in the timeline and in the
  thread lists: live (unedited), who is in the call (a visible live row reads the live call every 5 seconds), Join,
  Transcript; ended, how long it lasted and, once known, a link
  to the transcript message (`transcript_event_id`) in its thread. The transcript message itself uses the existing
  transcript card, with the notes as its text; for a message carrying `io.mindroom.call_notes` from a MindRoom agent,
  speakers who were in the room but have left still count as trusted, so the transcript stays visible.
- The MindRoom server for a room is the one the room's MindRoom agents published (while the homeserver binds sign-in
  tokens to it), else the one the deployment names. A device's own choice of server for agents' computers doesn't
  apply: transcription needs the MindRoom whose router is in the room.
- Strings in every locale; the app's own components and theme tokens; no new colours.

## Testing

- Server: the rules above as unit tests with fakes (membership, router, transcriber, notes); the routes through the
  real API app; and one opt-in test with a real speech-to-text key that transcribes a real recording.
- Client: unit tests for speech finding (fed synthetic frames), the transcribing lifecycle, Pause and the panel; an
  end-to-end test with two people in a real LiveKit call, real speech-to-text and a real notes model (opt-in with
  `OPENAI_API_KEY`), and the same test against a stand-in for runs without keys.

## Not in this work

People on other Matrix apps aren't transcribed. Direct messages without MindRoom. Voices on one shared microphone.
Changing who may start an agent call from a room (a separate change).
