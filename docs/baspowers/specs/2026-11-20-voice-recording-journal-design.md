# A voice recording is never lost

## Problem

Until a voice message is sent, its audio lives only in memory (`generation.chunks` in
`voiceCaptureSession.ts`). Today these paths lose it:

- A crash, reload or app update while recording loses all of it.
- A recorder that stops on its own (mic unplugged, iOS suspension) drops the chunks and says "Voice
  recording stopped unexpectedly. Please record again." (`finishStop`, action not `send`).
- `retire` and `releaseOwner` (composer unmount, room switch) drop the chunks.
- Discard of a recording that is still running deletes at once; a misclick has no way back.
- `savedVoiceDraft.ts` keeps only a failed send. It erases that copy whenever the draft atom is
  empty, and it skips the restore, leaving the copy hidden, when `mx.getRoom(saved.roomId)` is
  not loaded yet.
- Mac Catalyst records an `AVAudioRecorder` `.m4a` in the temp folder. The file is unreadable until
  stopped properly, and the plugin wipes the folder at startup.

## Rule

**Audio is on disk within about a second of being recorded, and leaves the disk only after the
server acknowledged this voice event with an event ID, or after a Discard the person confirmed.**

Promise: recovery through the last chunk written to disk. Not "nothing is ever lost": the last
second or so before a crash can be gone.

Two rules follow from it (review round 2):

- **A. The journal record is the truth, and every change to it is write-then-act.** One function,
  `transitionVoiceRecording(recordingId, change)`, makes every change: send intent, park, the
  delete of a confirmed Discard, and the delete after an acknowledged send. It resolves
  `committed` (the disk holds the change and all audio so far), `absent` (the disk has no such
  recording: it never took one, or it is deleted) or `failed` (nothing was written; the state
  before stands). What shows and what is sent act on that outcome, after the write. A failed
  write keeps the state before it, which is the safer one, and shows the error.
- **B. A recording whose send intent was written belongs to that destination.** It is retried and
  recovered only there, under its transaction ID, as the event type it went out as. If this
  account cannot send that there now (the room is gone or not joined once the server was heard,
  or its encryption changed since), every composer shows it as "May already be sent to <room
  name, or another room>", and sending it elsewhere is a copy under a new transaction ID, behind
  its own button "Send a copy here". A recording that was never attempted has no destination.

Review round 3 cut what round 2 had added beyond the request: the Undo for a Discard (a deadline
on disk, a toast, timers, expiry on load) and the deferred cleanup of the old draft database.
Both were where the round's new findings were. A Discard asks first instead, and the old draft
is moved in one step.

## Web journal (`src/app/composer/voice/voiceRecordingJournal.ts`)

- IndexedDB database `mindroom-voice-journal`. It has two stores:
  - `recordings`, keyed by `recordingId`. Meta is written once at start: `userId`, `recordingId`,
    `startedAt`, `mimeType`. Later changes that are not chunks are written to the same record:
    `destination`, `txnId`. The destination holds IDs only (room, thread root, the event replied
    to and its thread), never the text of what is replied to, in any room, and `encrypted`:
    whether the event went out as `m.room.encrypted` or as `m.room.message`. The server tells a
    repeated send by the event type too, so the same transaction ID as the other type would be a
    second message.
  - `chunks`, keyed by `[recordingId, seq]`, holding `{bytes: ArrayBuffer, type, elapsedMs}`.
    Chunks are only appended, never rewritten. `seq` is assigned synchronously in
    `dataavailable`. Writes are serialized per recording, each in one transaction that is
    aborted as a whole when any part of it fails. The first chunk that has a `type` gives a
    recovered recording its MIME type. Waveform samples are not kept: a recovered recording shows
    the fallback waveform.
  - A chunk that is not on disk yet is kept as its Blob and read again for every try, so a read
    that failed once does not stop the journal.
  - Every write transaction asks for `durability: 'strict'`: what follows a write may be a send,
    so the write has to be on the disk, not only handed to the system. A connection the browser
    closed (`terminated`) is opened again by the next write.
  - Bytes are stored as an ArrayBuffer, never a Blob: WebKit refuses Blobs in IndexedDB in a private
    window.
- No React, jotai or matrix-js-sdk imports. The capture session gets the journal injected; capture
  does not import it.
- The in-memory chunks stay the primary copy. If a journal write fails (quota, private mode,
  eviction), recording goes on and the capsule says "Not protected against a crash". The failed
  chunk is written again, in its place, with the next one and with every later change to the
  recording, and the warning goes once the disk holds everything. A recording is parked, or said
  to be saved in its failure dialog, only by the outcome of such a write.
  `navigator.storage.persist()` is asked once, best effort.
