# CINNY-121 — Optimistic text-send implementation plan

This ticket-scoped planning artifact is retained under `docs/`; `FORK_CHANGES.md` remains the live fork Runbook.

## Outcome

For a direct text send from the compact Simple Mode room overview, Cinny will create and render the Matrix SDK local echo, clear the composer, and navigate to the local-echo thread route in the same JavaScript turn.
The message timeline will remain the only in-flight owner of the submitted text and will show the existing message-level pending indicator.
The composer will no longer show a pending clock or pending banner.
The existing Matrix SDK transaction-id, local-echo, pending-event, scheduler, and local-id replacement machinery will remain the source of truth, with only the narrow compatibility patch required for this app's chronological pending-event ordering.

## Root-cause analysis

### 1. The text composer waits for the network response before clearing or notifying navigation

`src/app/mindroom/room-input/MindroomRoomInput.tsx:948-1064` implements the text-only branch in `submit()`.
It sets `submitPending`, awaits `mx.sendMessage(...)` at line 1043, and only then resets the editor, clears the reply draft, stops typing, and calls `onRoomMessageSent` at lines 1050-1057.
On a slow connection, the submitted text therefore remains in the composer until the HTTP send resolves even though matrix-js-sdk has already synchronously inserted a local echo.
`submitInFlightRef` is also held until the awaited request settles, which prevents the user from sending a follow-up message while the first message is pending.

The SDK creates the local event synchronously in `node_modules/matrix-js-sdk/src/client.ts:2824-2838`, gives it the deterministic id `~${roomId}:${txnId}`, records the transaction id, and inserts it with `room.addPendingEvent(...)` at lines 2869-2875 before returning the send promise.
The room exposes that same event through `room.getEventForTxnId(txnId)` at `node_modules/matrix-js-sdk/src/models/room.ts:2884-2886`.
Cinny can therefore verify the registered local echo and use its id before waiting for the network.

### 2. Compact-room auto-navigation deliberately rejects the local id

`src/app/mindroom/threads/useRoomViewThreadState.ts:318-326` only calls `navigateRoomThread` when `isConfirmedMatrixEventId(sentEventId)` accepts a `$` id.
The test at `src/app/mindroom/threads/__tests__/RoomView.test.ts:1537-1559` pins that old confirmed-only decision.
This gate forces room-level sends to wait for the server even though the fork already resolves and canonicalizes local thread routes.

`src/app/mindroom/threads/threadRouteUtils.ts:16-37` can recover a transaction id from an exact `~${roomId}:` prefix and resolve its confirmed id through the room transaction map.
`src/app/mindroom/threads/useThreadRootEvent.ts:24-83` listens to `RoomEvent.LocalEchoUpdated` and refreshes only when the replaced id is the currently open thread root.
`src/app/mindroom/threads/useRoomViewThreadState.ts:357-361` then replaces the local route with the confirmed route, while lines 363-367 intentionally keep local ids out of recent-thread persistence.
Those existing mechanisms make an immediate local route safe without a new navigation store.

### 3. The composer duplicates pending state that already belongs to the message

`src/app/mindroom/room-input/MindroomRoomInput.tsx:302` owns a text-only `submitPending` state.
The state drives a thread-composer top banner at `src/app/mindroom/room-input/MindroomRoomInput.tsx:1279-1289`.
`src/app/mindroom/room-input/RoomInputMindroomExtensions.tsx:52-58` and lines 227-249 accept `pendingSend` and render `PendingSendIndicator` inside that composer banner.

The timeline already derives pending state from SDK event statuses in `src/app/mindroom/messages/pendingLocalEcho.ts:1-14`.
The pending clock is rendered beside messages and compact thread cards through the existing message-state and card renderers, including `src/app/mindroom/threads/MindroomRoomTimeline.tsx:1975`, `src/app/mindroom/threads/CompactThreadCard.tsx:104`, and `src/app/mindroom/messages/messageStateSuffix.tsx:24`.
`src/app/mindroom/threads/roomLiveRenderController.ts:199-208` already forces the compact overview to recompute when a freshly sent standalone pending root enters the chronological room timeline.
The composer indicator is therefore redundant and creates the reported appearance that the same send is pending in two places.

### 4. The installed SDK's dependent-send lookup is incompatible with chronological ordering

