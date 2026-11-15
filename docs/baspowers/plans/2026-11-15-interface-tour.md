# Interface Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development, adapted: Task 1 is done by the coordinator, Tasks 2 to 4 run as three implementers at once in this checkout on files that do not overlap, the coordinator commits their work, looks at the tour in a browser and polishes it (Task 5), the translations fan out (Task 6), and two other models review the whole branch (Task 8). Reason: the plan is long, the three parts share only the interfaces Task 1 lays down, and the look needs one pair of eyes on screenshots.

**Goal:** A tour dialog that teaches threads on an animated sample room, in a Quick (6 steps) and a Full (12 steps) level, offered after sign-in and reachable from four standing entries.

**Architecture:** A new domain `src/app/tour/` (layer 12) renders a dialog whose stage is a small sample room built from the app's `CompactThreadCard`; pure modules describe the steps, the sample data and each step's scene, and a spotlight ring follows the scene's part. An atom in `navigation/` opens it; an offer card in the notice places asks once per account, through `tourOffered` in `io.mindroom.settings`.

**Tech Stack:** React 18, TypeScript (strict flags), vanilla-extract, folds, the glass primitives (`ui/glass/GlassPrimitives.tsx`), jotai, i18next, Vitest (jsdom opt-in), Playwright.

**Spec:** `docs/baspowers/specs/2026-11-15-interface-tour-design.md`. Read it first: it holds every step's title, text, scene and spotlight, which this plan does not repeat.

## Global Constraints

- Every command runs in `nix develop -c ...` from the repository root. Vitest: `nix develop -c npx vitest run <paths>`. Lint: `nix develop -c npx eslint <paths>`. Types: `nix develop -c just typecheck` and `nix develop -c just strict`.
- No copyleft code. No new dependency.
- Layers: `tour` is layer 12 (beside `settings`). It may import `threads`, `room`, `activity`, `ui`, `navigation`, `matrix`, `preferences`, `config`, `lib`, `i18n`. It must not import `settings`, `sidebar` or `shell`. Other domains open the tour only through `navigation/tourState.ts`.
- `PopOut` and `TooltipProvider` come from `src/app/ui/directional.tsx`, never folds. Folds `Menu`, `MenuItem`, `Modal`, `Dialog`, `Header` are banned: use `ui/glass/GlassPrimitives.tsx`.
- Styles use logical sides (`paddingInlineStart`, `insetInlineEnd`, no `left`/`right`, no four-part `margin`/`padding`). A measured pixel position uses `transform: translate(...)`.
- Motion uses the tokens of `ui/styles/Motion.css.ts` and `transition()` of `ui/styles/transition.ts`. Every keyframe animation opts out under `(prefers-reduced-motion: reduce)`. JS checks reduced motion with `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.
- Every string a person reads comes from i18n. All new keys are under `tour.` in `src/app/i18n/locales/additions/*.json` (Task 1 adds them; nobody else edits those files before Task 6). A label the real UI already has uses the real key (the list is in Task 1).
- No em dashes in comments, docs or commit messages. Comments say what the code does for a reader, in the present tense, like the comments around them.
- Tests sit beside their subject (`X.test.ts(x)`); DOM tests start with `// @vitest-environment jsdom`. Class names are hashed in production: tests and specs select by role, label and `data-*`.
- Commits: unsigned (`git -c commit.gpgsign=false commit`), files added by explicit path. Implementers of Tasks 2 to 4 do not commit and do not run `git add`; the coordinator commits.
- Tasks 2 to 4 run at the same time in one checkout. Run only your own tests and `eslint` on your own files; a type error in a file that is not yours is the other implementer's work in progress: report it, do not fix it.

## Review Focus

1. The first sync has not completed and the stored account data is missing: no card, and no write that would replace `io.mindroom.settings` with only `tourOffered`. (Task 3)
2. A phone at 375 by 667 with a long translation (German, Russian): the step's part and the buttons stay in view. (Task 2 e2e hook, Task 5)
3. Tab inside the dialog: never lands on a control of the stage. (Task 2)
4. Right-to-left: ArrowLeft goes forward, the spotlight sits on its part. (Task 2)
5. Reduced motion: the last phase at once, no Replay, no pulse. (Task 2)

---

## File map

| File | Task | Role |
|---|---|---|
| `src/app/navigation/tourState.ts` | 1 | `tourAtom` |
| `src/app/shell/accountState.ts` | 1 | reset `tourAtom` on account exit |
| `src/app/preferences/accountSettings.ts` | 1 | `tourOffered` |
| `src/app/config/useClientConfig.ts` | 1 | `tour.offerAtStart` |
| `scripts/e2e-client-config.mjs`, `e2e/helpers/staticBuildServer.ts`, `src/build/e2eClientConfig.test.ts` | 1 | switch the offer off in e2e |
| `.eslintrc.cjs`, `docs/architecture.md`, `docs/configuration.md` | 1 | layer, layout, config key |
| `src/app/i18n/locales/additions/*.json` | 1, 6 | English keys (copied to the 16 others), then translations |
| `src/app/tour/TourRenderer.tsx`, `TourOffer.tsx` | 1 (stubs) | mounted in `shell/ClientShell.tsx` |
| `src/app/tour/tourSteps.ts`, `tourSample.ts`, `tourScenes.ts`, `useScenePhase.ts`, `useFlipList.ts`, `TourStage.tsx`, `TourStage.css.ts`, `TourSpotlight.tsx`, `TourDialog.tsx`, `TourDialog.css.ts`, `TourHandoff.tsx`, `TourRenderer.tsx` | 2 | the tour itself |
| `src/app/ui/noticeSlots.tsx`, `noticeSlots.css.ts`, `src/app/shell/NewVersionNotice.tsx`, `src/app/tour/TourOffer.tsx`, `TourOffer.css.ts`, `src/app/account/encryption/EncryptionRecoveryPrompt.tsx` | 3 | the offer, the recovery prompt's wait |
| `src/app/command-palette/commandPaletteActions.ts`, `commandPaletteItems.ts`, `src/app/settings/pages/About.tsx`, `src/app/preferences/settingsRegistry.ts`, `src/app/shell/WelcomePage.tsx`, `src/app/timeline/CompactRoomWithoutThreads.tsx` | 4 | entries |
| `e2e/tour/tour.spec.ts` | 5 | e2e |

---

### Task 1: Foundations (coordinator)

**Produces:**

```ts
// src/app/navigation/tourState.ts
export type TourLevel = 'quick' | 'full';
/** The open tour and its level; undefined while it is closed. */
export const tourAtom = atom<{ level: TourLevel } | undefined>(undefined);

