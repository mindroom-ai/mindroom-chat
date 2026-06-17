# Router Delegate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a message-menu delegate action for unassigned MindRoom router messages inside threads.

**Architecture:** Put pure matching/content logic in `src/app/mindroom/messages/delegation.ts`, then wire it into the existing MindRoom message-menu extension path. The UI sends a same-thread Matrix reply with clickable formatted Matrix.to mention and explicit `m.mentions`.

**Tech Stack:** React 18, TypeScript, matrix-js-sdk, Folds menu components, Vitest.

---

## File Structure

- Create `src/app/mindroom/messages/delegation.ts` for pure helper logic.
- Create `src/app/mindroom/messages/delegation.test.ts` for helper tests.
- Modify `src/app/mindroom/messages/MindroomMessageControls.tsx` to add the delegate menu popout and send action.
- Modify `src/app/mindroom/messages/messageExtensions.tsx` to pass room/event/content context into the delegate menu extension.
- Modify `src/app/mindroom/messages/MindroomMessage.tsx` to provide `room`, `mEvent`, and effective content to menu extensions.
- Modify `src/app/mindroom/messages/__tests__/Message.test.ts` for menu integration coverage.
- Modify `FORK_CHANGES.md` with the runbook entry and validation notes.

### Task 1: Helper Red Test

**Files:**

- Create: `src/app/mindroom/messages/delegation.test.ts`
- Create: `src/app/mindroom/messages/delegation.ts`

- [ ] **Step 1: Write the failing helper test**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildMindroomDelegateMessageContent,
  getMindroomDelegateAgents,
  shouldShowMindroomDelegateAction,
} from './delegation';

describe('mindroom delegation helpers', () => {
  it('detects unassigned router messages inside threads', () => {
    expect(
      shouldShowMindroomDelegateAction({
        senderId: '@mindroom_router:mindroom.chat',
        content: { msgtype: 'm.text', body: 'Who owns this?' },
        eventId: '$router',
        threadRootId: '$thread',
        agents: ['@mindroom_worker:mindroom.chat'],
      })
    ).toBe(true);
  });

  it('hides delegation when the router message already mentions someone', () => {
    expect(
      shouldShowMindroomDelegateAction({
        senderId: '@mindroom_router:mindroom.chat',
        content: {
          msgtype: 'm.text',
          body: '@mindroom_worker:mindroom.chat already tagged',
          'm.mentions': { user_ids: ['@mindroom_worker:mindroom.chat'] },
        },
        eventId: '$router',
        threadRootId: '$thread',
        agents: ['@mindroom_worker:mindroom.chat'],
      })
    ).toBe(false);
  });

  it('filters joined MindRoom agents and excludes the router', () => {
    expect(
      getMindroomDelegateAgents([
        { userId: '@mindroom_router:mindroom.chat', membership: 'join' },
        { userId: '@mindroom_worker:mindroom.chat', membership: 'join' },
        { userId: '@mindroom_invited:mindroom.chat', membership: 'invite' },
        { userId: '@alice:mindroom.chat', membership: 'join' },
      ])
    ).toEqual(['@mindroom_worker:mindroom.chat']);
  });

  it('builds same-thread reply content with clickable mention metadata', () => {
    expect(
      buildMindroomDelegateMessageContent({
        originalBody: 'Who owns <this>?',
        selectedAgentId: '@mindroom_worker:mindroom.chat',
        routerEventId: '$router',
        threadRootId: '$thread',
      })
    ).toEqual({
      msgtype: 'm.text',
      body: 'Who owns <this>?\n\n@mindroom_worker:mindroom.chat, can you address this question?',
      format: 'org.matrix.custom.html',
      formatted_body:
        'Who owns &lt;this&gt;?<br><br><a href="https://matrix.to/#/@mindroom_worker:mindroom.chat">@mindroom_worker:mindroom.chat</a>, can you address this question?',
      'm.mentions': { user_ids: ['@mindroom_worker:mindroom.chat'] },
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: '$thread',
        is_falling_back: false,
        'm.in_reply_to': { event_id: '$router' },
      },
    });
  });
});
```

- [ ] **Step 2: Run red helper test**

Run: `npm test -- src/app/mindroom/messages/delegation.test.ts`

Expected: FAIL because `./delegation` does not export the helper functions.

### Task 2: Helper Green

**Files:**

- Modify: `src/app/mindroom/messages/delegation.ts`
- Test: `src/app/mindroom/messages/delegation.test.ts`

- [ ] **Step 1: Implement helper functions**

Implement constants for router id and agent regex, a safe HTML escape helper,
`getMindroomDelegateAgents`, `hasMindroomDelegateMention`, `shouldShowMindroomDelegateAction`,
`getMindroomDelegateOriginalBody`, and `buildMindroomDelegateMessageContent`.

- [ ] **Step 2: Run helper test**

Run: `npm test -- src/app/mindroom/messages/delegation.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit helper slice**