The app does not override the SDK room pending-event ordering, so `node_modules/matrix-js-sdk/src/models/room.ts:493` selects `PendingEventOrdering.Chronological`.
When a follow-up reply targets the pending `~` root, `node_modules/matrix-js-sdk/src/client.ts:2852-2862` calls `room.getPendingEvents()` before inserting the reply local echo.
`room.getPendingEvents()` throws under chronological ordering at `node_modules/matrix-js-sdk/src/models/room.ts:724-740`, so the follow-up rejects before its local echo is registered.

This becomes a release blocker once immediate navigation lets the user type a reply while the root is still pending.
The SDK's existing association replacement also has a second gap: `MatrixEvent.getAssociatedId()` prefers `m.in_reply_to` at `node_modules/matrix-js-sdk/src/models/event.ts:1598-1610`, while `updateAssociatedId()` at lines 1619-1634 rewrites only `m.relates_to.event_id` or a redaction target.
MindRoom ordinary thread replies intentionally put the same root in both `m.relates_to.event_id` and `m.in_reply_to.event_id` at `src/app/mindroom/threads/composeMessageRelation.ts:28-47`, so both raw fields must be replaced before transmission.

### 5. Opening a local thread can trigger an invalid read-receipt fetch

`src/app/mindroom/notifications/readReceipts.ts:96-110` calls `getLatestThreadReplyTarget` for every thread id.
When no SDK thread model exists yet, `getLatestThreadReplyTarget` calls `mx.fetchRelations(...)` with that id at lines 45-71.
A local `~` id can never be a server relation target, so immediate navigation would otherwise cause a guaranteed failing request and an avoidable unhandled rejection.

### 6. Canonical route replacement can lose the seeded exit target

`src/app/mindroom/threads/threadNavigation.ts:40-72` stores the originating room path and the local thread id when the initial thread navigation pushes a history entry.
`src/app/mindroom/threads/useRoomViewThreadState.ts:143-159` only honors that exit target when its thread id equals the effective thread id.
The local-to-confirmed replacement at lines 357-361 currently passes only `{ replace: true }`, so after confirmation the stored target still names the `~` id and explicit exit can fall back to focus-event navigation instead of returning to the original overview.
The existing `withRoomThreadExitTargetState` helper at `src/app/mindroom/threads/roomNavigateState.ts:69-75` is sufficient to translate this target without adding navigation state.

## Minimal implementation

### Change 1 — Patch the installed SDK's pending association rewrite first

Create `patches/matrix-js-sdk+41.7.0.patch` with the same narrow changes in the SDK TypeScript sources, the compiled JavaScript consumed by the package `main` entry, and the affected declaration file.
Do not change the SDK's pending-event ordering and do not add a send queue.

In `node_modules/matrix-js-sdk/src/client.ts:2852-2862` and the corresponding compiled `lib/client.js` block:

1. Inspect every distinct local target present in `m.relates_to.event_id`, `m.in_reply_to.event_id`, or the redaction target instead of relying on the single value returned by `getAssociatedId()`.
2. Accept only an exact local-event prefix of `~${room.roomId}:`, extract its transaction id, and first resolve it with `room.getEventForTxnId(txnId)`.
3. Fall back to `room.findEventById(targetId)` for chronological timeline membership and `room.getPendingEvent(targetId)` for detached ordering, never `room.getPendingEvents()`.
4. If the transaction event already has a confirmed `$` id, rewrite the child event immediately to close the race where HTTP acknowledgement occurred before the listener was attached.
5. Otherwise attach the existing one-shot `MatrixEventEvent.LocalEventIdReplaced` listener and rewrite when the target confirms.
6. Keep scheduler, encryption, transaction ids, pending statuses, and send ordering unchanged.

In `node_modules/matrix-js-sdk/src/models/event.ts:1619-1634`, the corresponding `lib/models/event.js`, and `lib/models/event.d.ts`, extend `updateAssociatedId` with an optional original target id.
When the original target is supplied, replace only relation, reply-to, and redaction fields whose current value equals that original id.
This equality check preserves distinct targets for an explicit reply inside a pending thread while still replacing both fields when an ordinary thread reply uses the local root for both.
Preserve the existing one-argument behavior for other SDK callers.

Regenerate the patch with the repository's existing `patch-package` workflow and inspect it to ensure it contains no source maps, generated noise, or unrelated SDK changes.

### Change 2 — Reorder the direct text-only `submit()` path in one JavaScript turn

