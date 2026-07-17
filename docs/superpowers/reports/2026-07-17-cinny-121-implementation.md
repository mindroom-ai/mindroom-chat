# CINNY-121 Implementation Report

## Outcome

All five planned changes are implemented in ship order, and every confirmed Round 1 through Round 5 review finding is fixed at its owning boundary.

The implementation reuses matrix-js-sdk transaction ids, synchronous local echoes, relation aggregation, pending statuses, and `RoomEvent.LocalEchoUpdated`.

No new application store, send queue, or abstraction was added.

`src/app/mindroom/threads/threadOpenSdkBootstrap.ts` and the CINNY-122 thread-creation path are unchanged.

## Changes by file

- `patches/matrix-js-sdk+41.7.0.patch` updates the SDK source, compiled runtime, and declarations so relation, reply, and redaction local ids resolve independently through transaction lookup, old-id lookup, detached pending lookup, or transaction metadata across every loaded room and thread timeline after remote-echo eviction.
  Pending replies are inserted into a provisional thread, reaggregated and migrated when their local root canonicalizes, replayed through canonical SDK hydration, and detached from the discarded provisional thread's listeners and re-emitter.
- `src/app/mindroom/room-input/MindroomRoomInput.tsx` performs direct text dispatch and verified local-echo lookup synchronously, canonicalizes live reply drafts, gates every encrypted related text or voice boundary, permits late settlement mutations only while the exact submitted room, thread, reply draft, and editor generation remain owned, and transfers ownership to the timeline only when Simple Mode navigation explicitly accepts the local root.
- `src/app/mindroom/room-input/RoomInputMindroomExtensions.tsx` removes the composer-owned pending clock and pending banner prop while refreshing captured voice thread and reply targets against the live room.
- `src/app/mindroom/room-input/__tests__/RoomInput.test.ts` covers same-turn ordering, exceptional lookup paths, full settlement ownership, FIFO and reverse concurrent failures, sequential and duplicate sends, relation construction, reply-draft canonicalization, encrypted text and voice boundaries, composer rendering, terminal ownership, and rejection before and after an auto-navigated route renders.
- `src/app/mindroom/room-input/RoomInputMindroomExtensions.test.ts` covers the remaining reply, voice, and children extension surfaces without a pending prop.
- `src/app/mindroom/threads/composeMessageRelation.ts` provides the shared narrow predicate for local relation and reply targets and safely handles a malformed reply fallback without an event id.
- `src/app/mindroom/threads/composeMessageRelation.test.ts` covers ordinary thread and reply relation construction plus safe malformed reply fallback inspection.
- `src/app/mindroom/threads/threadRouteUtils.ts` resolves any encoded local event id through transaction lookup or transaction metadata across every loaded room and thread timeline.
- `src/app/mindroom/threads/threadRouteUtils.test.ts` covers post-transaction-map local-id resolution when the canonical event exists only in a non-live thread timeline.
- `src/app/mindroom/threads/roomTimelineReplyDraft.ts` canonicalizes every event id retained by a reply draft while preserving the original object when nothing changes.
- `src/app/mindroom/threads/roomTimelineReplyDraft.test.ts` covers independent reply, relation-root, and fallback-target canonicalization.
- `src/app/mindroom/threads/useRoomInputSendSessionController.ts` resolves live room, thread, reply, encryption, and bridge state before attachment, caption, and upload sends and preserves composer or board ownership while an encrypted target is local.
- `src/app/mindroom/threads/useRoomInputSendSessionController.test.ts` covers attachment-only and caption-plus-attachment ownership for encrypted local roots.
- `src/app/mindroom/threads/useRoomViewThreadState.ts` accepts a local root id in the compact room overview, returns whether that navigation handoff occurred, and replaces the local route with its confirmed id while translating the saved exit target.
- `src/app/mindroom/threads/__tests__/RoomView.test.ts` covers accepted compact and declined classic or already-threaded handoffs, immediate local navigation, canonical replacement, recents exclusion, browser history, and explicit iOS exit behavior.
- `src/app/mindroom/threads/threadNavigation.ts` persists a translated exit target after replacement navigation creates its new keyed history entry.
- `src/app/mindroom/threads/threadNavigation.test.ts` covers pushed persistence, targetless replacement, and carried-target migration.
- `src/app/mindroom/threads/roomNavigateState.ts` moves the keyed memory and session-storage exit target to the replacement entry and removes the dead keyed cache.
- `src/app/mindroom/threads/roomNavigateState.test.ts` covers replacement-key migration and the existing explicit and fallback state contracts.
- `src/app/mindroom/notifications/readReceipts.ts` returns before any room lookup, relation fetch, or receipt send for a local thread id.
- `src/app/mindroom/notifications/readReceipts.test.ts` covers the local-id no-op and retains loaded and fetched confirmed-thread behavior.
- `src/app/mindroom/threads/matrixSdkLocalEchoAssociation.test.ts` exercises the installed patched SDK under chronological and detached ordering, acknowledgement and post-remote-echo races, a transaction-evicted target available only in a non-live thread timeline, real pending relation aggregation, dual targets, redaction, encryption, and compatibility behavior.
- `src/app/mindroom/messages/MindroomMessage.tsx` requires a confirmed event id before exposing reaction, edit, permalink, pin, delete, or report actions for message and generic-event menus.
- `src/app/mindroom/messages/__tests__/Message.test.ts` proves pending local echoes withhold durable actions, retain local-only inspection and deferred replies, and restore the actions after confirmation.
- `src/app/features/room/message/Reactions.tsx` renders pending-target and pending-owned-reaction chips as read-only so neither reaction creation nor redaction receives a local id.
- `src/app/features/room/message/Reactions.test.ts` covers pending message targets, pending owned-reaction redaction targets, confirmed toggles, and read-only context inspection.
- `src/app/features/room/message/MessageEditor.tsx` disables and rechecks every replacement send until the edited event id is confirmed, including defensive coverage for callers outside the message menu.
- `src/app/features/room/message/MessageEditor.test.ts` drives pending-root edit races in encrypted and unencrypted rooms and proves the eventual replacement relation contains only the live confirmed id.
- `src/app/mindroom/messages/pendingLocalEcho.ts` distinguishes terminal `NOT_SENT` local echoes from in-flight pending statuses.
- `src/app/mindroom/messages/pendingSendIndicator.tsx` renders a dedicated accessible failed-send indicator while retaining the existing pending clock for in-flight events.
- `src/app/mindroom/messages/pendingSendIndicator.test.ts` covers the disjoint pending and terminal-failure status contracts.
- `src/app/mindroom/messages/messageStateSuffix.tsx` gives terminal failure precedence over the ordinary message-state suffix.
- `src/app/mindroom/messages/messageStateSuffix.test.ts` covers failed, pending, and delivered suffix selection.
- `src/app/components/RenderMessageContent.tsx` and `src/app/mindroom/messages/renderMindroomMessageContent.tsx` carry local-echo failure state to the message-owned render surface.
- `src/app/mindroom/threads/threadRecord.ts`, `src/app/mindroom/threads/types.ts`, and `src/app/mindroom/threads/compactThreadCardViewModel.ts` carry terminal failure into compact thread-card data without changing pending ordering.
- `src/app/mindroom/threads/CompactThreadCard.tsx` renders the same failed-send indicator on a failed root card.
- `src/app/mindroom/threads/CompactThreadCard.test.tsx` and `src/app/mindroom/threads/compactThreadCardViewModel.test.ts` cover compact failure rendering and state derivation.
- `src/app/mindroom/threads/MindroomRoomTimeline.tsx` excludes local ids from ArrowUp editing and withholds thread-scoped focus work for a pending local route.
- `src/app/mindroom/threads/threadOpenLifecycleController.ts` short-circuits remote thread-open work for a pending local route.
- `src/app/mindroom/threads/threadSummaryPublishController.ts` withholds thread-summary persistence until the route id is confirmed.
- `src/app/mindroom/threads/useThreadRenderState.ts` renders a room-owned pending root immediately and retains an SDK local-echo seed through root canonicalization, child acknowledgement, and canonical SDK hydration without waiting for app-cache hydration.
- `src/app/mindroom/threads/useThreadRenderState.test.ts` covers the installed-SDK pending root and reply render path under local and canonical routes, including completed SDK hydration while app-cache hydration remains unresolved, while preserving ordinary confirmed-thread loading behavior.
- `src/app/mindroom/threads/__tests__/RoomTimeline.pendingSend.test.ts` covers message failure state, ArrowUp before and after confirmation, and the absence of remote, cache, summary, or thread-focus effects on a pending route.
- `src/app/mindroom/threads/__tests__/RoomTimeline.cache.test.ts` removes the obsolete expectation that pending routes start cache hydration.
- `src/app/mindroom/threads/test-utils/RoomTimeline.test.shared.ts`, `src/app/mindroom/threads/useRoomInputSendSessionController.test.ts`, and `src/app/mindroom/threads/useThreadRootEvent.test.ts` model the loaded-thread SDK surface required by the tightened route boundary.
- `docs/superpowers/plans/2026-07-16-cinny-121-optimistic-send.md` retains the orchestrator-requested ticket plan outside the product root.
- `docs/superpowers/reports/2026-07-17-cinny-121-implementation.md` retains this implementation and validation report outside the product root.
- `FORK_CHANGES.md` records the implementation, all five review rounds, scope, validation, SDK patch maintenance note, and current status in the fork Runbook.

