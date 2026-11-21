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
  `threadingEnabled`, `threadView?`, and `encrypted?` (the event type the send went out as). IDs
  only.
- `VoiceJournalRecord`: `userId`, `recordingId`, `startedAt`, `mimeType`, and later
  `destination?`, `txnId?`.
- `transitionVoiceRecording(recordingId, change?)`: the one way a recording this tab owns
  changes on disk (spec, rule A). `change` gets the record and returns what it becomes, or
  nothing to delete the recording; every call also writes the audio the disk does not hold yet,
  in the same transaction, with `durability: 'strict'`. It resolves
  `'committed' | 'absent' | 'failed'`.
- `voiceCaptureJournal(userId: () => string)`: what capture gets, `{ begin, append, abandon }`.
  `begin` takes the Web Lock and writes the record; `append` keeps the chunk's Blob until it is
  written. Both resolve `true` while the disk holds everything so far. Without the lock nothing
  is kept. `abandon` deletes a recording that ended without audio.
- `clearVoiceRecordings(userId)` is what sign-out calls.
- `adoptVoiceOrphans(userId, unsentCopy?)`: returns nothing without Web Locks. Otherwise it
  moves the account's old `mindroom-voice-drafts` row (copied as `legacy-<userId>-<SHA-256>` if
  that is not there, then deleted from the old database if it still is those bytes), then,
  oldest first, takes each of the account's records with
  `navigator.locks.request(name, { ifAvailable: true })`. A record that has no chunks is
  deleted; one it cannot read gives its lock back; the rest resolve as
  `{ record, file, duration }`. `unsentCopy(roomId, size)` is `unsentVoiceCopy` of
  `unsentMessages.ts`, injected: the transaction ID of the unsent row that is the same send,
  and what forgets that row.

`voice/voiceCaptureSession.ts`:

- `createVoiceCaptureSession({ journal?, keep? })`. `CapturedVoiceRecording` has `recordingId`;
  the snapshot has `unprotected`, which follows the journal's last write. A recording is handed
  over at once: what is done with it next (send, park, discard) writes what the disk still owes.
- `dataavailable` assigns `seq` synchronously and hands the chunk to `journal.append`.
- `pagehide` and `visibilitychange` to hidden call `recorder.requestData()`.
- Audio that was not sent goes to `keep(recording, discarded)` instead of being dropped: a discard
  (deleted through the journal), a recorder that stops by itself, `retire` and `releaseOwner`. A recorder that is
  let go of while it records, or after a Send or Discard it has not finished, is waited for, so
  its last audio is kept too.

`composer/roomInputDrafts.ts`: `PendingVoiceSendDraft` has `recordingId`, `txnId?` and
`unprotected?` (a label only); its `context` is a destination (with `encrypted?` once its intent
is written) or, for a recording that has none here, its account and what was `attempted`
(`UnplacedVoiceContext`, told apart by `hasVoiceDestination`): the destination IDs the journal
holds and the room's name. One with `attempted` may already be sent (rule B). `inFlight` is a
send or, with `discard`, the delete of a confirmed Discard. `queuedVoiceDraftsAtom` sits beside
the slot.

