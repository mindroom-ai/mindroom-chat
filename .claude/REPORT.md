# CINNY-126 implementation report

## Gate result

The exact speed-1 offline replay processed all 23 authoritative trace events through matrix-js-sdk 41.7.0 while thread initialization was held.

On unpatched code, all 17 `m.replace` events were accepted by the SDK but emitted zero pre-initialization thread timeline or update signals, `replacingEvent()` remained null, and both overview presentation paths remained on `Thinking...`.

Releasing initialization replayed the buffered events and immediately exposed the final completed 1,466-code-point body.

The gate therefore localized CINNY-126 to H1, matrix-js-sdk pre-initialization replacement buffering, and disproved a separate live presentation-helper defect on this path.

The presentation helper was intentionally left unchanged.

## Changes

- Added an exact-trace replay package under `scripts/cinny-126-replay/` with SHA-256 artifact verification, exact timing, offline real-SDK scenarios, a guarded test-room-only live sender, surface assertions, and one-line diagnostic verdicts.
- Added a patch-package patch for matrix-js-sdk 41.7.0 that aggregates pre-initialization replacements through `aggregateChildEvent` and emits `Thread.update` only after the accepted replacement is observable so existing overview consumers read committed edited content from the callback.
- Cleared a rejected `initalEventFetchProm` so later metadata work can retry, and absorbed the same owner-reported rejection in concurrent metadata waiters created by `Room.createThread`.
- Added real-SDK contracts for pre-initialization replacement aggregation, replacement/update signals, retry through the production `Room.createThread` path, and zero escaped rejections.
- Extended the native-iOS flight recorder with deduplicated per-room `matrix_sync` records closed at successful `SYNCING` boundaries and persisted once per batch.
- Stored only event/edit/unresolved-encrypted counts, an eight-character stable room hash, coarse route class, and thread-route presence, with no raw room IDs, event IDs, senders, content, relation targets, URLs, or tokens.
- Discarded saved-sync cache accumulators at `Prepared(fromCache: true)` so cached edits cannot be falsely attributed to the first live network batch.
- Attached the sync recorder immediately before the authenticated main client starts, with idempotent client attachment, deterministic stop/dispose cleanup, and clean reattachment.
- Bumped the recorder schema to version 2 for the expanded `matrix_sync` shape and kept combined optional `lastAction` and sync evidence valid inside the strict abnormal-session envelope.

## Review round 1

- Confirmed and fixed every forwarded finding; none were ignored as overreach.
- Moved `Thread.update` from the pre-aggregation call site to the target event's post-commit replacement signal and strengthened the real-SDK contract with two callback-observed effective bodies.
- Added encrypted-event reclassification through `MatrixEventEvent.Decrypted`, an explicit unresolved-encrypted count, strict schema-v2 validation, and an eight-room per-sync retention bound that prioritizes edit-bearing evidence.
- Made live media validation and attachment rewriting fail closed against identifiers extracted from the hash-verified trace, with normal-discovery tests for incident values, malformed input, unknown mappings, and residual nested references.
- Replaced private offline presentation output with code-point length and SHA-256, brought the replay directory under ESLint and Vitest discovery, documented the private artifact hashes and opaque event IDs, and removed the five planning artifacts.

## Evidence

- RED exact replay: `/tmp/CINNY-126-evidence/red/exact-offline-speed-1.log`.
- RED verdict: `/tmp/CINNY-126-evidence/red/verdict.txt`.
- Artifact hashes: `/tmp/CINNY-126-evidence/red/artifact-sha256.txt`.
- GREEN exact replay: `/tmp/CINNY-126-evidence/green/exact-offline-speed-1.log`.
- GREEN exact verdict: `/tmp/CINNY-126-evidence/green/verdict.txt`.
- GREEN forced-retry replay: `/tmp/CINNY-126-evidence/green/forced-init-failure.log`.
- GREEN forced-retry verdict: `/tmp/CINNY-126-evidence/green/forced-init-verdict.txt`.
- SDK patch hash: `/tmp/CINNY-126-evidence/green/sdk-patch-sha256.txt`.

The final exact verdict is `GREEN` with 23 of 23 events processed, the final replacement attached before initialization, 17 pre-initialization thread updates, both overview surfaces final, tags visible before entry, the summary targeting the final edit, and first entry final.

The forced-failure verdict is `GREEN` with two pagination attempts and zero unhandled rejections.

## Validation

- A clean `npm ci` completed and patch-package applied both `@tanstack/virtual-core@3.17.3` and `matrix-js-sdk@41.7.0` successfully.
- The 85 focused SDK patch, flight recorder, and authenticated-startup tests pass on current `dev`.
- `npm run typecheck` passes.
- `npm run build` passes, including the production/PWA build and Element Call background verification.
- `npm run lint` completes with zero errors and 17 pre-existing warnings.
- Normal `npm test` discovery passes 448 files and 3,334 tests, including every CINNY-126 test.
- Three pre-existing `xcodeCloudPostClone.test.ts` cases fail only because this Nix environment exposes Bash at `/run/current-system/sw/bin/bash` while the test replaces `PATH` with `/usr/bin:/bin`, which makes its `spawnSync('bash')` return `ENOENT` before the test fixture runs.
- Neither the Xcode Cloud test nor its shell scripts differs on this branch.
- Independent review found and drove fixes for harness acceptance gaps, a concurrent SDK waiter rejection, cached-sync recorder attribution, and missing timing/lifecycle assertions, and each remediation passed independent re-review with no remaining findings.

## Not completed live

No safe live test credentials were present in the worktree, so the live sender was not run against `https://mindroom.chat`.

The live harness refuses the incident room, original incident accounts, non-test topics, non-MindRoom homeservers, shared credentials, and unconfirmed targets, so Bas's account and real rooms were never used.

The offline real-SDK reproduction is the accepted red/green gate permitted by the final plan.

The clean install reported the repository's existing npm audit total of 23 dependency vulnerabilities, which were not changed because dependency upgrades are outside CINNY-126's root-cause scope.

## Publication

Branch `cinny-126` is pushed to Gitea and ready PR [#1](https://git.nijho.lt/basnijholt/mindroom-cinny/pulls/1) is open at implementation SHA `04fa2137`.

The Gitea `dev` base is 332 commits behind and 14 commits ahead of canonical `origin/dev`, so Gitea reports the PR as non-mergeable even though this branch is based on current canonical `dev`.

No AI review comments were configured or returned on Gitea, and its Actions checks remain queued with `Waiting to run`, so there were no external reviewer findings to validate.

Independent Codex review completed after the final clean install and found no remaining correctness, privacy, lifecycle, patch hygiene, or scope issue.

## Commits

- `91faebb1 test: add CINNY-126 exact trace replay gate`
- `1ca1256f fix: aggregate pre-init thread edits in matrix SDK`
- `0f0e0acf feat: record Matrix sync batches on iOS`
- `06185b4d test: keep SDK patch contract lint-clean`
- `04fa2137 test: verify merged flight recorder evidence`