## Round 1 fixes

- A1/B5 exposed one violated send-boundary invariant: every related send must refresh its live Matrix context and either canonicalize or withhold an encrypted local target before the final `sendMessage`.
- Direct text, attachment-only, caption-plus-attachment, and voice now share that invariant without sharing a new queue, store, or send framework.
- A2/B1 exposed stale draft identity ownership, so the reply-draft atom now follows `RoomEvent.LocalEchoUpdated` and all retained ids are re-resolved again at send time.
- A3/B2 exposed the SDK as the final wire owner after `Room.handleRemoteEcho` evicts its transaction map, so the patch falls back to matching live events by `getTxnId()` or `unsigned.transaction_id`.
- B3/B4 exposed composer ownership races, so terminal root restoration requires the room overview and exceptional late fulfillment requires the still-mounted originating room.
- B6 is pinned against the installed SDK by asserting that a chronological pending child is aggregated under its local parent before confirmation.
- B7 is fixed in the navigation persistence owner by moving the translated exit target to the replacement history key after navigation.
- The later Round 5 cleanup moves the retained plan and report under `docs/superpowers` without touching the review archive or unrelated working-tree files.

## Round 2 fixes

- A1 and A2 exposed one incomplete ownership invariant in `MindroomRoomInput.submit`: a settlement handler may mutate only the composer whose mounted room, thread, reply draft, and editor generation exactly match the submitted snapshot.
- Both the missing-local-echo fulfillment fallback and terminal standalone-root transfer now use that same predicate, so stale fulfillment cannot clear or navigate and a failed root cannot enter an unrelated reply or thread context.
- Slate reports reset operations in a microtask, so the successful local clear adopts that reset generation before later user input can occur and still permits an otherwise untouched standalone failure to transfer back.
- A3 exposed reverse restoration under FIFO rejection, so each later direct send now invalidates older transfer ownership and only the newest unchanged root may restore while older failures remain timeline-owned.
- B6 is addressed by optional-chaining the reply fallback event id, with a malformed-relation regression at the shared predicate boundary.
- The encrypted-gate call sites were not consolidated because the ownership fix did not touch those flows, and auto-resubmission UX, broader SDK-upgrade automation, and fail-fast unresolved-target behavior remain follow-up work.