// src/app/preferences/accountSettings.ts: AccountSettings gains
tourOffered: boolean; // default false; sanitize reads it like the switches

// src/app/config/useClientConfig.ts: ClientConfig gains
tour?: { offerAtStart?: boolean };

// src/app/tour/TourRenderer.tsx and TourOffer.tsx: stubs `export function X() { return null; }`,
// mounted in shell/ClientShell.tsx after <EncryptionRecoveryPrompt />.
```

- [ ] `tourAtom`, its `toInitial(tourAtom)` line in `shell/accountState.ts`, and whatever `shell/accountState.test.ts` lists.
- [ ] `tourOffered` with tests in `preferences/accountSettings.test.ts` (read, default false, a non-boolean is false, survives `mergeAccountSettings` with unknown keys). Fix every test that compares the whole settings object.
- [ ] `tour.offerAtStart` in the config type; `tour: { ...config.tour, offerAtStart: false }` in both e2e config writers, asserted in `src/build/e2eClientConfig.test.ts`; a row in `docs/configuration.md` after `encryptionRecovery.promptAtStart`.
- [ ] `'tour'` in layer 12 of `LAYERS`; `docs/architecture.md`: the layout tree line and the layers table.
- [ ] All `tour.*` English keys in `additions/en.json` (below), copied as English into the 16 other overlays so the parity tests pass until Task 6.
- [ ] Stubs mounted. `nix develop -c just typecheck`, the i18n, accountSettings, accountState, layering and e2eClientConfig tests pass. Commit.

**Keys (`tour.*`).** The step titles and texts are the spec's tables, word for word.

```
tour.levels.quick            "Quick tour"
tour.levels.full             "Full tour"
tour.offer.title             "Take a tour of MindRoom"
tour.offer.text              "See how threads, titles and states work."
tour.offer.quick             "Quick tour (1 min)"
tour.offer.full              "Full tour (5 min)"
tour.offer.dismiss           "Dismiss"
tour.dialog.stepOf           "Step {{current}} of {{total}}"
tour.dialog.close            "Close tour"
tour.dialog.back             "Back"
tour.dialog.next             "Next"
tour.dialog.done             "Done"
tour.dialog.keepGoing        "Keep going (6 more steps)"
tour.dialog.replay           "Replay"
tour.chapters.basics         "The basics"
tour.chapters.tidy           "Keeping the list tidy"
tour.chapters.finding        "Finding your way"
tour.steps.<id>.title / .text      for conversation, start, reply, title, order, resolve, snooze, pinAndTag, filters, views, activity
tour.steps.states.title, .streaming, .unread, .resolved, .snoozed   (the four lines without their label)
tour.sample.room             "Marketing"
tour.sample.ana              "Ana"
tour.sample.writer           "Writer"
tour.sample.analyst          "Analyst"
tour.sample.typed            "Draft the spring launch email"
tour.sample.launchTitle      "Spring launch email"
tour.sample.launchReply      "Here is a first draft with three subject lines."
tour.sample.budgetTitle      "Q3 budget review"
tour.sample.budgetReply      "Totals are up 4% on last quarter."
tour.sample.websiteTitle     "Website redesign feedback"
tour.sample.websiteReply     "The new homepage tests well."
tour.sample.vendorTitle      "Vendor contract renewal"
tour.sample.vendorReply      "Let's look again after the call."
tour.sample.vendorNewReply   "The contract is signed."
tour.sample.surveyTitle      "Customer survey results"
tour.sample.surveyReply      "212 answers so far."
tour.sample.preview          "{{name}}: {{text}}"
tour.sample.tagLaunch        "launch"
tour.sample.tagFinance       "finance"
tour.sample.approval         "Send the report to the team"
tour.entries.paletteQuick    "Take the quick tour"
tour.entries.paletteFull     "Take the full tour"
tour.entries.paletteDescription "See how threads work"
tour.entries.settingsSection "Tour"
tour.entries.settingsTitle   "See how threads work"
tour.entries.settingsDescription "A short tour of threads: starting one, titles, order and states."
tour.entries.settingsKeywords "tour tutorial guide help onboarding threads"
tour.entries.howThreadsWork  "How threads work"
tour.entries.noThreadsHint   "Send a message below to start one."
```

**Real keys the stage reuses** (never a new string for these): `composer.placeholder`; `thread.back`; `thread.resolve`; `threadNav.pin`; `threadNav.pinned`; `threadActions.more`, `.tags`, `.editSummary`; `thread.snooze`; `thread.status.streaming|unread|resolved|snoozed` (the labels of the states' four lines); `mindroomUi.threads.compactThreadCard.streaming`; `mindroomUi.threads.roomThreadOverview.threadFilters`, `.lastReply`, `.advancedFilters`, and the simple bar's Unresolved label and thread count (find them in `threads/overview/RoomThreadOverview.tsx`); `mindroomUi.threads.mindroomRoomViewHeader.compactView`, `.moreOptions`, `.back`; `activity.title`, `activity.sentence.mention|finished|approval`, `activity.actions.approve|deny`; `thread.replyCount`; the card's "No replies yet" (find it in `threads/overview/compactThreadCardViewModel.ts`).

---

### Task 2: The tour (implementer A)

**Files:** every `src/app/tour/*` file of the file map except `TourOffer*`, with a test beside each.

**Consumes:** Task 1's atom, keys and stub. `CompactThreadCard` and `CompactThreadCardViewModel` (`threads/overview/CompactThreadCard.tsx`, `event-store/threads/types.ts`), the card list's styles (`threads/overview/CompactRoomView.css.ts`: `CardShell`, `CardAction`, `PinnedSection`), `ThreadStreamingDot`, `ThreadTagPill`, `room/CompactViewIcon.tsx`, `ui/Modal500.tsx` (`fillPhoneScreen`, `fitContent`, `className`), `lib/hooks/useInert.ts`, `lib/hooks/useScreenSize.ts`, glass `Menu`/`MenuItem`/`Surface`, `ui/MenuEntry.tsx`.

**Produces:**

```ts
// tourSteps.ts
export type TourStepId = 'conversation' | 'start' | 'reply' | 'title' | 'order' | 'states'
  | 'resolve' | 'snooze' | 'pinAndTag' | 'filters' | 'views' | 'activity';
export type TourChapter = 'basics' | 'tidy' | 'finding';
export type TourStep = { id: TourStepId; chapter: TourChapter; /** ms each phase lasts; the last phase stays */ phases: readonly number[] };
export const TOUR_STEPS: readonly TourStep[];           // the twelve, in the spec's order
export const QUICK_STEP_COUNT = 6;
export const stepsOf: (level: TourLevel) => readonly TourStep[];
/** ms before a step's scene starts. */
export const SCENE_START_DELAY_MS = 450;

