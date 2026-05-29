# Rebase Problems Log

## 2026-04-21

### Problem 1: First rebase conflict on branding commit `e1c4145c`

- Command: `git rebase --onto v4.11.1 6347640a35d85a60a4794879e11c8a11e065005a`
- Rebase stopped at commit `e1c4145c` (`chore(brand): rebrand and set MindRoom homeserver defaults`)
- Git reported content conflicts in:
  - `config.json`
  - `src/app/features/settings/about/About.tsx`
- `rerere` reapplied previously recorded resolutions and staged the conflict files automatically.
- Remaining staged changes for this commit still need review before continuing.

### Problem 2: Worktree-incompatible `post-commit` hook

- During the rebase, `.git/hooks/post-commit` tried to write to:
  - `/var/www/cinny-worktrees/upstream-v4.11.1-dev-20260421/.git/push-gitea.log`
- In a linked worktree, `.git` is a file rather than a directory, so the hook emitted:
  - `Not a directory`
- The hook failure did not abort the rebase step, but it is a repeat-noise/tooling issue to account for during the rebase.

### Problem 3: `npm test` unavailable at this rebase point

- Running `npm test` at the first conflict stop failed with:
  - `npm error Missing script: "test"`
- The current in-rebase `package.json` exposes:
  - `build`
  - `check:eslint`
  - `check:prettier`
  - `fix:prettier`
  - `lint`
  - `preview`
  - `start`
  - `typecheck`
- To keep the requested "run all tests after each conflict resolution" behavior, the fallback for this tree state is to run the underlying test runner directly instead of the missing npm script.

### Problem 4: Fresh worktree has no local dependency tree

- The rebase worktree does not have its own `node_modules/` directory.
- A direct full-run attempt via `npx vitest run` failed during startup because the project config could not resolve local build/test dependencies such as:
  - `vite`
  - `@vitejs/plugin-react`
  - `@rollup/plugin-wasm`
  - `vite-plugin-static-copy`
- The current in-rebase `package.json` also does not declare a `vitest` dependency yet, so `npx` downloaded a standalone `vitest` binary that still could not execute the project without the rest of the dependency tree.
- Next step is to make the worktree use the already-installed dependency tree from the main checkout so test runs are actually meaningful during the rebase.

### Problem 5: No test files exist at this early rebased tree state

- After wiring `node_modules` from the main checkout into the worktree, a full run via `./node_modules/.bin/vitest run` started correctly but exited with:
  - `No test files found, exiting with code 1`
- This means the current rebased tree state predates the repository's current test footprint.
- For this conflict stop, full automated test execution is structurally unavailable even after dependencies are present, so the fallback validation is to use the available compile/build checks before continuing.

### Validation after resolving the first conflict stop

- `./node_modules/.bin/vitest run`
  - started correctly after wiring `node_modules`
  - but no test files existed yet in this tree state
- `npm run typecheck`
  - failed on broad upstream/API-drift errors outside the branding conflict files, including `EventReaders.tsx`, `UserChips.tsx`, `AddExisting.tsx`, `DevelopTools.tsx`, `GlobalPacks.tsx`, `useAccountData.ts`, `SpaceTabs.tsx`, and `CallEmbed.ts`
- `npm run build`
  - passed

### Problem 6: Second rebase conflict on deploy/base-path commit `6e58d2be`

- Rebase stopped at commit `6e58d2be` (`feat(deploy): add SPA server and runtime base-path/subpath support`)
- Git reported content conflicts in:
  - `src/app/pages/Router.tsx`
  - `vite.config.js`
- `rerere` reapplied previously recorded resolutions and staged the conflict files automatically.
- Validation is required again before continuing.

### Validation after resolving the second conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `3` test files, `8` tests
- `npm run typecheck`
  - still failed on the earlier upstream/API-drift set
  - plus new missing-symbol errors:
    - `src/app/components/ClientConfigLoader.tsx`: missing exported member `reconcileFallbackSessionHomeserver`
    - `src/sw.ts`: cannot find module `./swMediaAuth`
- `npm run build`
  - failed
  - current blocker: `vite-plugin-pwa:build` could not resolve `./swMediaAuth` from `src/sw.ts`

### Problem 7: Third rebase conflict on sidebar/welcome commit `5346f8e1`

- Rebase stopped at commit `5346f8e1` (`feat(sidebar): add configurable sidebar visibility and welcome presentation`)
- Git reported a content conflict in:
  - `src/app/pages/client/WelcomePage.tsx`
- `rerere` reapplied the previously recorded resolution and staged the file automatically.
- Validation is required again before continuing.

### Validation after resolving the third conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `7` test files, `17` tests
- `npm run typecheck`
  - still failed on the broad upstream/API-drift error set
  - the earlier temporary `reconcileFallbackSessionHomeserver` and `swMediaAuth` blockers were no longer present at this stop
- `npm run build`
  - passed

### Problem 8: Fourth rebase conflict on auth-core commit `ed778667`

- Rebase stopped at commit `ed778667` (`feat(auth-core): improve auth UX and matrix client initialization`)
- Git reported content conflicts in:
  - `package.json`
  - `src/app/pages/auth/AuthFooter.tsx`
- `rerere` reapplied the previously recorded resolutions and staged the conflict files automatically.
- Validation is required again before continuing.

### Validation after resolving the fourth conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `9` test files, `20` tests
- `npm run typecheck`
  - still failed on the broad upstream/API-drift error set
  - plus a new test-typing error:
    - `src/app/components/AuthFlowsLoader.test.ts`: `AuthFlowsLoaderProps` now requires `children`
- `npm run build`
  - passed

### Problem 9: Fifth rebase conflict on thread-mode commit `8d895c2a`

