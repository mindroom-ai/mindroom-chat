# CINNY-128 — Final implementation plan

## Status and user outcome

This is the consolidated implementation plan only.

The user report is the ground truth:

> "in the Mindroom chat app, when I create an attachment right in the room, so creating a new one, and then I also start doing a voice message, and then when I click on send for the voice message, I want both the attachment and the audio to send at the same time in the same thread. But that doesn't happen."

The required result is that a voice Send from a threading-enabled room composer enrolls the eligible files currently staged in that room and the voice file in one ordered send session.

At room level, the first eligible staged attachment becomes the confirmed thread root, remaining attachments join that root in board order, and voice is the final thread child among files sent without a manual retry.

Inside an existing thread, all eligible staged attachments and voice target the existing root, with voice last among files sent without a manual retry and no nested root.

“At the same time” means one gesture starts one ordered same-thread session, because Matrix does not provide an atomic multi-event transaction.

This ticket guarantees Matrix thread topology and ordering, not that slow or retried uploads always enter one backend coalescing window.

## Verified current behavior and root cause

The upload board is keyed only by room ID through `roomIdToUploadItemsAtomFamily(roomId)` at `src/app/state/room/roomInputDrafts.ts:33`, and `MindroomRoomInput` mirrors its current contents in `selectedFilesRef` at `src/app/mindroom/room-input/MindroomRoomInput.tsx:268-271`.

Staged upload cards start their media upload automatically when eligible at `src/app/components/upload-card/UploadCardRenderer.tsx:121-139`, but no Matrix message event is sent until the composer session submits the file.

Ordinary composer and upload-board sends enter `startSendSession` at `src/app/mindroom/room-input/MindroomRoomInput.tsx:1025-1027` and `src/app/mindroom/room-input/MindroomRoomInput.tsx:1055-1059`.

The controller chooses `auto-thread-upload-root` for more than one room-level attachment at `src/app/mindroom/threads/roomInputSendSession.ts:81-102`, sends the first active upload as the root at `src/app/mindroom/threads/roomInputSendSession.ts:159-171`, captures its confirmed event ID at `src/app/mindroom/threads/useRoomInputSendSessionController.ts:235-249`, and relates later files to that root at `src/app/mindroom/threads/roomInputSendSession.ts:238-270`.

By contrast, `handleVoiceSend` creates one voice item, appends it, uploads it imperatively, sends it directly, and removes only that item at `src/app/mindroom/room-input/MindroomRoomInput.tsx:833-925`.

Its relation is derived from a synthetic one-file session at `src/app/mindroom/room-input/RoomInputMindroomExtensions.tsx:111-127`, so an ordinary room-level voice send without explicit thread reply context uses mode `room` and sends a plain top-level event.

The pre-existing staged attachments are never selected for Matrix event delivery and remain on the room-scoped board.

The voice-send claim also blocks both composer submission and controller startup at `src/app/mindroom/room-input/MindroomRoomInput.tsx:817-831`, `src/app/mindroom/room-input/MindroomRoomInput.tsx:947-954`, and `src/app/mindroom/threads/useRoomInputSendSessionController.ts:356-359`.

The root cause is therefore a missing handoff: the direct single-file voice pipeline never gives the live staged files plus voice to the existing controller that owns ordered root election and thread relations.

## Minimum-scope design

Use the existing send-session controller for the combined case and retain the current direct voice path for every fallback case.

Do not add a gesture-time attachment snapshot, a new queue, a thread-scoped board, or new persistent session state.

Read the live room board immediately before handoff so files canceled during recorder stop or voice preparation are omitted and files staged before handoff are included.

The expected production change is two existing files and approximately 45–60 changed lines: about three lines for the controller query and the remainder for the voice branch, size eligibility, and cleanup ownership.

### File 1: expose active-session state

Update `src/app/mindroom/threads/useRoomInputSendSessionController.ts` to return a synchronous `hasActiveSendSession(): boolean` query backed by `sendSessionRef.current`.

Add the method to the hook return type near `src/app/mindroom/threads/useRoomInputSendSessionController.ts:135-138` and to the returned object near `src/app/mindroom/threads/useRoomInputSendSessionController.ts:450-453`.

The query must report both an in-flight session and a parked failed session as active.

This guard is required because an existing healthy session ignores a new start, while an existing failed session resumes its old files and ignores new options at `src/app/mindroom/threads/useRoomInputSendSessionController.ts:360-370`.

