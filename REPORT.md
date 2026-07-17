# CINNY-121 Implementation Report

## Outcome

All five planned changes are implemented in ship order: the SDK patch, direct text submit reordering, composer pending-clock removal, optimistic navigation and exit preservation, and the local-id read-receipt guard.

The implementation reuses matrix-js-sdk transaction ids, synchronous local echoes, relation aggregation, pending statuses, and `RoomEvent.LocalEchoUpdated`.

No new application store, send queue, or abstraction was added.

`src/app/mindroom/threads/threadOpenSdkBootstrap.ts` and the CINNY-122 thread-creation path are unchanged.

## Changes by file

- `patches/matrix-js-sdk+41.7.0.patch` updates the SDK source, compiled runtime, and declarations so relation, reply, and redaction local ids resolve independently through transaction lookup, timeline lookup, or detached pending lookup and are rewritten immediately or on local-id replacement.
- `src/app/mindroom/room-input/MindroomRoomInput.tsx` performs the direct text-only send and verified local-echo lookup synchronously, attaches completion ownership before clearing, clears and navigates in the same turn, gates related encrypted drafts until their target is confirmed, and transfers only unowned failed roots back to the composer.
- `src/app/mindroom/room-input/RoomInputMindroomExtensions.tsx` removes the composer-owned pending clock and pending banner prop while preserving reply, voice, and child rendering.
- `src/app/mindroom/room-input/__tests__/RoomInput.test.ts` covers same-turn ordering, exceptional lookup paths, failures, sequential and duplicate sends, relation construction, encryption gating, composer rendering, and terminal ownership.
- `src/app/mindroom/room-input/RoomInputMindroomExtensions.test.ts` covers the remaining reply, voice, and children extension surfaces without a pending prop.
- `src/app/mindroom/threads/useRoomViewThreadState.ts` accepts a local root id in the compact room overview and replaces the local route with its confirmed id while translating the saved exit target.
- `src/app/mindroom/threads/__tests__/RoomView.test.ts` covers immediate local navigation, canonical replacement, recents exclusion, browser history, and explicit iOS exit behavior.
- `src/app/mindroom/notifications/readReceipts.ts` returns before any room lookup, relation fetch, or receipt send for a local thread id.
- `src/app/mindroom/notifications/readReceipts.test.ts` covers the local-id no-op and retains loaded and fetched confirmed-thread behavior.
- `src/app/mindroom/threads/matrixSdkLocalEchoAssociation.test.ts` exercises the installed patched SDK under chronological and detached ordering, acknowledgement races, dual targets, redaction, encryption, and compatibility behavior.
- `FORK_CHANGES.md` records the implementation, scope, validation, review findings, and current status in the fork Runbook.

## Automated test plan and results

### Direct composer behavior

- Verify the same-turn order of transaction allocation, `sendMessage`, synchronous transaction lookup, promise-handler attachment, editor reset, and local-id navigation before the request settles.
- Verify a standalone room-level text send clears the editor and history, clears reply state, stops typing, and emits exactly one local root id while the request remains unresolved.
- Verify later fulfillment neither clears nor navigates a second time.
- Verify a missing synchronous local echo retains the composer and guard until fulfillment, then clears and emits the confirmed id once.
- Verify a synchronous send throw and a missing-local-echo rejection retain the composer and emit no navigation callback.
- Verify an unowned standalone `NOT_SENT` root cancels before its structured editor fragment is restored.
- Verify newer text remains after the restored fragment.
- Verify an active failed root remains timeline-owned.
- Verify a failed root with a local reply remains timeline-owned even after the user exits that thread, so the child is never orphaned.
- Verify multiple standalone failures cancel and restore their own fragments once in SDK callback order without adding cross-send state.
- Verify failed thread and explicit replies remain event-owned and do not overwrite newer composer or reply state.
- Verify a rejection after the input changes room ownership does not cancel the event or mutate the stale editor.
- Verify two sends before either request settles receive distinct transaction ids, local echoes, completion handlers, and snapshots.
- Verify rapid duplicate Enter handling produces one send.
- Verify a thread reply clears immediately without invoking room-level navigation.
- Verify an explicit reply inside a thread retains the existing thread-root and reply-target relation construction.
- Verify related encrypted drafts do not send while either thread or reply target is local and can send after canonicalization.
- Verify text-plus-upload, voice, sticker, command, and paste paths remain on their existing ownership paths.
- Result: all 51 focused `RoomInput.test.ts` tests and all 6 `RoomInputMindroomExtensions.test.ts` tests pass.

### Navigation and history

- Verify both confirmed and local ids open a new compact-overview thread.
- Verify classic mode, an existing route thread, and an existing effective thread suppress new-root navigation.
- Verify unresolved local ids are excluded from recent-thread persistence.
- Verify local-to-confirmed canonicalization uses replacement rather than push.
- Verify canonicalization translates the stored exit target without nesting React Router's history wrapper.
- Verify browser Back returns to the original compact overview after a pre-ack open.
- Verify the explicit iOS exit path returns to the original overview before and after canonicalization.
- Result: the 35 focused `RoomView.test.ts` tests pass, and the 4 `threadNavigation.test.ts`, 4 `roomNavigateState.test.ts`, and 5 `useThreadRootEvent.test.ts` tests remain green.

