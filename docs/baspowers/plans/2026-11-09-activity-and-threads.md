# Activity and Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:executing-plans: the tasks share many interfaces and the session already holds the codebase map, so one implementer then one fresh whole-branch reviewer.

**Goal:** Replace the Inbox and the old Threads page with an Activity bell (popover, page, phone sheet) and a Threads section grouped by state, both showing the selected thread in the normal room view beside their list.

**Architecture:** Activity and Threads are router sections (`SectionPage nav={...}`) whose navigation column is their list and whose nested `.../:roomIdOrAlias/` route renders `RoomPage`. A per-thread signal reader (`threads/cross-room/threadSignals.ts`) over the cross-room thread index feeds both lists; Activity merges signals and invites into rows in a new `activity` domain.

**Tech Stack:** React 18, TypeScript, jotai, folds, vanilla-extract, matrix-js-sdk 41, React Router 6, i18next, vitest, Playwright.

**Spec:** `docs/baspowers/specs/2026-11-09-activity-and-threads-design.md`

## Global Constraints

- All new code is Lane C: passes `just strict` and `just lint` (type-aware rules, logical CSS sides, `PopOut` from `src/app/ui/directional.tsx`).
- Layers: `activity` at layer 10 in `.eslintrc.cjs` `LAYERS` and in `docs/architecture.md` "Layers"; no import climbs.
- New strings only in `src/app/i18n/locales/additions/<code>.json`, English plus the 16 others with the same keys.
- No em dashes in docs, comments or commit messages. Commits unsigned (`git -c commit.gpgsign=false commit`), files added by path.
- `just upstream-overlap` must report 0 findings for every commit before push; the pre-push hook checks it.
- Thread events read for signals: the SDK thread's last 40 events. Activity window for read rows: 7 days. "Finished" threshold: 60 s from a reply to its last edit. Threads Recent: 50 at a time.

## Review Focus

- A thread whose only news since the read receipt is noise (a title notice, a skill review notice): not an unread row, and the preview stays on the last counted reply. Test in Task 2 and Task 3.
- An approval whose `approverUserId` is someone else, or that expired: no Needs-you row and no Approve button. Test in Task 2.
- A question already answered by the user's reaction, or by a later message of the user in the thread: not Needs you. Test in Task 2.
- An undecryptable or redacted event among the latest: never counted, never previewed. Test in Task 2.
- A room addressed by alias in `/activity/#alias:server/`: in-view navigation stays in the Activity section, and the viewed place resolves the room. Test in Task 1.

---

### Task 1: Routes and section-keeping navigation

**Files:**
- Modify: `src/app/routes/paths.ts`, `src/app/routes/pathUtils.ts`, `src/app/navigation/useRoomNavigate.ts`, `src/app/navigation/viewedPlace.ts`, `src/app/navigation/clientRouteRestore.ts`, `src/app/routes/useThreadsSelected.ts`
- Create: `src/app/routes/useActivitySelected.ts`
- Test: `src/app/routes/pathUtils.test.ts`, `src/app/navigation/useRoomNavigate.test.ts`, `src/app/navigation/viewedPlace.test.ts`, `src/app/navigation/clientRouteRestore.test.ts`

**Interfaces:**
- Produces: `ACTIVITY_PATH = '/activity/'`, `ACTIVITY_INVITES_PATH = '/activity/invites/'`, `ACTIVITY_ROOM_PATH = '/activity/:roomIdOrAlias/:eventId?/'`, `THREADS_ROOM_PATH = '/threads/:roomIdOrAlias/:eventId?/'`; `getActivityPath(): string`, `getActivityInvitesPath(): string`, `getActivityRoomPath(roomIdOrAlias: string, eventId?: string): string`, `getThreadsRoomPath(roomIdOrAlias: string, eventId?: string): string`; `useActivitySelected(): boolean` (any `/activity/` route). `INBOX_*` paths and getters are removed in Task 7, not here.

