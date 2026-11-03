# M2 Core Parity Implementation Plan

> **For agentic workers:** each workstream below is one agent's task. Read `.baspowers/sdd/2026-11-03-m2-core-parity/m2-rules.md` first; it holds the rules every workstream shares.

**Execution:** parallel workstreams in one checkout (orchestrator: Claude Opus 5.5), because Bas asked for maximal concurrency and the acceptance tests already exist; each workstream owns a set of files, commits by pathspec and is verified by the orchestrator before each push to `main`.

**Goal:** the client looks and works like MindRoom Chat in the reference screenshots for the core flows: sign in, sync, sidebar, room header, Compact and Full room views, thread view, tool calls, approvals, composer, members, settings.

**Architecture:** the ported Lane P files already implement most MindRoom behavior; M2 completes and corrects the Lane C seams and shell around them until the ported unit tests and Playwright specs pass and the screens match `docs/design/reference/`.

**Tech Stack:** React 18.2, TypeScript 5.4, Vite 5.4, vanilla-extract, folds 2.7.1, jotai, TanStack Query, matrix-js-sdk 41.7, Vitest, Playwright against disposable Tuwunel slots (`scripts/e2e-slot.sh`).

**Spec:** `docs/baspowers/specs/2026-11-02-clean-room-client-design.md` (sections 4 to 7, milestone M2).

## Global Constraints

- Lane rules of `AGENTS.md` and spec section 2: Lane C never opens the upstream client, MindRoom Chat outside this repository, or the other listed clients; Lane P files change only in the allowed ways; no formatter on Lane P files.
- Every commit passes `scripts/upstream-overlap/check.py` (0 findings) for the files it touches.
- `just typecheck` stays at 0 errors; no unit test that passes in the M1 baseline may fail.
- Licenses: no new dependency outside the allowlist in `scripts/license-check.mjs`.
- No thread filter bar, no Simple Mode; the Compact and Full switch is an icon button in the room header.
- Bas is the reference for look: `docs/design/reference/*.png` (1440x900 unless noted), light and dark.

## Review Focus

1. Account switching and sign-out with several accounts: state of one account must never show under another.
2. A room with hundreds of threads and long histories: Compact view and timeline must stay responsive and keep scroll position on back navigation.
3. Encrypted rooms where keys arrive late: messages must re-render when decryption succeeds.
4. Narrow screens (390x844): every screen in the reference has a usable mobile layout with a back button.
5. Agent replies that stream, stop, fail or wait for approval: status, tool rows and the approval bar must follow the edits in order.

## Workstreams, wave 1 (unit tests and screens)

| ID | Slot | Owns | Acceptance |
|---|---|---|---|
| W1 timeline | 1 | the room timeline seams behind `src/app/mindroom/threads/` timeline components | every `src/app/mindroom/threads/__tests__/RoomTimeline.*.test.ts`, `RoomTimelineCollapsible.test.ts`, `roomCacheHydrationController.test.tsx`, `message-rendering/TimelineMessageFeature.test.tsx`, `roomTimelineBoundaries.architecture.test.ts` pass |
| W2 room shell | 2 | room and room view composition (`Room`, `RoomView`, `MindroomRoomView`, send session) | `threads/__tests__/Room.test.ts`, `RoomView.test.ts`, `RoomView.threadSummary.test.ts`, `useRoomInputSendSessionController.test.ts`, `forkOwnership`, `featureOwnership`, `roomCompatibilitySeams` architecture tests pass |
| W3 room header | 3 | room header and its buttons | `command-palette/__tests__/RoomViewHeader.test.ts` passes; header matches `room-light.png` (avatar, name, topic, schedules, members, options, Compact/Full switch) |
| W4 native and assets | 4 | `src/app/mindroom/native/`, `ios/`, `android/`, `public/` icons, App Store preflight | `native/xcodeCloudPostClone.test.ts` passes; a new MindRoom icon set (favicons, PWA, Android) replaces every icon that was not ported, generated from `public/res/branding/` assets; `scripts/appstore-preflight` checks the version guard |
| W5 sidebar | 5 | icon rail and sidebar (`pages/client/sidebar/`, `pages/client/home/`, recent threads) | matches `home.png` and the sidebar in `room-light.png`: rail (home, direct, inbox, account, collapse), Home header and menu, Create Room, Join with Address, Message Search, ROOMS, THREADS, RECENTLY OPENED |
| W6 members | 6 | members drawer | matches the members panel in `room-light.png`: count header with invite and close, Joined filter, A to Z sort, search, power-level groups (Founder, Member) with avatars |
| W7 avatars and badges | 7 | user and room avatar components, agent avatars, model badge | avatars load from MXC everywhere (sidebar, header, members, thread bars, messages); the model badge sits under the agent avatar as in `thread-light.png` |
| W8 composer | 8 | room input and the approval bar | matches the composer in `room-light.png` and the approval bar in `thread2-light.png` (glass card, add, voice, emoji, send; "code is waiting for you · run_shell_command", Review); typing dots |
| W9 messages | 9 | message rendering in thread view and Full room view | matches `thread-light.png`, `thread2-light.png`, `thread3-light.png`: thread banner, author rows, tool call rows with chevrons, running tools with spinner, Markdown tables, "AI titled this thread", Show full message; Full room view shows the classic timeline |
| W10 settings | 10 | settings dialog and pages | matches `settings.png`; every page opens and saves |
| W11 auth | 11 | sign-in, registration, password reset, SSO | password login and SSO redirect work against Tuwunel; auth specs in `e2e/` pass (`password-login`, `auth-router`, `authentication-recovery`, `deployed-auth-shell` where it runs locally) |

## Wave 2 (after wave 1)

- Failing Playwright specs from the M2 e2e baseline, grouped by area, one workstream per group.
- Mobile (`room-mobile.png`) and dark mode (`room-dark.png`) across all screens.
- Type errors in test files (`just typecheck-tests`, 773 at M1).
- A deletion pass: unused Lane C code and seams nothing imports.

## Verification (orchestrator, before each push)

`just typecheck`, the full unit suite against the baseline, `scripts/upstream-overlap/check.py --history`, `just check-holes`, and the workstream's own acceptance specs.
