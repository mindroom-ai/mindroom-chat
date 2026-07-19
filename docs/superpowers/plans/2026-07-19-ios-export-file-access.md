# iOS Exported File Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make native iOS attachment and diagnostic exports readable after saving to local or cloud Files destinations.

**Architecture:** Keep the shared JavaScript-to-Swift chunked staging bridge and transfer ownership of its disposable temporary file through the document picker's move-export mode.
The JavaScript API, callers, cancellation behavior, and non-iOS fallback remain unchanged.

**Tech Stack:** Swift, Capacitor 8, UIKit `UIDocumentPickerViewController`, TypeScript, Vitest, Vite, and Xcode.

---

### Task 1: Pin the native export ownership contract

**Files:**

- Create: `src/app/mindroom/native/nativeFileSaveIOSContract.test.ts`

- [ ] **Step 1: Write the failing native source contract test**

```typescript
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pluginSource = readFileSync(
  new URL('../../../../ios/App/App/MindRoomFileSavePlugin.swift', import.meta.url),
  'utf8'
);

describe('MindRoomFileSavePlugin iOS export contract', () => {
  it('moves the disposable staged file into the selected destination', () => {
    expect(pluginSource).toMatch(
      /UIDocumentPickerViewController\(\s*forExporting:\s*\[session\.fileURL\]\s*\)/
    );
    expect(pluginSource).not.toMatch(/asCopy:\s*true/);
  });
});
```

- [ ] **Step 2: Run the test and verify the current copy export fails**

Run: `npx vitest run src/app/mindroom/native/nativeFileSaveIOSContract.test.ts`

Expected: FAIL because `MindRoomFileSavePlugin.swift` passes `asCopy: true`.

- [ ] **Step 3: Commit the red regression evidence**

```bash
git add src/app/mindroom/native/nativeFileSaveIOSContract.test.ts
git commit -m "test(ios): reproduce inaccessible exported files"
```

### Task 2: Transfer the staged file into the selected destination

**Files:**

- Modify: `ios/App/App/MindRoomFileSavePlugin.swift`
- Test: `src/app/mindroom/native/nativeFileSaveIOSContract.test.ts`
- Test: `src/app/mindroom/native/nativeFileSave.test.ts`
- Test: `src/app/components/AttachmentViewerDownload.test.ts`
- Test: `src/app/features/settings/about/About.test.tsx`

- [ ] **Step 1: Replace export-as-copy with move-export initialization**

Replace:

```swift
let picker = UIDocumentPickerViewController(
    forExporting: [session.fileURL],
    asCopy: true
)
```

With:

```swift
let picker = UIDocumentPickerViewController(
    forExporting: [session.fileURL]
)
```

- [ ] **Step 2: Run the focused native-save and caller suites**

Run: `npx vitest run src/app/mindroom/native/nativeFileSaveIOSContract.test.ts src/app/mindroom/native/nativeFileSave.test.ts src/app/components/AttachmentViewerDownload.test.ts src/app/features/settings/about/About.test.tsx`

Expected: PASS with 4 test files and 23 tests.

- [ ] **Step 3: Commit the production fix**

```bash
git add ios/App/App/MindRoomFileSavePlugin.swift
git commit -m "fix(ios): transfer exported files to destination"
```

### Task 3: Record and validate the fix

**Files:**

- Modify: `FORK_CHANGES.md`

- [ ] **Step 1: Update the Runbook status and evidence**

Update the `Native iOS exported-file access` section to state that move-export ownership is implemented, the red-first regression fails on copy mode and passes on move mode, local validation is complete, and physical-device acceptance remains.

- [ ] **Step 2: Run focused formatting and lint checks**

Run: `npx prettier --check ios/App/App/MindRoomFileSavePlugin.swift src/app/mindroom/native/nativeFileSaveIOSContract.test.ts FORK_CHANGES.md docs/superpowers/specs/2026-07-19-ios-export-file-access-design.md docs/superpowers/plans/2026-07-19-ios-export-file-access.md`

Expected: PASS with all matched files formatted.

Run: `npx eslint src/app/mindroom/native/nativeFileSaveIOSContract.test.ts`

Expected: PASS with zero errors.

- [ ] **Step 3: Run web and TypeScript validation**

Run: `npm run typecheck`

Expected: PASS with exit code 0.

Run: `npm run build`

Expected: PASS with exit code 0 and successful Element Call artifact verification.

Run: `npm test`

Expected: PASS with zero failing test files.

- [ ] **Step 4: Run native project validation**

Run: `npx cap sync ios`

Expected: PASS with the web assets and Capacitor iOS plugins synchronized.

Run: `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Verify the final diff**

Run: `git diff --check`

Expected: PASS with no output.

Run: `git status --short`

Expected: only the intended Runbook change plus the pre-existing untracked `.agents/` and `.docs/google-play-assets/` paths.

- [ ] **Step 6: Commit the validation record**

```bash
git add FORK_CHANGES.md
git commit -m "docs: record iOS export validation"
```

### Task 4: Review and publish

**Files:**

- Review all changes from `origin/dev` through `HEAD`.

- [ ] **Step 1: Request independent code review**

Give the reviewer the approved design, implementation plan, base SHA, and head SHA.

Require review of UIKit export semantics, staging cleanup ownership, cancellation and failure paths, test strength, and scope.

- [ ] **Step 2: Address every confirmed finding**

For behavior changes, add a failing regression before changing production code.

Rerun the focused suites and all affected validation after each confirmed fix.

- [ ] **Step 3: Run fresh pre-push verification**

Run: `npm test`

Expected: PASS with zero failing test files.

Run: `npm run typecheck`

Expected: PASS with exit code 0.

Run: `npm run build`

Expected: PASS with exit code 0.

Run: `git diff --check origin/dev...HEAD`

Expected: PASS with no output.

- [ ] **Step 4: Push and open a ready pull request**

Run: `git push -u origin fix/ios-export-file-access`

Open a ready-for-review PR against `dev` titled `fix(ios): make exported files readable`.

The PR body must explain the export-as-copy cleanup root cause, move-export ownership fix, user impact, red-green evidence, validation, and physical-device acceptance still requested.

- [ ] **Step 5: Wait for all AI reviewers**

Inspect every AI review and CI result.

Validate findings against code and behavior, address every confirmed item, resolve review threads, rerun affected checks, and push remediation before declaring completion.