- [ ] **Step 1: Failing tests.** `pathUtils.test.ts`: `getActivityRoomPath('!r:x')` is `/activity/!r%3Ax/`, with an event `/activity/!r%3Ax/%24e/`; `getThreadsRoomPath('#a:x')` is `/threads/%23a%3Ax/`. `useRoomNavigate.test.ts`: on `/activity/!r:x/` a thread of `!r:x` opens at `/activity/!r%3Ax/?threadId=$t`, on `/threads/#a:x/` (alias of `!r:x`) at `/threads/%23a%3Ax/?threadId=$t`, and another room still opens in Home. `viewedPlace.test.ts`: `/activity/%23a%3Ax/?threadId=$t` gives `{ roomId: '!r:x', threadId: '$t' }`. `clientRouteRestore.test.ts`: an `/activity/<room>/` route is restorable like a Home room route.
- [ ] **Step 2: Run** `nix develop -c npx vitest run src/app/routes src/app/navigation`; expected FAIL on the new cases.
- [ ] **Step 3: Implement.** `RoutePlace` gains `section?: 'activity' | 'threads'` read with `useMatch` on `ACTIVITY_PATH`/`THREADS_PATH` (`end: false`); in `getRoomPath`, when `shown` and `section` is set, return that section's room path before the space check. Add the two room patterns before `SPACE_ROOM_PATH` in `viewedPlace.ts` and `clientRouteRestore.ts`.
- [ ] **Step 4: Run** the same command; PASS.
- [ ] **Step 5: Commit** `Routes: Activity and Threads sections keep the room they show`.

### Task 2: Thread signals

**Files:**
- Create: `src/app/threads/cross-room/threadSignals.ts`
- Test: `src/app/threads/cross-room/threadSignals.test.ts`

**Interfaces:**
- Consumes: `collectThreadApprovals` (`matrix/protocol/threadApprovalModel.ts`), `canSubmitApprovalDecision` (`approvals/approvalActions.ts`), `isMindroomAgentUserId`, `isThreadSummaryEvent`, `isCallRowEvent`, `isThinkingPlaceholderBody`, `getAiRunInfo`, `getStreamStatusFromContent`.
- Produces:
```ts
export type ThreadReply = { eventId: string; senderId: string; ts: number; preview: ThreadPreview };
export type ThreadPreview = { kind: 'text'; text: string } | { kind: 'voice' | 'image' | 'video' | 'file' };
export type ThreadQuestion = { eventId: string; senderId: string; text: string; options: { key: string; label: string }[] };
export type ThreadOutcome = { kind: 'finished' | 'stopped'; senderId: string; ts: number; durationMs: number; toolCount?: number };
export type ThreadSignals = {
  pendingApproval?: ThreadApprovalRecord;
  pendingQuestion?: ThreadQuestion;
  mentionedMe: boolean;
  newCount: number;
  newSenderIds: string[];
  lastReply?: ThreadReply;
  outcome?: ThreadOutcome;
  automation: boolean;
};
export const SIGNAL_EVENT_LIMIT = 40;
export const FINISHED_AFTER_MS = 60_000;
export const isCountedReply = (event: MatrixEvent): boolean;
export const readThreadSignals = (room: Room, rootId: string, userId: string, now?: number): ThreadSignals;
```

