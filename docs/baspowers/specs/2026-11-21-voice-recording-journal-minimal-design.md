# A voice recording survives a crash (minimal)

Replaces the larger `feat/voice-recording-journal` attempt (+912 production lines after three
review rounds). This one does only the core: save while recording, offer the audio back after a
crash, delete it once it was sent or discarded. Target: about 300 production lines.

## Problem

Until a voice message is sent, its audio lives only in memory (`generation.chunks` in
`voiceCaptureSession.ts`). A crash, reload or app update while recording loses all of it. A
recorder that stops on its own drops the chunks ("Voice recording stopped unexpectedly"), and so
does a composer unmount (`retire`, `releaseOwner`).

## Rule

**While recording, each chunk is on disk within about a second. The disk copy goes after a
successful send, confirmed Discard, or sign-out.**

## Design

- New `src/app/composer/voice/voiceRecordingJournal.ts`. It holds an IndexedDB database
  `mindroom-voice-journal` with two stores:
  - `recordings`: meta `{id, userId, startedAt, mimeType}`, written once at start.
  - `chunks`: keyed `[id, seq]`, holding the bytes as an ArrayBuffer (WebKit refuses Blobs in
    private windows) and `elapsedMs`. `seq` is assigned synchronously in `dataavailable`. Writes are
    serialized per recording. On recovery, the first non-empty chunk's type wins over the start-time
  MIME. Live sends continue to prefer the recorder's MIME.
- **Ownership.** The tab holds the Web Lock `mindroom-voice-recording:<id>` from before it writes
  the meta until the record is deleted. Without `navigator.locks` there is no journal; recording
  works from memory as today.
- **Injection.** The capture session gets the journal injected and imports no React, jotai or
  composer code. A failed journal write never stops recording.
- **Recovery.** When a composer first mounts for the account on a page, the client takes each
  record's lock with `ifAvailable`. Each record it gets becomes a parked draft labelled "Recovered recording · m:ss",
  with Send and Discard, in the existing `pendingVoiceSendDraftAtom` slot. It sends in whichever
  composer Send is pressed. If the slot is taken, the record stays on disk and its lock is released
  for the next page load.
- **Self-stop and unmount.** A recorder that stops without Send or Discard, or a composer that
  unmounts while recording, parks the captured audio as a recovered draft instead of dropping it.
  When another composer takes the mic, the displaced recording stays on disk with its lock
  released until the next page load, without occupying the draft slot.
  Since voice follows navigation (#703) the account owns the live recording: no unmount or
  second microphone ends it, so only self-stop parks, and account exit keeps the record unlocked.
- **Send.** The record is deleted after `sendRecording` resolved. A failed send keeps it. The
  existing failed-send copy (`savedVoiceDraft.ts`) stores the recording id. On restore, a journal
  record with that id is not offered a second time.
- **Discard** asks for confirmation for both live and parked recordings. Focus starts on Cancel
  and stays inside the confirmation. The recording is not discarded until confirmed.
- Sign-out deletes the account's journal records, as main does for the failed-send copy.

## Not in scope (each was a source of review rounds last time)

- No Undo.
- No migration of `savedVoiceDraft.ts`.
- No transaction-ID reuse or "Send a copy here". A retry can double-post as on `main` today.
- No room or thread destination on disk.
- No queue of several recovered recordings beyond "one at a time, the rest wait for a reload".
- No Mac native orphans: follow-up after mindroom-chat#701.
- Without Web Locks there is no journal, and a mic handoff behaves as on main.

## Tests

- **Unit:**
  - Chunks are written in `seq` order even when `arrayBuffer()` resolves out of order.
  - A failed write keeps recording.
  - Recovery adopts only unlocked records.
  - A self-stopped or unmounted recording parks.
  - Send success deletes the record; a failed send keeps it.
  - Discard deletes the record.
  - The failed-send copy and the journal never offer the same id twice.
- **e2e (Chromium and WebKit):** record about 5 s, close the page without stopping, and open a new
  page. "Recovered recording" shows, Send posts exactly one `m.audio` of about 5 s, and its bytes
  decode. After a reload nothing comes back.
