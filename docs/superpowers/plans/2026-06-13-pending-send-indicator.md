# Pending Send Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a subtle inline clock indicator while a Matrix message is still a pending local echo.

**Architecture:** Add a fork-owned pending-send helper/component under `src/app/mindroom/messages/`, compose it with the existing message state suffix path, and pass a `pendingSend` boolean from `MindroomRoomTimeline` using Matrix local echo status. Add a focused room local-echo refresh hook so `RoomEvent.LocalEchoUpdated` forces the timeline surfaces to re-render when the SDK mutates local echo status or replaces local IDs.

**Tech Stack:** React, TypeScript, Folds icons, matrix-js-sdk `EventStatus`, Vitest/react-test-renderer, vanilla-extract.

---

### Task 1: Pending Send Helper And Indicator

**Files:**

- Create: `src/app/mindroom/messages/pendingSendIndicator.tsx`
- Create: `src/app/mindroom/messages/PendingSendIndicator.css.ts`
- Test: `src/app/mindroom/messages/pendingSendIndicator.test.tsx`

- [ ] **Step 1: Write the failing helper/component tests**

```tsx
it.each([EventStatus.ENCRYPTING, EventStatus.SENDING, EventStatus.QUEUED, EventStatus.SENT])(
  'treats %s as pending',
  (status) => {
    expect(isPendingLocalEchoStatus(status)).toBe(true);
  }
);

it.each([undefined, null, EventStatus.NOT_SENT, EventStatus.CANCELLED])(
  'does not treat %s as pending',
  (status) => {
    expect(isPendingLocalEchoStatus(status)).toBe(false);
  }
);

it('renders an accessible muted clock indicator', () => {
  const renderer = create(<PendingSendIndicator />);
  expect(JSON.stringify(renderer.toJSON())).toContain('Message sending');
  expect(JSON.stringify(renderer.toJSON())).toContain('Waiting for server');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/app/mindroom/messages/pendingSendIndicator.test.tsx`

Expected: FAIL because the helper/component files do not exist yet.

- [ ] **Step 3: Implement the helper and indicator**

Implement:

- `isPendingLocalEchoStatus(status: unknown): boolean`
- `isPendingLocalEchoEvent(event?: Pick<MatrixEvent, 'status'> | null): boolean`
- `PendingSendIndicator`
- `renderPendingSendIndicator`

Use Folds `Icons.Clock`, a low-priority `Text` wrapper, `role="status"`,
`aria-label="Message sending"`, and `title="Waiting for server"`.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- src/app/mindroom/messages/pendingSendIndicator.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/mindroom/messages/pendingSendIndicator.tsx src/app/mindroom/messages/PendingSendIndicator.css.ts src/app/mindroom/messages/pendingSendIndicator.test.tsx
git commit -m "feat: add pending send indicator"
```

### Task 2: Compose Message State Suffixes

**Files:**

- Create: `src/app/mindroom/messages/messageStateSuffix.tsx`
- Test: `src/app/mindroom/messages/messageStateSuffix.test.tsx`
- Modify: `src/app/components/RenderMessageContent.tsx`
- Modify: `src/app/mindroom/messages/renderMindroomMessageContent.tsx`
- Test: `src/app/mindroom/messages/renderMindroomMessageContent.test.ts`

- [ ] **Step 1: Write failing suffix composition tests**

Cover:

- no custom suffix and no pending returns `undefined`, preserving existing edited behavior,
- pending returns a suffix renderer,
- custom streaming suffix plus pending renders both,
- edited plus pending renders both edited and pending.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:
`npm test -- src/app/mindroom/messages/messageStateSuffix.test.tsx src/app/mindroom/messages/renderMindroomMessageContent.test.ts`

Expected: FAIL because the suffix helper does not exist and pending state is not passed.

- [ ] **Step 3: Implement suffix composition**

Create `getMindroomMessageStateSuffixRenderer({ edited, pendingSend, renderStateSuffix })`.

Rules:

- return `undefined` when only `edited` is true, so current generic edited rendering remains unchanged,
- when a custom suffix or pending indicator exists, return a function that renders the custom suffix, then edited marker if needed, then pending indicator if needed,
- do not duplicate edited marker.

- [ ] **Step 4: Add `pendingSend?: boolean` to `RenderMessageContent`**

Pass `pendingSend` through to `renderMindroomMessageContent`.

For local caption rendering in `RenderMessageContent`, pass a composed
`renderStateSuffix` to `MText` when `pendingSend` is true.

- [ ] **Step 5: Add `pendingSend?: boolean` to `renderMindroomMessageContent`**

Use the composed suffix helper for text, notice, emote, and MindRoom long-text
rendering. Keep media-only and sticker rendering out of scope.

- [ ] **Step 6: Run focused tests and verify they pass**

Run:
`npm test -- src/app/mindroom/messages/messageStateSuffix.test.tsx src/app/mindroom/messages/renderMindroomMessageContent.test.ts src/app/mindroom/messages/__tests__/RenderMessageContent.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/mindroom/messages/messageStateSuffix.tsx src/app/mindroom/messages/messageStateSuffix.test.tsx src/app/components/RenderMessageContent.tsx src/app/mindroom/messages/renderMindroomMessageContent.tsx src/app/mindroom/messages/renderMindroomMessageContent.test.ts src/app/mindroom/messages/__tests__/RenderMessageContent.test.ts
git commit -m "feat: compose pending message suffix"
```

### Task 3: Wire Pending State From Timeline Events

**Files:**

- Modify: `src/app/mindroom/threads/MindroomRoomTimeline.tsx`
- Test: `src/app/mindroom/threads/__tests__/RoomTimeline.architecture.test.ts`

- [ ] **Step 1: Write a failing rendering test**

Add a focused source-architecture guard that requires `MindroomRoomTimeline.tsx`
to import `isPendingLocalEchoEvent`, derive pending state from both `mEvent` and
`editedEvent`, and pass that derived value to message content renderers.
Behavioral coverage for pending vs accepted/failed states lives in the focused
message renderer tests from Tasks 1 and 2.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:
`npm test -- src/app/mindroom/threads/__tests__/RoomTimeline.architecture.test.ts`

Expected: FAIL because `MindroomRoomTimeline.tsx` is not passing
`pendingSend`.

- [ ] **Step 3: Wire the pending state**

Import `isPendingLocalEchoEvent` in `MindroomRoomTimeline.tsx` and derive:

```tsx
const pendingSend = isPendingLocalEchoEvent(mEvent) || isPendingLocalEchoEvent(editedEvent);
```

Pass `pendingSend={pendingSend}` to `RenderMessageContent` call sites that render standard room messages,
encrypted room-message content after decryption, and MindRoom approval/text
content where the suffix path is used.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:
`npm test -- src/app/mindroom/threads/__tests__/RoomTimeline.architecture.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/mindroom/threads/MindroomRoomTimeline.tsx src/app/mindroom/threads/__tests__/RoomTimeline.architecture.test.ts
git commit -m "feat: show pending indicator for local echoes"
```

### Task 4: Refresh On Local Echo Status Updates

**Files:**

- Create: `src/app/mindroom/threads/roomLocalEchoRefresh.ts`
- Test: `src/app/mindroom/threads/roomLocalEchoRefresh.test.ts`
- Modify: `src/app/mindroom/threads/roomLiveEventController.ts`

- [ ] **Step 1: Write failing hook tests**

Test that `useRoomLocalEchoRefresh(room, callback)` subscribes to
`RoomEvent.LocalEchoUpdated`, calls the callback for the same room, ignores
other rooms, and removes the listener on unmount.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/app/mindroom/threads/roomLocalEchoRefresh.test.ts`

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the hook**