Modify only the no-upload text branch of `submit()` in `src/app/mindroom/room-input/MindroomRoomInput.tsx:948-1064`.
Keep command execution, upload sessions, voice, and sticker sends on their existing paths.

After content and relation construction, perform this order:

1. Capture `structuredClone(editor.children)` before mutating the composer so terminal failure can return ownership safely.
2. Allocate an explicit transaction id with `mx.makeTxnId()`.
3. Call `mx.sendMessage(roomId, content, txnId)` without awaiting it.
4. Immediately read `room.getEventForTxnId(txnId)` and verify that its id is the expected room-local echo.
5. Attach fulfillment and rejection handlers to the returned promise before any editor reset or navigation callback.
6. In the verified-local-echo path, reset the editor and its history, clear the reply draft, and stop typing.
7. Derive the room-level notification with the existing `getRoomMessageSentNotificationEventId` rules and call `onRoomMessageSent` with the local id only for a standalone room-level root.
8. Release `submitInFlightRef` before returning so a second message can be sent while the first request remains pending.

All steps from `sendMessage` through editor reset and `onRoomMessageSent` must occur in the same turn and must not await the network.
The promise handlers must consume both fulfillment and rejection so navigation does not introduce an unhandled promise rejection.

Keep one local boolean that records whether the navigation notification was already delivered.
On fulfillment, do nothing in the normal verified-local-echo path so the composer is not cleared and navigation is not notified a second time.
If the transaction lookup unexpectedly did not produce the local echo, retain the current conservative behavior for that exceptional path by keeping the composer and submission guard intact until fulfillment, then clear once and notify once with the confirmed response id.
If `sendMessage` throws before returning or the exceptional no-local-echo promise rejects, leave the composer and reply context untouched.

For a normal terminal rejection, inspect the captured local event.
For a standalone room-level root only, if it still exists with `EventStatus.NOT_SENT`, has no SDK-tracked children, and this input still owns the exact submitted room, thread, reply draft, and editor generation, call the existing `mx.cancelPendingEvent(localEvent)` to remove the failed room-timeline echo, then call the existing `restoreEditorContent(editor, snapshot)`.
Track editor changes with one component-local generation ref, adopt Slate's reset-driven microtask generation after an immediate clear, and leave the `NOT_SENT` echo as the owner after any later content or context change.
For a thread reply or explicit reply, leave the `NOT_SENT` event as the sole owner and do not restore it into the composer, because the SDK cancellation path does not reliably remove supplemental or thread-timeline copies in this fork.
Do not cancel `SENDING` events, because matrix-js-sdk only permits cancellation from its cancellable pending statuses.
Each send handles only its own event and snapshot, and each later direct send advances the generation so an older concurrent failure remains timeline-owned without cross-event dependency state.

### Terminal-failure UX choice

While a request is in flight, the SDK local echo is the sole owner of the submitted content.
On terminal standalone-root failure, cancelling the `NOT_SENT` echo before restoring its captured editor fragment transfers ownership back only when that exact composer context remains unchanged; otherwise the event stays timeline-owned.
This intentionally chooses the smaller existing-primitives option from the critique disagreement; visible retry or cancel controls and dependency policy belong in a follow-up ticket.

### Change 3 — Remove the composer-owned pending indicator

Delete `submitPending`, `setSubmitPending`, and their cleanup branches from `src/app/mindroom/room-input/MindroomRoomInput.tsx:302` and lines 951-1062.
At `src/app/mindroom/room-input/MindroomRoomInput.tsx:1279-1289`, render the reply context only for a real reply draft and stop passing `pendingSend`.
Keep voice-recorder and parked-voice-draft banners unchanged.

Remove the `pendingSend` prop and `PendingSendIndicator` import and rendering from `src/app/mindroom/room-input/RoomInputMindroomExtensions.tsx:15`, lines 52-58, and lines 227-249.
Do not change the pending indicator used by timeline messages or compact thread cards.

### Change 4 — Allow local-echo navigation and preserve exit behavior

In `src/app/mindroom/threads/useRoomViewThreadState.ts:318-326`, accept either `isConfirmedMatrixEventId(sentEventId)` or `isLocalEchoEventId(sentEventId)`.
Keep the existing compact-mode, current-thread, and effective-thread guards unchanged so thread replies, classic mode, and already-open threads never open a new thread.
This intentionally supersedes the older confirmed-only gate because the fork now has transaction-aware local-route canonicalization.