- [ ] **Step 1: Failing tests** with stand-in `Room`/`Thread` objects holding real `MatrixEvent`s (room needs an `m.room.create`, see memory `matrix-sdk-edit-model-quirks`): a counted reply after the receipt gives `newCount 1` and `lastReply`; a later title notice and a skill-review `m.notice` from an agent leave `newCount 0` and `lastReply` on the earlier reply; an `m.room.encrypted` event and a redacted reply are skipped; `m.audio` previews as `{ kind: 'voice' }` when it has `org.matrix.msc3245.voice`, else `file` kinds by msgtype; a pending agent approval with `approverUserId` null gives `pendingApproval`, one for `@other:x` or expired does not; an agent message with `io.mindroom.interactive` `{options: {'✅': 'yes', '1': 'yes'}, option_labels: {'✅': 'Ship it', '1': 'Ship it'}}` gives `pendingQuestion.options [{key:'✅', label:'Ship it'}]` (emoji keys only), not after a reaction `✅` by the user, not after a later user message; `m.mentions.user_ids` with the user on an unread reply gives `mentionedMe`; an agent reply with `io.mindroom.ai_run.status 'cancelled'` gives outcome `stopped`; a `completed` reply edited 90 s later gives `finished` with `durationMs 90000`, edited 10 s later gives no outcome; root from `@mindroom_bot:x` with only agent replies gives `automation true`, a person's reply makes it false.
- [ ] **Step 2: Run** `nix develop -c npx vitest run src/app/threads/cross-room/threadSignals.test.ts`; FAIL (module missing).
- [ ] **Step 3: Implement** reading `room.getThread(rootId)?.timeline` (fall back to the root event alone), unread with `room.hasUserReadEvent(userId, eventId)`, highlight with `room.getThreadUnreadNotificationCount(rootId, NotificationCountType.Highlight) > 0`, reactions with `room.relations.getChildEventsForEvent(id, RelationType.Annotation, EventType.Reaction)`, content through `event.getContent()` (the SDK applies the latest edit), edit time from `event.replacingEvent()?.getTs()`.
- [ ] **Step 4: Run**; PASS. Also `just strict` 0 Lane C errors.
- [ ] **Step 5: Commit** `Threads: read each thread's signals for Activity and the Threads page`.

### Task 3: Activity rows model and the `activity` domain

**Files:**
- Create: `src/app/activity/activityRows.ts`
- Modify: `.eslintrc.cjs` (`LAYERS` layer 10 gets `'activity'`), `docs/architecture.md` ("Layers" table, Layout tree line for `activity/`)
- Test: `src/app/activity/activityRows.test.ts`

**Interfaces:**
- Consumes: `CrossRoomThreadIndexEntry`, `ThreadSignals`.
- Produces:
```ts
export type ActivityKind = 'approval' | 'question' | 'invite' | 'mention' | 'stopped' | 'finished' | 'reply';
export type ActivityTab = 'all' | 'mentions' | 'replies' | 'needsYou';
export type ActivityThreadRow = { type: 'thread'; key: string; kind: ActivityKind; entry: CrossRoomThreadIndexEntry; signals: ThreadSignals; unread: boolean; ts: number; actorIds: string[] };
export type ActivityInviteRow = { type: 'invite'; key: string; kind: 'invite'; roomId: string; inviterId?: string; unread: true; ts: number };
export type ActivityRow = ActivityThreadRow | ActivityInviteRow;
export type ActivityRowsResult = { rows: ActivityRow[]; hiddenAutomations: number };
export const ACTIVITY_READ_WINDOW_MS = 7 * 24 * 3600_000;
export const needsYou = (row: ActivityRow): boolean;
export const buildActivityRows = (input: { entries: Iterable<CrossRoomThreadIndexEntry>; signals: (entry: CrossRoomThreadIndexEntry) => ThreadSignals; invites: { roomId: string; inviterId?: string; ts: number }[]; now: number; showAutomations: boolean }): ActivityRowsResult;
export const filterActivityRows = (rows: ActivityRow[], tab: ActivityTab, unreadOnly: boolean): ActivityRow[];
export const activityDay = (ts: number, now: number): 'today' | 'yesterday' | 'earlier';
```

- [ ] **Step 1: Failing tests:** kind priority (approval over mention over reply); an involved thread read 8 days ago is left out, read 2 days ago is a read row; a not-involved thread with `mentionedMe` is a row; `automation` threads count into `hiddenAutomations` unless `mentionedMe` or `showAutomations`; a noise-only unread thread (`entry.isUnread` true, `newCount 0`, no needs-you) is a read row; needs-you rows sort first, then by `ts` descending; `actorIds` lists mention sender first then other `newSenderIds`; `filterActivityRows` tabs (`mentions` = kind mention, `replies` = reply/finished/stopped, `needsYou` = approval/question/invite) and `unreadOnly`; `activityDay` boundaries at local midnight.
- [ ] **Step 2: Run** `nix develop -c npx vitest run src/app/activity`; FAIL.
- [ ] **Step 3: Implement** the pure functions.
- [ ] **Step 4: Run**; PASS. `nix develop -c npx vitest run src/test/layering.test.ts` PASS.
- [ ] **Step 5: Commit** `Activity: one row per thread from its signals, invites first`.