- Rebase stopped at commit `8d895c2a` (`feat(thread): add thread mode and timeline thread indicators`)
- Git reported content conflicts in:
  - `package-lock.json`
  - `src/app/features/room/Room.tsx`
  - `src/app/features/room/RoomView.tsx`
- `rerere` reapplied the previously recorded resolutions and staged the conflict files automatically.
- Validation is required again before continuing.

### Validation after resolving the fifth conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `11` test files, `37` tests
- `npm run typecheck`
  - still failed on the earlier upstream/API-drift baseline
  - plus new thread-era errors, including:
    - `src/app/features/room/CallChatView.tsx`: missing required `room` prop
    - `src/app/features/room/RoomTimeline.tsx`: undefined/thread-arithmetic/iterability typing errors
    - `src/app/features/room/message/Message.tsx`: additional implicit-`any` callback
- `npm run build`
  - passed

### Problem 10: Sixth rebase conflict on CI workflow commit `070c151f`

- Rebase replayed commits `8/227` through `11/227` without stopping, then halted at commit `070c151f` (`ci: add PR test workflow and GHCR publish pipelines`)
- Git reported a content conflict in:
  - `.github/workflows/prod-deploy.yml`
- `rerere` reapplied the previously recorded resolution and staged the file automatically.
- Validation is required again before continuing.

### Validation after resolving the sixth conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `20` test files, `84` tests
- `npm run typecheck`
  - still failed on the earlier accumulated baseline
  - plus new errors in newer surfaces, including:
    - `src/app/components/message/MindroomLongTextText.test.ts`: missing `ext` field in encrypted key fixture
    - `src/app/components/message/MindroomLongTextText.tsx`: possibly undefined encrypted file argument
    - `src/app/components/message/mindroomLongText.ts`: incompatible cast to `IEncryptedFile`
    - `src/app/plugins/react-custom-html-parser.test.ts`: `unknown` not assignable to `ReactNode`
    - `src/app/styles/CustomHtml.css.ts`: missing `OnContainerVariant` theme property
- `npm run build`
  - passed

### Problem 11: Seventh rebase conflict on Capacitor scaffold commit `d15092dd`

- Rebase stopped at commit `d15092dd` (`feat(ios): add Capacitor app scaffold`)
- Git reported a content conflict in:
  - `package-lock.json`
- `rerere` reapplied the previously recorded resolution and staged the file automatically.
- Validation is required again before continuing.

### Validation after resolving the seventh conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `20` test files, `84` tests
- `npm run typecheck`
  - failed with the same accumulated baseline as the prior stop
  - no new distinct blocker surfaced beyond that existing set
- `npm run build`
  - passed

### Problem 12: Eighth rebase conflict on iOS/device fixes commit `ce2c4c8e`

- Rebase replayed commits `14/227` and `15/227` cleanly, then stopped at commit `ce2c4c8e` (`feat(ios): add account deactivation, swipe-back, and app-id/device fixes`)
- Git reported a content conflict in:
  - `src/app/features/room/RoomViewHeader.tsx`
- `rerere` reapplied the previously recorded resolution and staged the file automatically.
- Validation is required again before continuing.

### Validation after resolving the eighth conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `24` test files, `104` tests
- `npm run typecheck`
  - failed with the same accumulated baseline as the prior two stops
  - no new distinct blocker surfaced beyond that existing set
- `npm run build`
  - passed

### Problem 13: Ninth rebase conflict on matrix-js-sdk backport commit `83ff5fd1`

- Rebase replayed commits `17/227` through `21/227` cleanly, then stopped at commit `83ff5fd1` (`fix(matrix-js-sdk): backport m.replace stale-edit race fix`)
- Git reported a content conflict in:
  - `package-lock.json`
- `rerere` reapplied the previously recorded resolution and staged the file automatically.

### Problem 14: Browser validation after the rebase exposed two regressions

- A live Playwright sweep against the rebased tree uncovered two distinct browser-level issues:
  - `CINNY-001` re-entering a room after leaving a thread rendered the non-call room header twice.
  - `CINNY-073` recent-thread entries were visible, but their accessible name no longer matched the existing browser selector contract (`Open thread: ...`).
- Root causes:
  - `src/app/features/room/Room.tsx` still rendered `RoomViewHeader` even though `RoomView.tsx` now owns that header in the non-call path.
  - `src/app/features/recent-threads/RecentThreadEntry.tsx` no longer set an explicit `aria-label`, so the accessible name drifted to the concatenated visible text.
- Fixes applied:
  - removed the outer non-call `RoomViewHeader` from `Room.tsx`
  - restored a stable explicit `aria-label` on recent-thread buttons in `RecentThreadEntry.tsx`
  - added focused regressions in `Room.test.ts` and `RecentThreadEntry.test.ts`

### Problem 15: Chrome DevTools MCP stayed unusable on NixOS

- The newly installed Chrome DevTools MCP still tried to discover stable Chrome at:
  - `/opt/google/chrome/chrome`
- This NixOS host exposes Chromium at:
  - `/run/current-system/sw/bin/chromium`
  - `/home/basnijholt/.nix-profile/bin/chromium`
- `/opt` is root-owned and not writable from this session, so the MCP could not be shimmed locally.
- Browser validation continued through Playwright plus screenshots/traces instead of the MCP.

### Problem 16: Ad hoc fixture-room lookup used a missing `undici` dependency

- The first manual rerun command for the live Playwright pack used `require('undici')` in a one-off Node script.
- This worktree runtime does not expose `undici` as a local dependency, so the lookup failed before Playwright started.
- Resolution:
  - switched the temporary alias lookup to Node 20's built-in `fetch(...)`
  - reran the browser specs successfully without changing repo code for this issue

### Problem 17: `CINNY-073` 480px landscape branch became stale after bare-home thread restore