## Round 3 fixes

- A1 exposed a durable-id ownership invariant at the message action boundary: no action that persists, transmits, or redacts an event id may receive a local echo id.
- `MindroomMessage` now uses the existing shared confirmed-id predicate to withhold reaction, edit, permalink, pin, delete, and report actions while the target is local, while reply, reply-in-thread, read receipts, source inspection, reaction inspection, and text copy retain their existing safe behavior.
- The inline `Reactions` surface applies the same boundary to both the message target and the current user's reaction event, so neither a new reaction nor a reaction redaction can consume a local id.
- A2 exposed the same invariant at the replacement-send owner, so encrypted `MessageEditor` saves remain disabled and are rechecked until the edited event exposes its confirmed id.
- The menu audit found no forward or read-until action on this surface and no additional durable local-id consumer after the inline reaction fix.
- The independent re-review found one incomplete test double for the new reaction-id check, which was corrected without weakening production behavior, and then found no remaining durable-action surface.
- Dead-local-route reload recovery, encrypted-gate copy or auto-resubmission, SDK upgrade automation beyond the existing Runbook note, unresolved-target fail-fast behavior, and settlement refactoring remain explicit follow-up work.

## Round 4 fixes

- A2/B1/B2 exposed a single-ownership gap in the flagship flow: the navigation callback had already published the local root, but terminal rejection still tested composer ownership after the route changed.
- The submit boundary now records timeline ownership before invoking navigation, so rejection before or after the route render leaves the same root event-owned and visibly `NOT_SENT`.
- Terminal `NOT_SENT` is no longer part of the in-flight clock set and now renders a distinct accessible failed-send indicator on timeline messages and compact thread cards.
- Retry and cancel controls remain follow-up work because the minimal single-owner contract keeps the failed content recoverable on the existing event surface without transferring it into a different composer.
- A4/B4 exposed ArrowUp as another replacement-editor entry point, so its candidate filter now requires a confirmed id and `MessageEditor` independently enforces the same boundary in encrypted and unencrypted rooms.
- A1 exposed a post-remote-echo lookup gap for thread replies outside live timelines, so both the application resolver and installed SDK patch scan every loaded unfiltered room and thread timeline before allowing a local relation target to reach the wire.
- A3 exposed remote and durable side effects during a pending local route, so the route renders only its room-owned local root while relation reconciliation, cache writes, summary publication, and thread-scoped focus work wait for confirmation.
- The obsolete pending-route cache-hydration expectation was deleted and replaced with a real-hook render regression plus a timeline integration regression that asserts the prohibited side effects do not occur.
- Independent review found that the first pending-route integration test mocked away the real render state and that the first canonicalization fallback inspected only live timelines; both half-refactors were replaced at their owning boundaries before final review.
- Two independent final re-reviews report no remaining findings across terminal ownership, edit gates, all-loaded-timeline canonicalization, pending-route rendering, side-effect suppression, cleanup, and CINNY-122 scope isolation.

