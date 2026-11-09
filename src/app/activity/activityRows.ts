import type { CrossRoomThreadIndexEntry } from '../threads/cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../threads/cross-room/threadSignals';

export type ActivityKind =
  | 'approval'
  | 'question'
  | 'invite'
  | 'mention'
  | 'stopped'
  | 'finished'
  | 'reply';
export type ActivityTab = 'all' | 'mentions' | 'replies' | 'needsYou';

/** One thread in Activity: its most pressing news, who it is from, and whether it is unread. */
export type ActivityThreadRow = {
  type: 'thread';
  key: string;
  kind: Exclude<ActivityKind, 'invite'>;
  entry: CrossRoomThreadIndexEntry;
  signals: ThreadSignals;
  unread: boolean;
  ts: number;
  /** Who the row's sentence names: who asks or mentioned first, then who else replied. */
  actorIds: string[];
};
export type ActivityInviteRow = {
  type: 'invite';
  key: string;
  kind: 'invite';
  roomId: string;
  inviterId?: string;
  unread: true;
  ts: number;
};
export type ActivityRow = ActivityThreadRow | ActivityInviteRow;
export type ActivityRowsResult = { rows: ActivityRow[]; hiddenAutomations: number };
export type ActivityInvite = { roomId: string; inviterId?: string; ts: number };

/** How long a read thread stays in Activity after its last activity. */
export const ACTIVITY_READ_WINDOW_MS = 7 * 24 * 3600_000;

const NEEDS_YOU_KINDS = new Set<ActivityKind>(['approval', 'question', 'invite']);
const REPLY_KINDS = new Set<ActivityKind>(['reply', 'finished', 'stopped']);

/** Whether the row waits for an answer: an approval, a question, an invite. */
export const needsYou = (row: ActivityRow): boolean => NEEDS_YOU_KINDS.has(row.kind);

const threadKind = (signals: ThreadSignals): ActivityThreadRow['kind'] => {
  if (signals.pendingApproval) return 'approval';
  if (signals.pendingQuestion) return 'question';
  if (signals.mentionedMe) return 'mention';
  const { outcome, lastReply } = signals;
  if (outcome && (!lastReply || outcome.ts >= lastReply.ts)) return outcome.kind;
  return 'reply';
};

const actorsOf = (kind: ActivityThreadRow['kind'], signals: ThreadSignals): string[] => {
  if (kind === 'approval') return [signals.pendingApproval?.sender ?? ''];
  if (kind === 'question') return [signals.pendingQuestion?.senderId ?? ''];
  if ((kind === 'finished' || kind === 'stopped') && signals.outcome) {
    return [signals.outcome.senderId];
  }
  const first = signals.mentionedBy ? [signals.mentionedBy] : [];
  const actors = [...new Set([...first, ...signals.newSenderIds])].filter(Boolean);
  if (actors.length > 0) return actors;
  return signals.lastReply ? [signals.lastReply.senderId] : [];
};

const compareRows = (a: ActivityRow, b: ActivityRow): number =>
  Number(needsYou(b)) - Number(needsYou(a)) || b.ts - a.ts;

/**
 * Activity's rows: a thread that waits for the person or names them, and a thread they take part
 * in that has news or had activity in the last `ACTIVITY_READ_WINDOW_MS`, one row each; then the
 * invites. A thread an agent runs alone (an automation) is only counted, unless it names them, it
 * waits for them, or `showAutomations` lists it.
 */
export const buildActivityRows = ({
  entries,
  signals,
  invites,
  now,
  showAutomations,
}: {
  entries: Iterable<CrossRoomThreadIndexEntry>;
  signals: (entry: CrossRoomThreadIndexEntry) => ThreadSignals;
  invites: ActivityInvite[];
  now: number;
  showAutomations: boolean;
}): ActivityRowsResult => {
  const rows: ActivityRow[] = [];
  let hiddenAutomations = 0;
  for (const entry of entries) {
    const recent = now - entry.lastActivityTs <= ACTIVITY_READ_WINDOW_MS;
    if (!recent && !entry.isUnread) continue;
    const threadSignals = signals(entry);
    const waits = !!threadSignals.pendingApproval || !!threadSignals.pendingQuestion;
    const named = threadSignals.mentionedMe;
    const unread = waits || threadSignals.newCount > 0;
    if (!waits && !named) {
      if (threadSignals.automation && !entry.isInvolved) {
        if (!showAutomations) {
          hiddenAutomations += 1;
          continue;
        }
      } else if (!entry.isInvolved || (!unread && !recent)) continue;
    }
    const kind = threadKind(threadSignals);
    rows.push({
      type: 'thread',
      key: entry.key,
      kind,
      entry,
      signals: threadSignals,
      unread,
      ts: Math.max(entry.lastActivityTs, threadSignals.lastReply?.ts ?? 0),
      actorIds: actorsOf(kind, threadSignals),
    });
  }
  for (const invite of invites) {
    rows.push({
      type: 'invite',
      key: `invite:${invite.roomId}`,
      kind: 'invite',
      roomId: invite.roomId,
      ...(invite.inviterId ? { inviterId: invite.inviterId } : {}),
      unread: true,
      ts: invite.ts,
    });
  }
  rows.sort(compareRows);
  return { rows, hiddenAutomations };
};

/** The rows of one Activity tab, and only the unread ones when `unreadOnly`. */
export const filterActivityRows = (
  rows: ActivityRow[],
  tab: ActivityTab,
  unreadOnly: boolean
): ActivityRow[] =>
  rows.filter((row) => {
    if (unreadOnly && !row.unread) return false;
    switch (tab) {
      case 'mentions':
        return row.kind === 'mention';
      case 'replies':
        return REPLY_KINDS.has(row.kind);
      case 'needsYou':
        return needsYou(row);
      case 'all':
        return true;
    }
  });

/** Which divider a row's time falls under, by the local calendar. */
export const activityDay = (ts: number, now: number): 'today' | 'yesterday' | 'earlier' => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = today.getTime();
  if (ts >= start) return 'today';
  const yesterday = new Date(start);
  yesterday.setDate(yesterday.getDate() - 1);
  return ts >= yesterday.getTime() ? 'yesterday' : 'earlier';
};
