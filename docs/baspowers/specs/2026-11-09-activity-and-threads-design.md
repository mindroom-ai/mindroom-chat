# Activity and Threads

Bas Nijholt asked on 2026-11-09 for an activity menu and a threads menu that make it easy to see what is going on, where you are mentioned, and what waits for you, "very much like Slack". He chose the design from mockups: an Activity popover on the rail that expands into a full Activity page with the thread beside the list, and a rewritten Threads page that groups threads by state. The old Threads page and the Inbox go.

## What the production data says

Measured on the `mindroom` LXC event journal over 30 days (5,272 messages, 15 rooms, 347 threads):

- Two of three messages come from agents; a median agent reply is 484 characters (p90 3,000), a human message 63.
- Mentions are rare (66 from agents to people, 20 from people to agents in 30 days), so a feed of mentions alone stays empty. The main signal is a reply in a thread you take part in.
- 193 of the 347 threads have no person in them: scheduled runs and hooks. They must not flood the lists.
- Most threads carry an AI title (`io.mindroom.thread_summary`); a voice message's body is its file name.
- A thread's last message is often noise: a title notice, a skill review notice, a tool-only body.
- Agents ask questions with option buttons (`io.mindroom.interactive`, 72 in the journal) and ask for tool approvals: both need a click, not a read.
- Every reply ends with a terminal stream status; runs that take long or stop are worth telling.
- Threads are short: a median of 4 messages over 12 minutes, about 12 active threads a day.

## Decisions

1. **Two sections, one reader.** Activity and Threads become sections of the app like Home and Direct: the list is the section's navigation column, and the content beside it is the normal room route showing the selected thread (`/activity/<room>/?threadId=<root>`, `/threads/<room>/?threadId=<root>`). The reader is the existing thread view (`room/Room.tsx`), with its banner, tools, approvals and composer; nothing renders a room outside a room route.
2. **Activity answers "what happened to me".** Rows are events, merged one row per thread: needs you (a pending approval for you, an agent question, an invite), a mention of you, replies, an agent run that finished after a long time or stopped. Reading the thread clears its row.
3. **Threads answers "where do my conversations stand".** Rows are threads, grouped by state: Needs you, Unread, Agents working, Recent, and Automations folded at the end. A thread never leaves the list; it moves between groups.
4. **Read state is the only state.** No Done, Snooze, Follow or Mark unread: the thread read receipts decide unread, so the two views, the rail badges and every device agree without new account data.
5. **Inbox goes.** The bell replaces the Inbox rail button. Invites are Needs-you rows in Activity; the full invite list (with its spam filter and Accept All) moves to `/activity/invites/`. The Notifications page (`GET /notifications`) goes; `/inbox/...` addresses redirect to `/activity/`.
6. **Automations stay out of the way.** A thread is an automation when an agent sent its root and no person has written in it. Activity hides them unless one mentions you (a count with Show); Threads lists them only under All, folded.
7. **Noise never counts.** A reply counts for Activity rows and previews only when it is an `m.room.message` that is not an `m.notice`, not a title notice, not a call row, not a thinking placeholder and not redacted. Voice, image and file messages preview as their kind, not their file name.

## Activity

### Rows

`threads/cross-room/threadSignals.ts` reads one thread's recent events (the SDK thread's timeline, its last 40 events) and returns:

| Signal | Rule |
|---|---|
| `pendingApproval` | the newest `io.mindroom.tool_approval` record of the thread (`collectThreadApprovals`) from an agent that `canSubmitApprovalDecision` allows the user to answer |
| `pendingQuestion` | the newest agent message carries `io.mindroom.interactive` with emoji option keys, the user has not reacted to it with one of them, and has not written in the thread since |
| `mentionedMe` | an unread counted reply names the user in `m.mentions.user_ids`, or the SDK's highlight count for the thread is above 0 |
| `newCount` | counted replies from others the user has not read (`room.hasUserReadEvent`) |
| `lastReply` | the newest counted reply: sender, preview text, time |
| `outcome` | the newest agent reply's terminal status: `stopped` for cancelled, error or interrupted; `finished` when its last edit came 60 s or more after it; with its tool count |
| `automation` | the root's sender is an agent and no person sent a counted reply |

`activity/activityRows.ts` turns the cross-room thread index (`threads/cross-room/crossRoomThreadIndex.ts`), these signals and the invites into rows:

- A thread gets a row when it needs you, mentions you, or is one you take part in (`isInvolved`) with activity in the last 7 days.
- Its kind, in this order: `approval`, `question`, `mention`, `stopped`, `finished`, `reply`. Its sentence names who: "Code needs approval", "Mind asked you", "Maya mentioned you, Tom replied · 2 new", "Research finished · 6 min, 3 tools", "Mind replied · 2 new".
- A row is unread while the thread is unread or it needs you.
- Order: needs-you rows first (newest first), then the rest by their newest event, with Today, Yesterday and Earlier dividers.
- Invites are `invite` rows among the needs-you ones; invites the invite filter calls spam stay on the invites page.
- Automation threads count into "N automation runs hidden · Show" unless they mention you.

### Inline actions