No controller processing or mode-selection behavior changes.

### File 2: branch the combined voice case

Update `src/app/mindroom/room-input/MindroomRoomInput.tsx` around the controller destructure at `:767-787` and `handleVoiceSend` at `:833-945`.

Read the homeserver media limit through the existing `useMediaConfig` hook in `src/app/hooks/useMediaConfig.ts:12-16`, using `Infinity` when `m.upload.size` is absent.

Keep live-room refresh, voice claim validation, and `createVoiceUploadItems` in their current order at `src/app/mindroom/room-input/MindroomRoomInput.tsx:867-904`.

Append the prepared voice item to its source room board once through `appendUploadItemsToRoomBoard` at `src/app/mindroom/room-input/MindroomRoomInput.tsx:402-423`, as the current direct path already does at `:905`.

Immediately after that append and before any further `await`, derive the final companion list from the live `selectedFilesRef.current`.

Exclude the new voice item itself, preparation-error items, marker-backed `metadata.mindroomPasteAttachment` items, and staged files at or above the homeserver upload-size limit.

The combined path is eligible only when all of the following are true:

- The source `RoomInput` remains mounted and `liveContext.roomId === roomIdRef.current`.
- `liveContext.threadingEnabled === true`, so classic mode is unchanged.
- `hasActiveSendSession()` is false at handoff time.
- The prepared voice file is below the homeserver upload-size limit.
- At least one eligible live companion remains after filtering.

If any condition fails, continue through the current imperative `uploadVoiceItem`, `sendVoiceItem`, direct reply-clear, notification, parked-draft error, and identity-specific cleanup path without submitting staged companions.

For an eligible combined send, construct `files: [...eligibleCompanionFiles, voiceFile]` so board order is stable and voice is last.

Release `voiceAutoSendPendingAtom` immediately before calling `startSendSession`, because the controller otherwise returns at `src/app/mindroom/threads/useRoomInputSendSessionController.ts:356-359`.

Call `startSendSession({ files, context: liveContext })` in the same synchronous continuation after releasing the claim.

This is race-safe without another lock because `startSendSession` checks its guards and assigns `sendSessionRef.current` before its first `await` at `src/app/mindroom/threads/useRoomInputSendSessionController.ts:356-430`.

Set a one-way `handedOffToSession` flag only after `startSendSession` resolves, including when it resolves after installing a waiting or failed session.

When handed off, skip `uploadVoiceItem`, `sendVoiceItem`, `clearReplyDraftForVoiceContext`, the direct `onRoomMessageSent` notification, and the direct `finally` removal of the voice item.

The generic controller owns upload progression, Matrix send errors, removal after successful sends, root notification, and reply clearing at `src/app/mindroom/threads/useRoomInputSendSessionController.ts:218-252`.

If `startSendSession` throws unexpectedly, leave `handedOffToSession` false, normalize and rethrow the error, remove the appended voice item in the existing `finally`, release the voice claim, and let `useVoiceRecorder` retain the recording in its parked Retry/Discard draft at `src/app/mindroom/voice/useVoiceRecorder.ts:514-541`.

Normal upload and Matrix-send failures do not throw out of the controller because `processSendSession` converts them into waiting, blocked-root, or failed-file state at `src/app/mindroom/threads/useRoomInputSendSessionController.ts:280-343`.

No change is needed in `RoomInputMindroomExtensions.tsx`, `roomInputSendSession.ts`, the recorder hook, the upload board, or the MindRoom backend.

## Resulting behavior and edge cases

### Room-level send with one or more staged attachments

The first eligible companion sends without an `m.thread` relation and its confirmed event ID becomes `rootEventId`.

Remaining eligible companions and voice send under that root, with voice last unless an earlier non-root upload requires a manual retry.

Compact mode navigates using the confirmed attachment root through the controller’s existing notification path at `src/app/mindroom/threads/useRoomInputSendSessionController.ts:235-252` and `src/app/mindroom/threads/useRoomViewThreadState.ts:321-329`.

`RoomInput` remains mounted during confirmed-root compact navigation at `src/app/mindroom/threads/MindroomRoomView.tsx:191-201`, so the component-local session continues.

### Voice Send inside an existing thread

