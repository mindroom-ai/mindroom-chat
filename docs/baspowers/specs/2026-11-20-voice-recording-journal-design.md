# A voice recording is never lost

## Problem

Until a voice message is sent, its audio lives only in memory (`generation.chunks` in
`voiceCaptureSession.ts`). Today these paths lose it:

- A crash, reload or app update while recording loses all of it.
- A recorder that stops on its own (mic unplugged, iOS suspension) drops the chunks and says "Voice
  recording stopped unexpectedly. Please record again." (`finishStop`, action not `send`).
- `retire` and `releaseOwner` (composer unmount, room switch) drop the chunks.
- Discard deletes at once; a misclick has no way back.
- `savedVoiceDraft.ts` keeps only a failed send. It erases that copy whenever the draft atom is
  empty, and it skips the restore, leaving the copy hidden, when `mx.getRoom(saved.roomId)` is
  not loaded yet.
- Mac Catalyst records an `AVAudioRecorder` `.m4a` in the temp folder. The file is unreadable until
  stopped properly, and the plugin wipes the folder at startup.

## Rule

**Audio is on disk within about a second of being recorded, and leaves the disk only after the
server accepted the voice event or the person confirmed Discard.**

Promise: recovery through the last chunk written to disk. Not "nothing is ever lost": the last
second or so before a crash can be gone.

## Web journal (`src/app/composer/voice/voiceRecordingJournal.ts`)

- IndexedDB database `mindroom-voice-journal`. It has two stores:
  - `recordings`, keyed by `recordingId`. Meta is written once at start: `userId`, `recordingId`,
    `startedAt`, `mimeType`. Later changes that are not chunks are written to the same record:
    `stoppedAt`, `destination`, `txnId`, `discardUntil`, `errorMessage`.
  - `chunks`, keyed by `[recordingId, seq]`, holding `{bytes: ArrayBuffer, elapsedMs, samples}`.
    Chunks are only appended, never rewritten. `seq` is assigned synchronously in
    `dataavailable`, before the async `arrayBuffer()`. Writes are serialized per recording.
  - Bytes are stored as an ArrayBuffer, never a Blob: WebKit refuses Blobs in IndexedDB in a private
    window.
- No React, jotai or matrix-js-sdk imports. The capture session gets the journal injected; capture
  does not import it.
- The in-memory chunks stay the primary copy. If a journal write fails (quota, private mode,
  eviction), recording goes on and the capsule says "Not protected against a crash" once.
  `navigator.storage.persist()` is asked once, best effort.
- On `pagehide` and `visibilitychange` to hidden, call `recorder.requestData()` (best effort).

## Ownership: Web Locks

- The tab that owns a recording holds the exclusive lock `mindroom-voice-recording:<recordingId>`.
  It takes the lock before it writes the meta, and holds it while the recording is live, parked or
  sending, until it deletes the record.
- Recovery takes each record's lock with `navigator.locks.request(name, {ifAvailable: true})`,
  never with `query()` and then acting. If it gets the lock, the record is an orphan and now
  belongs to this tab. A second tab can never adopt it.
- If `navigator.locks` is missing (check under `capacitor://` too), there is one fallback: a record
  is an orphan only if its newest chunk is older than 10 minutes and the page loaded after that
  write. A live recording in a suspended tab must never count as dead.

## Recovery

- After login, per account, orphans are queued oldest first. `pendingVoiceSendDraftAtom` is a single
  slot, so it shows them one at a time. A record is never erased because the slot is empty.
- An orphan becomes a parked draft with no destination: "Recovered recording · 4:32" with Send and
  Discard. It is the chunks concatenated in `seq` order, with the stored MIME type; its duration is
  the last chunk's `elapsedMs` and its waveform the stored samples. It shows in any composer, and
  Send in that composer sends it there. This matches the destination-free live recording from
  `2026-11-20-voice-recording-follows-navigation-design.md`.
- An orphan that has a `destination` and `txnId` (the crash happened mid-send) is parked at that
  destination, with Retry, using the same `txnId`.

