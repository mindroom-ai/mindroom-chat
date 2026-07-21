# CINNY-128 Implementation Report

## What changed

`src/app/mindroom/threads/useRoomInputSendSessionController.ts:135-138,451-457` exposes a read-only `hasActiveSendSession` query over the controller-owned session ref without changing session processing or mode selection.

`src/app/mindroom/room-input/MindroomRoomInput.tsx:113,228-229` reads the homeserver upload-size limit through the existing media configuration and preserves the upload card's exclusive size boundary.

`src/app/mindroom/room-input/MindroomRoomInput.tsx:910-941` rereads the live board after voice preparation, filters out the new voice item plus preparation-error, paste-marker, and oversized companions, and hands eligible files to the existing session controller in board order with voice last.

`src/app/mindroom/room-input/MindroomRoomInput.tsx:921-927` limits combining to the still-mounted source room, captured threaded mode, an inactive generic session, an eligible voice size, and at least one eligible companion.

`src/app/mindroom/room-input/MindroomRoomInput.tsx:929-940,955-963` releases the voice guard immediately before synchronous session creation and transfers cleanup ownership only after the controller accepts the batch, while unexpected handoff errors keep the existing voice cleanup and parked-draft path.

`src/app/mindroom/threads/useRoomInputSendSessionController.test.ts:213-247` verifies that the controller query is false initially, true while waiting, true after a retryable root failure, and false after completion.

`src/app/mindroom/room-input/__tests__/RoomInput.test.ts:1601-2131` covers room-level and existing-thread topology, board-driven voice upload, multiple companions, loading roots, live cancel/add rereads, fallback eligibility, handoff failure, reply clearing, upload retry, and root cancellation.

## User-visible behavior

At room level, Voice Send now enrolls eligible staged attachments and the voice message into one existing send session, making the first surviving attachment the only plain root and sending later attachments plus voice under that confirmed root.

Inside an existing thread, the eligible attachments and voice all target the thread captured when recording began, and no new room-level root notification is emitted.

Voice-only sends and the planned fallback cases retain the standalone voice pipeline, including parked Retry/Discard behavior for failures before ownership transfer.

Typed composer text, paste-marker attachments, preparation-error items, and oversized staged files remain staged rather than being silently submitted or deleted.

## Validation

The focused controller, RoomInput, voice recorder, and room-view run passes eight files with 164 tests.

The final RoomInput suite passes 55 tests, including a faithful Idle-to-Loading-to-Success upload-card boundary that proves the appended voice card starts upload and wakes the waiting session.

`npm run typecheck`, touched-file ESLint, Prettier, `git diff --check`, and `npm run build` all pass, including the production/PWA build and Element Call verification.

Full ESLint passes with zero errors and the repository's existing 17 warnings.

The final full `npm test` rerun exercised 447 files and 3,336 tests, with 446 files and 3,333 tests passing; every application test and all CINNY-128 coverage pass.

The only failures are the three unrelated `xcodeCloudPostClone.test.ts` cases, which remain unexecutable in this Nix workspace because the fixture forces `PATH=/usr/bin:/bin`, so `spawnSync('bash')` returns `ENOENT` before the sourced repository function runs; Bash is installed at `/run/current-system/sw/bin/bash`.

Independent review found no production defect, identified one invalid no-upload assertion and stale Runbook wording, and confirmed both fixes with no residual issue.

## Reviewer scrutiny

Matrix still sends multiple events rather than one atomic transaction, and a non-root upload that requires manual retry can be delivered after voice even though it remains in the same Matrix thread.

Failures after session ownership transfer intentionally use upload-board retry state rather than the recorder's parked Retry/Discard overlay.

The combined session remains component-local and is not made persistent across later cross-room unmounts, reloads, logout, room leave, or application restart.

The implementation intentionally does not submit typed composer text or marker-backed paste attachments as part of Voice Send.
