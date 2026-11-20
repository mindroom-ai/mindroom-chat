# Voice Recording Journal Implementation Plan (web)

**Goal:** A voice recording is on disk within about a second of being recorded and leaves the disk
only after the server gave the voice event an ID or the person let a Discard stand.

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

- `VoiceJournalDestination`: `roomId`, `threadId?`, `replyEventId?`, `replyThreadId?`,
  `threadingEnabled`, `threadView?`. IDs only.
- `VoiceJournalRecord`: `userId`, `recordingId`, `startedAt`, `mimeType`, and later
  `destination?`, `txnId?`, `discardUntil?`.
- `voiceCaptureJournal(userId: () => string)`: what capture gets, `{ begin, append, flush, abandon }`.
  `begin` and `append` add a row to what the recording still owes the disk and write all of it in
  order, taking the Web Lock first; they resolve `true` while the disk holds everything so far.
  `flush` writes once more what a stopped recording still owes the disk. `abandon` deletes a
  recording that ended without audio.
- `updateVoiceRecording(recordingId, changes)` resolves `true` only if this tab owns the record,
  the record exists and the write committed. `deleteVoiceRecording(recordingId, expiredBy?)`
  deletes record, chunks and lock; with `expiredBy`, only if the disk says the discard stood until
  then. `clearVoiceRecordings(userId)` is what sign-out calls.
- `adoptVoiceOrphans(userId, now?)`: returns nothing without Web Locks. Otherwise it copies the
  old `mindroom-voice-drafts` entries, then, oldest first, takes each of the account's records
  with `navigator.locks.request(name, { ifAvailable: true })`. A record whose `discardUntil`
  passed, or that has no chunks, is deleted; one it cannot read gives its lock back; the rest
  resolve as `{ record, file, duration, waveform }`, a discard with time left included.

`voice/voiceCaptureSession.ts`:

- `createVoiceCaptureSession({ journal?, keep? })`. `CapturedVoiceRecording` has `recordingId` and
  `unprotected?`; the snapshot has `unprotected`, which follows the journal's last write.
- `dataavailable` assigns `seq` synchronously and hands the chunk to `journal.append`.
- `pagehide` and `visibilitychange` to hidden call `recorder.requestData()`.
- Audio that was not sent goes to `keep(recording, discarded)` instead of being dropped: a discard
  (for its Undo), a recorder that stops by itself, `retire` and `releaseOwner`. A recorder that is
  let go of while it records is stopped and waited for, so `keep` gets its last audio too.

`composer/roomInputDrafts.ts`: `PendingVoiceSendDraft` has `recordingId`, `txnId?` and
`unprotected?`; its `context` is a destination or, for a recording that has none, only its account
(`UnplacedVoiceContext`, told apart by `hasVoiceDestination`). `queuedVoiceDraftsAtom` and
`discardedVoiceDraftsAtom` sit beside the slot.

`voice/voiceSendDraftController.ts`: `createVoiceSendDraftController(drafts, journal)`.
`SendRecordingCallback` gets `{ txnId, commit }` and resolves with the voice event's ID. The
composer calls `commit(resolved destination)` before it uploads anything; `commit` rejects when
the journal could not take it, unless the draft is `unprotected`. The record is deleted only when
the callback resolved with an ID. `drafts.settle(recordingId, token, failed)` ends an attempt
wherever its draft is. `retry` takes the pressing composer's context for a draft without one.

`matrix/protocol/pendingLocalEcho.ts`: `eventIdOfTransaction(room, txnId)`, the event the server
holds for a transaction ID. `patches/matrix-js-sdk`: a cancelled local echo gives its transaction
ID back. `matrix/client/unsentMessages.ts` does not keep voice messages.

`voice/voiceDrafts.ts` (jotai, no React): `parkVoiceDraft`, `settleVoiceDraft`,
`discardVoiceDraft`, `undoVoiceDiscard(store, recordingId)`, `recoverVoiceDrafts(mx, store)`,
`keepRecoveringVoiceDrafts(mx, store)` (now, and on `focus` and `visibilitychange`) and
`offerQueuedVoiceDraft(store, userId)`, which moves the account's next queued draft into the
single slot while it is empty and no recorder is open. `useRoomInputVoice` calls the last two: a
composer is where the account's rooms are loaded and where a draft can show.

`voice/VoiceDiscardToast.tsx` (mounted in `shell/ClientShell.tsx`): "Recording discarded" with
Undo in the page's notice place, for the account's own last discard.

## Tasks

Each task: failing test first, then the code, then `nix develop -c npx vitest run <files>`, commit.

