import { describe, expect, it } from 'vitest';
import type { CrossRoomThreadIndexEntry } from '../threads/cross-room/crossRoomThreadIndex';
import type { ThreadApprovalRecord } from '../matrix/protocol/threadApprovalModel';
import type { ThreadSignals } from '../threads/cross-room/threadSignals';
import {
  ACTIVITY_READ_WINDOW_MS,
  activityDay,
  buildActivityRows,
  filterActivityRows,
  needsYou,
  unreadCount,
  type ActivityRow,
} from './activityRows';

const DAY = 24 * 3600_000;
const NOW = new Date(2026, 10, 9, 15, 0).getTime();

const entry = (key: string, overrides: Partial<CrossRoomThreadIndexEntry> = {}) =>
  ({
    key,
    roomId: `!${key}:x`,
    threadRootId: `$${key}`,
    isInvolved: true,
    isUnread: false,
    lastActivityTs: NOW - 3600_000,
    threadRecord: { presentation: {}, status: {} },
    ...overrides,
  } as CrossRoomThreadIndexEntry);

const quiet: ThreadSignals = {
  mentionedMe: false,
  newCount: 0,
  newSenderIds: [],
  automation: false,
};
const approvalRecord = { eventId: '$ask', sender: '@mindroom_code:x' } as ThreadApprovalRecord;
const reply = (senderId: string) => ({
  eventId: '$reply',
  senderId,
  ts: NOW - 3600_000,
  preview: { kind: 'text' as const, text: 'Done' },
  event: { sender: senderId, content: {} },
});

const build = (
  items: [CrossRoomThreadIndexEntry, Partial<ThreadSignals>][],
  extra: Partial<Parameters<typeof buildActivityRows>[0]> = {}
) => {
  // Signals as a thread with a counted reply has them, unless the case says otherwise.
  const byKey = new Map(
    items.map(([e, s]) => [e.key, { ...quiet, lastReply: reply('@tom:x'), ...s }])
  );
  return buildActivityRows({
    entries: items.map(([e]) => e),
    signals: (e) => byKey.get(e.key) ?? quiet,
    invites: [],
    now: NOW,
    showAutomations: false,
    ...extra,
  });
};

const kinds = (rows: ActivityRow[]) => rows.map((row) => `${row.key}:${row.kind}`);