- After fixing the recent-thread entry accessible label, the `480x800` branch of `e2e/live/cinny073-recent-threads-mobile.spec.ts` still failed.
- Root cause:
  - the test navigated back to bare `/home/` before rotating to `800x480`
  - the rebased app now intentionally restores the last open thread from bare home startup
  - as a result, the test landed back inside the thread route instead of staying on the page-nav shell it meant to validate
- Resolution:
  - cleared that room's `lastOpenThread${userId}` entry before the rotation step
  - changed the wait condition to assert the recent-threads toggle directly instead of the broader account-shell helper

### Problem 18: `threads.spec.ts` assumed a fixed accessible-name field order

- The broader live browser pack then exposed two remaining failures in `e2e/live/threads.spec.ts`.
- Root cause:
  - the recent-thread button `aria-label` now starts with the thread summary/root preview and still includes the room name
  - the old selector assumed the room name must appear before the summary in the accessible name
- Resolution:
  - updated `threads.spec.ts` to use a shared selector helper that matches `Open thread:` plus both the fixture room name and the summary/root preview, regardless of ordering
  - reran `threads.spec.ts`; all `8/8` tests passed
- Validation is required again before continuing.

### Validation after resolving the ninth conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `27` test files, `124` tests
- `npm run typecheck`
  - failed with the same accumulated baseline as the prior several stops
  - no new distinct blocker surfaced beyond that existing set
- `npm run build`
  - passed

### Problem 14: Tenth rebase conflict on native iOS SSO commit `3ea6010b`

- Rebase replayed commits `23/227` through `26/227` cleanly, then stopped at commit `3ea6010b` (`feat(ios-auth): add native iOS SSO redirect and deep-link login`)
- Git reported a content conflict in:
  - `package-lock.json`
- `rerere` reapplied the previously recorded resolution and staged the file automatically.
- Validation is required again before continuing.

### Validation after resolving the tenth conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `31` test files, `138` tests
- `npm run typecheck`
  - still failed on the accumulated baseline
  - plus newer typing failures now visible in:
    - `src/app/pages/client/SpecVersions.test.ts`
    - `src/app/plugins/react-custom-html-parser.test.ts`
    - `src/app/plugins/react-custom-html-parser.tsx`
- `npm run build`
  - passed

### Problem 15: Eleventh rebase conflict on iOS-auth hardening commit `95be1cc9`

- Rebase stopped at commit `95be1cc9` (`fix(ios-auth): harden SSO launch and callback routing`)
- Git reported a content conflict in:
  - `package-lock.json`
- `rerere` reapplied the previously recorded resolution and staged the file automatically.
- Validation is required again before continuing.

### Validation after resolving the eleventh conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `31` test files, `143` tests
- `npm run typecheck`
  - failed with the same accumulated baseline as the prior stop
  - no new distinct blocker surfaced beyond that existing set
- `npm run build`
  - passed

### Cross-check: older parked rebase branch

- Existing branch `rebase/upstream-v4.11.1` is only `157` commits ahead of `v4.11.1`
- Current `dev` is `216` commits ahead of `v4.11.1`
- That older branch is therefore not close enough to the current target to use as a drop-in shortcut for this rebase

### Problem 16: Twelfth rebase conflict on native push support commit `04824f2e`

- Rebase replayed commits `29/227` through `31/227` cleanly, then stopped at commit `04824f2e` (`feat(ios): add native push notification support`)
- Git reported a content conflict in:
  - `package-lock.json`
- `rerere` reapplied the previously recorded resolution and staged the file automatically.
- Validation is required again before continuing.

### Validation after resolving the twelfth conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `35` test files, `162` tests
- `npm run typecheck`
  - still failed on the accumulated baseline
  - plus new Matrix pusher typing errors now visible in:
    - `src/app/features/settings/notifications/SystemNotification.tsx`
    - `src/app/pages/client/ClientNonUIFeatures.tsx`
- `npm run build`
  - passed

### Problem 17: Thirteenth rebase conflict on multi-account commit `904061b9`

- Rebase replayed commits `33/227` through `62/227` cleanly, then stopped at commit `904061b9` (`Multi account (#5)`)
- Git reported content conflicts in:
  - `package-lock.json`
  - `src/app/pages/Router.tsx`
  - `src/app/pages/client/ClientRoot.tsx`
- `rerere` reapplied the previously recorded resolutions and staged the conflict files automatically.
- Unlike the previous auto-restaged stops, this one was manually reviewed before continuing because it touches core routing/session bootstrap surfaces.
- Manual inspection notes:
  - `Router.tsx` resolved onto the route-guard helper path (`resolveRootRouteRedirect`, `resolveAuthRouteRedirect`, `resolveProtectedRouteRedirect`) rather than mixing legacy fallback-session redirect logic.
  - `ClientRoot.tsx` resolved onto the session-driven bootstrap/client-switching implementation rather than a partial merge of old fallback-session behavior.

### Validation after resolving the thirteenth conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `57` test files, `276` tests
- `npm run typecheck`
  - still failed on the accumulated baseline
  - no new distinct blocker was isolated to the multi-account conflict files themselves
- `npm run build`
  - passed

### Problem 18: Fourteenth rebase conflict on TypeScript 5.4 upgrade commit `3d1841be`

- Rebase replayed commits `64/227` through `72/227` cleanly, then stopped at commit `3d1841be` (`chore(types): upgrade TypeScript to 5.4 and modernize tsconfig`)
- Git reported a content conflict in:
  - `package.json`
- `rerere` reapplied the previously recorded resolution and staged the file automatically.
- Manual inspection notes:
  - the staged `package.json` resolution keeps the earlier MindRoom `test:e2e*` scripts and Playwright dependency additions,
  - while also taking the intended tooling changes from this commit:
    - `lint` switches from `yarn ...` to `npm run ...`
    - `typescript` upgrades from `4.9.4` to `5.4.2`

