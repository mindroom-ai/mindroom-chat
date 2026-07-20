# CINNY-126 implementation plan — Codex

## Scope and target outcome

This is an implementation plan only, and no product code is changed by this planning task.

The implementation must first prove the failure with the exact incident payload and cadence, then fix only the owning path demonstrated by that reproduction.

The existing uncommitted `package-lock.json` and `.envrc` changes are unrelated user work and must remain untouched.

The Runbook section in `FORK_CHANGES.md` must be updated after every implementation step with the current evidence, status, validation, and next action.

## Evidence established before implementation

### Exact trace contract

The three supplied artifacts are the authoritative source, with no inferred event shapes.

- `edit-events-full.json` has SHA-256 `2834620072ae2ec92c9566e53f9dccc048fa8775c14616be0b3e374d15a0ede6`.
- `incident-core-events.json` has SHA-256 `65cbcd390bfaac8679240854e57cb9c979045df4d273f490d5eaeb3c1a44f2be`.
- `incident-window-all-events.json` has SHA-256 `a0f41c772c3ee221943244daeca1de5c45e926ef7ce1c714b37574a3e327f4b6`.

The incident stimulus is a voice reply, a transcription, a `Thinking...` thread placeholder, 17 replacements, two room-state tag events, and one in-thread summary event.

The placeholder is `m.room.message` with `msgtype: "m.text"`, `io.mindroom.stream_status: "pending"`, an `m.thread` relation to the root, and `m.in_reply_to` pointing to the voice event.

The first 16 replacements are `m.room.message` events whose outer content and `m.new_content` both use `msgtype: "m.notice"` and `io.mindroom.stream_status: "streaming"`.

The seventeenth replacement has `msgtype: "m.text"` and `io.mindroom.stream_status: "completed"` in both locations.

Every replacement targets the one placeholder with `m.relates_to.rel_type: "m.replace"`.

The final `m.new_content.body` is 1,466 characters, while the replacement wrapper body is 1,468 characters because it has the required `* ` prefix.

The first replacement arrives 14,789 ms after the placeholder.

The subsequent replacement deltas are exactly `160, 777, 158, 782, 162, 788, 944, 1983, 166, 164, 164, 1302, 174, 1236, 316, 188` ms.

The 17 replacements therefore span 9,464 ms.

The first tag follows the final replacement by 3,239 ms, the second tag follows by 1,195 ms, and the summary follows by 758 ms.

The tags are room state of type `com.mindroom.thread.tags` with canonical JSON-array state keys.

The summary is an in-thread `m.notice` carrying `io.mindroom.thread_summary`, and its reply target is the final replacement.

### Build and prior-fix history

The reported build commit is `64c7773fb2730b01967312f8185528610aae9de3` from 2026-07-19.

`git merge-base --is-ancestor` proves that CINNY-122 commit `08118f7b`, CINNY-121 commit `960a4149`, and initial iOS flight-recorder commit `8e910aa4` are all ancestors of `64c7773f`.

The repository labels the initial recorder work CINNY-124, although the requested secondary deliverable describes it as CINNY-125-adjacent.

The later opt-in deep trace at `0b325652` was not in the incident build.

CINNY-122 created an SDK `Thread` before an owner sent the first reply into a zero-reply thread and repaired local-echo routing.

CINNY-126 is not that shape because the server-delivered placeholder is already an ordinary reply in an existing thread and the missing user-visible body exists only in its replacements.

The relevant `threadUtils.ts` preview code is byte-for-byte unchanged between `64c7773f` and the current head.

### Current room-overview data flow

The in-room compact overview flows from `MindroomRoomTimeline.tsx` through `useThreadOverviewRefreshCounter`, `useMindroomThreadIndex`, `buildThreadRecord`, `resolveThreadPresentationSnapshot`, and `getVisibleThreadEventBodyPreviewText` before `CompactThreadCard` renders the preview.

The persistent cross-room Threads index in `cross-room-threads/useCrossRoomThreadIndex.ts` correctly dirties a containing thread for an `m.replace`, then `buildCrossRoomThreadIndexEntry` uses the same `buildThreadRecord` and `resolveThreadPresentationSnapshot` path.

`shouldRefreshOverviewForTimelineEvent` and `getThreadCacheTargetId` already resolve a replacement target back to the containing thread and cause the in-room overview memo chain to rebuild.

`useCrossRoomThreadIndex` already handles direct thread replies, replacement targets, reverse event-to-thread lookup, thread events, room timeline events, and decrypted events.