- On `pagehide` and `visibilitychange` to hidden, call `recorder.requestData()` (best effort).

## Ownership: Web Locks

- The tab that owns a recording holds the exclusive lock `mindroom-voice-recording:<recordingId>`.
  It takes the lock before it writes the meta, and holds it while the recording is live, parked or
  sending, until it deletes the record.
- Recovery takes each record's lock with `navigator.locks.request(name, {ifAvailable: true})`,
  never with `query()` and then acting. If it gets the lock, the record is an orphan and now
  belongs to this tab. A second tab can never adopt it.
- If `navigator.locks` is missing, nothing says whose a recording is, so nothing is written to the
  journal, no second copy of the audio is kept for it, and nothing is adopted: recordings live
  in memory and say "Not protected against a crash". (The first version had a fallback that
  adopted a record that had been quiet for 10 minutes. Review showed that two tabs could then
  own one recording, so it was removed.)
- Recovery handles each record on its own: one it cannot read gives its lock back and is offered
  again later. It runs once for the signed-in app (`ClientNonUIFeatures`) and again whenever the
  page comes to the front, so a recording whose tab closed later is offered too.

## Recovery

- After login, per account, orphans are queued oldest first. `pendingVoiceSendDraftAtom` is a single
  slot, so it shows them one at a time. A record is never erased because the slot is empty.
- An orphan becomes a parked draft with no destination: "Recovered recording · 4:32" with Send and
  Discard. It is the chunks concatenated in `seq` order, with the stored MIME type; its duration is
  the last chunk's `elapsedMs`. It shows in any composer, and Send in that composer sends it
  there. This matches the destination-free live recording from
  `2026-11-20-voice-recording-follows-navigation-design.md`.
- An orphan that has a `destination` and `txnId` (the crash happened mid-send) is parked at that
  destination, with Retry, using the same `txnId`.
- Where a recording belongs is resolved by one function (`reconcileVoiceDrafts`), on every
  answer of the server and whenever the slot or the queue changes, from what the store holds at
  that moment. A recording keeps its destination IDs while its room cannot be found: before the
  server was heard, the room may only not be loaded yet (the app can mount from its cache), so
  the recording waits and no copy is offered. Once the server was heard, a room that is not
  there or not joined, or whose encryption differs from the intent's, makes rule B apply. When
  the room is back (joined again), the recording goes back to it, with Retry under its ID.
- The same function moves another account's recording out of the slot and brings in the next one
  of this account. It is one store operation, so two mounted composers move each recording
  once.

## Send, discard, stop

- Send: the destination actually used (the thread root's server ID, resolved by the composer) and
  a stable Matrix transaction ID are written to the record before anything is uploaded, on every
  attempt. If that write fails, nothing is sent and the draft stays with its error. Only a
  recording the disk never held (`absent`) is sent from memory. Every attempt, also a retry in
  the same page, sends under that one ID: a small matrix-js-sdk patch gives a cancelled local
  echo's ID back, and a recording the server already holds under the ID is not sent again. The
  record is deleted only after the server gave this voice event an ID, and the draft leaves the
  composer only once that delete is written. A voice message is not kept among the unsent
  messages as well: the journal is its one way back.
- A send settles its own draft, found by recording ID and attempt in the slot or the queue. It
  never clears or replaces another recording that took the slot meanwhile.
- A bundled send (the recording with attachments or text) writes the destination a second time:
  a file sent before the recording can open a thread, and the voice event goes into it. That
  final thread is written before the voice event's `sendMessage`, and if it cannot be written
  the event is not sent. The parked draft keeps the destination that was written last, not the
  one it was first aimed at.
- A send that stops before its destination is known (the room is gone, the thread's root is
  unsent) still asks the journal for all of the audio, and the parked draft says "Your recording
  is still saved" only if that write committed.
- A voice item without its recording's transaction ID is not sent: nothing makes one up.
- Discard asks first, of a recording that is running as of a parked one: "Discard voice
  recording? This recording has not been sent. Discard it permanently?", Cancel or Discard. A
  running recording goes on while it asks. Confirmed, the recording is deleted through
  `transitionVoiceRecording` at once. The slot's recording is taken for the Discard before
  anything is awaited (`inFlight` with `discard`), so no Send and no second Discard acts on it
  until the delete settled; a recording that is being sent is not discarded. If the disk does
  not delete it, the recording stays with "Couldn't delete the recording." and the dialog offers
  Cancel or Retry. That Retry repeats the Discard and never sends.
- A recorder that stops without Send or Discard (`finishStop`, `retire`, `releaseOwner`) parks the
  chunks it has as a draft instead of dropping them. One that was still recording is stopped and
  waited for (up to the stop timeout), so its last audio is kept too; so is one whose Send or
  Discard was accepted before its composer went. If it has no chunks, today's error stays.
- `savedVoiceDraft.ts` goes away. Its parked failed send lives in the journal (one store, one
  restore path). The old `mindroom-voice-drafts` database holds at most one row per account. It
  is moved in two steps:
  1. The row is copied under the ID `legacy-<userId>-<SHA-256 of its bytes>`, only if no record
     of that ID is there, in one journal transaction. Two pages, or two accounts with the same
     audio, never write over each other.
  2. Right after that commits, one read-write transaction on the old database reads the row
     again, compares its bytes with the copied ones, and deletes it only if they are the same.
     That also takes the quoted text the old row held off the disk. A row an older version's tab
     wrote meanwhile holds other audio: it stays, and the next recovery moves it.
  No lock and no later cleanup are involved.
- Voice messages are not added to the unsent messages (`unsentMessages.ts`). One an older version
  kept there comes back as its "Not sent" row, since it may be the only copy of that send, and
  is forgotten for good once it is sent or deleted. Where such a row and the old draft are the
  same send (the same room, a voice message of the same size: a retry that version was cut
  short in), the recording takes the row's transaction ID, its intent says "not encrypted" (only
  such messages were kept there), and the row and its echo are forgotten once the copy is on
  disk. One copy to send again is left, under the original ID.