## Send, discard, stop

- Send: the destination and a stable Matrix transaction ID are written to the record before the
  upload starts. Retries reuse that ID. The record is deleted only after the voice event is
  acknowledged (the send resolved with an event ID), not when the upload completes.
- Discard: the record gets `discardUntil = now + 10 s` and an Undo toast shows. The record is
  deleted when the toast expires. If `discardUntil` has passed when a page loads, the record is
  deleted then. Undo turns the recording into a parked draft.
- A recorder that stops without Send or Discard (`finishStop`, `retire`, `releaseOwner`) parks the
  chunks it has as a draft instead of dropping them. If it has no chunks, today's error stays.
- `savedVoiceDraft.ts` goes away. Its parked failed send lives in the journal (one store, one
  restore path). The old `mindroom-voice-drafts` database is read once, imported into the journal,
  then deleted.
- Sign-out deletes the account's records (as today).

## Mac Catalyst (`ios/App/App/MindRoomVoiceRecorderPlugin.swift`, `src/app/native/nativeVoiceRecorder.ts`)

- Recordings move from the temp folder to `Application Support/MindRoomVoiceRecorder/`.
- The plugin records in a format a kill can't ruin. It writes AAC through `AVAssetWriter` with
  `movieFragmentInterval` = 1 s (fragmented `.m4a`). If that proves unreliable, it writes linear
  PCM CAF and converts to AAC at stop.
- No folder wipe at startup. **A native file is deleted only by an explicit `forget({id})` from
  JS.** Nothing native infers it: not a stop (failed or not), a reload, a closed window, a changed
  device or a timeout. Each recording holds an exclusive `flock` (`<id>.lock`) from its start until
  its writer is done, finished or failed, and never lets go earlier. `stop` answers
  `{path, incomplete}` for every recording of the page, also one that ended by itself (an
  interruption, a file that cannot be written), so what was recorded can still be sent;
  `incomplete` when the writer did not take the last buffers within 2 s (they are dropped, the rest
  is finished) or is not done 3 s after the stop. The lock file holds the account that recorded,
  written before the capture starts. `orphans()` resolves
  `{recordings: [{id, path, startedAt, owner}]}` for the files whose existing lock it can take (the
  lock first, then the file is read under it; it makes no lock file), so a stopped recording that
  was not forgotten is listed too. JS decides: the capture session calls
  `NativeVoiceRecorder.forget()` on Discard (without reading the audio), and hands the recording on
  with a `forgetSource` that is called only once the audio is safe elsewhere: the server accepted
  the send, or the failed send's copy is stored in IndexedDB (and never for an `incomplete` file).
  `listNativeVoiceOrphans()`, which gives each orphan's `userId`, and
  `forgetNativeVoiceRecording(id)` are for the rest. Every other way out leaves the file for
  `orphans()`. The journal imports each orphan of the signed-in account once, by its native ID, and
  then forgets it; it moves the forget of a sent recording to after its journal write.

## Tests (the gate is a forced kill, not a clean stop)

- Unit: the journal appends in `seq` order even when `arrayBuffer()` resolves out of order. A write
  failure keeps recording and warns once.
- Unit: recovery through `ifAvailable` adopts only unlocked records, and two tabs adopt one record
  once.
- Unit: a recorder stopping by itself parks the audio. Discard plus Undo restores it; an expired
  `discardUntil` deletes it.
- Unit: a send deletes the record only after the event is acknowledged. A crash mid-send retries
  with the same `txnId`.
- Unit: the old `mindroom-voice-drafts` copy is imported once.
- e2e (Chromium and WebKit): record about 5 s, close the page context without stopping, open a new
  page. "Recovered recording" shows, Send posts exactly one `m.audio`, its duration is about 5 s, and
  the uploaded file decodes and seeks (decode it in the page with `decodeAudioData`).
- Mac (M2): record, `kill -9` the app, relaunch. The recording comes back, plays, and the file is in
  Application Support.