The shared defect is in `src/app/mindroom/threads/threadUtils.ts:getVisibleThreadEventBodyPreviewText`, which passes the logical event's original `getContent()` directly to `getThreadMessagePreviewText`.

For the incident placeholder, that helper can therefore return only `Thinking...` even after the SDK has attached the final replacement.

The open-thread renderer in `MindroomRoomTimeline.tsx` instead calls `getEditedEvent` and `getLatestMessageContent`, so entering the thread can reveal the final body without the overview ever having previewed it.

The compact root preview helper in `compactThreadRootData.ts` also resolves replacements, but it handles edited thread roots and does not fix an edited nested reply such as this placeholder.

There is no current room-list `LatestMessage` preview component to patch.

`RoomNavItem.tsx` renders the room name, typing state, and unread badge, while `useRoomLatestRenderedEvent.ts` is used for following/read behavior rather than a room-list text preview.

### `m.notice`, badges, tags, and summaries

`isVisibleThreadReplyEvent` filters on the Matrix event envelope type and deliberately does not filter on `content.msgtype`, so `m.notice` replacement content is eligible for a preview once the replacement is resolved.

`getThreadMessagePreviewText` accepts text bodies regardless of `m.text` versus `m.notice`.

`compactThreadRootData.ts:isZeroReplyStandaloneThreadRootEvent` rejects standalone `m.notice` roots, but that special root-only rule is irrelevant to an `m.replace` of a nested `m.text` placeholder.

`src/app/utils/room.ts:isNotificationEvent` deliberately rejects every `m.replace`, which prevents 17 edits from producing 17 unread increments.

The original `m.text` placeholder remains the logical notification event, and the later summary may be another logical event according to the server push rules.

The fix must not make replacement events independently increment room or thread unread counts.

Tag state should already update the overview through `useRoomThreadResolutionMap`, `useStateEvents`, and `useRoomState`, whose `RoomStateEvent.Events` listener rebuilds state.

Summary state should already update from the room-view branch of `roomLiveRenderController.ts`, which recognizes `m.notice` plus `io.mindroom.thread_summary` and publishes through `threadSummaryState`.

The exact replay must verify those expectations instead of adding speculative tag or summary refresh code.

## Deliverable 0: deterministic exact-trace replay

### Files to add

- Add `e2e/fixtures/cinny126-exact-trace.json` as the portable replay fixture.
- Add `scripts/replay-cinny-126.mjs` as the manual browser and iOS driver using Node's built-in `fetch` and raw Matrix Client-Server API calls.
- Add `e2e/live/cinny126-overview-streamed-edit.spec.ts` as the automated desktop regression using the same fixture and existing helpers from `e2e/helpers/matrix.ts`.

Export the preparation and replay functions from the CLI module and import them in the Playwright spec so manual and automated runs cannot diverge in payload rewriting or timing.

The fixture must be produced mechanically from the three authoritative artifacts and record their hashes.

The fixture must preserve every content field from the voice event, transcription, placeholder, all 17 replacements, both tags, and the summary.

The only rewritten values may be relation targets and canonical tag state keys that must refer to newly returned test event IDs.

The homeserver must assign fresh `event_id`, `sender`, `origin_server_ts`, `unsigned`, and transaction IDs because clients cannot replay those server-assigned envelope fields.

The fixture must store the original event IDs as provenance only and must store exact relative delays so replay does not depend on wall-clock timestamps.

The script must fail before sending if the fixture does not contain one pending `m.text` placeholder, exactly 16 streaming `m.notice` edits, exactly one completed `m.text` edit, or the exact delay vector above.

The script must also verify that every edit has the exact outer body and exact `m.new_content` body from the fixture rather than regenerating wrappers from prose.

### Accounts and room setup

Use two disposable accounts so sender-versus-observer unread behavior is real.

Accept `CINNY126_OBSERVER_TOKEN` and `CINNY126_SENDER_TOKEN`, call `/account/whoami` for their user IDs, default the homeserver to `https://mindroom.chat`, and never print either token.

The observer account creates a private test room, invites the sender, grants the sender the power needed for the custom tag state, and sends a fresh synthetic thread root.

The script prints the room ID, root ID, room name, and the room-overview URL, then waits for Enter unless a noninteractive delay option was supplied.

That pause lets the browser or iOS client log in as the observer, open the room in compact overview mode, confirm there is no `threadId` query parameter, and remain foreground.

After the pause, the observer token sends the exact voice content with the new root relation, the sender token sends the exact transcription 3,994 ms later, and the sender sends the exact placeholder 254 ms after that.