## Round 5 fixes

- A1 exposed an SDK render-ownership invariant: a pending reply sent against a pending root must remain represented by one renderable thread model before root acknowledgement, after root canonicalization, after child acknowledgement, and through canonical SDK hydration without waiting for a remote echo or app-cache hydration.
- The SDK patch now creates a provisional local-root thread when `Room.addPendingEvent` rejects the threaded child from the room timeline, moves the child from the local aggregation and provisional timeline into the canonical aggregation and thread, and retains it in the SDK replay set while canonical hydration resets the live timeline.
- The discarded provisional `Thread` is removed from Room re-emission and detaches its room and timeline listeners before the canonical thread takes ownership, preventing a per-send stale listener and object leak.
- The render owner treats transaction-backed SDK events and pending replay events as a live local-echo seed, so acknowledgement or hydration cannot temporarily blank the already-visible root and reply.
- A2 exposed an application ownership-handoff invariant: invoking the room-message callback is not itself a transfer; the parent must explicitly return that compact navigation accepted the root.
- `handleRoomMessageSent` now returns `true` only after compact-overview navigation and returns `false` for classic mode, an active route or effective thread, and invalid ids.
- Direct text settlement records timeline ownership only from that `true` return, so compact failures remain visibly event-owned in both settlement orderings while an unchanged classic standalone failure cancels its echo and restores its captured editor fragment.
- The ticket plan and report moved from the repository root into `docs/superpowers`; `.review-archive` remains untouched.
- Independent reviews approved both logical fixes after regressions closed SDK hydration, listener teardown, compact acceptance, and classic decline behavior.