When `src/app/mindroom/threads/useRoomViewThreadState.ts:357-361` replaces a `~` route with its confirmed id, read the current exit target with the existing helper.
If it belongs to the same room and names the old local thread id, safely extract the current React Router user state from `window.history.state.usr`, pass that user state and a copy with `threadId: effectiveThreadId` through `withRoomThreadExitTargetState`, and use the result as `NavigateOptions.state`.
Do not pass the full `window.history.state` wrapper as user state.
Do not push a second history entry and do not add another cache or atom.

Continue to require a confirmed id before `bumpRecentThread` at lines 363-367.
The local route is transient and must not be persisted in recents.

### Change 5 — Guard read receipts for local thread ids

Add an early `isLocalEchoEventId(threadId)` return in `markThreadAsRead` at `src/app/mindroom/notifications/readReceipts.ts:96-110`.
Do not fetch relations and do not send a receipt until the route has canonicalized to a server id.
The existing confirmed-thread behavior remains unchanged.

### Round 3 review hardening — Gate durable actions on confirmed ids

Reuse `isConfirmedMatrixEventId` at the message action, inline reaction, and encrypted editor boundaries.
While a message id is local, withhold reaction creation, edit, copy-link, pin, delete, and report actions, and keep existing reaction chips read-only while preserving their inspection menu.
When the current user's reaction event is itself local, keep its chip read-only so removing it cannot redact a transient id.
Keep reply and reply-in-thread available because the existing send boundary defers or canonicalizes them, and keep read-only source, receipt, reaction, and text inspection available.
In an encrypted room, disable and recheck `MessageEditor` save while the replacement target is local, then build the replacement relation from the live confirmed id after canonicalization.
Do not add state, a queue, an action registry, or a new durability abstraction.

## Edge cases

### Send failure

A synchronous pre-local-echo failure leaves the composer and reply draft untouched.
A terminal standalone-root failure after local insertion cancels only that send's `NOT_SENT` event and restores only that send's captured fragment when the exact submitted room, thread, reply draft, and editor generation remain owned and the event has no SDK-tracked children.
If the user typed newer content or changed composer context while the request was pending, leave the failed event timeline-owned and do not inject its fragment into the composer.
If a root and queued replies fail terminally together, leave the root and each reply in their existing `NOT_SENT` events so cancellation cannot orphan the child.
If several standalone roots fail terminally together, only the newest unchanged root may transfer back, while older roots remain timeline-owned under either FIFO or reverse settlement.
For a thread reply or explicit reply failure, retain the original event and relation context in the timeline and do not overwrite a newer composer or reply draft.
Visible message-owned retry or cancel controls require product policy and belong in the failure-UX follow-up.
If the input has unmounted or changed rooms, threads, reply targets, or editor generation, do not cancel the event or mutate the stale editor, so the SDK event remains the single owner.
If the failed root is open as the current thread, its route change means the event remains timeline-owned.
Automatic route exit and visible retry or cancel actions are deliberately not part of this fix.

### Offline send

The SDK remains responsible for retry timing and pending statuses while the device is offline.
The message owns the pending clock for as long as the SDK considers it pending.
Only the terminal standalone-root rejection path with unchanged full composer ownership returns text to the composer.

### Room-level send versus thread reply

A standalone room-level text send clears immediately and notifies the compact-room controller with its local id, which opens the new thread immediately.
A thread reply follows the same immediate clear and local-echo behavior but produces no room-level notification because the existing relation, reply-draft, and thread-id checks suppress it.
A follow-up reply sent while the root is still local relies on the patched SDK association rewrite and existing scheduler rather than app-owned dependency state.
An explicit reply whose reply target differs from its local thread root retains the confirmed reply target while only the local root field is rewritten.

### Multiple quick sends

The same synchronous re-entry guard still prevents duplicate submission from repeated Enter events in one invocation.
The guard is released after verified local dispatch, so a later message can obtain a distinct transaction id and local echo while the earlier request is unresolved.
Each promise handler closes over its own event and editor snapshot.
Each immediate clear advances the editor generation, so a later send invalidates an older handler's right to transfer content back.

### Local-to-confirmed transition

`RoomEvent.LocalEchoUpdated` remains responsible for resolving the open local root.
Canonicalization replaces the current route rather than pushing history, retains the original exit destination, and adds only the confirmed id to recents.
Fulfillment does not issue a second navigation callback.