### Task 4: Activity state and actions

**Files:**
- Create: `src/app/activity/useActivityRows.ts`, `src/app/activity/activityActions.ts`, `src/app/activity/activityState.ts`
- Test: `src/app/activity/activityActions.test.ts`

**Interfaces:**
- Consumes: `crossRoomThreadIndexAtom`, `readThreadSignals`, `buildActivityRows`, `allInvitesAtom`, `categorizeInvite` (`notifications/inbox/inviteFilter.tsx`), `acceptInvite`, `declineInvite`, `toggleReaction`, `buildToolApprovalResponseContent`, `MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT`, `markThreadAsRead`.
- Produces:
```ts
// activityState.ts
export const activityUnreadOnlyAtom: PrimitiveAtom<boolean>;   // default false, session
export const activityShowAutomationsAtom: PrimitiveAtom<boolean>; // default false, session
export const activityPopoverOpenAtom: PrimitiveAtom<boolean>;
// useActivityRows.ts
export const useActivityRows = (): ActivityRowsResult; // memoized per entry.generation
export const useActivityBadge = (): { count: number; needsYou: boolean };
// activityActions.ts
export const answerApproval = (mx: MatrixClient, roomId: string, record: ThreadApprovalRecord, status: 'approved' | 'denied'): Promise<void>;
export const answerQuestion = (mx: MatrixClient, room: Room, threadId: string, question: ThreadQuestion, key: string): Promise<void>;
export const markActivityRowsRead = (mx: MatrixClient, rows: ActivityRow[], hideActivity: boolean): Promise<void>;
```
- [ ] **Step 1: Failing tests:** `answerApproval` sends `io.mindroom.tool_approval_response` with `buildToolApprovalResponseContent(status, threadId, eventId)` where `threadId = approval.threadId ?? eventId`; refuses (rejects) when `canSubmitApprovalDecision` is false; `answerQuestion` calls `sendEvent(roomId, threadId, 'm.reaction', {m.relates_to: annotation key})` and never redacts (an existing own reaction with that key is a no-op); `markActivityRowsRead` calls `markThreadAsRead` once per unread thread row and skips needs-you and invite rows.
- [ ] **Step 2: Run** `nix develop -c npx vitest run src/app/activity`; FAIL.
- [ ] **Step 3: Implement.** `useActivityRows` reads `useAtomValue(crossRoomThreadIndexAtom)`, keeps a `Map<key, {generation, signals}>` in a ref so unchanged entries keep their signals, invites from `allInvitesAtom` minus spam by `categorizeInvite`, `now` refreshed every minute.
- [ ] **Step 4: Run**; PASS.
- [ ] **Step 5: Commit** `Activity: rows from the thread index, and their inline actions`.

### Task 5: Activity list UI and section nav

**Files:**
- Create: `src/app/activity/ActivityList.tsx`, `ActivityList.css.ts`, `ActivityRowItem.tsx`, `ActivityNav.tsx`, `ActivityEmpty.tsx`
- Modify: `src/app/i18n/locales/additions/en.json` (`activity.*` keys)
- Test: `src/app/activity/ActivityList.test.tsx` (jsdom)

**Interfaces:**
- Produces: `ActivityList({ variant: 'popover' | 'page' | 'sheet', onOpenRow?: (row: ActivityRow) => void, onExpand?: () => void })`; `ActivityNav()` (section nav: `PageNav` with header "Activity" and `ActivityList variant="page"`); `ActivityEmpty()` (content index: "Select something in Activity" / "You're all caught up").
- Row click: `navigatePath(withSearchParam(getActivityRoomPath(alias, undefined), { threadId }))` for threads, `getActivityRoomPath(roomId)` for invites; the popover closes.
- [ ] **Step 1: Failing tests:** rows render the sentence ("Code needs approval", "Maya mentioned you, Tom replied · 2 new"), the title and room; Approve calls `answerApproval` and shows "Sending…", then an error text on reject; option buttons call `answerQuestion` with the key; tabs filter; the Unread switch hides read rows; "3 automation runs hidden · Show" sets `activityShowAutomationsAtom`; empty list shows "You're all caught up".
- [ ] **Step 2: Run** `nix develop -c npx vitest run src/app/activity/ActivityList.test.tsx`; FAIL.
- [ ] **Step 3: Implement** with folds (`Box`, `Text`, `Chip`, `Button`, `Icon`), `UserAvatar`/room name helpers already used by `CompactThreadCard`, styles in `ActivityList.css.ts` with logical sides; needs-you rows tinted, unread rows bold with a dot.
- [ ] **Step 4: Run**; PASS; `just strict` and `npx eslint src/app/activity` clean.
- [ ] **Step 5: Commit** `Activity: the list with tabs, inline actions and hidden automations`.