## Automated test plan and results

### Direct composer behavior

- Verify the same-turn order of transaction allocation, `sendMessage`, synchronous transaction lookup, promise-handler attachment, editor reset, and local-id navigation before the request settles.
- Verify a standalone room-level text send clears the editor and history, clears reply state, stops typing, and emits exactly one local root id while the request remains unresolved.
- Verify later fulfillment neither clears nor navigates a second time.
- Verify a missing synchronous local echo retains the composer and guard until fulfillment, then clears and emits the confirmed id once.
- Verify a synchronous send throw and a missing-local-echo rejection retain the composer and emit no navigation callback.
- Verify callback invocation alone does not transfer ownership: a declined classic-mode handoff cancels an otherwise unchanged failed root and restores its structured fragment.
- Verify an auto-published root remains timeline-owned when rejection settles before the route render and when it settles after the route render.
- Verify both settlement orderings retain the failed event, do not restore it into the routed composer, and expose `NOT_SENT` to message rendering.
- Verify an unowned standalone `NOT_SENT` root cancels before its structured editor fragment is restored.
- Verify Slate's reset-driven microtask does not invalidate an otherwise untouched standalone-root transfer.
- Verify newer text or a changed reply target invalidates terminal transfer and leaves the failed event timeline-owned.
- Verify an active failed root remains timeline-owned.
- Verify a failed root with a local reply remains timeline-owned even after the user exits that thread, so the child is never orphaned.
- Verify only the newest unchanged concurrent standalone failure transfers back under both FIFO and reverse settlement while the older root remains timeline-owned.
- Verify failed thread and explicit replies remain event-owned and do not overwrite newer composer or reply state.
- Verify a rejection after the input changes room ownership does not cancel the event or mutate the stale editor.
- Verify two sends before either request settles receive distinct transaction ids, local echoes, completion handlers, and snapshots.
- Verify rapid duplicate Enter handling produces one send.
- Verify a thread reply clears immediately without invoking room-level navigation.
- Verify an explicit reply inside a thread retains the existing thread-root and reply-target relation construction.
- Verify a reply draft captured against a pending event rewrites its explicit reply, thread root, and fallback target when the event canonicalizes.
- Verify related encrypted text does not send while either thread or reply target is local and can send after canonicalization.
- Verify attachment-only and caption-plus-attachment sessions retain the upload board and composer while an encrypted relation target is local.
- Verify voice is blocked before upload when its encrypted target is known local and is checked again after a deferred upload before the final send.
- Verify the same captured voice context can retry with confirmed ids after canonicalization.
- Verify a failed room root never restores into a different thread composer.
- Verify exceptional missing-local fulfillment cannot clear or navigate after unmount, room switch, same-room thread entry, reply-target change, or a newer editor change and always releases the submit guard.
- Verify a malformed reply fallback without an event id is treated as non-local without throwing on the submit hot path.
- Verify sticker, command, and paste paths remain on their existing ownership paths.
- Result: all 64 focused `RoomInput.test.ts`, 9 send-session controller tests, 6 extension tests, 5 reply-draft tests, 8 route-resolution tests, and 7 message-relation tests pass.

### Navigation and history

- Verify both confirmed and local ids open a new compact-overview thread and return an accepted ownership handoff.
- Verify classic mode, an existing route thread, and an existing effective thread suppress new-root navigation and return a declined ownership handoff.
- Verify unresolved local ids are excluded from recent-thread persistence.
- Verify local-to-confirmed canonicalization uses replacement rather than push.
- Verify canonicalization translates the stored exit target without nesting React Router's history wrapper.
- Verify replacement navigation moves the translated exit target from the dead local-route history key to the confirmed-route key.
- Verify browser Back returns to the original compact overview after a pre-ack open.
- Verify the explicit iOS exit path returns to the original overview before and after canonicalization.
- Result: the 35 focused `RoomView.test.ts`, 5 `threadNavigation.test.ts`, 5 `roomNavigateState.test.ts`, and 5 `useThreadRootEvent.test.ts` tests pass.