The sender waits 14,789 ms, sends the 17 exact replacements with their recorded deltas, sends the two exact tag states with a dynamically rewritten canonical root state key, and sends the exact summary related to the new root and new final-edit ID.

Each request uses `PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}`, while tags use `PUT /_matrix/client/v3/rooms/{roomId}/state/com.mindroom.thread.tags/{stateKey}`.

The script prints a timestamped phase line and the returned event ID after each logical send without printing message bodies or credentials.

An optional `--speed` flag may aid diagnosis, but acceptance evidence must use `--speed 1`.

An optional existing-room mode may accept `--room-id` and `--root-id`, but the default must create an isolated room so prior receipts, summaries, tags, and cache state cannot contaminate the result.

### Desktop browser procedure

Run dev Cinny locally and point it at `https://mindroom.chat` with the normal MindRoom E2E tunnel or configuration.

Log the client under test in as the observer, open the generated room, select compact overview mode, clear all filters, and do not enter the generated thread.

Start the replay only after the overview card or standalone root is visible.

Capture a Playwright trace, video, screenshots at the placeholder and final phases, the room-nav unread count, and the compact card's text, metadata, and attention state.

After all events have arrived, inspect the global Threads page, return to the room overview, and enter the thread once without reloading.

Run the automated spec with both primary and secondary E2E credentials through `npm run test:e2e:mindroom -- e2e/live/cinny126-overview-streamed-edit.spec.ts`.

### iOS Capacitor procedure

Install the incident source build at `64c7773f`, then repeat with a diagnostics-only build and the eventual fixed build.

Use the same homeserver, disposable room, observer account, sender account, fixture, and `--speed 1` script from a workstation.

On the phone, disable auto-lock for the run, keep the Capacitor app foreground, open the generated room's compact overview, and confirm the thread is not open before releasing the script's prompt.

Screen-record from before the prompt until after a single thread entry, then export on-device diagnostics from Settings → About for the diagnostics-only and fixed builds.

The fixed-build run must not require pull-to-refresh, route changes, backgrounding, app restart, or a second thread entry.

### Required observations

The placeholder passes when the generated thread appears or updates in the room overview and its card preview becomes `Thinking...` while the route remains the overview.

Streaming passes when the card enters streaming state and later replacements can update its preview even though their `msgtype` is `m.notice`.

Completion passes when the card leaves streaming state and its preview contains `Take the 1:00 PM slot. The math:` after preview markdown normalization and any sender-name prefix.

Unread passes when the room and thread show unread state for logical incoming messages, the badge does not disappear during the stream, and the 17 edit-only arrivals do not create 17 increments.

Thread-list freshness passes when the generated thread is present in the room overview and global Threads list, sorted as recent, and both surfaces show the final preview.

Metadata freshness passes when `anniversary-planning`, `schedule-coordination`, and the exact generated summary appear on the overview before the thread is clicked.

Entry passes when one click opens the thread and the placeholder row immediately renders the complete 1,466-character final body with completed state and the banner shows the same summary, without reload or re-entry.

Any preview remaining `Thinking...`, blank, or stale after the final edit is a failure.

Any tag or summary that first appears only after entry is a failure.

Any absent thread, absent unread indication, missing completed content, manual-refresh dependency, or second-entry dependency is a failure.

The automated spec should observe intermediate state without inserting waits between edit sends, because modifying the 160 ms bursts would invalidate the production cadence being tested.

## Root-cause confirmation gate

Run the exact replay before changing the preview helper and retain the red evidence from current head and `64c7773f`.

For each replacement, confirm whether the client receives `ClientEvent.Event`, whether `RoomEvent.Timeline` fires, whether `getThreadCacheTargetId` resolves the root, and whether the overview refresh counter advances.

After the final replacement, compare the placeholder's raw content, `placeholder.replacingEvent()`, any serialized `unsigned.m.relations.m.replace`, the thread event collection, and `resolveThreadPresentationSnapshot(...).latestReplyPreviewText`.

The expected primary finding is that the final replacement is attached to the placeholder and refresh invalidation runs, while the shared presentation snapshot still says `Thinking...`.

If events and edits are received but `replacingEvent()` and the serialized replacement are both absent, stop and investigate relation attachment in matrix-js-sdk 41.7 plus `eventCacheEditUtils.ts`, `eventRevision.ts`, and `eventRepository.ts` before changing presentation.

If replacement attachment exists but `shouldRefreshOverviewForTimelineEvent` is false, constrain the fix to `getThreadCacheTargetId` or `threadOverviewRefreshCounter.ts` and add the exact missing-target regression there.

