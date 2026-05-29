# CINNY-105 Retrofit Complete

- Final retrofit SHA: `c173bb383f5e65fa13acffd43348197beaaf9b4c`
- Rebased onto `origin/dev` before retrofit. The `FORK_CHANGES.md` conflict preserved incoming dev entries and CINNY-105 entries.
- Net LOC delta vs post-rebase pre-retrofit baseline:
  - Production: `-150` LOC
  - Tests: `-602` LOC

## Reused

- `AutocompleteMenu` for menu shell, focus trap, outside-click dismissal, Escape dismissal when focus is inside the menu, arrow focus forwarding, and alive-guarded close.
- `MenuItem`, `Avatar`, and `UserAvatar` row rendering matching composer mention autocomplete.
- `useKeyDown`, `onTabPress`, `preventScrollWithArrowKey`, and `useListFocusIndex` for keyboard behavior.
- `useAsyncSearch` substring/normalize ordering for local and merged invite search.
- Existing cache/DM/search hooks: `useUserDirectoryCache`, `useDirectUsers`, `useDebounce`, and `useAlive`.

## Deleted

- Invite-specific focus/dismiss refs and auto-open effect.
- Bespoke outside-click listener and custom listbox `Menu`/`Scroll` shell.
- `UserAutocomplete.css.ts`.
- Fuse-backed `rankUsers` and the invite feature's parallel Fuse cache/index.
- Regression tests tied to the removed combobox/listbox state machine.

## Search Decision

Chose Option A. `useAsyncSearch` already provides the substring and normalization behavior used by composer mentions, and that is sufficient for the smaller invite candidate pool. This keeps invite autocomplete aligned with existing repository behavior and removes the duplicated Fuse setup.

## Deviations

- Escape from the input still explicitly closes the menu because the input is outside the shared `AutocompleteMenu` focus trap. Menu-internal dismissal remains owned by `AutocompleteMenu`.
- The completion report is a follow-up docs commit so it can name the concrete retrofit commit SHA.

## Validation

- `npm run lint`: passed with existing baseline, `17` warnings and `0` errors.
- `npm run typecheck`: passed.
- `npx vitest run src/app/components/invite-user-prompt/ src/app/hooks/useUserDirectoryCache.test.ts src/app/hooks/useInviteUserSearch.test.ts src/app/state/userDirectoryCache.test.ts src/app/utils/userDirectorySearch.test.ts`: passed, `6` files and `32` tests.
- `npm run build`: passed with existing Vite runtime-config, sourcemap, and chunk-size warnings.
- `npm test`: passed, `260` files and `1966` tests.

## Review

- Independent review completed after the first retrofit pass.
- Follow-up fixes landed for server-result suggestion flicker, focused-option double commit, and Escape from the input.