### Attachments, voice, stickers, and commands

Text bundled with uploads still enters `startSendSession` at `src/app/mindroom/room-input/MindroomRoomInput.tsx:1026-1029`, while its existing send-session controller refreshes relation targets and keeps encrypted local-target sessions composer-owned.
Voice keeps its existing upload and retry ownership path around lines 714-945, while refreshing and checking encrypted relation targets again at the final send boundary.
Sticker sends use the separate `sendEvent` path at lines 1156-1169 and remain unchanged.
Local commands that execute without sending and reset at lines 984-995 remain unchanged.

## Automated test strategy

### Direct composer behavior

Extend `src/app/mindroom/room-input/__tests__/RoomInput.test.ts` with focused deferred-promise tests.

- Verify that `makeTxnId`, `sendMessage` with that explicit transaction id, synchronous transaction lookup, handler attachment, editor reset, and the local-id callback occur in the required same-turn order before the promise settles.
- Verify that a standalone room-level send clears the composer, clears editor history and reply state, stops typing, and emits exactly one `~${roomId}:${txnId}` callback while the request is unresolved.
- Verify that fulfillment after local notification does not clear or notify a second time.
- Verify that the exceptional missing-local-echo path keeps the composer and guard until fulfillment, then clears and emits the confirmed id exactly once.
- Verify that a synchronous throw and a missing-local-echo rejection leave the composer intact and emit no callback.
- Verify that terminal `NOT_SENT` rejection for a standalone room-level root calls `cancelPendingEvent` before `restoreEditorContent`, removes the local room-timeline ghost, and restores the captured fragment once.
- Verify that Slate's reset-driven microtask still permits an otherwise untouched standalone root to restore.
- Verify that newer content or a changed reply context invalidates transfer and leaves the failed root timeline-owned.
- Verify that a pending root and pending reply rejected together remain owned by the timeline and never duplicate either fragment into the composer.
- Verify that two standalone roots rejected in FIFO and reverse order leave the older root timeline-owned while only the newest unchanged root may cancel and restore.
- Verify that a failed thread reply and failed explicit reply call neither `cancelPendingEvent` nor `restoreEditorContent`, preserving their original event relation while leaving a newer composer and reply draft untouched.
- Verify that a rejection after unmount or room, thread, reply, or editor-generation ownership change neither cancels the only failed echo nor mutates the stale editor.
- Verify that two sequential sends made before the first settles receive distinct transaction ids, create distinct local echoes, and retain independent handlers and snapshots.
- Verify that rapid duplicate Enter handling still produces one send.
- Verify that a thread reply clears immediately but never invokes the room-level navigation callback.
- Verify that an explicit reply inside a thread keeps the existing relation construction.
- Keep upload, voice, command, and paste tests unchanged and green.

Update `src/app/mindroom/room-input/RoomInputMindroomExtensions.test.ts` to remove composer-pending expectations and assert that reply, voice, and children rendering still work without a pending prop.
Add a component assertion that the direct text in-flight state never renders the composer clock or a pending banner.

### Navigation and history

Update `src/app/mindroom/threads/__tests__/RoomView.test.ts:1537-1559` so a compact room overview accepts and navigates to a local id.

- Keep the confirmed-id navigation case green.
- Keep the guards for classic mode, an existing `threadId`, and an existing `effectiveThreadId` green.
- Verify that unresolved local ids are still excluded from recent-thread persistence.
- Verify that a local-to-confirmed route change uses replacement rather than push and translates the stored exit target to the confirmed id.
- Verify that browser back after a pre-ack open returns to the original compact room overview.
- Verify that the explicit iOS exit path still returns to the original overview after confirmation.

Keep `src/app/mindroom/threads/threadNavigation.test.ts`, `src/app/mindroom/threads/roomNavigateState.test.ts`, and `src/app/mindroom/threads/useThreadRootEvent.test.ts` green.

### SDK patch

Add `src/app/mindroom/threads/matrixSdkLocalEchoAssociation.test.ts` as a focused test that imports the installed `matrix-js-sdk` runtime rather than a copied helper.