describe('buildActivityRows', () => {
  it('gives each thread its most pressing kind', () => {
    const { rows } = build([
      [entry('a'), { pendingApproval: approvalRecord, mentionedMe: true, newCount: 2 }],
      [entry('b'), { mentionedMe: true, mentionedBy: '@maya:x', newCount: 2 }],
      [entry('c'), { newCount: 1, newSenderIds: ['@tom:x'] }],
      [
        entry('d'),
        {
          newCount: 1,
          outcome: { kind: 'stopped', senderId: '@mindroom_code:x', ts: NOW, durationMs: 1 },
        },
      ],
    ]);
    expect(kinds(rows)).toEqual(['a:approval', 'b:mention', 'c:reply', 'd:stopped']);
  });

  it('keeps read threads of the last 7 days and drops older ones', () => {
    const { rows } = build([
      [entry('recent', { lastActivityTs: NOW - 2 * DAY }), {}],
      [entry('old', { lastActivityTs: NOW - ACTIVITY_READ_WINDOW_MS - DAY }), {}],
    ]);
    expect(rows.map((row) => [row.key, row.unread])).toEqual([['recent', false]]);
  });

  it('leaves out older threads with unread replies, unless they name the user', () => {
    const old = { lastActivityTs: NOW - ACTIVITY_READ_WINDOW_MS - DAY, isUnread: true };
    const { rows } = build([
      [entry('stale', old), { newCount: 3, newSenderIds: ['@mindroom_mind:x'] }],
      [entry('named', old), { newCount: 1, mentionedMe: true }],
    ]);
    expect(kinds(rows)).toEqual(['named:mention']);
  });

  it('leaves out a resolved thread, whatever waits in it or names the user', () => {
    const question = { eventId: '$q', senderId: '@mindroom_mind:x', text: 'q', options: [] };
    const resolved = { isResolved: true, resolvedTs: NOW - 60_000 };
    const { rows, hiddenAutomations } = build([
      [entry('asks', resolved), { pendingQuestion: question }],
      [entry('approval', resolved), { pendingApproval: approvalRecord }],
      [entry('named', resolved), { mentionedMe: true, newCount: 1 }],
      [entry('reply', resolved), { newCount: 1, newSenderIds: ['@tom:x'] }],
      [entry('run', { ...resolved, isInvolved: false }), { automation: true, newCount: 1 }],
      // Before the tag's state event has come back, no time is known: it counts as just resolved.
      [entry('pending', { isResolved: true }), { pendingQuestion: question }],
      [entry('open'), { pendingQuestion: question }],
    ]);
    expect(kinds(rows)).toEqual(['open:question']);
    expect(hiddenAutomations).toBe(0);
  });

  it('lists a resolved thread again once something happens in it after', () => {
    const before = { isResolved: true, resolvedTs: NOW - 2 * 3600_000 };
    const { rows } = build([
      [entry('named', before), { mentionedMe: true, mentionedBy: '@tom:x', newCount: 1 }],
      [entry('replied', { ...before, lastActivityTs: NOW - 3 * 3600_000 }), { newCount: 1 }],
    ]);
    // The reply counts by its own time, which the index's last activity may not have caught up to.
    expect(kinds(rows)).toEqual(['named:mention', 'replied:reply']);
  });

  it('calls a thread whose root names the user unread, though no reply is new', () => {
    const { rows } = build([[entry('root'), { mentionedMe: true, newCount: 0 }]]);
    expect(rows.map((row) => [row.key, row.kind, row.unread])).toEqual([['root', 'mention', true]]);
  });

  it('leaves out a thread with nothing to tell: no reply counted, nobody to name', () => {
    // An agent still on its thinking placeholder, or only notices since the root.
    const { rows } = build([[entry('quiet'), { lastReply: undefined }]]);
    expect(rows).toEqual([]);
  });

  it('names no mentioner for a mention known only from the highlight count', () => {
    // Who wrote last is not who mentioned the user: the row leads with no one.
    const { rows } = build([
      [entry('hl'), { mentionedMe: true, newCount: 1, newSenderIds: ['@mindroom_mind:x'] }],
    ]);
    expect(rows.map((row) => row.type === 'thread' && row.actorIds)).toEqual([[]]);
  });

  it('keeps an older thread while it waits for the user', () => {
    const old = { lastActivityTs: NOW - ACTIVITY_READ_WINDOW_MS - DAY };
    const question = { eventId: '$q', senderId: '@mindroom_mind:x', text: 'q', options: [] };
    const { rows } = build([[entry('asks', old), { pendingQuestion: question }]]);
    expect(kinds(rows)).toEqual(['asks:question']);
  });

  it('lists a thread the user is not part of only when it names them or waits for them', () => {
    const { rows } = build([
      [entry('named', { isInvolved: false }), { mentionedMe: true, newCount: 1 }],
      [entry('waits', { isInvolved: false }), { pendingApproval: approvalRecord }],
      [entry('other', { isInvolved: false }), { newCount: 3 }],
    ]);
    expect(rows.map((row) => row.key).sort()).toEqual(['named', 'waits']);
  });

  it('counts automations apart unless they name the user or Show is on', () => {
    const items: [CrossRoomThreadIndexEntry, Partial<ThreadSignals>][] = [
      [entry('digest', { isInvolved: false, isUnread: true }), { automation: true, newCount: 1 }],
      [entry('sweep', { isInvolved: false }), { automation: true }],
      [
        entry('ping', { isInvolved: false, isUnread: true }),
        { automation: true, mentionedMe: true, newCount: 1 },
      ],
    ];
    const hidden = build(items);
    expect(hidden.rows.map((row) => row.key)).toEqual(['ping']);
    expect(hidden.hiddenAutomations).toBe(2);

    const shown = build(items, { showAutomations: true });
    expect(shown.rows.map((row) => row.key).sort()).toEqual(['digest', 'ping', 'sweep']);
    expect(shown.hiddenAutomations).toBe(0);
    // Showing them lists them; it does not make the bell count them.
    expect(unreadCount(shown.rows)).toBe(unreadCount(hidden.rows));
  });

  it('does not call a thread unread when only noise came in', () => {
    const { rows } = build([[entry('noise', { isUnread: true }), { newCount: 0 }]]);
    expect(rows[0]).toMatchObject({ key: 'noise', unread: false });
  });

  it('puts what needs the user first, then the newest', () => {
    const { rows } = build(
      [
        [entry('reply', { lastActivityTs: NOW - 60_000 }), { newCount: 1 }],
        [entry('ask', { lastActivityTs: NOW - 3 * 3600_000 }), { pendingApproval: approvalRecord }],
        [entry('older', { lastActivityTs: NOW - 2 * 3600_000 }), { newCount: 1 }],
      ],
      { invites: [{ roomId: '!inv:x', inviterId: '@tom:x', ts: NOW - 4 * 3600_000 }] }
    );
    expect(kinds(rows)).toEqual([
      'ask:approval',
      'invite:!inv:x:invite',
      'reply:reply',
      'older:reply',
    ]);
    expect(rows.slice(0, 2).every(needsYou)).toBe(true);
  });

  it('names who mentioned first, then the others who replied', () => {
    const { rows } = build([
      [
        entry('t'),
        {
          mentionedMe: true,
          mentionedBy: '@maya:x',
          newCount: 2,
          newSenderIds: ['@tom:x', '@maya:x'],
        },
      ],
    ]);
    expect(rows[0]).toMatchObject({ actorIds: ['@maya:x', '@tom:x'] });
  });
});