### Validation after resolving the fourteenth conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `60` test files, `294` tests
- `npm run typecheck`
  - improved substantially compared with the earlier accumulated baseline
  - remaining errors are now narrowed to:
    - `src/app/features/call-status/LiveChip.tsx`: implicit `any` parameter `evt`
    - `src/app/features/call-status/MemberGlance.tsx`: implicit `any` parameter `evt`
    - `src/app/features/room/CallChatView.tsx`: missing required `room` prop
    - `src/app/plugins/call/CallEmbed.ts`: read-only `sandbox` assignment
- `npm run build`
  - passed

### Problem 19: Fifteenth rebase conflict on thread resolution UI commit `f10079f8`

- Rebase replayed commits `74/227` through `81/227` cleanly, then stopped at commit `f10079f8` (`feat: thread resolve/unresolve UI with SDK thread support (CINNY-006)`)
- Git reported content conflicts in:
  - `src/app/features/room/RoomView.tsx`
  - `src/types/matrix/room.ts`
- The staged conflict resolutions were reviewed manually before continuing because this commit changes thread-state semantics and room banner behavior.
- Manual inspection notes:
  - `RoomView.tsx` resolved onto the thread-root-aware action/banner path rather than falling back to the older room-only branch.
  - `src/types/matrix/room.ts` keeps `StateEvent.ThreadResolution = 'com.mindroom.thread.resolution'` intact.
- Additional compatibility fix required on the rebased base:
  - added `src/app/hooks/useStateEvents.ts`
  - reason: `src/app/features/room/useRoomThreadResolution.ts` imports that hook, but the helper was not present on this upstream base after replaying the commit
  - implementation mirrors the existing `useRoomState()` live-state subscription and returns all current state events for a given event type

### Validation after resolving the fifteenth conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `66` test files, `343` tests
- `npm run typecheck`
  - still failed on the narrowed accumulated baseline
  - remaining errors are:
    - `src/app/features/call-status/LiveChip.tsx`: implicit `any` parameter `evt`
    - `src/app/features/call-status/MemberGlance.tsx`: implicit `any` parameter `evt`
    - `src/app/features/room/CallChatView.tsx`: missing required `room` prop
    - `src/app/plugins/call/CallEmbed.ts`: read-only `sandbox` assignment
- `npm run build`
  - passed

### Problem 20: Sixteenth rebase conflict on thread tags migration commit `15dcbe69`

- Rebase replayed commits `83/227` through `116/227` cleanly, then stopped at commit `15dcbe69` (`feat: migrate thread resolution to tag-based system (CINNY-028/ISSUE-041)`)
- Git reported a content conflict in:
  - `src/types/matrix/room.ts`
- `rerere` reapplied the previously recorded resolution and staged the file automatically.
- The staged resolution was reviewed manually before continuing because this commit changes the persisted state-event contract for thread resolution.
- Manual inspection notes:
  - `src/types/matrix/room.ts` resolves onto `StateEvent.ThreadTags = 'com.mindroom.thread.tags'` rather than retaining the older `ThreadResolution` event name.
  - the rebased tree consistently points thread-resolution consumers at `useRoomThreadTags.ts` (`RoomView.tsx`, `RoomTimeline.tsx`, `Reply.tsx`, and the related test mocks), matching the intended migration.

### Validation after resolving the sixteenth conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `81` test files, `523` tests
- `npm run typecheck`
  - still failed on the same narrowed accumulated baseline
  - remaining errors are:
    - `src/app/features/call-status/LiveChip.tsx`: implicit `any` parameter `evt`
    - `src/app/features/call-status/MemberGlance.tsx`: implicit `any` parameter `evt`
    - `src/app/features/room/CallChatView.tsx`: missing required `room` prop
    - `src/app/plugins/call/CallEmbed.ts`: read-only `sandbox` assignment
- `npm run build`
  - passed

### Problem 21: Seventeenth rebase conflict on message search rendering commit `7bf69d12`

- Rebase replayed commits `117/227` through `131/227` cleanly, then stopped at commit `7bf69d12` (`fix(search): stabilize result rendering and navigation (CINNY-024/CINNY-023)`)
- Git reported a content conflict in:
  - `src/app/features/message-search/SearchResultGroup.tsx`
- Manual resolution notes:
  - kept the new extracted `SearchResultGroupHeader` component rather than resurrecting the older inline room-header block inside `SearchResultGroup`
  - this preserves the intended search-result refactor shape while avoiding duplicate room-header implementations

### Additional issue surfaced during validation after the seventeenth conflict stop

- The first full `vitest` run after resolving the search conflict exposed suite instability in `src/app/features/room/RoomTimeline.test.ts`
- Root cause:
  - a cleanly replayed earlier commit in this segment introduced the real `CollapsibleMessage` implementation into `RoomTimeline` test coverage, and the full suite then showed timing-sensitive failures around async room-history/thread bootstrap assertions
  - the `RoomTimeline` file does not assert `CollapsibleMessage` behavior directly; that component already has dedicated tests in `src/app/components/CollapsibleMessage.test.ts`
- Test-stability fixes applied locally before continuing:
  - mocked `../../components/CollapsibleMessage` inside `src/app/features/room/RoomTimeline.test.ts` as a passthrough UI dependency
  - added explicit async waiting in:
    - `preserves an explicit null backward token when hydrating cached room history`
    - `resets the room timeline to the latest live range when returning to all threads`
  - this keeps `RoomTimeline.test.ts` focused on room/thread behavior instead of collapsible-message internals and removes the observed full-suite flake

### Validation after resolving the seventeenth conflict stop

- `./node_modules/.bin/vitest run`
  - passed after the `RoomTimeline.test.ts` stabilization above
  - no failing assertions remained in the full discovered suite