- Under chronological ordering, verify that a reply to a local root no longer calls the throwing `getPendingEvents()` path and creates its own local echo.
- Under detached ordering, verify that pending-target replacement still works.
- Verify the post-HTTP/pre-listener race by returning a transaction event whose id has already changed to `$`, then assert immediate association replacement.
- Verify an ordinary thread reply rewrites both `m.relates_to.event_id` and `m.in_reply_to.event_id`.
- Verify an explicit reply with a confirmed reply target and a different local thread root rewrites only the local root.
- Verify two distinct local relation and reply targets resolve independently to their own confirmed ids in both confirmation orders without either replacement overwriting the other.
- Verify redaction association replacement remains intact.
- Verify both unencrypted and encrypted sends preserve local-echo behavior and that the actual outgoing HTTP payload contains no `~` target.
- Verify the patch reapplies cleanly from a fresh dependency installation.

Treat the encrypted outgoing-payload assertion as a release gate because encryption runs before scheduler queueing.
If the narrow association mutation does not remove both local targets from the encrypted HTTP payload, do not broaden CINNY-121 into encryption or scheduler work.
Instead, leave only that related draft in the composer with no send while its active root id is local, let the user press Enter again after canonicalization, and file the broader SDK behavior separately.

### Read receipts and rendering

Extend `src/app/mindroom/notifications/readReceipts.test.ts` to verify that `markThreadAsRead` performs neither `fetchRelations` nor `sendReceipt` for a local id and retains both loaded and fetched confirmed-thread cases.
Keep `src/app/mindroom/threads/__tests__/RoomTimeline.pendingSend.test.ts`, `src/app/mindroom/threads/CompactThreadCard.test.tsx`, `src/app/mindroom/messages/pendingSendIndicator.test.ts`, and message-state suffix tests green to prove the clock remains message-owned.
Keep the focused root canonicalization and compact render tests green.

### Durable event-id actions

Extend `src/app/mindroom/messages/__tests__/Message.test.ts` to prove pending ids withhold reaction, edit, copy-link, pin, delete, and report actions while preserving safe inspection and deferred reply actions, then prove confirmed ids restore the actions.
Extend `src/app/features/room/message/Reactions.test.ts` to prove a pending message target and a pending current-user reaction remain visible and inspectable but cannot toggle.
Add `src/app/features/room/message/MessageEditor.test.ts` to drive an encrypted pending-root edit race, prove the blocked attempt sends nothing, and prove the post-canonicalization replacement contains only the confirmed id.

### Repository validation

After each logical implementation step, update the CINNY-121 Runbook entry in `FORK_CHANGES.md`, run the focused tests, and perform the required independent review.
Before finalizing, run formatting and lint checks for changed files, `npm run typecheck`, `npm test`, and `npm run build`.
Review the final patch to confirm there are no source changes outside the files named here and the generated SDK patch.

## Live throttled-browser script

1. Start from a compact Simple Mode room overview on a mobile-sized viewport and enable Chrome DevTools Slow 3G throttling.
2. Hold or heavily delay the Matrix send request so its promise remains unresolved.
3. Type a new room-level message and press Enter once.
4. Before releasing the request, verify the composer is empty, the URL contains the new `~${roomId}:${txnId}` thread id, the new thread view is open, and the submitted message is visible.
5. Verify the pending clock appears on the timeline message and nowhere in the composer or composer context banner.
6. Verify the pending root card appears immediately in the room overview when navigating back, without waiting for acknowledgement.
7. Return to the pending thread, type a follow-up reply before the root request resolves, and verify it clears immediately, renders as a second local echo, and does not throw.
8. Inspect the eventual follow-up request and verify neither its thread relation nor reply fallback sends a `~` target.
9. Release the root and reply requests and verify each local id canonicalizes to one `$` event with no duplicate message, no duplicate navigation, and no pending clock after acknowledgement.
10. Verify the URL replacement does not add a duplicate history entry and that browser Back returns to the original room overview.
11. Repeat the exit check through the explicit close or back control in iOS standalone mode and verify it returns to the originating overview both before and after acknowledgement.
12. While the local route is open, verify no `fetchRelations` request or read receipt is sent with a `~` id.
13. Open the pending-root menu and verify durable-id actions are absent while read-only inspection and deferred reply actions remain available.
14. Verify existing reaction chips remain visible and inspectable but cannot toggle while the message or current-user reaction id is local.
15. Repeat the root plus pending follow-up flow in an encrypted room and verify the outgoing encrypted send path never transmits a local relation target.
16. Open the encrypted pending root editor, verify Save is disabled, then verify the post-canonicalization replacement contains only the confirmed id.
17. Simulate a terminal offline standalone-root failure after the SDK retries while the overview composer remains unchanged and verify the failed local echo disappears and the original structured content returns once.
18. Repeat after typing newer text, selecting an unrelated reply, entering another thread, and changing rooms, and verify the failed root remains timeline-owned without composer mutation or stale navigation.
19. Send two standalone roots before either settles, reject them in FIFO and reverse order, and verify only the newest unchanged root may return while the older root remains timeline-owned.
20. Restore the network, press Enter to retry restored text from the room overview, and verify it creates one new transaction and local echo through the normal path.
21. Regression-check a reply in an already confirmed thread, an explicit reply, a text-plus-attachment send, voice, sticker, command execution, compact mode, and classic mode.
22. Eyeball the transient thread header for a local root and confirm it upgrades cleanly when the confirmed event arrives.