- A reply is taken as consumed by the ID of the event it replies to. A recovered recording knows
  only that ID, and its Retry clears the composer's reply all the same.
- Sign-out deletes the account's records (as today).

## Mac Catalyst (`ios/App/App/MindRoomVoiceRecorderPlugin.swift`, `src/app/native/nativeVoiceRecorder.ts`)

- Recordings move from the temp folder to `Application Support/voice-recorder/`.
- The plugin records in a format a kill can't ruin. It writes AAC through `AVAssetWriter` with
  `movieFragmentInterval` = 1 s (fragmented `.m4a`). If that proves unreliable, it writes linear
  PCM CAF and converts to AAC at stop.
- No folder wipe at startup. Every exit path deletes only its own file: `cancel`, and stop after
  the JS side confirms the handoff.
- New plugin method `orphans()` resolves `{recordings: [{id, path, startedAt}]}` for files that no
  live recorder owns.
- JS: `listNativeVoiceOrphans(): Promise<{id: string; file: File; startedAt: number}[]>` and
  `forgetNativeVoiceRecording(id: string): Promise<void>` in `nativeVoiceRecorder.ts`.
- Until the web journal lands, `NativeVoiceRecorder.end()` keeps calling `cancel` after delivery,
  as today. Only a killed process leaves a file behind. Once both PRs are in, the second PR wires
  the native files into the journal: at startup each orphan is imported as one chunk and then
  `forgetNativeVoiceRecording`. A live recording is forgotten only after its bytes are written to
  the journal.

## Tests (the gate is a forced kill, not a clean stop)

- Unit: the journal appends in `seq` order whatever time a read takes. A write failure keeps
  recording and warns once; a failed read is made again; a failed write changes nothing.
- Unit, one per failure path of a durable change: send intent on every attempt, discard (asked,
  taken, failed, retried), park, the delete after a send, a room that is not loaded, gone, left
  or encrypted since, and the old draft (another account's same audio, a row an old tab wrote
  while it was hashed, two pages at once, a source that cannot be deleted, the unsent row of the
  same send).
- Unit: recovery through `ifAvailable` adopts only unlocked records, and two tabs adopt one record
  once.
- Unit: a recorder stopping by itself parks the audio. A Discard asks, deletes on confirm, and
  blocks Send and a second Discard until it settled.
- Unit: a send deletes the record only after the event is acknowledged. A crash mid-send retries
  with the same `txnId`.
- Unit: the old `mindroom-voice-drafts` copy is imported once.
- e2e: Discard asks; cancelled, the recording is there after a reload; confirmed, no later page
  brings it back and nothing is sent.
- e2e (Chromium and WebKit): record about 5 s, close the page context without stopping, open a new
  page. "Recovered recording" shows, Send posts exactly one `m.audio`, its duration is about 5 s, and
  the uploaded file decodes and seeks (decode it in the page with `decodeAudioData`).
- Mac (M2): record, `kill -9` the app, relaunch. The recording comes back, plays, and the file is in
  Application Support.