Captured `context.threadId` selects mode `existing-thread` at `src/app/mindroom/threads/roomInputSendSession.ts:68-96`.

Every eligible companion and voice receives an `m.thread` relation to the existing root at `src/app/mindroom/threads/roomInputSendSession.ts:238-249`.

No new top-level root or room-level navigation notification is created.

### Multiple staged attachments

Eligible companion order comes from the final live board order.

The first surviving companion is the room-level root, later companions are children in order, and voice is the final child among files sent without a manual retry.

Marker-backed paste attachments, preparation-error items, and oversized items remain staged and are not silently detached from their composer state.

### Attachment upload still in flight

The session waits when its next required upload is not `UploadStatus.Success` at `src/app/mindroom/threads/roomInputSendSession.ts:147-203` and resumes through the existing upload-state effect at `src/app/mindroom/room-input/MindroomRoomInput.tsx:1061-1063`.

If the root upload is still loading, no Matrix event is sent until it succeeds.

If a later companion or the newly appended voice upload is still loading after the root succeeds, the root can be sent while that later file remains pending, but every eventual event still uses the captured root.

The recorder capsule can close after the session enters `wait`, before every Matrix event has been emitted, because the controller has accepted ownership of the voice item.

A non-root upload in `UploadStatus.Error` is deliberately skipped at `src/app/mindroom/threads/roomInputSendSession.ts:174-184`, so voice may send before that file and a later retry may enter a second agent turn while remaining in the same Matrix thread.

A root upload error waits for the upload card’s Retry action, while a root Matrix-send failure sets `blockedRoot` and resumes through the board Send action at `src/app/mindroom/threads/useRoomInputSendSessionController.ts:330-339` and `:360-370`.

### Cancel and discard

Discarding the recording before Send never calls `handleVoiceSend`, so staged attachments remain unchanged under `src/app/mindroom/voice/useVoiceRecorder.ts:441-483`.

Files removed before the final live-board read are not enrolled, and files added before that read are intentionally included in the current gesture.

There is no await between the final live read and session creation, so a user action cannot change that list during handoff.

After handoff, canceling an enrolled card removes it from both the board and `sendSessionFilesRef` at `src/app/mindroom/room-input/MindroomRoomInput.tsx:574-607`, allowing the next surviving file to become root if no root has been sent yet.

Canceling the voice upload after handoff intentionally removes voice from the accepted session, while already-sent attachment events remain in their thread.

If every eligible companion disappears before handoff, the send uses the standalone voice path and preserves its parked-draft failure behavior.

### Oversized voice or staged file

A voice file at or above `m.upload.size` never enters the board-driven combined path because `UploadCardRenderer` would otherwise leave it `Idle` at `src/app/components/upload-card/UploadCardRenderer.tsx:121-139`.

It uses the current standalone upload path, whose server failure rejects into the parked voice draft instead of closing the recorder around a permanently waiting session.

Oversized staged files are excluded from the combined file list and remain visible on the board with the existing too-large error.

If no other eligible companion remains, voice sends standalone.

### Existing send session

If a healthy, waiting, or parked-failed generic session still exists at handoff, voice uses the standalone path and the existing session retains its original destination and files.

The query is evaluated at handoff rather than voice-click time, so a session that completed while voice preparation ran does not force an unnecessary fallback.

### Reply draft

For a room-level plain reply draft, the attachment root carries the existing reply relation and later files join its new thread through `src/app/mindroom/threads/roomInputSendSession.ts:258-270`.

For an explicit thread reply, all files target the existing thread.

The combined path must not call `clearReplyDraftForVoiceContext`; the session clears the matching draft once after its first successful upload event and before notification at `src/app/mindroom/threads/useRoomInputSendSessionController.ts:243-252`.

### Voice-only, classic, paste-marker, and cross-room cases

Voice-only sends remain on the current direct path, including encrypted-room refresh, Signal bridge MIME handling, cross-room completion, and parked Retry/Discard behavior.

Classic mode keeps current behavior: voice sends standalone and staged attachments remain on the board.

Marker-backed paste attachments remain paired with their Slate marker, and typed composer text remains drafted because voice Send does not submit text.

A post-unmount or wrong-room callback uses the captured standalone path rather than handing files to a controller owned by another mounted room.

A combined session is not persistent across a later cross-room `RoomInput` unmount; unsent board items remain recoverable, but the chosen `rootEventId` is not rehydrated when the room is reopened.