Use `useEffect`, `RoomEvent.LocalEchoUpdated`, and
`RoomEventHandlerMap[RoomEvent.LocalEchoUpdated]`.

- [ ] **Step 4: Use the hook in `useRoomLiveEventController`**

Call the hook with a memoized callback that does:

```ts
setTimeline((current) => ({ ...current }));
```

This is intentionally broad and cheap; local echo updates are low volume and
status/id replacement must refresh both room and thread surfaces.

- [ ] **Step 5: Run focused tests and verify they pass**

Run:
`npm test -- src/app/mindroom/threads/roomLocalEchoRefresh.test.ts src/app/mindroom/threads/__tests__/RoomTimeline.architecture.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/mindroom/threads/roomLocalEchoRefresh.ts src/app/mindroom/threads/roomLocalEchoRefresh.test.ts src/app/mindroom/threads/roomLiveEventController.ts
git commit -m "fix: refresh room timeline on local echo updates"
```

### Task 5: Final Validation And Runbook

**Files:**

- Modify: `FORK_CHANGES.md`

- [ ] **Step 1: Update runbook status and files/validation notes**

Record changed files, design decisions, focused test results, and final
validation commands under `CINNY-132`.

- [ ] **Step 2: Run focused validation**

Run:

```bash
npm test -- src/app/mindroom/messages/pendingSendIndicator.test.tsx src/app/mindroom/messages/messageStateSuffix.test.tsx src/app/mindroom/messages/renderMindroomMessageContent.test.ts src/app/mindroom/messages/__tests__/RenderMessageContent.test.ts src/app/mindroom/threads/roomLocalEchoRefresh.test.ts src/app/mindroom/threads/__tests__/RoomTimeline.architecture.test.ts
npm run typecheck
npx prettier --check FORK_CHANGES.md docs/superpowers/specs/2026-06-13-pending-send-indicator-design.md docs/superpowers/plans/2026-06-13-pending-send-indicator.md src/app/mindroom/messages/pendingSendIndicator.tsx src/app/mindroom/messages/PendingSendIndicator.css.ts src/app/mindroom/messages/messageStateSuffix.tsx src/app/components/RenderMessageContent.tsx src/app/mindroom/messages/renderMindroomMessageContent.tsx src/app/mindroom/threads/roomLocalEchoRefresh.ts src/app/mindroom/threads/roomLiveEventController.ts
git diff --check
```

- [ ] **Step 3: Run broader validation**

Run `npm test`, `npm run lint`, and `npm run build`. Treat `npm test` as
required by `AGENTS.md` unless the environment prevents completion; if blocked,
record the concrete reason in `FORK_CHANGES.md`. Record any existing
warning-only baselines.

- [ ] **Step 4: Commit runbook and plan**

```bash
git add FORK_CHANGES.md docs/superpowers/plans/2026-06-13-pending-send-indicator.md
git commit -m "docs: record pending send indicator validation"
```
