# Voice Volume `currentTarget` Crash Report

## Root cause and exact interaction/component

Staging is pinned by the production Matrix overlay values to `ghcr.io/mindroom-ai/mindroom-chat:commit-3083fca` at digest `sha256:019bf0e7748dfebf2c11f4af6c2ea6b2ca404ac7df5fd69b87ebd78c4101172f`.
The tag resolves locally to commit `3083fcaa35a7051f3a51c5391b800fe03f635014`.
Current `origin/dev` and this worktree started at `73d318baa23488585e5d3b94bf21d38faaff8e1c`.
Authenticated inspection of the exact staging bundle mapped `index-DvHwdwou.js:447:1054535` and minified component `Dmt` to `VoiceVolumeButton`.
`VoiceAudioContent` renders this component as the volume icon/button in the compact voice and audio player.
The crashing interaction is opening or reopening the voice-volume popover while its deactivation update is still queued.
`VoiceVolumeButton.handleOpen` passed a functional updater to `setAnchor` and read `event.currentTarget.getBoundingClientRect()` inside that updater.
React may defer that updater until after the synchronous click callback, when the SyntheticEvent-compatible `currentTarget` has been cleared to `null`.
The direct lifecycle reproduction opens the volume popover, queues its real `FocusTrap.onDeactivate` callback and a same-batch trigger reopen, then invalidates `currentTarget` before React flushes the queued updates.
The pre-fix test failed with `Cannot read properties of null (reading 'getBoundingClientRect')`.

## What changed

`VoiceVolumeButton.handleOpen` now reads the trigger `DOMRect` synchronously before calling `setAnchor`.
The updater still closes when an anchor exists and otherwise opens against the captured rect.
No null guard, component redesign, gcp-infra edit, deployment, or unrelated cleanup was added.

## Regression coverage

`VoiceAudioContent.test.ts` now covers volume-popover deactivation plus immediate reopening.
The event double exposes `currentTarget` through a getter and sets it to `null` before the queued state updater runs.
The test requires no throw and one open popover, so reverting the synchronous capture reproduces the production exception.

## Tests and verification

- RED: `npm test -- src/app/components/message/content/VoiceAudioContent.test.ts -t "reopens volume during deactivation"` failed 1 of 1 selected tests with the exact null `getBoundingClientRect` dereference before the fix.
- GREEN: the same command passed 1 of 1 selected tests after the fix.
- Focused file: `npm test -- src/app/components/message/content/VoiceAudioContent.test.ts` passed all 30 tests.
- Typecheck: `npm run typecheck` passed.
- Touched ESLint: `npx eslint src/app/components/voice/VoiceVolumeButton.tsx src/app/components/message/content/VoiceAudioContent.test.ts` passed with zero errors or warnings.
- Full ESLint: `npm run lint` completed with zero errors and the existing 17 warnings.
- Formatting: `npx prettier --check FORK_CHANGES.md src/app/components/voice/VoiceVolumeButton.tsx src/app/components/message/content/VoiceAudioContent.test.ts` passed.
- Build: `npm run build` completed the production and PWA builds, including the Element Call verification, with the existing Vite runtime-config, dependency source-map, and chunk-size warnings.
- Diff integrity: `git diff --check` passed.
- Full suite: `npm test` passed 453 of 454 files and 3,434 of 3,437 tests.
- Full-suite baseline failures: all three failures are in unchanged `src/app/mindroom/native/xcodeCloudPostClone.test.ts` Homebrew-install fixtures under this local Nix-style environment, matching the pre-existing three-failure baseline documented in the preceding Runbook entry.

## Diff and self-review findings

The implementation commit changes only `FORK_CHANGES.md`, `VoiceVolumeButton.tsx`, and `VoiceAudioContent.test.ts`.
An AST-backed audit across `src` found no remaining `currentTarget` reads inside state-setter, async, timer, animation-frame, or promise callbacks.
Nearby `VoiceAudioContent` More-menu code already captures its rect synchronously.
Nearby `VoiceWaveform` reads `currentTarget` synchronously and passes only the element plus scalar coordinates to its helper.
Independent read-only review reproduced RED, verified GREEN and the equivalent-misuse audit, found no issues, and returned `READY`.
The pre-existing modified `package-lock.json` and untracked `.envrc` were not staged or changed by this task.

## Remaining questions, risks, and deployment follow-up

The regression uses react-test-renderer to force the exact queued-update ordering rather than a deployed browser because deployment was explicitly out of scope.
The production stack, exact staging bundle body, deployed git revision, source history, and RED failure all identify the same handler and lifecycle.
Staging remains pinned to the affected `commit-3083fca` image until this commit is integrated, built, and the separate deployment owner updates the image pin.
Deployment follow-up should verify repeated volume popover open, close, and reopen interactions on an actively updating audio message.
No gcp-infra files were edited and nothing was pushed or deployed.

## Branch and commit

Branch: `fix-currenttarget-rect-crash`.
Implementation commit: `9491c2e65f24e62df8ad016fec3e43bff8a4b1b4`.