- `npm run typecheck`
  - still failed on the same narrowed accumulated baseline
  - remaining errors are:
    - `src/app/features/call-status/LiveChip.tsx`: implicit `any` parameter `evt`
    - `src/app/features/call-status/MemberGlance.tsx`: implicit `any` parameter `evt`
    - `src/app/features/room/CallChatView.tsx`: missing required `room` prop
    - `src/app/plugins/call/CallEmbed.ts`: read-only `sandbox` assignment
- `npm run build`
  - passed

### Problem 22: Eighteenth rebase conflict on last-open-thread restore commit `e67c7ec7`

- Rebase replayed commits `132/227` through `169/227` cleanly, then stopped at commit `e67c7ec7` (`feat: restore last open thread on room entry (CINNY-001)`)
- Git reported content conflicts in:
  - `src/app/features/room/Room.tsx`
  - `src/app/pages/client/ClientInitStorageAtom.tsx`
- Manual resolution notes:
  - `Room.tsx` was resolved by layering the thread-restore flow (`getLastOpenThread`, `setLastOpenThread`, `clearLastOpenThread`, and the auto-restore/load-error callbacks) on top of the existing call-room split instead of replacing the call-room/chat-pane UI.
  - `ClientInitStorageAtom.tsx` keeps both storage initializers:
    - `registerLastOpenThreadAtom(lastOpenThreadAtom)` via `useLayoutEffect`
    - `makeCallPreferencesAtom(userId)` and its provider
  - The new `Room.test.ts` introduced by this commit also needed light adaptation to the rebased room container surface:
    - mock the current notification API names,
    - treat the room as a non-call room,
    - mock `useAtomValue`, `CallView`, `CallChatView`, `RoomViewHeader`, and `callChatAtom`

### Additional issue surfaced during validation after the eighteenth conflict stop

- `npm run typecheck` exposed one new rebased-tree error in `src/app/features/room/RoomTimeline.tsx`:
  - imported `isThreadOnlyRoomActivity` from `threadRenderUtils.ts`
  - while an older local `isThreadOnlyRoomActivity` declaration still existed in the same file
- Fix applied:
  - removed the obsolete local helper and kept the shared imported utility

### Validation after resolving the eighteenth conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `117` test files, `994` tests
- `npm run typecheck`
  - returned to the same narrowed accumulated baseline
  - remaining errors are:
    - `src/app/features/call-status/LiveChip.tsx`: implicit `any` parameter `evt`
    - `src/app/features/call-status/MemberGlance.tsx`: implicit `any` parameter `evt`
    - `src/app/features/room/CallChatView.tsx`: missing required `room` prop
    - `src/app/plugins/call/CallEmbed.ts`: read-only `sandbox` assignment
- `npm run build`
  - passed

### Problem 23: Nineteenth rebase conflict on audio/lint follow-up commit `91c5e64c`

- Rebase replayed commits `171/227` through `172/227` cleanly, then stopped at commit `91c5e64c` (`fix(audio): guard recorder playback and restore lint`)
- Git reported content conflicts in:
  - `package.json`
  - `package-lock.json`
- Manual resolution notes:
  - kept the current branch `preview` script and current branch package version (`4.11.1`)
  - took the incoming lint/tooling changes:
    - `lint` now runs `npm run check:eslint`
    - `check:eslint` now targets `src/**/*.{js,jsx,ts,tsx}`
    - the ESLint / `@typescript-eslint` dependency upgrades recorded by the incoming `package-lock.json` entries were preserved

### Additional issue surfaced during validation after the nineteenth conflict stop

- The first post-merge `vitest` run exposed a runtime `ReferenceError` in `RoomTimeline.tsx`:
  - `isThreadOnlyRoomActivity` had been removed locally during the previous stop,
  - but the import from `threadRenderUtils.ts` was not restored in the import list
- Fix applied:
  - re-added `isThreadOnlyRoomActivity` to the `threadRenderUtils` import block in `src/app/features/room/RoomTimeline.tsx`

### Validation after resolving the nineteenth conflict stop

- `./node_modules/.bin/vitest run`
  - passed
  - scope at this tree state: `119` test files, `1012` tests
- `npm run typecheck`
  - returned to the same narrowed accumulated baseline
  - remaining errors are:
    - `src/app/features/call-status/LiveChip.tsx`: implicit `any` parameter `evt`
    - `src/app/features/call-status/MemberGlance.tsx`: implicit `any` parameter `evt`
    - `src/app/features/room/CallChatView.tsx`: missing required `room` prop
    - `src/app/plugins/call/CallEmbed.ts`: read-only `sandbox` assignment
- `npm run build`
  - passed
- `npm run lint`
  - passed with warnings only
  - no ESLint errors were reported after the manifest/tooling merge

### Problem 24: Twentieth rebase conflict on compact deep-link commit `6f4e4dd7`

- Rebase replayed commits `173/227` through `177/227` cleanly, then stopped at commit `6f4e4dd7` (`fix(thread): resolve compact deep links consistently`)
- Git reported a content conflict in:
  - `src/app/features/room/Room.tsx`
- Manual resolution notes:
  - preserved the rebased call-room versus chat-pane split instead of taking the older room container shape from the replayed commit
  - threaded the incoming compact deep-link fix into the current container by passing `focusEventInRoom={focusEvent === '1'}` to the non-call `RoomView` branch
  - kept the existing last-open-thread restore and thread-load-error handling already merged in the previous stop

### Additional issues surfaced during validation after the twentieth conflict stop

- A targeted room test run completed the relevant assertions, then one Vitest worker was terminated with an out-of-memory error before the process exited cleanly:
  - `src/app/features/room/Room.test.ts`: passed
  - `src/app/features/room/RoomView.test.ts`: passed
  - `src/app/features/room/RoomTimeline.test.ts`: assertions passed before the worker crash