1. **Journal.** `voiceRecordingJournal.ts` and its test:
   - `appends chunks in seq order when arrayBuffer() resolves out of order`
   - `writes a chunk whose write failed again with the next one, in its place`
   - `adopts only records no tab holds, and two tabs adopt one record once`
   - `without Web Locks keeps nothing on disk and takes nothing over`
   - `offers a recording to a later call once its tab is gone, or once it can be read`
   - `says whether a later change reached the disk, and returns it with the orphan`
   - `deletes a record whose discardUntil has passed`
   - `the copy an older version kept` (copied once, IDs only, not twice, kept when it changed)
   - `forgets an account's recordings on sign-out`
2. **Capture.** `voiceCaptureSession.ts` and its test:
   - `journals each chunk with a seq assigned in dataavailable`
   - `keeps recording and warns once when a journal write fails`
   - `parks the audio of a recorder that stopped by itself`
   - `keeps all it recorded when retired or released, the audio that comes with the stop too`
   - `hands over a recording whose last write failed as not protected`
   - `resolves the recording on discard`
   - `asks the recorder for its data when the page is hidden`
3. **Delivery.** `roomInputDrafts.ts`, `voiceSendDraftController.ts`, `useRoomInputUploadTransport.ts`,
   `useRoomInputSendSessionController.ts` and tests:
   - `writes where it really goes, in IDs, and its txnId before anything is sent`
   - `sends nothing and keeps the recording when the journal could not take where it goes`
   - `keeps the record after a send that resolved without an event ID`
   - `a cancelled local echo gives its transaction ID back` (SDK patch)
   - `deletes the record only after the event is acknowledged`
   - `retries a failed send under the same txnId`
   - `a send that ends after the person moved on` (navigation, account switch)
   - `retries a crash mid-send with the same txnId`
   - `sends a recovered recording where Send is pressed`
4. **Drafts, recovery, Undo.** `voiceDrafts.ts`, `VoiceDiscardToast.tsx` (+ `.css.ts`), delete
   `savedVoiceDraft.ts` and its test, `sessionCleanup.ts`, `encryptedRoomTextOffDisk.test.ts`:
   - `shows orphans one at a time, oldest first, and erases none while the slot is taken`
   - `parks a mid-send orphan at its destination with Retry`
   - `shows an orphan whose room is gone in every composer`
   - `brings a discard back only once the disk no longer says it is discarded`
   - `gives each discard its own ten seconds`
   - `offers Undo again for a discard that still has time`
5. **Wiring and UI.** `useVoiceRecorder.ts`, `VoiceRecorderDialog.tsx`, `VoiceRecordingCapsule.tsx`
   (+ `.css.ts`), `useRoomInputVoice.tsx`, `UnconfirmedRootsFeature.tsx`, locale additions:
   "Recovered recording · 4:32", "Not protected against a crash", "Recording discarded" with Undo.
6. **e2e.** Update `e2e/composer/voice-draft-reload.spec.ts` to the journal and add the kill
   case to it (one spec, shared helpers): record about 5 s, close the page without stopping, open
   a new page in the same context, "Recovered recording" shows, Send posts exactly one `m.audio`
   of about 5 s, and its bytes decode with `decodeAudioData` (Chromium and WebKit). In both cases
   one send reaches the server while its answer is lost, once followed by a Retry in the same
   page and once by a reload and a Retry: the room still has one `m.audio`.
7. **Verify.** `just typecheck`, `just strict`, `just lint`, `npx vite build`, the full vitest suite
   and the e2e spec on the mac-runner, screenshots under `.pr-screenshots/` (not committed).

## Decisions where the spec left room, or proved wrong

- **Transaction ID.** matrix-js-sdk kept the transaction ID of a cancelled local echo and refused
  a second echo under it. The SDK patch releases it on cancel, so every attempt sends under the
  recording's one ID. Before sending, `eventIdOfTransaction` looks for an event the server already
  holds under it (the send got through and only its answer was lost) and takes that as sent.
- **No Web Locks, no journal.** The spec's fallback (adopt after 10 quiet minutes) let two tabs own
  one recording. Without Web Locks nothing is written or adopted, and recordings say they are not
  protected.
- **A send whose intent cannot be journaled sends nothing** and marks the draft `unprotected`. The
  next Retry then goes from memory, so a broken disk never blocks sending for good.
- **Undo is kept in memory too.** A discard that the disk could not be told to undo comes back from
  memory, marked `unprotected`; the disk copy is then deleted at its deadline.
- **A draft whose room is gone or not joined** loses its destination and shows in every composer,
  instead of being dropped.
- **The confirmation dialog of a parked draft's Discard stays;** the Undo toast follows it.
- **The persisted error text is gone.** After a reload a draft with a destination says "Sending
  this voice message was interrupted."
- **Legacy copy.** Its ID is `imported:<userId>:<bytes>:<duration>`. If the journal copy was sent
  and the old entry's delete had failed, the entry is copied again; this was accepted.
- **Sign-out** still deletes the account's records. A decision on that is pending.