## Focused test strategy

### Unit and component coverage

Add focused orchestration coverage in `src/app/mindroom/room-input/__tests__/RoomInput.test.ts` without duplicating the controller’s existing relation tests.

1. Room level with one ready companion plus voice sends the companion as the only plain root, sends voice last with `m.thread.event_id` equal to the confirmed root, empties the two enrolled board items, and releases the voice claim.
2. Two ready companions preserve board order, create one root, and send the second companion and voice as ordered children.
3. A recording started inside an existing thread sends every companion and voice to the captured existing root and emits no new room-root notification.
4. A loading root sends no Matrix event until its upload becomes successful, then completes with the same topology.
5. Delay voice item preparation, remove one staged file and add another, then verify the final live-board read omits the removed file and includes the current eligible file without resurrecting stale state.
6. Assert the fallback path for voice-only, classic mode, an active generic session, only preparation-error or paste-marker companions, only oversized companions, and an oversized voice file.
7. Make `startSendSession` throw and verify the appended voice card is removed, the global voice claim releases, existing staged files remain, and the recorder parks the voice draft for Retry/Discard.
8. Verify the reply relation lands on the attachment root and the matching reply draft is cleared exactly once by the session.
9. Verify a handed-off voice upload error remains on the board, its upload Retry eventually sends voice under the captured root, and no parked recorder draft is created after ownership transfer.
10. Cancel the would-be root after handoff but before its event and verify the next surviving eligible file becomes root without stranding voice.

Add focused controller coverage in `src/app/mindroom/threads/useRoomInputSendSessionController.test.ts` for `hasActiveSendSession`: false initially, true while waiting, true while failed, and false after completion.

Retain all existing voice-only, encrypted-room, Signal bridge, retry, cross-room, and session-order tests as regression coverage.

### Real Matrix/browser verification

Use the existing live Matrix/Playwright harness if it can drive the real voice callback without bypassing `handleVoiceSend`.

Verify one room-level staged attachment plus voice produces exactly one top-level attachment root and one voice child related to that confirmed root, with compact navigation opening the attachment root.

Verify the same gesture inside an existing thread adds both events to that existing root without creating a new room-level event.

Verify one delayed attachment upload does not let voice become a competing top-level root.

Do not make backend single-turn dispatch or physical microphone behavior a release gate for this frontend topology fix.

### Validation gates

- Run the focused RoomInput, send-session controller, voice recorder, and room-view suites.
- Run `npm run typecheck`.
- Run touched-file lint and the full lint command when feasible.
- Run the production/PWA build through the repository’s normal build command.
- Run the focused live Matrix/Playwright scenario when the harness supports the recorder path.
- Run the full `npm test` suite before finalizing.
- Run touched-file Prettier and `git diff --check`.
- Update the CINNY-128 Runbook entry with exact implementation and validation evidence.
- Obtain independent review after each logical implementation step and resolve all confirmed findings.
- Open the pull request ready for review, wait for all available AI reviewers, and address every confirmed finding.

## Implementation sequence

1. Add `hasActiveSendSession`, its lifecycle test, and no other controller behavior.
2. Add the live-board combined voice branch, conditional cleanup ownership, and focused orchestration tests.
3. Run focused validation, typecheck, build, lint, and independent review, then commit the logical implementation step.
4. Run the live Matrix checks and full validation, update the Runbook, and commit the validation evidence.
5. Open a ready pull request and complete reviewer remediation.

## Explicitly out of scope

- No gesture-time attachment snapshot or attempt-scoped ref.
- No atomic Matrix transaction or rollback of already-sent events.
- No guarantee that slow or retried uploads form one backend agent turn.
- No backend `matrix_message`, coalescing, agent-routing, or thread-resolution changes.
- No automatic submission of typed composer text.
- No submission or deletion of marker-backed paste attachments without their Slate marker lifecycle.
- No implicit threading or multi-file auto-submit in classic mode.
- No redesign of the voice Retry/Discard overlay for combined-session failures after handoff.
- No persistent or background send-session owner across cross-room unmounts, reloads, logout, room leave, or application restart.
- No upload-board, composer, recorder, codec, compression, waveform, microphone permission, or playback redesign.
- No thread-summary, compact-card, deep-link, cache, or timeline reconciliation changes beyond verifying the existing confirmed-root path.
