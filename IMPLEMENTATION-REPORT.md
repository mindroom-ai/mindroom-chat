# CINNY-094 Implementation Report

## Summary

Implemented rendering-only support for `com.mindroom.message_extras` on text-family room timeline messages. Normal body rendering stays on the existing Cinny paths, with optional extras inserted after the body and before URL previews. Invalid extras parse to `null` and do not affect body rendering.

## Rebase onto current dev

- Safety branch: `cinny-089-message-extras-pre-rebase-b24f5598` preserves reviewed SHA `b24f5598`.
- Rebase method: conflict-repair squash onto current local `dev` at `5f9f326a` (`Fix mounted thread streaming completion refresh`). The originally supplied `dev` SHA was `0ac0b7d2`, but local `dev` advanced before the clean replay was built.
- New final SHA: recorded in the final handoff after commit creation (`git rev-parse HEAD`); a commit cannot embed its own final hash.
- Clean diff sanity result: `dev...HEAD` is limited to message-extras parser/renderer/tests, MindRoom render seam integration, long-text sidecar metadata/extras handling, room/thread collapse behavior, focused tests, and docs/reports. It does not include unrelated ThemeManager, nativeSso, React Query devtools, iOS edge-swipe, or theme bootstrap files.
- Validation after conflict-repair replay:
  - `npm test -- src/app/components/message/mindroomMessageExtras.test.ts src/app/components/message/MindroomMessageExtras.test.ts src/app/mindroom/messages/longText.test.ts src/app/mindroom/messages/MindroomLongTextText.test.ts src/app/mindroom/messages/renderMindroomMessageContent.test.ts src/app/mindroom/messages/__tests__/RenderMessageContent.test.ts src/app/mindroom/threads/__tests__/RoomTimelineCollapsible.test.ts src/app/utils/room.test.ts` passed (`8/8` files, `88/88` tests).
  - `npm run typecheck` passed.
  - `npm run build` passed with the existing Vite CJS/runtime-config/sourcemap and chunk-size warnings.
  - `git diff --check` passed.
  - `npm test` and `npm test -- --no-file-parallelism` both failed only in current-dev baseline `src/app/mindroom/threads/compactThreadCardViewModel.test.ts`, expecting `scheduledTaskLabel` to be `2 pending scheduled tasks` while receiving `undefined`. The same isolated file fails on `/var/www/cinny` `dev` at `5f9f326a`, so this is not introduced by CINNY-095.

## Review round 1 fix

- Fixed `MindroomMessageExtras` disclosure keys so they use section index, parsed title, and content type only. Keys no longer include mutable section content or the collapsed/default-open value, so streaming `m.replace` edits do not remount the same logical native `<details>` node.
- Added a regression test that toggles the native disclosure, rerenders with changed content and changed collapsed defaults, and verifies the same DOM node preserves the user-toggled open/closed state while its content updates.
- Removed the accidental untracked `REVIEW.md` from the implementation worktree.

## Review round 2 fix

- Fixed the long-text post-body extras precedence so live event content is the preferred extras source, with hydrated sidecar content used only as fallback. Hydrated body rendering still uses `resolvedContent`.
- Added a regression test for the stale-cache case: hydrated/resolved long-text extras E1 remain cached, the event rerenders with live extras E2 and unchanged long-text identity, hydration does not restart, and E2 renders.

## Review round 3 fix

- Fixed the remaining long-text edit gap by giving the post-body extras renderer the merged top-level event content before hydrated sidecar fallback. Raw `m.new_content` still wins when it explicitly carries extras, but edits that omit extras now see the metadata preserved by `getLatestMessageContent`.
- Disabled the generic outer long-message collapse for messages with valid MindRoom extras by routing those messages through the existing `always-expanded` collapse mode. This keeps extras summaries discoverable and expanded details usable without a timeline refactor.
- Added focused regressions for a long-text edit whose raw `m.new_content` omits extras while merged content preserves them, and for the collapse-mode behavior on messages with valid extras.

## Review round 4 fix