## Intended implementation files

- `src/app/mindroom/room-input/MindroomRoomInput.tsx`
- `src/app/mindroom/room-input/__tests__/RoomInput.test.ts`
- `src/app/mindroom/room-input/RoomInputMindroomExtensions.tsx`
- `src/app/mindroom/room-input/RoomInputMindroomExtensions.test.ts`
- `src/app/mindroom/threads/useRoomViewThreadState.ts`
- `src/app/mindroom/threads/__tests__/RoomView.test.ts`
- `src/app/mindroom/threads/threadNavigation.ts`
- `src/app/mindroom/threads/threadNavigation.test.ts`
- `src/app/mindroom/threads/roomNavigateState.ts`
- `src/app/mindroom/threads/roomNavigateState.test.ts`
- `src/app/mindroom/threads/threadRouteUtils.ts`
- `src/app/mindroom/threads/threadRouteUtils.test.ts`
- `src/app/mindroom/threads/composeMessageRelation.ts`
- `src/app/mindroom/threads/composeMessageRelation.test.ts`
- `src/app/mindroom/threads/roomTimelineReplyDraft.ts`
- `src/app/mindroom/threads/roomTimelineReplyDraft.test.ts`
- `src/app/mindroom/threads/useRoomInputSendSessionController.ts`
- `src/app/mindroom/threads/useRoomInputSendSessionController.test.ts`
- `src/app/mindroom/notifications/readReceipts.ts`
- `src/app/mindroom/notifications/readReceipts.test.ts`
- `src/app/mindroom/messages/MindroomMessage.tsx`
- `src/app/mindroom/messages/__tests__/Message.test.ts`
- `src/app/features/room/message/Reactions.tsx`
- `src/app/features/room/message/Reactions.test.ts`
- `src/app/features/room/message/MessageEditor.tsx`
- `src/app/features/room/message/MessageEditor.test.ts`
- `patches/matrix-js-sdk+41.7.0.patch`
- `src/app/mindroom/threads/matrixSdkLocalEchoAssociation.test.ts`
- `FORK_CHANGES.md` for implementation status and validation evidence

No production file outside this list should be needed.
Existing navigation and pending-render tests may need expectation-only updates if the focused changes exercise them.

## Explicitly out of scope

- CINNY-122's not-yet-thread-root timeline-set subscription and reply-live-update fix.
- A new app-owned send queue, pending-message store, navigation store, event ownership store, or orchestration abstraction.
- An inline retry or cancel row, cross-message dependency controls, new failure copy, locale changes, or a dependency matrix.
- Automatic route exit after terminal root failure.
- Mount-time recovery for a dead local route after reload or a PWA process kill.
- Encrypted-gate auto-resubmission, additional user-facing copy, or locale changes.
- A broad settlement-handler refactor.
- Returning older concurrent failed roots to separate composer rows instead of leaving them timeline-owned.
- Persisting chronological pending events across reloads.
- Persisting `~` ids in recent threads or changing the pre-existing recent-card behavior for manually opened local ids.
- General upstream SDK refactoring beyond the narrow pending-target lookup and association rewrite patch.
- Changing attachment, voice, sticker, upload-session, or command send semantics.
- Thread header design changes beyond verifying its existing transient fallback.
- Any source change belonging to CINNY-122; if its parallel fix touches `useThreadRootEvent.ts`, thread timeline code, or shared tests, coordinate the overlap and keep this issue's changes limited to the CINNY-121 files and boundaries listed above.