### Task 6: Bell on the rail and in the phone top bar

**Files:**
- Create: `src/app/sidebar/rail/ActivityTab.tsx`, `src/app/activity/ActivitySheet.tsx`
- Modify: `src/app/sidebar/SidebarNav.tsx` (bell where `InboxTab` was), `src/app/sidebar/PhoneTopBar.tsx` (+ `.css.ts`), `src/app/sidebar/rail/ThreadsTab.tsx` (Needs-you badge from Task 8's `useThreadsNeedsYouCount`, added in Task 8)
- Delete: `src/app/sidebar/rail/InboxTab.tsx`, `InboxTab.test.tsx`, `src/app/routes/useInbox.ts`
- Test: `src/app/sidebar/rail/ActivityTab.test.tsx`, `src/app/sidebar/PhoneTopBar.test.tsx`, `src/app/sidebar/SidebarNav.buttons.test.tsx`, `SidebarNav.test.ts`

**Interfaces:**
- Consumes: `useActivityBadge`, `ActivityList`, `activityPopoverOpenAtom`, `useActivitySelected`, `getActivityPath`.
- [ ] **Step 1: Failing tests:** the bell shows the badge count and `highlight` (red) when `needsYou`; on desktop a click opens the popover (`aria-expanded="true"`), a second click or Open as page navigates to `/activity/`; while `/activity/` is shown a click does not open the popover; on phones (in the drawer) a click navigates; the top bar has a bell button before the account that opens the sheet.
- [ ] **Step 2: Run** `nix develop -c npx vitest run src/app/sidebar`; FAIL.
- [ ] **Step 3: Implement** the popover like `SettingsTab` (anchor state, `PopOut` from `ui/directional.tsx`, `position="Right" align="Start"`, `FocusTrap` letting the anchor's click through, width 400 px, max height 70vh scroll); the sheet like `FilterBarMobileSheet` (folds `Overlay`, `FocusScope`, bottom aligned, max height 80%).
- [ ] **Step 4: Run**; PASS.
- [ ] **Step 5: Commit** `Rail: the Activity bell replaces the Inbox, with a popover and a phone sheet`.

### Task 7: Router, Inbox removal, command palette

**Files:**
- Modify: `src/app/shell/Router.tsx`, `src/app/shell/clientPages.tsx`, `src/app/routes/paths.ts`, `src/app/routes/pathUtils.ts`, `src/app/command-palette/commandPaletteActions.ts`, `commandPaletteItems.ts`, `src/app/diagnostics/flightRecorder.ts`, `src/app/navigation/phoneNavDrawer.ts` (comment)
- Delete: `src/app/notifications/inbox/InboxNav.tsx`, `InboxNav.test.tsx`, `Notifications.tsx`, `Notifications.css.ts`, and `src/app/notifications/inboxNotification.ts` with its test if nothing else imports it
- Test: `src/app/shell/Router.inbox.test.tsx` renamed `Router.activity.test.tsx`, `commandPaletteActions.test.ts`, `src/app/bug-reports/error-reporting/routeTemplate.test.ts`, `useNavToActivePathMapper.test.tsx`, `clientRouteRestore.behaviour.test.ts`

**Interfaces:**
- Routes: `ACTIVITY_PATH` section `SectionPage navId="activity" nav={<ActivityNav/>}` with index `SectionIndex page={<ActivityEmpty/>}`, `ACTIVITY_INVITES_PATH` → `<Invites/>`, `ACTIVITY_ROOM_PATH` → `<RoomPage/>`; `THREADS_PATH` section `SectionPage navId="threads" nav={<ThreadsNav/>}` with index `<ThreadsEmpty/>` and `THREADS_ROOM_PATH` → `<RoomPage/>`; `/inbox/*` → `<Navigate to={ACTIVITY_PATH} replace/>`. Task 8 provides `ThreadsNav`/`ThreadsEmpty`; until then the Threads route keeps the old page.
- Command palette: action id `go-activity`, label `nav.activity`, path `getActivityPath()`.
- [ ] **Step 1: Failing tests:** `/activity/` renders the Activity nav and empty page; `/activity/!r:x/?threadId=$t` renders `RoomPage`; `/inbox/invites/` redirects to `/activity/`; `/activity/invites/` renders `Invites`; the palette has Go to Activity.
- [ ] **Step 2: Run** `nix develop -c npx vitest run src/app/shell src/app/command-palette src/app/navigation`; FAIL.
- [ ] **Step 3: Implement**; remove `INBOX_*` and the inbox getters; fix every importer `tsc` reports.
- [ ] **Step 4: Run** the tests and `just typecheck`; PASS.
- [ ] **Step 5: Commit** `Activity: its own section with the thread beside the list; the Inbox goes`.

### Task 8: Threads section rewrite

**Files:**
- Create: `src/app/threads/page/threadGroups.ts`, `ThreadsNav.tsx`, `ThreadsNav.css.ts`, `ThreadsEmpty.tsx`, `useThreadsNeedsYouCount.ts`, `threadsScope.ts`
- Delete: `src/app/threads/page/Threads.tsx`, `ThreadsView.tsx`, `ThreadsView.css.ts`, `ThreadsViewRow.tsx`, `FilterBar.tsx`, `FilterBar.css.ts`, `FilterBarMobileSheet.tsx`, `FilterBarMobileSheet.css.ts`, their tests in `threads/page/__tests__/`, `src/app/threads/cross-room/crossRoomThreadFilters.ts` and its tests
- Modify: `src/app/account/lifecycle/sessionCleanup.ts` (+ test: the scope key replaces the filters key), `src/app/shell/Router.tsx`, `clientPages.tsx`, `src/app/sidebar/rail/ThreadsTab.tsx`, `src/app/i18n/locales/additions/en.json` (`threadsPage.*`)
- Test: `src/app/threads/page/threadGroups.test.ts`, `src/app/threads/page/ThreadsNav.test.tsx` (jsdom)

**Interfaces:**
- Consumes: `crossRoomThreadIndexAtom`, `readThreadSignals`, `useJoinedRoomThreadLists(true)`, `compareCrossRoomThreadEntries` (moved into `threadGroups.ts` if `crossRoomThreadFilterPipeline.ts` goes; keep its sidebar importer working).
- Produces:
```ts
export type ThreadsScope = 'mine' | 'following' | 'all';
export type ThreadGroupId = 'needsYou' | 'unread' | 'working' | 'recent' | 'automations';
export type ThreadListItem = { entry: CrossRoomThreadIndexEntry; signals: ThreadSignals };
export const groupThreads = (items: ThreadListItem[], scope: ThreadsScope, userId: string, query: string): { id: ThreadGroupId; items: ThreadListItem[] }[];
export const useThreadsNeedsYouCount = (): number;
export const threadsScopeAtom: WritableAtom<ThreadsScope, ...>; // per account, localStorage key `mindroom.threadsScope.<userId>`
```
- [ ] **Step 1: Failing tests:** scope `mine` keeps `rootSenderId === userId`, `following` keeps `isInvolved`, `all` keeps everything eligible (replies or pending send); first fitting group wins (a streaming thread with a pending approval is in needsYou); automations only in `all`; query matches `searchableText` (normalized); groups come in the order needsYou, unread, working, recent, automations and empty groups are dropped; recent sorted by `lastActivityTs`. `ThreadsNav`: scope switch, search, Show more after 50 recent, a row navigates to `/threads/<room>/?threadId=<root>`.
- [ ] **Step 2: Run** `nix develop -c npx vitest run src/app/threads/page`; FAIL.
- [ ] **Step 3: Implement**; wire the router (Task 7 interfaces) and the Threads badge.
- [ ] **Step 4: Run** the tests, `just typecheck`, `just strict`, `just lint`; PASS.
- [ ] **Step 5: Commit** `Threads: a section of threads grouped by state, the thread beside the list`.

### Task 9: Translations, docs and product rules

**Files:**
- Modify: `src/app/i18n/locales/additions/*.json` (16 languages), `AGENTS.md` (phone top bar: menu button, search, the Activity bell, account), `docs/architecture.md` (Layout lines for `activity/`, `notifications/` and `threads/`, "Route pages" list), `README.md` (Inbox line)
- Test: `src/app/i18n/localeAdditions.test.ts`

- [ ] **Step 1: Run** `nix develop -c npx vitest run src/app/i18n`; FAIL on missing keys in the 16 overlays.
- [ ] **Step 2: Translate** every new key into each language, with its plural forms.
- [ ] **Step 3: Run**; PASS.
- [ ] **Step 4: Commit** `Activity and Threads: translations, docs and the phone top bar rule`.

### Task 10: End-to-end specs and the push gate

**Files:**
- Create: `e2e/activity/activity.spec.ts`, `e2e/threads/threads-page.spec.ts`
- Modify or delete: the specs that open `/inbox` or the Inbox button (`e2e/notifications/inbox-live`, `inbox-call-rings`, `notifications`, `notifications-paging`, `notification-sender-impostor`; `e2e/sidebar/inbox-mark-read`, `inbox-opens-on-invites`, `inbox-phone-mark-read`, `invites-page`, `invites-accept-all`), the old Threads page specs (`e2e/threads/thread-list-pages.live.spec.ts`, `thread-reply-counts.spec.ts`, `e2e/messages/direction-controls-previews.spec.ts`, `e2e/sidebar/fresh-account-sidebar.spec.ts`, `e2e/account/account-menu.spec.ts`), `scripts/push-gate.sh` (smoke list: `e2e/activity/activity.spec.ts` instead of `e2e/sidebar/inbox-mark-read.spec.ts`)

- [ ] **Step 1: Write** `activity.spec.ts`: a person and an `@mindroom_` agent account; the person starts a thread, the agent replies mentioning them and posts a pending `io.mindroom.tool_approval` for them; the bell badge shows; the popover lists "needs approval" and the mention; Approve sends a response the spec reads back from the room; a row opens `/activity/<room>/?threadId=` with the list beside it; after reading, Unread hides the row; at 390x844 the top bar bell opens the sheet.
- [ ] **Step 2: Write** `threads-page.spec.ts`: Following lists the person's thread under Unread after an agent reply, under Recent after reading; Mine/All switch; a row opens the thread beside the list.
- [ ] **Step 3: Update** each listed spec to the new paths (`/activity/invites/` for the invite list, `/activity/` for the bell), or delete the ones whose page is gone (Notifications page specs).
- [ ] **Step 4: Run** `just e2e-slot 31 --snapshot e2e/activity e2e/threads/threads-page.spec.ts` and every changed spec; PASS.
- [ ] **Step 5: Commit** `e2e: Activity and Threads sections replace the Inbox and old Threads page specs`.

### Task 11: Verification, screenshots, pull request

- [ ] **Step 1: Run** `just typecheck`, `just strict`, `just lint`, `just test`, `just license-check`, `just upstream-overlap <corpus>` (via the installed hook on push); all pass.
- [ ] **Step 2: Screenshots** at the branch head on a slot (throwaway Playwright spec, not committed): desktop popover, Activity page with thread, Threads page, phone sheet, phone Threads list.
- [ ] **Step 3: Review** the whole branch with a fresh reviewer (baspowers:requesting-code-review); fix findings.
- [ ] **Step 4: Push** the branch and `gh pr create` with the screenshots attached (`--attach '<file>#<alt>'`).
