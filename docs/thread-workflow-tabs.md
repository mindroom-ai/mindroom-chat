# Room workflow tabs

Advanced filters in agent rooms use Needs you, Working, Later, Done and All, with counts.
New Compact room preferences start on Needs you; Threads starts unfiltered (All). Simple mode still uses its existing Unresolved toggle
and sort controls. Rooms without agents retain their existing controls.

One pure classifier, `event-store/threads/threadWorkflow.ts`, serves the room overview and the
sidebar Sections layout. The first match wins:

1. Resolved: Done.
2. Currently snoozed (`isSnoozedAt`): Later.
3. A thread background job awaiting approval: Needs you.
4. Streaming or a live thread background job: Working.
5. Scheduled tasks: Later.
6. Otherwise: Needs you, including read, idle threads.

Only published live jobs whose `thread_id` matches the root count; room-wide jobs do not.
Completion removes a job from the published list. `finished` is only an internal jobs-bar display
status, not an incoming job status. All published statuses except `awaiting_approval` count as
live work. In the sidebar, Done maps to Resolved, Later stays Later, and Needs you maps to Idle.
Later sorts by active snooze end or next scheduled time, soonest first; unknown return times
follow by latest activity. Pins still lead the section, and its cap and tie ordering are unchanged.
Pending sends alone do not constitute Working. Resolved and snoozed now precede streaming there too.

In agent rooms, Compact's Group switch (a layers icon labelled "Group", only the icon on a narrow
bar like the tabs; tooltip "Group by status"; beside the sort, which it hides with its lock) groups
the cards the filters show by the same classifier, at the same snooze clock as the tab filter
(`useThreadIndex`'s `snoozeNow`), Working first, then Needs you, Later and Done, each under a
header with its count; a tab that shows one bucket shows one section. It owns no filter. Working
goes by when each thread started, Needs you by when its last run finished or its newest message
came (a reply still streaming counts from when it was sent), Later by the same return time as the
sidebar (`threadReturnTs`), and Done by when it was resolved; pins lead each section.
The switch and the folded sections are stored per account (`compactRoomSections:<userId>`), Done
folded at first. A section that shows alone, as under its tab, is open and folds nothing: its
stored fold is kept for when the other sections come back.

## Saved filters and search

The existing per-user, per-room `roomThreadFilterState` key and storage version 2 are unchanged.
`tab` is optional. Version 1 and version 2 states without it retain their legacy status filters;
unknown tab values are ignored. No preference reset or bulk rewrite occurs. Legacy status restrictions remain in the DSL query with no segment selected; legacy states
without status restrictions select All.
Choosing any segment, including All, clears all six legacy status tri-states and their OR mode.
It preserves people, tags, text search, unsupported query text, and sort. Counts respect people,
tags and text, but ignore the selected bucket and legacy status restrictions.

Legacy `is:` and `-is:` tokens still work. Entering a status token leaves bucket mode and uses the
legacy status expression. Text-only or tag-only search keeps the selected tab. Bucket tokens are
not added. Simple mode projects away the tab without overwriting the stored advanced preference.
Its Unresolved toggle retains its own stored resolved restriction. On returning to advanced mode,
a stored tab is authoritative: the effective advanced filter clears legacy status restrictions
without changing the stored Simple preference. Thus Done still shows resolved threads after a
Simple-mode Unresolved toggle, and returning to Simple restores that toggle unless search was
edited while a tab was selected. Applying a search query through `applyParsedThreadFilterQuery`
clears the legacy status fields in that case, including Simple's stored Unresolved restriction;
returning to Simple then does not restore it.
Reset clears all filters; it does not silently reapply Needs you. The tab is part of the frozen-sort
control signature, so changing tabs refreshes the frozen order as other filter changes do.

## Updates and cost

Room overviews subscribe through `useRoomBackgroundJobs`. Jobs are indexed once per jobs snapshot
change, then joined to memoized base records by root ID. Job-only updates do not rebuild base
records or reread timeline history. The overlay never mutates base maps; unchanged records and
unchanged job-flag overlays retain identity. Sidebar index entries share a per-room jobs index, invalidated by
trusted state content or membership changes. Background-job and membership state events refresh
only cross-room entries whose job flags changed; repeated lazy membership state does no rebuild. Scheduled tasks use the same trusted sender rule as the room schedule controls. The cross-room
index reads schedules once per room per flush, not per root. Schedule state updates refresh only
roots whose scheduled status changed, including a task's former root when moved or removed.
Neither path introduces `findEventById` calls in classification.

Pending tool approvals and questions from `threads/cross-room/threadSignals.ts` are not included.
Room overview records do not already carry those signals; computing them there would introduce
additional timeline scanning and a higher-layer dependency into the shared filtering model.
Background-job approval is included. Activity, reason chips and inline approval are unchanged.
