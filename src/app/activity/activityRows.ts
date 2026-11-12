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

/** An automation listed only because Show is on: it neither waits for the user nor names them. */
const isShownAutomation = (row: ActivityRow): boolean =>
  row.type === 'thread' &&
  row.signals.automation &&
  !row.entry.isInvolved &&
  !needsYou(row) &&
  !row.signals.mentionedMe;

/** How many rows are unread for the bell and the tabs; showing automations lists them, no more. */
export const unreadCount = (rows: ActivityRow[]): number =>
  rows.filter((row) => row.unread && !isShownAutomation(row)).length;

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
  // A mention known only from the highlight count: whoever wrote last need not be who named them.
  if (kind === 'mention' && !signals.mentionedBy) return [];
  const first = signals.mentionedBy ? [signals.mentionedBy] : [];
  const actors = [...new Set([...first, ...signals.newSenderIds])].filter(Boolean);
  if (actors.length > 0) return actors;
  return signals.lastReply ? [signals.lastReply.senderId] : [];
};

const compareRows = (a: ActivityRow, b: ActivityRow): number =>
  Number(needsYou(b)) - Number(needsYou(a)) || b.ts - a.ts;

/**
 * Activity's rows: a thread that waits for the person or names them, and a thread they take part
 * in with activity in the last `ACTIVITY_READ_WINDOW_MS`, one row each; then the invites. A
 * thread an agent runs alone (an automation) is only counted, unless it names them, it waits for
 * them, or `showAutomations` lists it. A resolved thread has no row and is not counted, until
 * news (`ThreadSignals.newsTs`) comes in it after it was resolved.
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
    const threadSignals = signals(entry);
    // Resolving a thread answers what it held; only news that comes after brings it back.
    if (entry.isResolved && (threadSignals.newsTs ?? 0) <= (entry.resolvedTs ?? Infinity)) {
      continue;
    }
    const recent = now - entry.lastActivityTs <= ACTIVITY_READ_WINDOW_MS;
    const waits = !!threadSignals.pendingApproval || !!threadSignals.pendingQuestion;
    const named = threadSignals.mentionedMe;
    // What waits for the person or names them stays however old; the rest leaves after the window.
    if (!waits && !named) {
      if (!recent) continue;
      if (threadSignals.automation && !entry.isInvolved) {
        if (!showAutomations) {
          hiddenAutomations += 1;
          continue;
        }
      } else if (!entry.isInvolved) continue;
    }
    // A mention is unread by its signal: it may sit in the root, which no reply count holds.
    const unread = waits || named || threadSignals.newCount > 0;
    const kind = threadKind(threadSignals);
    // A reply row says who replied; a thread with no counted reply has nothing to tell yet.
    if (kind === 'reply' && !threadSignals.lastReply && threadSignals.newCount === 0) continue;
    const actorIds = actorsOf(kind, threadSignals);
    rows.push({
      type: 'thread',
      key: entry.key,
      kind,
      entry,
      signals: threadSignals,
      unread,
      ts: Math.max(entry.lastActivityTs, threadSignals.lastReply?.ts ?? 0),
      actorIds,
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
  unreadOnly: boolean,
  /** A row to keep whatever its state: the one shown beside the list, which reading changes. */
  keep?: (row: ActivityRow) => boolean
): ActivityRow[] =>
  rows.filter((row) => {
    // Reading it may clear the row's unread state and its mention; it stays while it shows.
    if (keep?.(row)) return true;
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