### SDK patch

- Verify chronological pending ordering creates the reply local echo without calling the invalid `getPendingEvents()` path.
- Verify detached ordering retains pending-target replacement.
- Verify an acknowledgement that wins the listener race triggers immediate association replacement.
- Verify ordinary thread replies rewrite both `m.relates_to.event_id` and `m.in_reply_to.event_id`.
- Verify an explicit confirmed reply target remains unchanged while a different local thread root is rewritten.
- Verify distinct local relation and reply targets resolve independently in both confirmation orders.
- Verify redaction association replacement remains intact.
- Verify the existing one-argument `updateAssociatedId` behavior remains compatible.
- Verify lifted relation fields are rewritten after encryption and document the Rust encryption snapshot boundary that requires the composer release gate.
- Verify the patch cleanly reverses and reapplies through the repository's existing patch-package workflow.
- Result: all 10 installed-SDK association tests pass, and both repository patches reverse and reapply successfully.

### Read receipts and pending rendering

- Verify `markThreadAsRead` performs neither `fetchRelations` nor `sendReceipt` for a local id.
- Verify loaded and fetched confirmed-thread receipt cases remain green.
- Verify pending status still reaches timeline messages, compact cards, pending-indicator helpers, and message-state suffix rendering.
- Result: all 5 receipt tests pass, and the focused timeline, compact-card, pending-indicator, and suffix tests pass.

### Combined and repository gates

- The 12-file focused PLAN union passes 137 tests.
- `npm run typecheck` passes.
- `npm test` passes with 427 files and 3,266 tests.
- `npm run build` passes for the production application, PWA service worker, and Element Call background verification.
- `npm run lint` passes with zero errors and 17 pre-existing warnings.
- Touched TypeScript files pass Prettier.
- `git diff --check` passes.
- Patch-package reverse and clean reapplication pass for `@tanstack/virtual-core@3.17.3` and `matrix-js-sdk@41.7.0`.
- Independent final re-review reports no remaining findings.

## Live throttled-browser acceptance script

1. Open a compact Simple Mode room overview in a mobile-sized viewport and enable Chrome DevTools Slow 3G throttling.
2. Hold or heavily delay the Matrix send request so its promise remains unresolved.
3. Type a new room-level message and press Enter once.
4. Before releasing the request, verify the composer is empty, the URL contains the new `~${roomId}:${txnId}` thread id, the new thread is open, and the submitted message is visible.
5. Verify the pending clock appears on the timeline message and nowhere in the composer or its context banner.
6. Navigate back and verify the pending root card appears immediately in the room overview without waiting for acknowledgement.
7. Return to the pending thread in an unencrypted room, send a follow-up reply before the root settles, and verify it clears immediately, renders as a second local echo, and does not throw.
8. Inspect the eventual follow-up request and verify neither its thread relation nor its reply fallback contains a `~` target.
9. Release the root and reply requests and verify each local id canonicalizes to one `$` event with no duplicate message, duplicate navigation, or pending clock after acknowledgement.
10. Verify URL canonicalization replaces the local entry and browser Back returns to the original overview without an extra history entry.
11. Repeat the exit check through the explicit close or back control in iOS standalone mode before and after acknowledgement.
12. While the local route is open, verify no relation fetch or read receipt is sent with a `~` thread id.
13. Repeat in an encrypted room and verify Enter retains a related draft while the target is local, then press Enter after canonicalization and verify the encrypted request contains only the confirmed `$` target.
14. In a separate standalone-root case with no child, return to the overview before terminal rejection and verify the failed echo disappears, the original structured content returns once, and newer typed content remains after it.
15. In a root-plus-local-reply case, leave the thread before both requests reject and verify both `NOT_SENT` events remain timeline-owned with no composer restoration or orphaned reply.
16. Restore the network and retry the restored standalone text from the overview, then verify it creates one new transaction and one local echo through the normal path.
17. Regression-check a reply in an already confirmed thread, an explicit reply, a text-plus-attachment send, voice, sticker, command execution, compact mode, and classic mode.
18. Inspect the transient local-root thread header and verify it upgrades cleanly when the confirmed event arrives.

The live script is documented for manual acceptance and was not executed because this worktree does not include a live Matrix test account or a controllable send endpoint.

## Plan alignment and deviations

There are no scope deviations and no source changes outside the files allowed by PLAN.md.

Required independent review tightened one literal terminal-failure example: a root with an SDK-tracked local child remains timeline-owned instead of being cancelled and restored, because cancelling it would orphan the child.

This correction preserves the plan's single-owner requirement, uses the existing SDK relations container, and adds no state, queue, abstraction, retry row, locale, or dependency framework.

The PLAN-defined encrypted-send release gate was used exactly after the real Rust encryption snapshot test demonstrated that in-flight clear-content mutation cannot safely change the encrypted request.
