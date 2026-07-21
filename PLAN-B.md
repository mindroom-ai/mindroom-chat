# PLAN-B — CINNY-128: Voice send must flush staged attachments into the same thread

Status: plan only. No source changes in this step.

## User report (ground truth)

> "in the Mindroom chat app, when I create an attachment right in the room, so creating a new one, and then I also start doing a voice message, and then when I click on send for the voice message, I want both the attachment and the audio to send at the same time in the same thread. But that doesn't happen."

(Bas, voice message, 2026-07-20. Whisper transcript.)

Desired: from the room-level composer, a staged (unsent) attachment plus a voice recording sent via the voice capsule's Send must land together in one new thread — one root, both items grouped under it.

## 1. Actual current behavior (traced from code, not guessed)

### Staging path

- Picker/drop/paste files become `TUploadItem`s and are appended to the per-room board atom `roomIdToUploadItemsAtomFamily(roomId)` — `src/app/mindroom/room-input/MindroomRoomInput.tsx:402-437` (`appendUploadItemsToRoomBoard` / `appendUploadItems` / `handleFiles`).
- Each staged item starts uploading immediately when its card renders: `src/app/components/upload-card/UploadCardRenderer.tsx:137-139` (`status === Idle && !fileSizeExceeded && !fileItem.prepError → startUpload()`, where `fileSizeExceeded` compares against the homeserver's `m.upload.size` media config, `:121-133`). So by voice-send time a staged attachment is usually already `UploadStatus.Success` (has an `mxc`), or still `Loading`.
- The board is keyed by **roomId only**; the same staged items are visible above both the room-level and thread-level composer states (one `RoomInput` instance serves both — `src/app/mindroom/threads/MindroomRoomView.tsx:192-201`, `threadId={effectiveThreadId}`).

### Voice send path

- Capsule Send → `sendAndClose` (`src/app/mindroom/voice/VoiceRecorderDialog.tsx:110-119`) → `useVoiceRecorder.send()` → `finishStop` → `onSendRecording` = `handleVoiceSend` (`src/app/mindroom/room-input/MindroomRoomInput.tsx:833-945`), with the send context snapshotted at recording **start** (`src/app/mindroom/voice/useVoiceRecorder.ts:570-571`, via `getVoiceSendContext`, `MindroomRoomInput.tsx:795-806`).
- Recorder contract: `handleVoiceSend` **resolving** = success (pending draft cleared, capsule closes, blob discarded — `useVoiceRecorder.ts:514-523`); **throwing** = failure (draft parked in `pendingVoiceSendDraftAtom` with retry/discard UI — `useVoiceRecorder.ts:524-541`).
- `handleVoiceSend` is a fully separate, single-item pipeline: it creates exactly one voice `TUploadItem` (`createVoiceUploadItems`, `MindroomRoomInput.tsx:439-476`), appends it to the board (`:905`), uploads imperatively (`uploadVoiceItem`, `:909`), sends it (`sendVoiceItem`, `:914` / `:734-754`), then removes only the voice item from the board (`:919-925`). It never reads the other staged items in `selectedFilesRef` and never starts a send session.
- Its relation is computed from a synthetic **single-file** session: `getMindroomRoomInputVoiceUploadRelation` builds `createRoomInputSendSessionState({ files: [file], hasText: false, ... })` — `src/app/mindroom/room-input/RoomInputMindroomExtensions.tsx:111-128`. At room level with no reply draft, `getRoomInputSendMode({attachmentCount: 1, hasText: false})` returns `'room'` (`src/app/mindroom/threads/roomInputSendSession.ts:81-102`), so `getUploadRelationForSendSession` returns `undefined` (`roomInputSendSession.ts:250-257`) and the voice event goes out as a **plain room-level message**.
- Because the relation is undefined, `getRoomMessageSentNotificationEventId` returns the voice event id (`src/app/mindroom/threads/roomMessageSent.ts:8-17`), `onRoomMessageSent` fires (`MindroomRoomInput.tsx:928-930`), and in compact mode `handleRoomMessageSent` navigates into the new thread rooted at the voice event (`src/app/mindroom/threads/useRoomViewThreadState.ts:321-330`).
- From capsule Send until the voice send settles, `voiceAutoSendPendingAtom` is claimed (`claimVoiceAutoSend`, `MindroomRoomInput.tsx:817-823`), which blocks both text `submit()` (`:953`) and any `startSendSession` (`shouldBlockStartSendSession`, `:786`) — so nothing can flush the staged attachment during the voice send even in principle.

### Net current behavior for the reported scenario

The voice message sends **alone** and becomes its own new thread root; compact mode auto-navigates into that thread; the staged attachment **stays parked in the upload board, unsent** (now rendered above the thread composer, since the board is per-room). It is not dropped and not sent separately — it just silently remains staged. If the user later presses Send while still inside the voice thread, the attachment joins that thread (mode `'existing-thread'`); if they press Send after leaving to room level, it becomes a separate thread root. Either way, "both send at the same time in the same thread" never happens.

## 2. How grouping works today, and backend equivalence

### Frontend: text + attachments (CINNY-067 lineage)

- `submit()` with staged uploads calls `startSendSession({ textContent })` (`MindroomRoomInput.tsx:1025-1027`); the upload-board Send shares the same path (`handleUploadBoardSend`, `:1055-1059`).
- Mode selection (`roomInputSendSession.ts:81-102`): room level + (≥2 attachments, or text + ≥1 attachment) → `'auto-thread-upload-root'`; explicit thread context → `'existing-thread'`; `threadingEnabled === false` → `'room'`.
- In `'auto-thread-upload-root'`: the **first upload** is sent plain and its confirmed `event_id` becomes `rootEventId` (`src/app/mindroom/threads/useRoomInputSendSessionController.ts:245-247`); every subsequent upload and the trailing caption get an `m.thread` relation to that root (`roomInputSendSession.ts:238-271`, `:218-236`).
- Ordering is intentional: "Attachments go out first and the caption goes last: MindRoom coalesces a media batch into one agent turn and closes it on the trailing text event." (`roomInputSendSession.ts:192-194`).

### Backend: `matrix_message` and coalescing

- `/srv/mindroom/src/mindroom/custom_tools/matrix_message.py:228-229`: room-level text+attachments → text posts to the room timeline and attachments thread under it; multiple attachments without text → first attachment is the root, the rest thread under it. Same shape: one root, everything grouped.
- Coalescing (`/srv/mindroom/src/mindroom/coalescing_policy.py`, `pending_event_is_text`): "Text (typed messages, **voice transcripts**, edits) terminates an utterance burst … a batch ending in text is complete and a batch ending in media may still grow." Voice audio is normalized into a `PreparedTextEvent` (`/srv/mindroom/src/mindroom/inbound_turn_normalizer.py:161-193`).
- **Ordering consequence:** the voice message must be the LAST event of the batch. If the voice event were the thread root (sent first), the agent's coalescer would treat the arriving voice transcript as a burst terminator and dispatch immediately — the attachments would land in a second agent turn. Attachments-first / voice-last exactly mirrors the existing caption convention and closes the batch deterministically.

## 3. Root cause statement

The voice send path (`handleVoiceSend`, `src/app/mindroom/room-input/MindroomRoomInput.tsx:833-945`) is a parallel single-item pipeline that bypasses the send-session grouping machinery entirely: it derives its relation from a synthetic one-file session (`src/app/mindroom/room-input/RoomInputMindroomExtensions.tsx:111-128`), which at room level always resolves to mode `'room'` (no relation → standalone event), and it neither includes nor flushes the staged upload-board items — while its `voiceAutoSendPendingAtom` claim actively blocks the only path that can group (`MindroomRoomInput.tsx:786`, `:953`) for the duration of the send. Grouping (`'auto-thread-upload-root'`) exists only in the `submit()`/`startSendSession` path (`src/app/mindroom/threads/roomInputSendSession.ts:94-102`).

## 4. Fix: route the combined case through the existing send session

Keep the standalone voice pipeline for voice-only sends (preserving the CINNY-109/125 parked-draft retry machinery untouched). When eligible staged attachments exist, hand the voice file to the existing send-session controller as the last file of one batch.

### Files to change

1. `src/app/mindroom/threads/useRoomInputSendSessionController.ts` — expose `hasActiveSendSession: () => sendSessionRef.current !== undefined` from the hook's return value (~3 lines). It must report `true` for both in-flight and parked-failed sessions: `startSendSession` resumes a failed session and **ignores its `files` argument** in that branch (`useRoomInputSendSessionController.ts:360-371`), so handing off the voice file then would silently orphan it.
2. `src/app/mindroom/room-input/MindroomRoomInput.tsx` — branch inside `handleVoiceSend` (~30–40 lines, described below). Destructure `hasActiveSendSession` at `:767-787`.

No changes to `roomInputSendSession.ts` (mode selection already handles every case), the recorder stack, the upload board, or any backend code.

### Decision rule (inside `handleVoiceSend`, after `refreshMindroomRoomInputVoiceSendContext` and the claim guards, i.e. after `MindroomRoomInput.tsx:891`)

Take the **combined path** iff ALL of:

- `mountedRef.current && liveContext.roomId === roomIdRef.current` — the session controller operates on the mounted room's refs, and the same-tick `selectedFilesRef` sync plus `setUploadBoard(true)` that step 2 depends on are themselves gated on exactly these two conditions (`MindroomRoomInput.tsx:408-411`). A cross-room or post-unmount parked-draft retry corner falls back to standalone.
- `!hasActiveSendSession()` — an in-flight or parked-failed session cannot accept new files.
- Eligible staged items exist: `selectedFilesRef.current` filtered to items with no `prepError` and no `metadata.mindroomPasteAttachment` (see trade-off 2 below). (`startSendSession` re-filters `prepError` items anyway — `useRoomInputSendSessionController.ts:373-381`; the eligibility check just decides which path to take.)
- The voice file is under the homeserver upload limit (`file.size < m.upload.size`, same check as `UploadCardRenderer.tsx:121-133`). The board card's auto-start is gated on this, so an oversized voice file in the combined path would never upload and the session would wait forever after the capsule already closed as success. Standalone fallback preserves today's behavior (server error → parked draft). Voice files are small, so this is a cheap guard against a pathological hang, not an expected case.

Otherwise: standalone path, byte-for-byte today's behavior.

### Combined path steps

1. `createVoiceUploadItems(...)` as today (encrypts against the live room). A `create`-stage throw still propagates → recorder parks the draft; staged attachments untouched. Unchanged.
2. `appendUploadItemsToRoomBoard(liveContext.roomId, fileItems)` as today (`:905`). This already does the same-tick `selectedFilesRef` sync explicitly designed for this handoff (comment at `:406-408`) and forces the board open (`setUploadBoard(true)`, `:410`) so the voice card renders and auto-starts its upload (`UploadCardRenderer.tsx:137-138`). Do **not** call `uploadVoiceItem` — the board machinery owns the upload, same as every other staged file.
3. `releaseVoiceAutoSend()` — required because `shouldBlockStartSendSession` reads `voiceAutoSendPendingAtom` (`:786`). Safe: `startSendSession` is synchronous from its guard checks through `sendSessionRef.current = …` (first `await` comes after — `useRoomInputSendSessionController.ts:356-430`), so no other caller can interleave between release and session creation.
4. `await startSendSession({ files: [...eligibleStagedFiles, voiceFile], context: liveContext })` — voice file **last** (root = first staged attachment; voice closes the agent's coalescing batch). `PendingVoiceSendContext` is structurally a `RoomInputSendContext` plus `ownerSessionId`, so `liveContext` passes directly. Do not pass `textContent` (see trade-off 3). The promise resolves as soon as `processSendSession` reaches a `wait` step; the session then continues via the existing `useEffect` on uploads/selectedFiles (`MindroomRoomInput.tsx:1061-1063`).
5. Skip `sendVoiceItem` and skip the `finally`-block board removal for the handed-off items (guard the existing `removeUploadsFromBoard` call at `:920-925` with a `handedOffToSession` flag) — the session removes each item from the board as it sends (`useRoomInputSendSessionController.ts:249`). Still `releaseVoiceAutoSend()` in `finally` (idempotent, `:825-831`).
6. Resolve. The recorder treats resolve as success and closes the capsule; the blob is now owned by the session's `TUploadItem`, so discarding the recorder's copy is safe.
7. Defensive: if `startSendSession` itself throws unexpectedly, remove the voice items from the board and rethrow so the parked-draft path stays clean (no duplicate blob representations).

### Resulting wire behavior (room level, N staged + voice)

First staged attachment sent plain (thread root, confirmed `event_id` captured) → remaining staged attachments with `m.thread` → root → voice message last with `m.thread` → root. The root's confirmed id fires `onRoomMessageSent` → compact mode navigates into the new thread, exactly like text+attachment sends today. This is the grouping equivalent of the backend's `matrix_message` batches, with the frontend's established member ordering.

Ordering caveat: "voice last" holds on the happy path. The session's deliberate error-skip relaxation (`roomInputSendSession.ts:180-184`) lets a failed **non-root** staged upload be skipped, so the voice can send before it and the manual retry lands that attachment after the burst-terminating voice transcript (a second agent turn). This exactly mirrors how a failed attachment already trails the caption today (`:192-194`) — accepted, not changed.

## 5. Edge cases

| Case | Behavior after fix | Mechanism |
|---|---|---|
| Voice send from INSIDE an existing thread | Staged attachments AND voice all join that thread; no new root | `context.threadId` → mode `'existing-thread'` → every item related to the thread (`roomInputSendSession.ts:94-96`, `:242-249`) |
| Thread-reply draft (reply-in-thread from room level) | Same: everything joins the draft's thread | `hasExplicitThreadContext` via `replyDraft.relation` (`roomInputSendSession.ts:68-79`) |
| Room-level plain reply draft | Auto-thread root carries the reply relation; rest threaded under root | `getUploadRelationForSendSession` isRoot branch (`roomInputSendSession.ts:258-265`) — same as text sends today |
| Multiple staged attachments | All grouped: first = root, rest + voice threaded | `orderedFiles` (`roomInputSendSession.ts:124`) |
| Attachment still uploading at voice send | Session waits per file for `UploadStatus.Success`, including the root; sends in order once ready | `resolveRoomInputSendStep` (`roomInputSendSession.ts:147-204`) |
| Would-be root's upload already FAILED at voice send | Batch stalls (root branch waits, never error-skips — `roomInputSendSession.ts:159-171`) until the user taps the card's Retry, which resumes the batch; capsule has already closed as success | same shape as text+attachment sends today; add to browser checklist |
| Non-root staged upload fails mid-batch | Error-skip: voice sends anyway; retried attachment lands after the voice (second agent turn) | `roomInputSendSession.ts:180-184`; accepted, mirrors failed-attachment-after-caption today |
| Staged item failed to prepare (`prepError`) | Excluded from the batch, stays on the board with its error card; if it's the ONLY staged item, standalone voice path | eligibility filter + `startSendSession`'s own filter |
| Voice recording discarded / canceled | `handleVoiceSend` never runs; attachments stay staged | unchanged (`VoiceRecorderDialog.tsx:90-100`) |
| Voice-only send (no staged items) | Standalone path unchanged, including parked-draft retry overlay | decision rule |
| Send session already in flight or parked-failed | Standalone voice path (today's behavior); staged-but-not-in-session files stay staged | `hasActiveSendSession()` guard |
| Classic view (`threadingEnabled === false`) | Mode `'room'`: every item sends as a separate plain room message — consistent with classic-mode text+attachments today | `roomInputSendSession.ts:97` |
| Compact-mode auto-navigation into the new thread mid-batch | `RoomInput` is not keyed (`MindroomRoomView.tsx:192-201`), so the root-confirmation navigation only changes its `threadId` prop; the session ref survives — same mechanism text+attachment batches rely on today. The `pendingThreadRoot` composer swap only triggers for local-echo ids; upload roots notify with confirmed `response.event_id` (`useRoomInputSendSessionController.ts:235-241`) | verify in browser |
| Signal-bridged room | `liveContext.signalBridgedRoom` flows into the session; `buildUploadMessageContent` applies the `audio/aac` override | `useRoomInputSendSessionController.ts:227` |
| Encrypted room | Voice item encrypted against the live room (`createVoiceUploadItems`); staged items were encrypted at staging time | unchanged |
| Account switch / room no longer joined | `refreshMindroomRoomInputVoiceSendContext` returns null before the branch → error path unchanged | `RoomInputMindroomExtensions.tsx:98-109` |

## 6. Accepted semantic trade-offs (call out in PR)

1. **Voice failure UX in the combined case changes.** Failures surface as upload-board card errors with the board's Send/retry affordances (`blockedRoot`/`failedFiles`, resumed via `handleUploadBoardSend` → `startSendSession`), not the recorder's parked-draft overlay. The recorder resolves and closes as soon as the session is started. The parked-draft overlay remains fully intact for voice-only sends. Wiring `pendingVoiceSendDraftAtom` into multi-item sessions would be composer rearchitecture — explicitly out of scope.
2. **Paste-converted attachments are not flushed by voice send.** They are bound to the typed draft via editor marker chips (`mindroomPasteAttachment` metadata + `PasteMarker` elements); flushing them would leave dangling markers in the composer text or require mutating the user's draft. They continue to send with the text, as today.
3. **Composer text is not flushed by voice send** (unchanged from today — voice send has never sent typed text). If the user has typed text AND staged attachments and then sends voice, the attachments join the voice thread and the text remains drafted.

## 7. Test strategy

### Unit (Vitest, existing harnesses)

`src/app/mindroom/room-input/__tests__/RoomInput.test.ts` (react-test-renderer harness with mocked recorder/editor/mx, 41 existing tests) — drive `voiceRecorderState.onSendRecording` with staged items in `roomIdToUploadItemsAtomFamily`:

- Room level, 1 staged (upload Success) + voice: asserts exactly one plain send (root = staged file), voice sent with `m.thread` relation to root, voice sent **after** staged, board emptied, `voiceAutoSendPendingAtom` released, no `sendVoiceItem`-style standalone send.
- Room level, 2 staged + voice: root + 2 threaded, voice last.
- Staged upload still pending: nothing sends until the upload atom flips to Success, then correct order.
- `threadId` set (thread composer): all items sent with `m.thread` relation to the existing thread; no new root; no `onRoomMessageSent` notification.
- Voice-only: standalone path still used (existing tests must stay green — the strongest regression guard for CINNY-109/125).
- Only-`prepError` staged item / only paste-marker staged item: standalone path.
- Oversized voice file (≥ `m.upload.size`): standalone path.
- Active session in flight (start a text+upload session first): voice falls back to standalone.
- Combined-path send failure (mx.sendMessage rejects for the root): recorder resolved (no parked draft), session parked with `blockedRoot`, board retains items, board Send resumes.
- `onRoomMessageSent` fires once with the root's confirmed event id in compact scenario.

`src/app/mindroom/threads/useRoomInputSendSessionController.test.ts`:

- `hasActiveSendSession()` lifecycle: false → true on start → false on completion; stays true while parked-failed.
- `startSendSession({files, context})` preserves explicit file order (root = `files[0]`).

`roomInputSendSession.test.ts`: no production change; add (if missing) an assertion that `files: [a, b], hasText: false` at room level yields `'auto-thread-upload-root'`.

### Real-browser verification (required — jsdom cannot prove wire relations/ordering end-to-end)

Environment: local Tuwunel (registration token at `/run/agenix/registration-token`), vite preview — **verify the served bundle hash before testing** (known trap). Scenarios:

1. Room level: stage an image via picker, record voice, capsule Send → timeline/wire shows image event with no relation (root), voice event with `m.thread` → root; compact mode navigated into that thread; board empty.
2. Two staged files + voice → one root + two threaded members, voice last.
3. From inside an existing thread → both events threaded to the existing root; no navigation.
4. Stage a large file (still uploading) + voice send → batch waits, then correct grouping.
4b. Stage a file whose upload FAILS (cut network during upload), then voice send → batch stalls on the root; card Retry resumes and grouping completes.
5. Voice discard → attachment stays staged.
6. Voice-only send with network cut → parked-draft retry overlay still works (regression).
7. Agent room: confirm the agent handles the batch as ONE turn (attachments + voice transcript coalesced) — this validates the voice-last ordering decision.

## 8. Out of scope

- Flushing composer text with a voice send (and any change to voice-send-vs-typed-text semantics).
- Flushing paste-converted attachments with a voice send.
- Parked-draft (`pendingVoiceSendDraftAtom`) coverage for combined-batch failures.
- Unmount-resilient / cross-room send sessions (existing session limitation).
- Reordering the established text+attachment convention (attachments-first, caption-last stays).
- Any backend changes (`matrix_message`, coalescing).
- Composer rearchitecture of any kind; upload-board UI changes.

## 9. Delivery steps (per CLAUDE.md process)

1. Step 1: `hasActiveSendSession` exposure + `handleVoiceSend` branch + unit tests; `npm run typecheck` / `npm run build` / `npm run lint`; Runbook update; independent review; focused commit.
2. Step 2: real-browser validation against local Tuwunel (scenarios above); Runbook validation entry; commit.