### SDK patch

- Verify chronological pending ordering creates the reply local echo without calling the invalid `getPendingEvents()` path.
- Verify detached ordering retains pending-target replacement.
- Verify an acknowledgement that wins the listener race triggers immediate association replacement.
- Verify a dependent send started after `Room.handleRemoteEcho` removed the transaction-map entry resolves the canonical live event through retained transaction metadata.
- Verify the real chronological SDK relations container indexes a pending reply under its local root before confirmation.
- Verify the pending reply is present in a provisional local-root thread before acknowledgement.
- Verify root canonicalization removes the child from the local aggregation, reaggregates it under the confirmed root, and moves it into the canonical thread before any remote echo or relation fetch.
- Verify the provisional thread is removed from Room re-emission and has detached room and timeline listeners after migration.
- Verify the child remains replay-owned and renderable after its own acknowledgement, after canonical fetch and pagination complete, and while app-cache hydration remains unresolved.
- Verify ordinary thread replies rewrite both `m.relates_to.event_id` and `m.in_reply_to.event_id`.
- Verify an explicit confirmed reply target remains unchanged while a different local thread root is rewritten.
- Verify distinct local relation and reply targets resolve independently in both confirmation orders.
- Verify redaction association replacement remains intact.
- Verify the existing one-argument `updateAssociatedId` behavior remains compatible.
- Verify lifted relation fields are rewritten after encryption and document the Rust encryption snapshot boundary that requires the composer release gate.
- Verify an evicted transaction target found only in a non-live loaded thread timeline rewrites to its canonical id before the dependent send reaches the wire.
- Verify the patch cleanly reverses and reapplies through the repository's existing patch-package workflow.
- Result: all 12 installed-SDK association tests pass, and both repository patches reverse and reapply successfully.

### Read receipts and pending rendering

- Verify `markThreadAsRead` performs neither `fetchRelations` nor `sendReceipt` for a local id.
- Verify loaded and fetched confirmed-thread receipt cases remain green.
- Verify pending status still reaches timeline messages, compact cards, pending-indicator helpers, and message-state suffix rendering.
- Verify terminal `NOT_SENT` is excluded from the pending clock set and reaches an accessible failed-send indicator on timeline messages and compact cards.
- Verify a pending local route renders its room-owned root without relation requests, thread cache writes, summary persistence, or thread-scoped focus persistence.
- Verify ordinary unhydrated confirmed routes retain their existing loading and cache-hydration behavior.
- Result: all 5 receipt tests pass, and the focused real-hook, timeline, compact-card, pending-indicator, and suffix tests pass.

### Durable event-id actions

- Verify a pending local root withholds hover and menu reactions, edit, copy-link, pin, delete, and report actions while preserving reply, reply-in-thread, read receipts, view source, copy text, and reaction inspection.
- Verify a confirmed event id exposes the durable actions.
- Verify an existing reaction chip remains visible, pressed, readable, and context-viewable while a local message target prevents toggling.
- Verify a current-user reaction with its own local id cannot be toggled off because that would redact the transient reaction id.
- Verify confirmed message and reaction ids retain their existing toggle behavior.
- Verify ArrowUp skips a pending local event and selects it only after its id is confirmed.
- Verify a pending-root editor cannot save before canonicalization in encrypted or unencrypted rooms even if the event id changes immediately after the blocked click.
- Verify rerendering the editor after confirmation enables save and emits an `m.replace` relation containing the live `$` id and no `~` id.
- Result: the 7 message-menu, 6 reaction, 2 editor, and 3 pending-timeline integration tests pass.

### Round 4 focused regression union

