# Voice Recording Journal Implementation Plan (web)

**Goal:** A voice recording is on disk within about a second of being recorded and leaves the disk
only after the server accepted the voice event or the person let a Discard stand.

**Spec:** `docs/baspowers/specs/2026-11-20-voice-recording-journal-design.md` (every section except
"Mac Catalyst", which a parallel branch builds; the JS `NativeVoiceRecorder` path stays as it is).

**Related:** `2026-11-20-voice-recording-follows-navigation-design.md` (not built yet) moves the live
capture session into `liveVoiceRecording.ts`. This plan touches capture and delivery at narrow seams
so that refactor rebases cleanly: the journal is injected into `createVoiceCaptureSession`, and
delivery calls the journal only from `voiceSendDraftController.ts`.

**Tech:** TypeScript, vitest (`fake-indexeddb`), `idb`, Web Locks, Playwright (Chromium, WebKit).

## Constraints

- `voiceCaptureSession.ts` imports no React, jotai, matrix-js-sdk or composer module, and does not
  import the journal. `voiceRecordingJournal.ts` imports no React, jotai or matrix-js-sdk.
- In-memory chunks stay the primary copy; a journal failure never stops a recording.
- No new dependency. New strings go in `i18n/locales/additions/*.json` (all 17 files).
- Placeholder data only in tests, specs and screenshots.

## Interfaces

`voice/voiceRecordingJournal.ts` (IndexedDB `mindroom-voice-journal`: `recordings` by
`recordingId` with a `userId` index, `chunks` by `[recordingId, seq]`):

- `VoiceJournalDestination`: `roomId`, `threadId?`, `replyDraft?`, `threadingEnabled`,
  `signalBridgedRoom`, `threadView?`.
- `VoiceJournalRecord`: `userId`, `recordingId`, `startedAt`, `mimeType`, and later `stoppedAt?`,
  `destination?`, `txnId?`, `discardUntil?`, `errorMessage?`.
- `voiceCaptureJournal(userId: () => string)`: what capture gets, `{ begin, append, stop }`.
  `begin` takes the lock, then writes the meta. `append(recordingId, seq, { data, elapsedMs,
  samples })` reads the Blob and writes the chunk, one write after another per recording. Both
  resolve `false` once a write failed; later chunks of that recording are skipped, so what is on
  disk stays a clean prefix. `stop(recordingId, hasAudio)` writes `stoppedAt`, or deletes a
  recording that has no audio.
- `updateVoiceRecording(recordingId, changes)`, `deleteVoiceRecording(recordingId)` (record,
  chunks, lock), `clearVoiceRecordings(userId)` (sign-out).
- `adoptVoiceOrphans(userId, { now?, loadedAt? })`: imports the old `mindroom-voice-drafts`
  database once and deletes it; then, oldest first, takes each of the account's records with
  `navigator.locks.request(name, { ifAvailable: true })`. A record whose `discardUntil` passed is
  deleted (one not yet passed is deleted when it does); one without chunks is deleted; the rest
  resolve as `{ record, file, duration, waveform }`. Without `navigator.locks`, a record is taken
  only if its newest chunk is older than 10 minutes and was written before the page loaded.

`voice/voiceCaptureSession.ts`:

- `createVoiceCaptureSession({ journal?, keep? })`. `CapturedVoiceRecording` gains `recordingId`;
  the snapshot gains `unprotected`.
- `dataavailable` assigns `seq` synchronously and hands the chunk to `journal.append`.
- `pagehide` and `visibilitychange` to hidden call `recorder.requestData()`.
- Audio that was not sent goes to `keep(recording, discarded)` instead of being dropped: a discard
  (for its Undo), a recorder that stops by itself, `retire` and `releaseOwner`. Without audio,
  today's error stays.

`composer/roomInputDrafts.ts`: `PendingVoiceSendDraft` gains `recordingId` and `txnId?`; its
`context` is a destination or, for a recording that has none, only its account
(`UnplacedVoiceContext`, told apart by `hasVoiceDestination`). `queuedVoiceDraftsAtom` and
`discardedVoiceDraftAtom` sit beside the slot.

`voice/voiceSendDraftController.ts`: `createVoiceSendDraftController(drafts, journal)`. Before a
send it writes `destination` and `txnId` and waits for that write; it deletes the record after
`sendRecording` resolved (the voice event has an ID); a failure writes `errorMessage`. `retry`
takes the pressing composer's context for a draft without one. `SendRecordingCallback` gains
`txnId`; the voice upload item carries it (`metadata.voiceMessage.txnId`), and `sendVoiceItem` and
the send session's upload step send under it (`txnIdToSendUnder`).

