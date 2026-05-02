# Paste Attachment Marker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert oversized pasted text into a normal file attachment while inserting a sent MindRoom paste marker at the paste location.

**Architecture:** Keep the Matrix protocol shape standard by sending ordinary `m.text` and `m.file` events. Put the shared marker contract under `src/app/mindroom/messages`, the composer size/paste decision under `src/app/mindroom/room-input`, and render badges behind `renderMindroomMessageContent`.

**Tech Stack:** React, Slate, Jotai, Matrix JS SDK, Vitest, react-test-renderer, Vanilla Extract.

---

## File Structure

- Create `src/app/mindroom/messages/pasteAttachmentMarker.ts`: marker id, filename, parser, HTML formatting, and text-file construction.
- Create `src/app/mindroom/messages/pasteAttachmentMarker.test.ts`: focused marker contract tests.
- Create `src/app/mindroom/room-input/pasteAttachment.ts`: Matrix event-size estimate and paste conversion decision.
- Create `src/app/mindroom/room-input/pasteAttachment.test.ts`: focused paste decision tests.
- Modify `src/app/mindroom/room-input/MindroomRoomInput.tsx`: handle oversized text paste and add upload item plus marker.
- Modify `src/app/mindroom/room-input/__tests__/RoomInput.test.ts`: integration tests for paste conversion.
- Modify `src/app/components/editor/*`: add an inline-void paste marker node so the composer badge behaves atomically.
- Modify `src/app/mindroom/room-input/RoomInputMindroomExtensions.tsx`: create, find, and remove composer paste marker nodes.
- Modify `src/app/mindroom/messages/blocks.ts`: include paste-marker HTML formatting in the existing plain-text formatting path.
- Modify `src/app/mindroom/messages/MindroomHtmlBlocks.tsx` and `.css.ts`: render paste marker spans as compact badges.
- Modify `src/app/mindroom/messages/renderMindroomMessageContent.tsx` and `.test.ts`: use the combined formatter and verify badge rendering.
- Modify `FORK_CHANGES.md`: add CINNY-206 status and validation notes.

## Task 1: Shared Marker Contract

**Files:**
- Create: `src/app/mindroom/messages/pasteAttachmentMarker.ts`
- Test: `src/app/mindroom/messages/pasteAttachmentMarker.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  createMindroomPasteAttachment,
  formatMindroomPasteMarkerTextAsHtml,
  parseMindroomPasteMarker,
} from './pasteAttachmentMarker';

describe('pasteAttachmentMarker', () => {
  it('creates a text attachment and parseable marker', async () => {
    const created = createMindroomPasteAttachment('hello world', { id: 'paste-a3f19c' });

    expect(created.file.name).toBe('mindroom-paste-a3f19c.txt');
    expect(created.file.type).toBe('text/plain;charset=utf-8');
    expect(await created.file.text()).toBe('hello world');
    expect(created.marker).toBe(
      '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]]'
    );
    expect(parseMindroomPasteMarker(created.marker)).toEqual({
      id: 'paste-a3f19c',
      chars: 11,
      fileName: 'mindroom-paste-a3f19c.txt',
      raw: created.marker,
    });
  });

  it('formats inline markers as safe HTML spans', () => {
    expect(
      formatMindroomPasteMarkerTextAsHtml(
        'Before [[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]] after'
      )
    ).toContain('data-mindroom-paste-marker="true"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/mindroom/messages/pasteAttachmentMarker.test.ts`

Expected: fail because `pasteAttachmentMarker.ts` does not exist.

- [ ] **Step 3: Implement minimal marker helper**

Add parser, formatter, id generation, attachment creation, and HTML escaping in `pasteAttachmentMarker.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/mindroom/messages/pasteAttachmentMarker.test.ts`

Expected: pass.

## Task 2: Paste Size Decision

**Files:**
- Create: `src/app/mindroom/room-input/pasteAttachment.ts`
- Test: `src/app/mindroom/room-input/pasteAttachment.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { shouldConvertPasteToAttachment } from './pasteAttachment';

describe('shouldConvertPasteToAttachment', () => {
  it('converts when pasted text pushes content over the budget', () => {
    expect(
      shouldConvertPasteToAttachment({
        currentPlainText: 'hello',
        pastedText: 'x'.repeat(80),
        budgetBytes: 64,
      })
    ).toBe(true);
  });

  it('allows normal paste under the budget', () => {
    expect(
      shouldConvertPasteToAttachment({
        currentPlainText: 'hello',
        pastedText: ' world',
        budgetBytes: 1024,
      })
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/mindroom/room-input/pasteAttachment.test.ts`