- `npm run typecheck` exposed one new rebased-tree error in `src/app/features/room/RoomTimeline.tsx`:
  - `getTimelineEventById` was referenced after the replayed deep-link changes but was not imported/exported in the rebased tree
- Fix applied:
  - exported `getTimelineEventById` from `src/app/features/room/roomDeepLink.ts`
  - imported `getTimelineEventById` in `src/app/features/room/RoomTimeline.tsx`

### Validation after resolving the twentieth conflict stop

- `./node_modules/.bin/vitest run`
  - rerun against the full discovered suite after the import/export fix
  - no failing assertions were reported in the test output before the process lingered at shutdown in this environment
- `npm run typecheck`
  - returned to the same narrowed accumulated baseline
  - remaining errors are:
    - `src/app/features/call-status/LiveChip.tsx`: implicit `any` parameter `evt`
    - `src/app/features/call-status/MemberGlance.tsx`: implicit `any` parameter `evt`
    - `src/app/features/room/CallChatView.tsx`: missing required `room` prop
    - `src/app/plugins/call/CallEmbed.ts`: read-only `sandbox` assignment
- `npm run build`
  - passed

### Problem 25: Twenty-first rebase conflict on RoomTimeline test split commit `d7c1c6b7`

- Rebase replayed commits `179/227` through `181/227` cleanly, then stopped at commit `d7c1c6b7` (`test(room): split RoomTimeline coverage by behavior`)
- Git reported a content conflict in:
  - `src/app/features/room/RoomTimeline.cache.test.ts`
- Manual resolution notes:
  - took the incoming split-test layout so the old monolithic `RoomTimeline.test.ts` becomes:
    - `RoomTimeline.cache.test.ts`
    - `RoomTimeline.fetchAllThreadRelations.test.ts`
    - `RoomTimeline.navigation.test.ts`
    - `RoomTimeline.permalink-refresh.test.ts`
    - `RoomTimeline.test.shared.ts`
  - verified the shared split harness already preserved the earlier local test stabilizers, including the `CollapsibleMessage` mock and the explicit async wait helpers
  - kept the commit’s matching workflow updates in:
    - `package.json` (`npm test` back to plain `vitest run`)
    - `scripts/test-room-timeline.mjs` removal
    - `AGENTS.md` guidance to keep room timeline coverage in normal Vitest discovery

### Additional issue surfaced during validation after the twenty-first conflict stop

- `npm run typecheck` exposed one new rebased-tree integration error in `src/app/features/room/RoomTimeline.tsx`:
  - a local `getTimelineEventById` helper had reappeared and now conflicted with the shared import from `roomDeepLink.ts`
- Fix applied:
  - removed the duplicate local `getTimelineEventById` helper from `src/app/features/room/RoomTimeline.tsx`
  - kept the shared imported helper from `src/app/features/room/roomDeepLink.ts`

### Validation after resolving the twenty-first conflict stop

- `npm test`
  - passed
  - scope at this tree state: `124` test files, `1041` tests
- `npm run typecheck`
  - returned to the same narrowed accumulated baseline
  - remaining errors are:
    - `src/app/features/call-status/LiveChip.tsx`: implicit `any` parameter `evt`
    - `src/app/features/call-status/MemberGlance.tsx`: implicit `any` parameter `evt`
    - `src/app/features/room/CallChatView.tsx`: missing required `room` prop
    - `src/app/plugins/call/CallEmbed.ts`: read-only `sandbox` assignment
- `npm run build`
  - passed
- `npm run lint`
  - passed with warnings only
  - no ESLint errors were reported after removing the duplicate local helper

### Problem 26: Twenty-second rebase conflict on zero-reply overview commit `b9b32f16`

- Rebase replayed commits `183/227` through `186/227` cleanly, then stopped at commit `b9b32f16` (`fix(room): keep zero-reply roots visible across overview modes (CINNY-059)`)
- Git reported a content conflict in:
  - `src/app/features/room/RoomTimeline.tsx`
- Manual resolution notes:
  - the semantic overlap was at the `roomDeepLink` import block
  - kept both sides of the integration:
    - current rebased tree still needs `getTimelineEventById`
    - incoming CINNY-059 logic needs `getRoomEventThreadOpenTarget`
  - resolved the import to include both helpers alongside `resolveRoomEventThreadRedirect`
  - the rest of the replayed CINNY-059 changes merged cleanly, including:
    - zero-reply standalone root visibility in overview filtering
    - focused room overview targeting
    - zero-reply badge handling for room timeline/thread surfaces
    - compact zero-reply root merge logic

### Validation after resolving the twenty-second conflict stop

- `npm test`
  - passed
  - scope at this tree state: `126` test files, `1059` tests
- `npm run typecheck`
  - returned to the same narrowed accumulated baseline
  - remaining errors are:
    - `src/app/features/call-status/LiveChip.tsx`: implicit `any` parameter `evt`
    - `src/app/features/call-status/MemberGlance.tsx`: implicit `any` parameter `evt`
    - `src/app/features/room/CallChatView.tsx`: missing required `room` prop
    - `src/app/plugins/call/CallEmbed.ts`: read-only `sandbox` assignment
- `npm run build`
  - passed
- `npm run lint`
  - passed with warnings only
  - no ESLint errors were introduced by the CINNY-059 merge

### Problem 27: Twenty-third rebase conflict on recent threads sidebar commit `7b6d71f6`

- Rebase replayed commit `187/227` cleanly, then stopped at commit `7b6d71f6` (`feat: recent threads panel in sidebar (CINNY-070)`)
- Git reported content conflicts in:
  - `src/app/pages/client/ClientInitStorageAtom.tsx`
  - `src/app/pages/client/space/Space.tsx`