- Added a narrow hydrated-sidecar extras signal from `RenderMessageContent` to `RoomTimeline` for long-text messages whose extras render only from the hydrated fallback source.
- `RoomTimeline` now tracks the current event id plus long-text `mxc://` URI for those hydrated extras and folds that key into `getCollapsibleMessageMode`, so the outer `CollapsibleMessage` upgrades to `always-expanded` after hydration instead of staying default-clamped.
- Added regressions for the sidecar-only source: one verifies the render-content callback fires only when hydrated fallback extras render, and one verifies the timeline collapse mode upgrades to `always-expanded`.

## Review round 5 fix

- Fixed hydrated long-text sidecar edit wrappers so `m.new_content` normalization preserves missing wrapper metadata under the same `m.mentions` / `io.mindroom.*` / `com.mindroom.*` policy used by normal edit resolution.
- Added a hydration regression proving wrapper-level `com.mindroom.message_extras` survives when hydrated `m.new_content` omits it.
- Added sidecar-only edit-wrapper render/collapse coverage proving extras render from the hydrated fallback and the outer timeline collapse mode upgrades to `always-expanded`.

## Files changed

- `src/app/components/message/mindroomMessageExtras.ts`
- `src/app/components/message/MindroomMessageExtras.tsx`
- `src/app/components/message/MindroomMessageExtras.css.ts`
- `src/app/components/message/MsgTypeRenderers.tsx`
- `src/app/mindroom/messages/longText.ts`
- `src/app/mindroom/messages/longText.test.ts`
- `src/app/mindroom/messages/MindroomLongTextText.tsx`
- `src/app/mindroom/messages/MindroomLongTextText.test.ts`
- `src/app/mindroom/messages/renderMindroomMessageContent.tsx`
- `src/app/mindroom/messages/renderMindroomMessageContent.test.ts`
- `src/app/components/RenderMessageContent.tsx`
- `src/app/features/room/RoomTimeline.tsx`
- `src/app/components/message/mindroomMessageExtras.test.ts`
- `src/app/components/message/MindroomMessageExtras.test.ts`
- `src/app/mindroom/threads/threadCollapsibleMessages.ts`
- `src/app/mindroom/threads/__tests__/RoomTimelineCollapsible.test.ts`
- `src/app/mindroom/messages/__tests__/RenderMessageContent.test.ts`
- `src/app/utils/room.test.ts`
- `FORK_CHANGES.md`
- `IMPLEMENTATION-REPORT.md`

## Tests run and results

- Review round 5 fix validation:
  - `npm test -- src/app/components/message/mindroomMessageExtras.test.ts src/app/components/message/MindroomMessageExtras.test.ts src/app/components/message/mindroomLongText.test.ts src/app/components/message/MindroomLongTextText.test.ts src/app/components/RenderMessageContent.test.ts src/app/features/room/RoomTimelineCollapsible.test.ts src/app/utils/room.test.ts` passed (`84/84` tests).
  - `npm run typecheck` passed.
  - `npm run build` passed with the existing Vite CJS/runtime-config/sourcemap and chunk-size warnings.
  - `npm test -- --no-file-parallelism` passed (`177/177` files, `1576/1576` tests).
  - Default parallel `npm test` was attempted twice and hit unrelated long React renderer suite timeouts under worker load; the failed files passed when isolated or in the serial full-suite run above.
  - Targeted `npx eslint` on touched source/test files passed with no output.
  - `git diff --check` passed.
- Review round 4 fix validation:
  - `npm test -- src/app/components/RenderMessageContent.test.ts src/app/features/room/RoomTimelineCollapsible.test.ts` passed (`19/19` tests).
  - `npm test -- src/app/components/message/mindroomMessageExtras.test.ts src/app/components/message/MindroomMessageExtras.test.ts src/app/components/message/MindroomLongTextText.test.ts src/app/components/RenderMessageContent.test.ts src/app/features/room/RoomTimelineCollapsible.test.ts src/app/utils/room.test.ts` passed (`66/66` tests).
  - `npm run typecheck` passed.
  - `npm run build` passed with the existing Vite CJS/runtime-config/sourcemap and chunk-size warnings.
  - `npm test` passed (`177/177` files, `1573/1573` tests).
  - Targeted `npx eslint` on touched files passed with `0` errors and the existing `RoomTimeline.tsx` warning baseline (`9` warnings).
  - `git diff --check` passed.