// tourSample.ts
export type SampleThreadId = 'launch' | 'budget' | 'website' | 'vendor' | 'survey';
export type SampleCardState = { title?: 'typed' | 'summary'; streaming?: boolean; unread?: boolean;
  resolved?: boolean; snoozed?: boolean; tags?: boolean; replied?: boolean; noReplies?: boolean };
export const sampleCard: (id: SampleThreadId, state: SampleCardState, t: TFunction, now: number) => CompactThreadCardViewModel;
export type SampleMessage = { sender: 'you' | 'ana' | 'writer' | 'analyst'; text: string; streaming?: boolean };

// tourScenes.ts
export type TourPart = 'composer' | 'thread' | 'replyBox' | 'back' | `card:${SampleThreadId}`
  | `title:${SampleThreadId}` | 'resolveButton' | 'menuSnooze' | 'filterButton' | 'filterBar'
  | 'viewSwitch' | 'bell';
export type TourScene = {
  view: 'list' | 'thread' | 'messages';
  header: boolean; composer: boolean;          // false for `states`
  typed: number;                               // how many characters of tour.sample.typed the composer shows
  pinned: readonly SampleThreadId[];
  cards: readonly { id: SampleThreadId; state: SampleCardState }[];
  actionsOn?: SampleThreadId;                  // the card whose buttons show (a phone: the swiped card)
  menuOn?: SampleThreadId;                     // the card whose Thread options menu is open
  roomMenu: boolean;                           // a phone's room menu open
  filterBar: boolean;
  activity: boolean;                           // the bell with its list
  thread?: { messages: readonly SampleMessage[] };
  spotlight?: TourPart;
};
export const sceneOf: (step: TourStepId, phase: number, phone: boolean, typedLength: number) => TourScene;