If the iOS recorder shows no sync batches for the incident room while the app is foreground, treat this as a Matrix receive/lifecycle defect and investigate `src/client/initMatrix.ts:startClient`, `ClientRoot.tsx` sync-state handling, and Capacitor lifecycle state before claiming the preview fix resolves iOS.

If edit batches are received and presentation updates but tag state does not, constrain that repair to `useRoomState.ts` and `useRoomThreadTags.ts` with the exact canonical state key.

If the summary is received but not published, constrain that repair to the room-view branch of `roomLiveRenderController.ts` and `threadSummaryState.ts`.

Do not combine those conditional repairs, because the replay and recorder must identify which boundary actually fails.

## Primary fix shape

Change only `src/app/mindroom/threads/threadUtils.ts:getVisibleThreadEventBodyPreviewText` for the expected primary finding.

Select the newest valid replacement from `event.replacingEvent()` and `getSerializedReplacementEvent(event)` with the existing `getLatestEdit` ordering and `isSameSenderEditEvent` guard.

Pass the logical event and selected replacement to `getLatestMessageContent`, then pass that effective content to `getThreadMessagePreviewText`.

This uses the same sender validation, redaction handling, timestamp ordering, event-ID tie break, metadata fallback behavior, and `m.new_content` unwrapping already used elsewhere in the fork.

The shared change updates in-room compact cards, the cross-room Threads index, cached presentation snapshots, and recent-thread consumers without adding parallel replacement logic to each caller.

Do not change `isVisibleThreadReplyEvent`, `getThreadMessagePreviewText`, `isNotificationEvent`, `compactThreadRootData`, or unread counters for the expected finding.

Do not add relation fetches per edit, because live SDK aggregation and existing overview invalidation already provide the replacement and per-edit network fetching would amplify the 160 ms bursts.

Do not render standalone `m.replace` events as messages, because the placeholder remains the one logical timeline row.

Do not alter thread activity ordering merely because an edit arrived unless the exact replay proves ordering is separately wrong.

## Secondary deliverable: lightweight iOS sync/receive flight event

### Event contract

Extend `src/app/mindroom/diagnostics/flightRecorder.ts` with a backward-compatible event variant named `matrix_sync`.

Each stored event represents one room within one completed sync batch and contains only `at`, `type`, `roomId`, `eventCount`, `editCount`, `route`, and `hasThreadId`.

Use one record per room per batch because a single sync response may contain several room IDs while the requested record has one room ID.

Count room-scoped events emitted through `ClientEvent.Event`, deduplicate repeated emissions by event ID within the batch, and count edits when the relation type is `m.replace`.

Ignore presence, to-device, and account-data events that have no room ID.

Flush accumulated room counts only on `ClientEvent.Sync` with `SyncState.Syncing`, because matrix-js-sdk emits `SYNCING → SYNCING` after every successfully processed `/sync` response.

Do not flush on the preceding first-batch `Prepared` event, which would duplicate the same batch.

Record the route at flush time with `classifyFlightRecorderRoute`, including `hasThreadId` so an overview can be distinguished from an open thread.

Do not store event IDs, senders, bodies, formatted bodies, errors, URLs, tokens, state keys, or relation targets.

The raw Matrix room ID is an intentional privacy expansion required by this issue and must be called out explicitly in the Runbook and diagnostics review.

Keep `FLIGHT_RECORDER_MAX_EVENTS` and `FLIGHT_RECORDER_MAX_JSON_CHARS` unchanged unless a measured exact-trace run exceeds them.

Keep the v1 storage keys and schema number because the new union member is additive and the validator can continue to accept previously stored v1 sessions without migration or loss of retained abnormal evidence.

### Files and lifecycle

Add `src/app/mindroom/diagnostics/matrixSyncFlightRecorder.ts` to own batch accumulation and Matrix listener cleanup.

Expose a tiny `recordFlightRecorderMatrixSyncBatch` entry point and active-runtime predicate from `flightRecorder.ts`, with the same fail-closed no-op behavior as the existing voice and action recorders.

Append all per-room records and flush localStorage once per sync batch rather than once per room, so a large initial sync does not turn the recorder into a synchronous write storm.

Call `installMatrixSyncFlightRecorder(mx)` in `src/client/initMatrix.ts:startClient` immediately before the authenticated main client's `mx.startClient()` call.

Do not install from `matrixClientFactory.ts`, because that would instrument login, authentication-flow, and refresh-only clients.

Make installation idempotent per client with a `WeakMap`, and remove `ClientEvent.Event` and `ClientEvent.Sync` listeners when the sync state becomes `Stopped` or the returned disposer is called.