- Review round 3 fix validation:
  - `npm test -- src/app/components/RenderMessageContent.test.ts src/app/features/room/RoomTimelineCollapsible.test.ts` passed (`17/17` tests).
  - `npm test -- src/app/components/message/mindroomMessageExtras.test.ts` passed (`21/21` tests across parser and renderer tests loaded by Vitest).
  - `npm run typecheck` passed.
  - `npm run build` passed with the existing Vite CJS/runtime-config and chunk-size warnings.
  - `npm test` passed (`177/177` files, `1571/1571` tests).
  - `git diff --check` passed.
  - Targeted `npx eslint` on touched files passed with `0` errors and the existing `RoomTimeline.tsx` warning baseline (`9` warnings).
- Review round 2 fix validation:
  - `npm test -- src/app/components/message/MindroomLongTextText.test.ts` passed (`14/14` tests).
  - `npm test -- src/app/components/message/mindroomMessageExtras.test.ts src/app/components/message/MindroomMessageExtras.test.ts src/app/components/message/MindroomLongTextText.test.ts src/app/components/RenderMessageContent.test.ts src/app/utils/room.test.ts` passed (`54/54` tests).
  - `npm run typecheck` passed.
  - `npm run build` passed.
  - `npm test` passed (`177/177` files, `1569/1569` tests).
  - `npx eslint src/app/components/message/MindroomLongTextText.tsx src/app/components/message/MindroomLongTextText.test.ts` passed with the existing `react-hooks/exhaustive-deps` warning in `MindroomLongTextText.tsx`.
  - `git diff --check` passed.
- Review round 1 fix validation:
  - `npm test -- src/app/components/message/MindroomMessageExtras.test.ts` passed (`21/21` tests across `MindroomMessageExtras.test.ts` and the parser test loaded by Vitest).
  - `npm run typecheck` passed.
  - `npm run build` passed.
  - `npm test` passed (`177/177` files, `1568/1568` tests).
  - `npx eslint src/app/components/message/MindroomMessageExtras.tsx src/app/components/message/MindroomMessageExtras.test.ts` passed with no output.
  - `git diff --check` passed.
- `npm test -- src/app/components/message/mindroomMessageExtras.test.ts src/app/components/message/MindroomMessageExtras.test.ts src/app/components/message/MindroomLongTextText.test.ts src/app/components/RenderMessageContent.test.ts src/app/utils/room.test.ts` passed (`52/52` tests).
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm test` passed (`177/177` files, `1567/1567` tests).
- Targeted `npx eslint ...` on touched files passed with no errors; existing warnings remain in `MindroomLongTextText.tsx` and `RoomTimeline.tsx`.
- `git diff --check` passed.

## Deviations from FINAL-PLAN

- React 18 does not support passing `defaultOpen` through to native `<details>` and emits a runtime warning. The renderer uses a no-state ref shim that sets native `open` only when the element mounts, then leaves the disclosure uncontrolled after mount.
- Explicit surface gating is enabled only for full room/thread timeline `RenderMessageContent` calls. Pinned-message and inbox/notification preview surfaces remain quiet for v1.
- Long-text rendering now prefers live/raw event content for extras, checks merged top-level event content for preserved metadata, and falls back to hydrated sidecar content only when both live sources omit `com.mindroom.message_extras`.
- Room/thread timeline messages with valid extras opt out of the outer generic long-message collapse by using the existing `always-expanded` mode.
- Sidecar-only hydrated long-text extras also opt out after hydration by marking the event id plus current long-text `mxc://` URI as `always-expanded`.

## Live-test recommendations for DevAgent

- Inject or send an `m.room.message` with normal body plus one `text/plain` and one `text/markdown` section.
- Verify body, collapsed titles, expansion behavior, markdown code blocks, and literal plain-text escaping in room and thread timelines.
- Verify malformed extras beside a valid body render no extras and produce no console errors.
- Verify an `m.replace` edit that omits `com.mindroom.message_extras` preserves the original extras, and an edit that includes updated extras replaces them.
- Check one long body with multiple extra sections in room and thread timelines to confirm the outer long-message overlay does not cover the summaries or expanded content.
- Check a long-text event whose top-level content has no `com.mindroom.message_extras` but whose hydrated sidecar does; after hydration, the outer message should not show the generic "Show more" clamp over the extras.