describe('filterActivityRows', () => {
  const { rows } = build(
    [
      [entry('m'), { mentionedMe: true, newCount: 1 }],
      [entry('r'), { newCount: 1 }],
      [entry('read'), {}],
      [
        entry('f'),
        {
          newCount: 1,
          outcome: { kind: 'finished', senderId: '@mindroom_code:x', ts: NOW, durationMs: 90_000 },
        },
      ],
      [entry('q'), { pendingQuestion: { eventId: '$q', senderId: 'a', text: 'q', options: [] } }],
    ],
    { invites: [{ roomId: '!inv:x', ts: NOW }] }
  );

  it('keeps each tab to its kinds', () => {
    const keys = (tab: Parameters<typeof filterActivityRows>[1]) =>
      filterActivityRows(rows, tab, false)
        .map((row) => row.key)
        .sort();
    expect(keys('all')).toHaveLength(6);
    expect(keys('mentions')).toEqual(['m']);
    expect(keys('replies')).toEqual(['f', 'r', 'read']);
    expect(keys('needsYou')).toEqual(['invite:!inv:x', 'q']);
  });

  it('keeps a read row the page shows beside the list, also when only unread ones are asked for', () => {
    const shown = (row: ActivityRow) => row.key === 'read';
    expect(filterActivityRows(rows, 'replies', true, shown).map((row) => row.key)).toContain(
      'read'
    );
  });

  it('keeps the row shown beside the list in its tab, though reading turned its mention to a reply', () => {
    // Opened from Mentions: reading it clears the mention, and the row becomes a read reply.
    const shown = (row: ActivityRow) => row.key === 'read';
    expect(filterActivityRows(rows, 'mentions', true, shown).map((row) => row.key)).toContain(
      'read'
    );
  });

  it('hides read rows when only unread ones are asked for', () => {
    expect(
      filterActivityRows(rows, 'replies', true)
        .map((row) => row.key)
        .sort()
    ).toEqual(['f', 'r']);
  });
});

describe('activityDay', () => {
  it('splits at local midnight', () => {
    const midnight = new Date(2026, 10, 9).getTime();
    expect(activityDay(midnight, NOW)).toBe('today');
    expect(activityDay(midnight - 1, NOW)).toBe('yesterday');
    expect(activityDay(midnight - DAY - 1, NOW)).toBe('earlier');
  });
});