- Verify terminal failure remains timeline-owned and visibly failed under both promise-settlement orderings around the automatic route render.
- Verify pending and failed status are mutually exclusive on both the message timeline and compact card.
- Verify ArrowUp and every `MessageEditor` save boundary reject a local event id.
- Verify reply-draft and SDK association fallback resolve transaction metadata from non-live loaded thread timelines after transaction-map eviction.
- Verify the real thread render-state hook exposes the pending root without cache hydration.
- Verify the mounted pending route performs no relation reconciliation, thread cache write, summary publication, or thread-scoped focus persistence.
- Verify ordinary confirmed thread routes and existing send-session behavior remain unchanged.
- Result: the final independent focused union passes 13 files and 153 tests, and the second targeted re-review passes 8 files and 137 tests after the two half-refactor corrections.

### Round 5 focused regression union

- Verify an installed-SDK pending reply renders under the local route, migrates to the canonical aggregation and thread, survives child acknowledgement and completed SDK hydration, and does not retain provisional listeners.
- Verify the compact parent accepts ownership for confirmed and local roots while classic, active-route, and effective-thread contexts decline it.
- Verify compact navigation retains a terminal failed echo in both settlement orderings while a declined unchanged standalone root cancels before restoring its captured editor fragment.
- Result: the Round 5 focused union passes 5 files and 138 tests, and independent review approves both logical fixes.

### Combined and repository gates

- The Round 5 focused union passes 5 files and 138 tests.
- `npm run typecheck` passes.
- `npm test` passes on the final implementation with 428 files and 3,304 tests.
- `npm run build` passes for the production application, PWA service worker, and Element Call background verification.
- `npm run lint` passes with zero errors and 17 pre-existing warnings.
- The Round 5 touched files pass focused formatting and lint checks.
- `git diff --check` passes.
- Patch-package reverse and clean reapplication pass for `@tanstack/virtual-core@3.17.3` and `matrix-js-sdk@41.7.0`.
- Independent Round 5 implementation reviews approve both logical fixes after their first-pass findings were resolved.
- The pre-existing `SettingsModalRenderer.test.ts` load-sensitive flake noted by the Round 4 reviewer did not reproduce in either final full-suite run and was not changed.

## Live throttled-browser acceptance script

1. Open a compact Simple Mode room overview in a mobile-sized viewport and enable Chrome DevTools Slow 3G throttling.
2. Hold or heavily delay the Matrix send request so its promise remains unresolved.
3. Type a new room-level message and press Enter once.
4. Before releasing the request, verify the composer is empty, the URL contains the new `~${roomId}:${txnId}` thread id, the new thread is open, and the submitted message is visible.
5. Verify the pending clock appears on the timeline message and nowhere in the composer or its context banner.
6. Navigate back and verify the pending root card appears immediately in the room overview without waiting for acknowledgement.
7. Return to the pending thread in an unencrypted room, send a follow-up reply before the root settles, and verify it clears immediately, renders as a second local echo, and does not throw.
8. Release only the root request, keep the reply and thread hydration requests delayed, and verify the route canonicalizes while both the root and reply remain visible in the canonical thread.
9. Inspect the eventual follow-up request and verify neither relation target contains a `~` id, then release the reply and hydration requests and verify each local id canonicalizes to one `$` event with no blank interval, duplicate message, duplicate navigation, or pending clock.
10. Verify URL canonicalization replaces the local entry and browser Back returns to the original overview without an extra history entry.
11. Repeat the exit check through the explicit close or back control in iOS standalone mode before and after acknowledgement.
12. While the local route is open, verify no relation fetch or read receipt is sent with a `~` thread id and no thread cache, summary, or opened-thread metadata is written for that id.
13. Open the pending root menu and verify reaction, edit, copy-link, pin, delete, and report actions are absent while reply, reply-in-thread, read receipts, view source, copy text, and reaction inspection remain available.
14. Verify existing reaction chips on the pending root remain visible and inspectable but cannot be added, removed, or toggled until both target ids are confirmed.
15. Repeat in an encrypted room and verify Enter retains a related draft while the target is local, then press Enter after canonicalization and verify the encrypted request contains only the confirmed `$` target.
16. With an empty composer while the root is local, press ArrowUp in both encrypted and unencrypted rooms and verify no editor opens, then confirm the root, press ArrowUp again, and verify Save emits one `m.replace` relation containing only the `$` id.
17. While that encrypted root is local, try attachment-only, caption-plus-attachment, and voice sends and verify no related event reaches the wire, the attachment board or caption remains owned by its composer surface, and voice remains retryable.
18. After the root canonicalizes, retry each captured surface and verify every relation and reply fallback uses the confirmed `$` id.
19. Capture an explicit reply draft against a pending event, wait through its sync echo, and verify the draft remains selected but sends with the canonical event and thread ids.
20. Repeat the voice case with the upload request delayed, let the root canonicalize during upload, and verify the final send rebuilds its relation from the live context.
21. In one auto-navigated root case, force terminal rejection before the route render and verify the root remains timeline-owned, the composer stays empty, and the event shows the red failed-send indicator with no pending clock or delivered appearance.
22. Repeat with terminal rejection after the local route has rendered, navigate back, and verify the same failed indicator appears on the compact card with no composer injection or retry and cancel controls.
23. In a non-auto-navigation standalone-root context with no child and an otherwise untouched owner, reject the send and verify the failed echo disappears and the original structured content returns once.
24. Repeat that unpublished case after typing newer text, selecting an unrelated reply, entering another thread, and changing rooms, and verify the failed root remains timeline-owned without clearing, navigation, cancellation, or composer injection.
25. Send two unpublished standalone roots before either settles, reject them in FIFO order, and verify the older root remains timeline-owned while only the newest unchanged root may return to the composer.
26. Repeat the two-root rejection in reverse order and verify the same ownership result.
27. In a root-plus-local-reply case, leave the thread before both requests reject and verify both `NOT_SENT` events remain timeline-owned with no composer restoration or orphaned reply.
28. Restore the network and retry the restored standalone text from the overview, then verify it creates one new transaction and one local echo through the normal path.
29. Regression-check a reply in an already confirmed thread, an explicit reply, a sticker, command execution, compact mode, and classic mode.
30. Inspect the transient local-root thread header and verify it upgrades cleanly when the confirmed event arrives.