`voice/voiceDrafts.ts` (jotai, no React): `parkVoiceDraft`, `discardVoiceDraft`,
`undoVoiceDiscard`, `confirmVoiceDiscard`, `recoverVoiceDrafts(mx, store)` (once per account and
page) and `offerQueuedVoiceDraft(store, userId)`, which moves the account's next queued draft
into the single slot while it is empty and no recorder is open. `useRoomInputVoice` calls the last
two: a composer is where the account's rooms are loaded and where a draft can show.

`voice/VoiceDiscardToast.tsx` (mounted in `shell/ClientShell.tsx`): "Recording discarded" with
Undo in the page's notice place, for `VOICE_DISCARD_UNDO_MS`.

## Tasks

Each task: failing test first, then the code, then `nix develop -c npx vitest run <files>`, commit.

1. **Journal.** `voiceRecordingJournal.ts` and its test:
   - `appends chunks in seq order when arrayBuffer() resolves out of order`
   - `keeps a clean prefix and reports false once a write failed`
   - `adopts only records no tab holds, and two tabs adopt one record once`
   - `without Web Locks adopts only a record that went quiet before the page loaded`
   - `deletes a record whose discardUntil has passed`
   - `imports the old mindroom-voice-drafts copy once`
   - `forgets an account's recordings on sign-out`
2. **Capture.** `voiceCaptureSession.ts` and its test:
   - `journals each chunk with a seq assigned in dataavailable`
   - `keeps recording and warns once when a journal write fails`
   - `parks the audio of a recorder that stopped by itself`
   - `parks the audio it has when retired or released`
   - `resolves the recording on discard`
   - `asks the recorder for its data when the page is hidden`
3. **Delivery.** `roomInputDrafts.ts`, `voiceSendDraftController.ts`, `useRoomInputUploadTransport.ts`,
   `useRoomInputSendSessionController.ts` and tests:
   - `writes the destination and txnId before the send starts`
   - `deletes the record only after the event is acknowledged`
   - `keeps the record and the error of a failed send`
   - `retries a crash mid-send with the same txnId`
   - `sends a recovered recording where Send is pressed`
4. **Drafts, recovery, Undo.** `voiceDrafts.ts`, `VoiceDiscardToast.tsx` (+ `.css.ts`), delete
   `savedVoiceDraft.ts` and its test, `sessionCleanup.ts`, `encryptedRoomTextOffDisk.test.ts`:
   - `shows orphans one at a time, oldest first, and erases none while the slot is taken`
   - `parks a mid-send orphan at its destination with Retry`
   - `shows an orphan whose room is gone in every composer`
   - `Discard then Undo restores the recording; an expired Undo deletes it`
5. **Wiring and UI.** `useVoiceRecorder.ts`, `VoiceRecorderDialog.tsx`, `VoiceRecordingCapsule.tsx`
   (+ `.css.ts`), `useRoomInputVoice.tsx`, `UnconfirmedRootsFeature.tsx`, locale additions:
   "Recovered recording · 4:32", "Not protected against a crash", "Recording discarded" with Undo.
6. **e2e.** Update `e2e/composer/voice-draft-reload.spec.ts` to the journal; add
   `e2e/composer/voice-recording-recovery.spec.ts`: record about 5 s, close the page without
   stopping, open a new page in the same context, "Recovered recording" shows, Send posts exactly
   one `m.audio` of about 5 s, and its bytes decode with `decodeAudioData` (Chromium and WebKit).
7. **Verify.** `just typecheck`, `just strict`, `just lint`, `npx vite build`, the full vitest suite
   and the two e2e specs on the mac-runner, screenshots under `.pr-screenshots/` (not committed).

## Decisions where the spec left room, or proved wrong

- **Transaction ID.** matrix-js-sdk keeps a transaction ID it once gave a local echo
  (`Room.txnToEvent` is not cleared when the echo is cancelled) and throws on a second
  `addPendingEvent` with it. So the stored `txnId` is used for every attempt whose room holds no
  echo under it: always the first attempt after a page load, which is the crash case. An attempt
  after a failed send in the same page gets a fresh ID. Removing that limit needs a two-line
  matrix-js-sdk patch (delete the entry on cancel), left out here.
- **Undo is kept in memory too.** The discarded recording stays in an atom for the 10 s, so Undo
  also works when the journal could not be written.
- **A discard not yet expired at page load** is deleted when it expires, not shown again.
- **A draft whose room is gone, or whose thread root never got a server ID,** loses its
  destination and shows in every composer, instead of being dropped.
- **The confirmation dialog of a parked draft's Discard stays;** the Undo toast follows it.