- Manual resolution notes:
  - `ClientInitStorageAtom.tsx` was resolved by keeping both storage responsibilities:
    - existing call preferences atom/provider wiring
    - incoming recent-threads atom registration and recent-threads panel height registration
  - the storage effect now registers and cleans up:
    - `lastOpenThreadAtom`
    - `recentThreadsAtom`
    - `recentThreadsPanelHeightAtom`
  - `Space.tsx` was resolved by keeping both sidebar integrations:
    - existing `useCallEmbed()` usage for visibility overrides in collapsed space trees
    - incoming `RecentThreadsPageNav` wrapper for the sidebar panel

### Validation after resolving the twenty-third conflict stop

- `npm test`
  - passed
  - scope at this tree state: `131` test files, `1069` tests
- `npm run typecheck`
  - returned to the same narrowed accumulated baseline
  - remaining errors are:
    - `src/app/features/call-status/LiveChip.tsx`: implicit `any` parameter `evt`
    - `src/app/features/call-status/MemberGlance.tsx`: implicit `any` parameter `evt`
    - `src/app/features/room/CallChatView.tsx`: missing required `room` prop
    - `src/app/plugins/call/CallEmbed.ts`: read-only `sandbox` assignment
- `npm run build`
  - passed
- `npm run lint`
  - passed with warnings only
  - no ESLint errors were introduced by the CINNY-070 merge

### Problem 28: Twenty-fourth rebase conflict on working filter preset commit `f8cdc9e5`

- Rebase replayed commits `188/227` through `209/227` cleanly, then stopped at commit `f8cdc9e5` (`feat(threads): "Working" filter preset with OR-mode chips and DSL bar (CINNY-077)`)
- Git reported a content conflict in:
  - `src/app/features/room/RoomTimeline.tsx`
- Manual resolution notes:
  - the textual conflict was limited to the `roomDeepLink`/filter DSL import area
  - kept both integrations in `RoomTimeline.tsx`:
    - the rebased tree still needs `getRoomEventThreadOpenTarget`, `getTimelineEventById`, and `resolveRoomEventThreadRedirect` from `roomDeepLink.ts`
    - the incoming CINNY-077 changes need `applyParsedThreadFilterQuery` and `parseThreadFilterQuery` from the new `threadFilterDsl.ts`

### Additional issues surfaced during validation after the twenty-fourth conflict stop

- `npm test` first exposed a stale module mock in `src/app/features/room/Room.test.ts`:
  - the file fully mocked `jotai` with only `useAtomValue`, which broke the newer recent-thread state imports once `createStore`/`getDefaultStore` entered the dependency graph
- Fix applied:
  - converted the `jotai` mock in `Room.test.ts` into a partial mock via `vi.importActual(...)`
  - kept the test’s `useAtomValue` override while preserving real `jotai` store exports
- The first full-suite rerun then exposed order-dependent room-view test failures:
  - `RoomTimeline.navigation.test.ts` timed out in the full suite even though it passed in isolation
  - that timeout left later `RoomView.test.ts` cases running after leaked fake-timer / persisted atom state, causing follow-on failures
- Fixes applied:
  - reduced the mocked `paginationLimit` for the heavy navigation test from `300` to `50` only within that test, while preserving the behavior under test
  - hardened `RoomView.test.ts` by forcing real timers in `beforeEach`/`afterEach`
  - switched `RoomView.test.ts` to unique per-test room ids so local `jotai` / localStorage-backed atom state cannot collide across tests
  - updated the final three room-id assertions in `RoomView.test.ts` to assert against `room.roomId` instead of the old hard-coded ids
- `npm run typecheck` and `npm run lint` also surfaced the previously accumulated call/DSL integration issues:
  - `src/app/features/call-status/LiveChip.tsx`: implicit `any` click event parameter
  - `src/app/features/call-status/MemberGlance.tsx`: implicit `any` click event parameter
  - `src/app/features/room/CallChatView.tsx`: missing required `room` prop when rendering `RoomView`
  - `src/app/plugins/call/CallEmbed.ts`: read-only `sandbox` assignment
  - `src/app/features/room/threadFilterDsl.ts`: `no-return-assign` on two concise arrow callbacks
- Fixes applied:
  - typed the click event parameters in `LiveChip.tsx` and `MemberGlance.tsx`
  - threaded the room prop through `CallChatView` and its caller in `Room.tsx`
  - switched `CallEmbed.ts` to `iframe.setAttribute('sandbox', ...)`
  - expanded the concise callbacks in `threadFilterDsl.ts` into block bodies to satisfy ESLint

### Validation after resolving the twenty-fourth conflict stop

- `npm test`
  - passed
  - scope at this tree state: `143` test files, `1315` tests
- `npm run typecheck`
  - passed
- `npm run build`
  - passed
- `npm run lint`
  - still fails on the rebased branch baseline, but only with warnings
  - current count: `85` warnings, `0` errors

### Problem 29: Twenty-fifth rebase conflict on command palette commit `17d227e8`

- Rebase replayed commit `218/227` cleanly, then stopped at commit `17d227e8` (`feat(command-palette): Cmd-K command palette replaces SearchModal (CINNY-076)`)
- Git reported conflicts in:
  - `package-lock.json`
  - `package.json`
  - `src/app/features/room/RoomViewHeader.tsx`
  - `src/app/pages/Router.tsx`
  - modify/delete on `src/app/features/search/Search.tsx`
- Manual resolution notes:
  - `package.json` / `package-lock.json`
    - kept the rebased branch’s newer `folds` version (`2.6.2`)
    - added the incoming `fuse.js` dependency (`7.3.0`) required by the command palette
  - `Router.tsx`
    - removed the old `SearchModalRenderer`
    - kept the incoming `CommandPaletteRenderer` and `SettingsModalRenderer`
    - preserved the existing rebased `CallEmbedProvider` / `CallStatusRenderer` wiring around `ClientLayout`
  - `RoomViewHeader.tsx`
    - preserved the rebased branch’s current header behavior (`callView`, room settings members route, `ContainerColor`, existing search button behavior, direct-room avatar handling)
    - added the incoming command-palette button and `commandPaletteOpenAtom` wiring
    - intentionally kept the current `useIsDirectRoom()` path instead of reverting to the older `mDirectAtom` lookup from the incoming commit
  - `src/app/features/search/Search.tsx`
    - deleted, matching the incoming swap away from the old Cmd-K search modal