The live script is documented for manual acceptance and was not executed because this worktree does not include a live Matrix test account or a controllable send endpoint.

## Plan alignment and deviations

There is no deviation from the final Round 5 mandate.

Relative to the original implementation plan, review-required fixes add the existing attachment-session controller, reply-draft resolver, shared relation and route utilities, navigation persistence owner, and SDK thread migration lifecycle.

Those additions do not change attachment or voice product semantics; they apply the same local-target safety invariant at the send boundaries that already own those paths.

Required independent review tightened one literal terminal-failure example: a root with an SDK-tracked local child remains timeline-owned instead of being cancelled and restored, because cancelling it would orphan the child.

Round 2 further tightened that same single-owner requirement so newer content or any room, thread, or reply-context change leaves the failed event timeline-owned instead of transferring it into a composer it no longer owns.

Round 3 adds only confirmed-id gates at the action and encrypted-editor boundaries and reuses the existing shared predicate without adding state, queues, retry UI, or a new abstraction.

Round 4 makes the automatically published root explicitly timeline-owned, adds a message-owned terminal-failure indicator without retry or cancel controls, closes the ArrowUp editor entry point, searches existing loaded SDK timelines, and suppresses pending-route durable side effects without adding state or a new lifecycle.

Round 5 makes pending reply ownership explicit across provisional and canonical SDK threads and makes the application navigation handoff an explicit boolean contract without adding a store, queue, or retry surface.

The terminal failure choice is the minimal single-owner option: once Simple Mode receives the local root id, the timeline owns both content and failure state.

Restoring that same content into the routed composer would create two owners and risks cross-thread injection, so the existing failed event remains visible while retry and cancel controls stay in a follow-up ticket.

The implementation uses one component-local generation ref and the existing SDK relations container, with no store, queue, retry row, locale, dependency framework, or encrypted-send refactor.

The PLAN-defined encrypted-send release gate was used exactly after the real Rust encryption snapshot test demonstrated that in-flight clear-content mutation cannot safely change the encrypted request.

`threadOpenSdkBootstrap.ts` and all CINNY-122 thread-creation logic remain untouched.
