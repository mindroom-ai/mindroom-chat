import {
  normalizeThreadSearchText,
  type CrossRoomThreadIndexEntry,
} from '../cross-room/crossRoomThreadIndex';
import {
  compareCrossRoomThreadEntries,
  isCrossRoomThreadEntryEligible,
} from '../cross-room/crossRoomThreadOrder';
import type { ThreadSignals } from '../cross-room/threadSignals';
import { isSnoozedAt } from '../../event-store/threads/threadSnooze';

/** Mine: threads the user started; Following: threads they take part in; All: every thread. */
export type ThreadsScope = 'mine' | 'following' | 'all';
export type ThreadGroupId =
  | 'needsYou'
  | 'unread'
  | 'working'
  | 'recent'
  | 'snoozed'
  | 'automations';
export type ThreadListItem = { entry: CrossRoomThreadIndexEntry; signals: ThreadSignals };
export type ThreadGroup = { id: ThreadGroupId; items: ThreadListItem[] };

const GROUP_ORDER: ThreadGroupId[] = [
  'needsYou',
  'unread',
  'working',
  'recent',
  'snoozed',
  'automations',
];

const inScope = (entry: CrossRoomThreadIndexEntry, scope: ThreadsScope, userId: string) => {
  if (scope === 'mine') return entry.rootSenderId === userId;
  if (scope === 'following') return entry.isInvolved;
  return true;
};

const groupOf = (
  { entry, signals }: ThreadListItem,
  scope: ThreadsScope,
  now: number
): ThreadGroupId | undefined => {
  if (signals.pendingApproval || signals.pendingQuestion) return 'needsYou';
  if (signals.automation && !entry.isInvolved) return scope === 'all' ? 'automations' : undefined;
  if (signals.newCount > 0 || signals.mentionedMe) return 'unread';
  if (entry.threadRecord.status.isStreaming) return 'working';
  if (isSnoozedAt(entry.snoozedUntilTs, now)) return 'snoozed';
  return 'recent';
};

/**
 * The Threads page's groups for `scope` and the search `query`: each thread with replies in the
 * first group that fits (needs you, unread, an agent working, recent, snoozed, automations),
 * newest first; empty groups are left out. Automations, threads agents run alone, show only under
 * All. A thread snoozed at `now` that would sit in Recent goes to Snoozed instead.
 */
export const groupThreads = (
  items: Iterable<ThreadListItem>,
  scope: ThreadsScope,
  userId: string,
  query: string,
  now: number
): ThreadGroup[] => {
  const needle = normalizeThreadSearchText(query);
  const groups = new Map<ThreadGroupId, ThreadListItem[]>();
  for (const threadItem of items) {
    const { entry } = threadItem;
    if (!isCrossRoomThreadEntryEligible(entry) || !inScope(entry, scope, userId)) continue;
    if (needle && !entry.searchableText.includes(needle)) continue;
    const id = groupOf(threadItem, scope, now);
    if (!id) continue;
    const list = groups.get(id) ?? [];
    list.push(threadItem);
    groups.set(id, list);
  }
  return GROUP_ORDER.flatMap((id) => {
    const list = groups.get(id);
    if (!list) return [];
    list.sort((a, b) => compareCrossRoomThreadEntries(a.entry, b.entry));
    return [{ id, items: list }];
  });
};