`voice/voiceSendDraftController.ts`: `createVoiceSendDraftController(drafts, transition)`.
`SendRecordingCallback` gets `{ txnId, commit }` and resolves with the voice event's ID. The
composer calls `commit(resolved destination)` before it uploads anything; `commit` rejects when
that write `failed`, on every attempt, and lets a recording that is `absent` from the disk go
from memory. The record is deleted only when the callback resolved with an ID, and the attempt
counts as sent only once that delete is written. `drafts.settle(recordingId, token, failed)` ends
an attempt wherever its draft is. `retry` sends a draft that has a destination there under its
ID, and one without where Send was pressed under a new ID. `commit` may be called again when the
destination changes before the event goes (a bundled send's thread); the kept draft is the last
one written. The session controller's `onUploadPlaced(file, relation)` is that hook: it runs
before the file's `sendMessage`, and a rejection keeps the file unsent.

`matrix/protocol/pendingLocalEcho.ts`: `eventIdOfTransaction(room, txnId)`, the event the server
holds for a transaction ID. `patches/matrix-js-sdk`: a cancelled local echo gives its transaction
ID back. `matrix/client/unsentMessages.ts` adds no voice messages, forgets the ones an older
version kept once they are sent or deleted, and exports `unsentVoiceCopy`.

`voice/voiceDrafts.ts` (jotai, no React): `parkVoiceDraft`, `keepVoiceDraft`, `settleVoiceDraft`,
`discardVoiceDraft` (takes the slot's draft, deletes, settles), `recoverVoiceDrafts(mx, store)`,
`keepRecoveringVoiceDrafts(mx, store)` (now, on `focus` and `visibilitychange`, and a reconcile
on every `ClientEvent.Sync`; `shell/ClientNonUIFeatures.tsx` starts it once) and
`reconcileVoiceDrafts(mx, store)`: one store operation that moves another account's draft out
of the slot, puts this account's where its destination stands now (its room, or every composer
as "may already be sent"), and brings the next queued draft into a free slot while no recorder
is open. `useRoomInputVoice` calls it too.

`voice/VoiceRecorderDialog.tsx`: the Discard confirmation, which also shows a Discard that
failed, with Retry.

## Tasks

Each task: failing test first, then the code, then `nix develop -c npx vitest run <files>`, commit.

1. **Journal.** `voiceRecordingJournal.ts` and its test:
   - `appends chunks in seq order when arrayBuffer() resolves out of order`
   - `writes a chunk whose write failed again with the next one, in its place`
   - `adopts only records no tab holds, and two tabs adopt one record once`
   - `without Web Locks keeps nothing on disk and takes nothing over`
   - `offers a recording to a later call once its tab is gone, or once it can be read`
   - `says whether a later change reached the disk, and returns it with the orphan`
   - `asks for every write to be on the disk before it counts`
   - `opens the database again after the browser closed it`
   - `the copy an older version kept` (moved once, IDs only, per account, a row an old tab wrote
     meanwhile, two pages at once, the unsent row of the same send)
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
   - `keeps as what the event went out, and where it went last, for the retry`
   - `asks the disk for all of a recording whose send stopped before its destination was known`
   - `has the thread its bundle opened kept for the recording before its event goes there`
4. **Drafts and recovery.** `voiceDrafts.ts`, delete `savedVoiceDraft.ts` and its test,
   `sessionCleanup.ts`, `encryptedRoomTextOffDisk.test.ts`:
   - `shows orphans one at a time, oldest first, and erases none while the slot is taken`
   - `waits at its destination with Retry, under its txnId`
   - `keeps its destination while its room is not loaded yet`
   - `offers a copy only once the server was heard and its room is still not there`
   - `is not retried under its txnId in a room that was encrypted since`
   - `moves another account's recording out of the slot once, however many composers ask`
   - `deletes a confirmed discard at once, and takes the slot's recording until that is done`
   - `keeps a recording the disk would not delete, and says so`
5. **Wiring and UI.** `useVoiceRecorder.ts`, `VoiceRecorderDialog.tsx`, `VoiceRecordingCapsule.tsx`
   (+ `.css.ts`), `useRoomInputVoice.tsx`, `UnconfirmedRootsFeature.tsx`, locale additions:
   "Recovered recording · 4:32", "Not protected against a crash", the Discard confirmation,
   "May already be sent to …" with "Send a copy here".
6. **e2e.** Update `e2e/composer/voice-draft-reload.spec.ts` to the journal and add the kill
   case to it (one spec, shared helpers): record about 5 s, close the page without stopping, open
   a new page in the same context, "Recovered recording" shows, Send posts exactly one `m.audio`
   of about 5 s, and its bytes decode with `decodeAudioData` (Chromium and WebKit). In both cases
   one send reaches the server while its answer is lost, once followed by a Retry in the same
   page and once by a reload and a Retry: the room still has one `m.audio`. A third case:
   Discard asks, a cancelled one leaves the recording on disk across a reload, a confirmed one
   deletes it for good.
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
- **A send whose intent cannot be journaled sends nothing, on every attempt** (round 2: the
  first version let the second Retry go from memory, which could post twice after a crash). Only
  a recording the disk never held goes from memory. A disk that takes no write at all for a
  recording it holds blocks its send until it does; Discard has the same limit.
- **No Undo** (round 3). Round 2 replaced the Discard confirmation with an Undo: a deadline on
  disk, a toast, timers and expiry on load. Every new finding of round 3 about discarding was in
  that machinery (two Discards, a window used up by a slow write, a failed Undo deleted by a
  reload, a lock stranded by a failed expiry, Retry after a failed discard that sent). It is
  gone. A Discard asks first, of a running recording too, and deletes at once.
- **A Discard is single-flight.** The slot's draft is marked `inFlight` with `discard` before
  the delete is awaited. Send, Retry, a second Discard and the reconcile leave such a draft
  alone. A failed delete gives the draft back with "Couldn't delete the recording." and a Retry
  that repeats the Discard.
- **A draft whose send was attempted where this account cannot send it now** keeps the IDs of
  that destination (`attempted`) and shows in every composer as "May already be sent to …", to
  discard or to send a copy of under a new transaction ID. The composer's own Send does not send
  that copy. That is decided only once the server was heard (`isInitialSyncComplete`): before,
  a room that cannot be found may only not be loaded, and the recording waits. A room that is
  joined again takes the recording back. A room whose encryption changed since the intent
  counts as not sendable too, and the send itself refuses such a retry
  (`refreshRoomInputVoiceSendContext`).
- **An intent without `encrypted`** (an old draft that was moved, or a send that stopped before
  its destination was written) was never sent under an ID this version knows: if its room is not
  sendable it is only a recording, to send anywhere.
- **A recording that was sent but could not be deleted** stays as a failed draft with its
  transaction ID; Retry finds the event the server holds and deletes it.
- **The persisted error text is gone.** After a reload a draft with a destination says "Sending
  this voice message was interrupted."
- **Legacy move** (round 3). Round 2 kept the old row until its copy was deleted, under a Web
  Lock per account. That had three holes: the ID ignored the account, the check before the
  delete was not one transaction with it, and the quoted text stayed in the old database. Now
  the copy is insert-if-absent under `legacy-<userId>-<SHA-256>`, and the old row is deleted
  right after, in one transaction that reads it again and compares the bytes (`indexedDB.cmp`,
  which is synchronous). No lock and no later cleanup.
- **Old unsent voice rows** are restored, since one may be the only copy of its send, and are
  forgotten once sent or deleted. Matching a row to the old draft is by room and file size.
- **Recovery is mounted in `ClientNonUIFeatures`**, with the reconcile on every sync.
- **Sign-out** still deletes the account's records. A decision on that is pending.