// useScenePhase.ts
/** The step's phase; `replay()` starts it over. `settled` once the last phase shows. */
export const useScenePhase: (step: TourStep) => { phase: number; settled: boolean; replay: () => void };

// TourDialog.tsx
export function TourDialog(props: { level: TourLevel; onLevelChange: (level: TourLevel) => void;
  onClose: (how: 'done' | 'dismissed') => void }): JSX.Element;

// TourHandoff.tsx
/** Pulses the ring around the room's composer and, without touch, focuses it. Renders the ring. */
export function TourHandoff(props: { onEnd: () => void }): JSX.Element | null;
```

**Decisions the signatures leave open:**

- The typing phase of `start` shows the text grown by graphemes (`Intl.Segmenter` where there is one, else `Array.from`), about 28 ms each; `typedLength` is that count, kept by `TourStage`'s caller from a timer inside `useScenePhase`'s typing phase (a second small hook in `useScenePhase.ts` is fine).
- `TourStage` marks parts with `data-tour-part="<TourPart>"`. `TourSpotlight` finds the part inside the stage, measures it with `offsetLeft`/`offsetTop` up the `offsetParent` chain to the stage (not `getBoundingClientRect`, which reads a card mid-move), again on `ResizeObserver` of the stage, and positions a ring with `transform` and `width`/`height`; the ring's large spread `box-shadow` dims the rest, the stage clips it.
- `useFlipList(listRef, order)`: before the order changes it keeps each `[data-flip-key]` child's `offsetTop`; after, it plays `translateY(old - new) -> 0` with `element.animate` (motion token `Slower`, `Standard` easing). Skipped with reduced motion or without `animate`.
- The stage root is inert (`useInert`). Replay is outside the inert root, in the stage's corner, shown when `settled` and the step has more than one phase and motion is allowed.
- Dialog: `Modal500` with `fillPhoneScreen`, a `className` that sets 720 px and a fixed stage height on wider screens. The text block reserves its height with a hidden copy of every step's text in one grid cell (all in the same cell, only the current one visible), so it is as tall as the tallest. The main button takes focus in an effect keyed on the step.
- Keys: `ArrowRight`/`ArrowLeft` on the dialog, flipped when `document.dir === 'rtl'`; they do nothing at the level's ends, so Keep going is a choice, not a key.
- `TourRenderer` holds `handoff` state: `onClose('done')` sets it, `TourHandoff` runs, `onEnd` clears it. The composer is `document.querySelector('[data-room-footer="true"] [data-editable-name="RoomInput"]')`; touch is `window.matchMedia('(pointer: coarse)').matches`.
- Phone variants come from `useScreenSizeContext() === ScreenSize.Mobile`, passed to `sceneOf` and `TourStage`.

**Tests** (each named in the spec's Testing section under `tourSteps`, `tourScenes`, `tourSample`, `useScenePhase`, `TourDialog`, `TourHandoff`): write them first, see them fail, then implement. Add for the Review Focus: Tab from the main button through the dialog never focuses an element inside `[data-tour-stage]`; with `document.dir = 'rtl'` ArrowLeft goes to the next step; with reduced motion (mock `matchMedia`) `useScenePhase` returns the last phase and `settled` at once and no Replay renders; `tour.dialog.keepGoing` in English contains `String(TOUR_STEPS.length - QUICK_STEP_COUNT)`.

- [ ] Pure modules with their tests, then the hooks, the stage, the dialog, the handoff, the renderer.
- [ ] `nix develop -c npx vitest run src/app/tour` passes; `nix develop -c npx eslint src/app/tour` is clean.
- [ ] Report: files written, test output, anything in the spec you could not do as written.

---

### Task 3: The offer and the recovery prompt (implementer B)

**Files:** `src/app/ui/noticeSlots.tsx`, `noticeSlots.css.ts`, `src/app/shell/NewVersionNotice.tsx`, `src/app/tour/TourOffer.tsx`, `TourOffer.css.ts`, `TourOffer.test.tsx`, `src/app/account/encryption/EncryptionRecoveryPrompt.tsx` and its test file.

**Consumes:** `tourAtom`; `useAccountData` (`matrix/hooks/useAccountData.ts`), `sanitizeAccountSettings`, `MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE`, `useSetAccountSettings`; `useClientStartupContext().hasCompletedInitialSync`; `useClientConfig().tour`; the `tour.offer.*` keys.

**Produces:**

```ts
// ui/noticeSlots.tsx
export type NoticePlacement = 'list' | 'page';
/**
 * Where a notice card shows and how it comes and goes: `card` props for its element, the slot to
 * portal into (null: none offered), and `dismiss()`, which plays it out and then reports `gone`.
 */