- Approval: Approve and Deny (`buildToolApprovalResponseContent`, sent as `io.mindroom.tool_approval_response`, like `StandaloneToolApprovalCard`), and Details, which opens the thread.
- Question: one button per emoji option with its label; a click sends that reaction (`toggleReaction`) and the row shows the answer as sent.
- Invite: Join (`acceptInvite`) and Decline (`declineInvite`).
- Each action shows its sending state and its error in the row, and never opens the thread.

### Where it shows

- **Popover (wider than a phone).** The rail's bell (`sidebar/rail/ActivityTab.tsx`) opens it anchored to the button, over the current page: header with Unread switch, Mark all read and Open as page; tabs All, Mentions, Replies, Needs you; the rows. A row opens its thread at `/activity/...`. Clicking the bell while the popover is open, or while Activity is the shown section, opens the page.
- **Page.** `/activity/`: the same list in the section's navigation column; the content shows the selected thread, or an empty state. `/activity/invites/` shows the invite list.
- **Phone.** A bell in the top bar, before the account, opens the list as a sheet from the bottom. A row opens the thread full screen at `/activity/...`; Back returns. The rail in the drawer has the bell as a section button.
- **Badge.** The bell shows the number of unread rows, red when one needs you.

Mark all read sends a read receipt for each listed unread thread (`markThreadAsRead`), not for needs-you rows.

## Threads

`threads/page/` is rewritten; the list is `ThreadsNav`, the section's navigation column.

- Scope: **Mine** (you sent the root), **Following** (you take part: `isInvolved`), **All** (every thread of your joined rooms). Following is the default, kept per account in local storage.
- A search field filters on the entry's searchable text.
- Groups, each thread in the first that fits: **Needs you** (pending approval for you or a question), **Unread**, **Agents working** (`isStreaming`), **Recent** (by last activity, 50 at a time with Show more). In All, automation threads go to a folded **Automations** group.
- A row: the title (AI title, else root preview), a chip for approval, question or mention, the last counted reply as "Sender: preview", the room, the time, and the new count. A resolved thread shows a check.
- A row opens the thread at `/threads/...`. The section with no thread open shows an empty state.
- The rail's Threads button badge counts Needs-you threads.

The sidebar THREADS section and Recently opened stay as they are.

## Routes and navigation

- `routes/paths.ts`: `ACTIVITY_PATH`, `ACTIVITY_INVITES_PATH`, `ACTIVITY_ROOM_PATH` (`/activity/:roomIdOrAlias/:eventId?/`), `THREADS_ROOM_PATH` (`/threads/:roomIdOrAlias/:eventId?/`); the `INBOX_*` paths go.
- `navigation/useRoomNavigate.ts`: the room the route shows stays in the Activity or Threads section, as it stays in a space, so the thread view's own navigation (exit, another thread of the room, an event) keeps the list beside it.
- `navigation/viewedPlace.ts` and `navigation/clientRouteRestore.ts` read the new room routes, so notifications stay quiet for the thread on screen and a reload restores it.
- The command palette's Inbox action becomes Activity.

## Code placement

- New domain `activity` at layer 10 (`.eslintrc.cjs` `LAYERS`, `docs/architecture.md`): it reads threads (9), notifications (8), approvals (6), messages (7) and rooms (9); the sidebar (13) and shell (14) use it.
- `threads/cross-room/threadSignals.ts` (layer 9) serves both views.
- `notifications/inbox/` keeps `Invites.tsx`, `inviteFilter.tsx`, `acceptInvite.ts` and `declineInvite.ts`; `InboxNav.tsx`, `Notifications.tsx` and their styles go, with `routes/useInbox.ts` and `sidebar/rail/InboxTab.tsx`.
- `threads/page/Threads.tsx`, `ThreadsView*`, `FilterBar*` and `threads/cross-room/crossRoomThreadFilters.ts` go; `useJoinedRoomThreadLists.ts` and `JoinedRoomThreadListsFeature.tsx` stay. The Threads page asks for every page of every room's thread list, as the old page did.
- New strings go in `i18n/locales/additions/*.json` (English and the 16 other languages).
- `AGENTS.md`'s product rules name the bell in the phone top bar.

## Testing

- Unit: `threadSignals` (each signal and the noise rules), `activityRows` (kinds, merging, order, automations, invites), the Threads grouping, the route helpers, and jsdom tests of the Activity list's actions, the rail button and the phone top bar button.
- e2e: `e2e/activity/activity.spec.ts` with a person and a MindRoom agent account (an `@mindroom_` user) on the test homeserver: an agent reply with a mention and a pending approval in the person's thread show as rows and on the badge; Approve from the popover sends the response; a row opens the thread beside the page list and reading clears the row; a phone sheet opens from the top bar. `e2e/threads/threads-page.spec.ts`: groups and scope. Specs of the Inbox and the old Threads page are replaced or removed; `scripts/push-gate.sh` runs the Activity spec instead of `inbox-mark-read`.

## Out of scope

Done and Snooze, following or unfollowing a thread by hand, mark as unread, a cross-room list of approvals for threads you do not take part in, desktop notifications changes, and mentions in a room's main timeline outside a thread (the thread index lists threads with replies).