An absent or disabled flight-recorder runtime must make installation a no-op on desktop and non-iOS clients.

One exact replay should produce room records whose summed `editCount` is 17, even if the homeserver distributes the edits across several sync batches.

## Regression tests

### Focused unit and integration coverage

Extend `src/app/mindroom/threads/threadUtils.test.ts` with real `MatrixEvent` instances from the checked-in fixture.

Apply all 17 replacements sequentially and prove that each streaming `m.notice` can supply preview text, the final preview is normalized from the exact completed body, and the logical event count remains one.

Add same-sender, foreign-sender, redacted replacement, stale SDK replacement, and newer serialized replacement cases around the replacement selection.

Extend `src/app/mindroom/threads/threadPresentation.test.ts` to prove that a placeholder with the final exact replacement produces the completed `latestReplyPreviewText` while the later thread-summary event remains title metadata rather than replacing the ordinary reply preview.

Extend `src/app/mindroom/threads/threadOverviewRefreshCounter.test.ts` or its focused behavioral successor to prove that replacement events targeting a threaded reply invalidate the overview while the route has no thread ID.

Extend `src/app/mindroom/cross-room-threads/__tests__/crossRoomThreadIndex.test.ts` and `useCrossRoomThreadIndex.test.ts` to prove an incoming replacement dirties only its containing entry and rebuilds it with the completed preview.

Keep this behavior out of the already large `RoomTimeline` test files, in accordance with the repository testing guidance.

Extend `src/app/mindroom/diagnostics/flightRecorder.test.ts` for strict validation, bounded serialization, old-v1 session compatibility, invalid room/count rejection, and export retention of `matrix_sync`.

Add `src/app/mindroom/diagnostics/matrixSyncFlightRecorder.test.ts` for multi-room batching with one persistence flush, event-ID deduplication, exact edit counts, `Prepared` non-flush, repeated `Syncing` batches, current-route capture, disabled-runtime no-op, idempotent install, and listener cleanup on `Stopped`.

Add a focused `src/client/initMatrix.test.ts` contract proving only `startClient` installs the main-client recorder before sync starts.

Extend `e2e/cinny124-flight-recorder.spec.ts` to export a seeded `matrix_sync` record and verify that the room ID and counts survive the ordinary browser simulation.

### Live exact-trace regression

The Playwright spec must create its own private two-account room and run at recorded speed while the observer page remains on `/home/{roomId}` without `threadId`.

It must assert the final compact-card preview, streaming-to-completed transition, tags, summary, unread stability across edits, cross-room Threads preview, and first-entry completed content without reload.

Retain Playwright video, screenshot, trace, generated room ID, placeholder ID, final edit ID, and exported iOS diagnostic JSON as regression evidence.

Run the same script manually against the incident build, the diagnostics-only build, and the fixed iOS build so the final report distinguishes receive, aggregation, and rendering behavior.

## Implementation and validation order

1. Add the fixture, CLI replay, and red Playwright regression, document the exact baseline in `FORK_CHANGES.md`, obtain an independent review, and commit the reproduction separately.
2. Add the flight-recorder event and listener owner, validate and review it independently, deploy a diagnostics-only iOS build, and capture whether the exact trace reaches the foreground overview.
3. Confirm the root-cause gate from the replay and recorder, then make the one shared preview-helper fix or the single conditional owning-boundary fix proven by evidence.
4. Add the focused presentation and cross-room regressions in the same logical fix commit, then independently review the diff for replacement ordering, unread semantics, privacy, listener ownership, and half-refactors.
5. Run the exact desktop and iOS acceptance matrix, update the Runbook with actual results rather than planned claims, and retain the evidence locations.
6. Run focused Vitest suites, `npm test`, `npm run typecheck`, `npm run build`, `npm run check:eslint`, touched-file Prettier, the exact Playwright spec, and `git diff --check`.
7. Open the pull request ready for review, wait for every AI reviewer to finish, validate each finding, fix every confirmed issue, rerun proportional validation, and obtain final independent re-review before completion.

## Completion criteria

CINNY-126 is complete only when the exact trace is red on the affected baseline, green on desktop and physical iOS after the fix, and the exported recorder proves what the iOS client received while it remained on the overview.

The final implementation must show the completed reply in every shared preview surface, preserve one logical placeholder/reply row without 17 edit notifications, show tags and summary before entry, and render the completed body on the first thread entry without refresh.

If the recorder proves the iOS client did not receive sync batches, the issue is not complete with a presentation-only patch and must remain open for the evidenced sync/lifecycle repair.