export const useNoticePresence: (due: boolean) => {
  shown: boolean; slot: HTMLElement | null; placement: NoticePlacement;
  leaving: boolean; settled: boolean; dismiss: () => void; gone: boolean;
  onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void;
};
```

- [ ] Move the placement, hold-back, come-in, leave and settle logic of `NewVersionNotice` into `useNoticePresence` without changing what `NewVersionNotice` does; `src/app/shell/NewVersionNotice.test.tsx` passes untouched (if a test must change, say why in the report).
- [ ] `ListSlot` stacks two cards (column, end-aligned, a gap of `config.space.S200`), the new version notice nearest the foot (`order`). One card looks as before.
- [ ] `TourOffer` per the spec's Offer section and Offer rule: a module-level `answeredAccounts = new Set<string>()` (with `resetAnsweredAccountsForTests`), the card through `useNoticePresence`, styled like `NewVersionNotice.css.ts` (mark tile, title, text, two buttons, dismiss; `data-tour-offer={placement}`). The mark is the compass or sparkle icon the app already uses elsewhere, else `Icons.Info`.
- [ ] One effect writes `{ tourOffered: true }` when the account is answered, `hasCompletedInitialSync` is true and the stored flag is false; a rejected write is caught and ignored.
- [ ] `tourAtom` set by anyone counts as answered.
- [ ] `EncryptionRecoveryPrompt`: `enabled` also needs `tourAtom` to be undefined (read with `useAtomValue`, a dependency of the effect), so a pending server check is cancelled and run again after the tour closes.
- [ ] Tests: every `TourOffer` and `EncryptionRecoveryPrompt` case of the spec's Testing section. For the Review Focus: with `hasCompletedInitialSync` false, clicking is impossible (no card) and the writer is never called; when it turns true with `tourOffered: true` stored, the card never rendered.
- [ ] `nix develop -c npx vitest run src/app/tour/TourOffer.test.tsx src/app/shell/NewVersionNotice.test.tsx src/app/ui src/app/account/encryption` passes; eslint clean on the files above.

---

### Task 4: Entries (implementer C)

**Files:** `src/app/command-palette/commandPaletteActions.ts`, `commandPaletteItems.ts`, `src/app/settings/pages/About.tsx`, `src/app/preferences/settingsRegistry.ts`, `src/app/shell/WelcomePage.tsx`, `src/app/timeline/CompactRoomWithoutThreads.tsx`, and the tests beside each.

**Consumes:** `tourAtom`, the `tour.entries.*` and `tour.offer.quick|full` keys.

- [ ] Palette: ids `'take-quick-tour'` and `'take-full-tour'` in `CommandPaletteQuickActionId`, items with `tour.entries.paletteQuick|paletteFull`, description `tour.entries.paletteDescription`, keywords `['help', 'tutorial', 'guide', 'threads', 'onboarding']`, sort ranks just under `open-settings`; handlers set `tourAtom`.
- [ ] About: an `AboutSection` titled `tour.entries.settingsSection` above Credits with one `SettingTile` (`focusId="tour"`, title `tour.entries.settingsTitle`, description `tour.entries.settingsDescription`) whose `after` holds two buttons labelled `tour.offer.quick` and `tour.offer.full`; a click sets `tourAtom` and calls `requestClose`. Registry entry `{ id: 'tour', page: 'about', group: 'tour.entries.settingsSection', labelKey: 'tour.entries.settingsTitle', descriptionKey: 'tour.entries.settingsDescription', keywordsKey: 'tour.entries.settingsKeywords', scope: 'device' }`, and whatever the registry's tests list.
- [ ] Welcome page: `WelcomeLink` takes either `href` or `onClick` (a button without `as="a"`); a link labelled `tour.entries.howThreadsWork`, with the folds icon that fits best, after the docs link; it sets `tourAtom` to `{ level: 'quick' }`.
- [ ] Empty Compact room: inside the `EmptyState` box, a column: "No threads" as now, `tour.entries.noThreadsHint` in the same quiet text, then a text button `tour.entries.howThreadsWork` that sets `tourAtom` to `{ level: 'quick' }`. `data-compact-room-without-threads` stays on the root.
- [ ] Tests per the spec's Testing section, "Entries". Existing tests of the four files pass.

---

### Task 5: See it, polish it, e2e (coordinator)

- [ ] Commit Tasks 2 to 4 by path, one commit each. `nix develop -c just typecheck && nix develop -c just strict && nix develop -c just lint`, the whole `src/app/tour`, `shell`, `ui`, `settings`, `command-palette`, `timeline`, `preferences`, `account/encryption` test folders.
- [ ] `e2e/tour/tour.spec.ts` per the spec's e2e paragraph (the offer switched on with a `config.json` route and `serviceWorkers: 'block'`). Run on a slot: `just e2e-slot <n> npx playwright test e2e/tour`.
- [ ] A throwaway spec that screenshots every step at 1280 by 800 and 375 by 667, light and dark, and one right-to-left language. Look at every picture; fix what is off (spacing, clipping, the ring's place, legibility, motion). Repeat until each step reads at a glance.
- [ ] `nix develop -c just build && nix develop -c just bundle-report`: note what the tour adds; within budget.

### Task 6: Translations (four implementers at once, one per group of four languages)

- [ ] Each replaces the English `tour.*` texts of its four `additions/<code>.json` files with translations: the app's own terms for thread, Compact, Threads, Resolve, Snooze, Pin, Unresolved, Advanced filters, Activity and Thread options, taken from that language's main catalog and overlay; placeholders unchanged; Arabic placeholders isolated with U+2068 and U+2069 as its other entries are.
- [ ] `nix develop -c npx vitest run src/app/i18n` passes. Coordinator commits.

### Task 7: Docs and the full check (coordinator)

- [ ] `AGENTS.md` Product paragraph: one sentence on the tour and its entries. `docs/architecture.md` and `docs/configuration.md` as Task 1 left them, corrected to what was built.
- [ ] `nix develop -c just check` (or its parts, if the whole does not fit the machine), every failure read.

### Task 8: Review by other models, then the pull request (coordinator)

- [ ] Two reviews of the whole branch against the spec, by two models that are not this one (`delegate_task`, role review), with the accepted differences from the spec listed in the brief. Findings verified against the code before any fix; fixes committed; the tests run again.
- [ ] Screenshots taken again at the head. Push the branch, open the pull request with them attached.