Run:

```bash
git add src/app/mindroom/messages/delegation.ts src/app/mindroom/messages/delegation.test.ts docs/superpowers/specs/2026-06-17-router-delegate-design.md docs/superpowers/plans/2026-06-17-router-delegate.md
git commit -m "feat: add router delegate helpers"
```

### Task 3: UI Red Test

**Files:**

- Modify: `src/app/mindroom/messages/__tests__/Message.test.ts`

- [ ] **Step 1: Extend message-menu integration tests**

Add tests that render a router message with `threadRootId = '$thread'`, room
members including `@mindroom_worker:mindroom.chat`, open the context menu, click
`Delegate to`, click the agent, and assert `sendMessage` received the expected
Matrix content.

- [ ] **Step 2: Run red UI test**

Run: `npm test -- src/app/mindroom/messages/__tests__/Message.test.ts`

Expected: FAIL because no `Delegate to` menu item is rendered.

### Task 4: UI Green

**Files:**

- Modify: `src/app/mindroom/messages/MindroomMessageControls.tsx`
- Modify: `src/app/mindroom/messages/messageExtensions.tsx`
- Modify: `src/app/mindroom/messages/MindroomMessage.tsx`
- Test: `src/app/mindroom/messages/__tests__/Message.test.ts`

- [ ] **Step 1: Wire delegate menu context**

Pass `room`, `mEvent`, and `menuMessageContent` into `MindroomMessageMenuExtensions`.

- [ ] **Step 2: Add delegate menu item**

In `MindroomMessageControls.tsx`, use `room.getMembers()` to collect joined
agents, render `Delegate to`, render agent choices in a nested `PopOut`, and call
`mx.sendMessage(room.roomId, buildMindroomDelegateMessageContent(...))` on
selection.

- [ ] **Step 3: Run UI test**

Run: `npm test -- src/app/mindroom/messages/__tests__/Message.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit UI slice**

Run:

```bash
git add src/app/mindroom/messages/MindroomMessageControls.tsx src/app/mindroom/messages/messageExtensions.tsx src/app/mindroom/messages/MindroomMessage.tsx src/app/mindroom/messages/__tests__/Message.test.ts
git commit -m "feat: add router delegate menu"
```

### Task 5: Runbook and Validation

**Files:**

- Modify: `FORK_CHANGES.md`

- [ ] **Step 1: Add runbook entry**

Add a new `CINNY-132 - Delegate unassigned router messages to agents` section
with status, summary, decisions, risks, next steps, and validation commands.

- [ ] **Step 2: Run final checks**

Run:

```bash
npx prettier --check FORK_CHANGES.md docs/superpowers/specs/2026-06-17-router-delegate-design.md docs/superpowers/plans/2026-06-17-router-delegate.md src/app/mindroom/messages/delegation.ts src/app/mindroom/messages/delegation.test.ts src/app/mindroom/messages/MindroomMessageControls.tsx src/app/mindroom/messages/messageExtensions.tsx src/app/mindroom/messages/MindroomMessage.tsx src/app/mindroom/messages/__tests__/Message.test.ts
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: all commands exit 0. Existing build warnings are acceptable if they
match current Vite warning class.

- [ ] **Step 3: Commit validation docs**

Run:

```bash
git add FORK_CHANGES.md
git commit -m "docs: record router delegate validation"
```

## Self-Review

Spec coverage: plan covers eligibility, joined-agent filtering, same-thread
reply relation, clickable Matrix.to mention, `m.mentions`, UI integration,
errors, runbook, and validation.

Placeholder scan: no placeholder markers remain.

Type consistency: helper names and file paths are consistent across tasks.