Expected: fail because `pasteAttachment.ts` does not exist.

- [ ] **Step 3: Implement minimal size decision**

Estimate UTF-8 bytes of the Matrix message content JSON with `msgtype`, `body`, and optional `formatted_body`. Use a default conservative budget below 65536 bytes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/mindroom/room-input/pasteAttachment.test.ts`

Expected: pass.

## Task 3: Room Input Paste Integration

**Files:**
- Modify: `src/app/mindroom/room-input/MindroomRoomInput.tsx`
- Modify: `src/app/mindroom/room-input/__tests__/RoomInput.test.ts`

- [ ] **Step 1: Write failing integration tests**

Add tests that expose the mocked `CustomEditor.onPaste`, paste large text, assert `preventDefault`, assert a new upload-board file, and assert `editor.insertNode` receives an atomic paste marker node whose plain-text serialization is the exact marker. Add tests that small text paste does not prevent default, deleting the marker removes the staged upload, and removing/canceling the staged upload removes the marker.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/app/mindroom/room-input/__tests__/RoomInput.test.ts`

Expected: fail because `RoomInput` still only handles file pastes.

- [ ] **Step 3: Implement paste handler**

Replace the current `useFilePasteHandler(handleFiles)` wiring with a MindRoom-aware `handlePaste` that:

- preserves existing file paste handling,
- reads `text/plain`,
- calls `shouldConvertPasteToAttachment`,
- prevents default only when converting,
- creates the paste attachment,
- appends it through `createUploadItems` and `appendUploadItems`,
- inserts the marker through an inline-void paste marker element,
- keeps staged paste files and composer marker nodes linked in both deletion directions.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- src/app/mindroom/room-input/__tests__/RoomInput.test.ts`

Expected: pass.

## Task 4: Marker Badge Rendering

**Files:**
- Modify: `src/app/mindroom/messages/blocks.ts`
- Modify: `src/app/mindroom/messages/MindroomHtmlBlocks.tsx`
- Modify: `src/app/mindroom/messages/MindroomHtmlBlocks.css.ts`
- Modify: `src/app/mindroom/messages/renderMindroomMessageContent.tsx`
- Modify: `src/app/mindroom/messages/renderMindroomMessageContent.test.ts`

- [ ] **Step 1: Write failing render test**

Add a test that renders an `m.text` body containing a paste marker and expects `data-mindroom-paste-badge`, `paste-a3f19c`, and `mindroom-paste-a3f19c.txt` in the rendered tree.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/app/mindroom/messages/renderMindroomMessageContent.test.ts`

Expected: fail because paste markers render as raw text.

- [ ] **Step 3: Implement formatter and badge**

Add combined plain-text formatting that handles both tool refs and paste markers. In the MindRoom HTML parser options, replace marker spans with a compact badge component.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- src/app/mindroom/messages/renderMindroomMessageContent.test.ts`

Expected: pass.

## Task 5: Runbook, Review, Validation

**Files:**
- Modify: `FORK_CHANGES.md`

- [ ] **Step 1: Update runbook**

Add `CINNY-206` with implementation notes, review status, and validation commands.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- src/app/mindroom/messages/pasteAttachmentMarker.test.ts src/app/mindroom/room-input/pasteAttachment.test.ts src/app/mindroom/room-input/__tests__/RoomInput.test.ts src/app/mindroom/messages/renderMindroomMessageContent.test.ts
```

Expected: pass.

- [ ] **Step 3: Run full validation**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run lint
git diff --check
```

Expected: pass, except for documented existing warnings.

- [ ] **Step 4: Independent self-review**

Review the focused source and test diff for contract drift, accidental generic-editor ownership, and Matrix event compatibility. Record the review result in `FORK_CHANGES.md`.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/app/mindroom docs/superpowers/plans/2026-05-02-paste-attachment-marker.md FORK_CHANGES.md
git commit -m "feat: attach oversized pasted text"
```

Expected: focused implementation commit.