- Dependency install step:
  - ran `npm install --no-audit --no-fund` after resolving the package files so `fuse.js` was present in the worktree
  - install succeeded and `patch-package` reapplied the existing `matrix-js-sdk` patch
  - npm emitted engine warnings because the current environment is `node v20.20.2` while some packages declare `>=22`, but installation still completed successfully

### Additional issues surfaced during validation after the twenty-fifth conflict stop

- The new command-palette/room-header tests first exposed a stale `RoomViewHeader.test.ts` harness:
  - the existing `folds` mock was too narrow and did not expose `DefaultReset`, which the imported style stack now needs
  - the test was also importing the real `ContainerColor.css.ts`, which pulled vanilla-extract into a plain renderer test
- Fixes applied:
  - converted the `folds` mock in `RoomViewHeader.test.ts` into a partial mock over the real module
  - added the now-required `useIsDirectRoom` stub to the room hook mock
  - mocked `../../styles/ContainerColor.css` in `RoomViewHeader.test.ts`
- The larger total suite then pushed several already-heavy room tests beyond Vitest’s default `5000ms` timeout under full-suite load even though they still passed in isolation
- Fixes applied:
  - raised the timeout to `10000ms` for these specific tests only:
    - `src/app/features/room/message/Message.test.ts`
      - `does not render Token usage in the context menu for messages without ai_run metadata`
    - `src/app/features/room/roomThreadOverviewModel.test.ts`
      - `round-trips the default filter state`
    - `src/app/features/room/RoomTimelineCollapsible.test.ts`
      - `uses always-expanded mode for thread summary messages resolved from edits`
    - `src/app/features/room/RoomTimeline.permalink-refresh.test.ts`
      - `computes room-event focus against the active thread-filtered room list`
    - `src/app/features/room/RoomTimeline.navigation.test.ts`
      - `keeps the default overview range when reset restores default sorting`

### Validation after resolving the twenty-fifth conflict stop

- `npm test`
  - passed
  - scope at this tree state: `153` test files, `1364` tests
- `npm run typecheck`
  - passed
- `npm run build`
  - passed
- `npm run lint`
  - still fails on the rebased branch baseline, but only with warnings
  - current count: `85` warnings, `0` errors

### Problem 30: Twenty-sixth rebase conflict on iOS thread-exit commit `68a3e06a`

- Rebase replayed commit `219/227` cleanly, then stopped at commit `68a3e06a` (`fix(room): speed up thread exit on iOS`)
- Git reported a content conflict in:
  - `src/app/features/room/RoomView.test.ts`
- The rest of the commit applied cleanly and was already staged by the sequencer in:
  - `e2e/live/cinny015-thread-exit-scroll.spec.ts`
  - `src/app/features/room/RoomView.tsx`
  - `src/app/hooks/roomNavigateState.ts`
  - `src/app/hooks/useRoomNavigate.test.ts`
  - `src/app/hooks/useRoomNavigate.ts`
- Manual resolution notes:
  - merged the new `roomNavigateState` test imports with the rebased file’s existing `afterEach` / real-timer cleanup
  - preserved the earlier per-test unique room-id isolation from the rebased branch
  - adjusted the new history-exit tests to seed history state with the actual generated `room.roomId` instead of stale hard-coded ids, so the tests exercise the real `RoomView` room/thread match logic
  - keyed the history-entry-cache tests by the generated room id to avoid cross-test contamination in the module-level exit-target cache
  - normalized the native-iOS exit-path assertion to use the generated room id (`encodeURIComponent(room.roomId)`)

### Additional issues surfaced during validation after the twenty-sixth conflict stop

- `npm run lint` initially reported one new error in the current stop:
  - `src/app/features/room/RoomView.tsx`: import ordering for `roomNavigateState`
- Fix applied:
  - reordered the `getRoomThreadExitTargetFromHistoryState` import to satisfy `import/order`
- `npm run lint` still reports two unrelated rebased-tree errors outside this stop’s write set:
  - `src/app/hooks/router/useResolvedRoomIdOrAlias.ts`
    - `camelcase` on `room_id`
  - `src/app/pages/client/ClientStartupContext.tsx`
    - `react/jsx-no-constructed-context-values`

### Validation after resolving the twenty-sixth conflict stop

- `npm test`
  - passed
  - scope at this tree state: `154` test files, `1375` tests
- `npm run typecheck`
  - passed
- `npm run build`
  - passed
- `npm run lint`
  - still fails on the rebased branch baseline
  - current count: `86` warnings, `2` errors
  - remaining errors are limited to:
    - `src/app/hooks/router/useResolvedRoomIdOrAlias.ts`
    - `src/app/pages/client/ClientStartupContext.tsx`

### Post-rebase completion validation

- Rebase completed successfully through commit `227/227`
- Final rebased branch head:
  - `3fd8c959` `fix: drop redundant tool approval response ids`
- Final full validation at the rebased tip:
  - `npm test`
    - passed
    - final scope: `155` test files, `1388` tests
  - `npm run typecheck`
    - passed
  - `npm run build`
    - passed
  - `npm run lint`
    - still fails on the current rebased-tree baseline
    - final count: `85` warnings, `2` errors
    - remaining errors:
      - `src/app/hooks/router/useResolvedRoomIdOrAlias.ts`
      - `src/app/pages/client/ClientStartupContext.tsx`
