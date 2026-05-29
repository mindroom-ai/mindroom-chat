# CINNY-105 Adapter Fix Complete

- Final SHA: commit containing this report; concrete SHA is reported after commit creation.
- Base: `7f6da13e`
- Net LOC delta vs `7f6da13e`: production `+203`, tests `+230`

## Fixed

- Adapter blocker: added invite-only `InviteAutocompleteMenu` instead of reusing composer-shaped `AutocompleteMenu`.
- REVIEW-H#1: `requestClose` is ref-stable and updated during render so FocusTrap deactivation uses the latest parent closure.
- REVIEW-C / REVIEW-F#1: async suggestions arriving after input blur no longer reopen the invite menu.
- REVIEW-B#1: restored Fuse weighted ranking with exact/prefix/contains/Fuse buckets and deterministic userId tiebreak.
- REVIEW-A#1 / REVIEW-B#4 / REVIEW-D#3: restored MatrixClient owner-swap bootstrap coverage so late owner A data cannot overwrite owner B cache state.
- Independent review follow-up: disabled FocusTrap keyboard navigation for the invite wrapper so Tab/Shift+Tab cannot preempt invite-owned keyboard handling.

## Dropped

- REVIEW-D#1: same-value refocus reopen ergonomics remains a follow-up UX preference.
- REVIEW-A#2: same-value refocus reopen ergonomics remains a follow-up UX preference.
- REVIEW-H#4: same-value refocus reopen ergonomics remains a follow-up UX preference.
- REVIEW-H#3: not separately targeted; the later keyboard-ownership fix removed the window `useKeyDown` listener incidentally.
- REVIEW-D#2: limited-bootstrap coverage gap remains a non-blocking follow-up test nit.

## Validation

- `npm run lint`: passed, `0` errors and existing `17` warnings.
- `npm run typecheck`: passed.
- `npx vitest run src/app/components/invite-user-prompt/ src/app/hooks/useUserDirectoryCache.test.ts src/app/hooks/useInviteUserSearch.test.ts src/app/state/userDirectoryCache.test.ts src/app/utils/userDirectorySearch.test.ts`: passed, `6` files and `40` tests.
- `npm run build`: passed with existing Vite runtime-config/sourcemap/chunk-size warnings.
- `npm test`: passed, `260` files and `1974` tests.
- Environmental flakes: none observed in this run.

## Deviations

- `InviteAutocompleteMenu` sets `isKeyForward` and `isKeyBackward` to callbacks that return `false`. This is invite-only and deliberately disables FocusTrap's default Tab handling after independent review found it could preempt the invite Tab paths.
- Shared Fuse helper extraction with command palette was not attempted; it remains a follow-up as requested.
