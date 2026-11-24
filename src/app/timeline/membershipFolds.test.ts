import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_MEMBERSHIP_FOLD_VIEW,
  MIN_FOLDED_MEMBERSHIP_EVENTS,
  loadedRangeOfRows,
  planMembershipFolds,
  projectRoomRows,
  rowIndexOfLoaded,
  rowRangeOfLoaded,
  viewMembershipFolds,
} from './membershipFolds';

const DAY_1 = new Date(2026, 10, 3, 10, 0).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

const memberEvent = (
  id: string,
  target: string,
  content: Record<string, unknown>,
  prevContent: Record<string, unknown> = {},
  options: { sender?: string; ts?: number; redacted?: boolean } = {}
): MatrixEvent => {
  const event = new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: options.sender ?? target,
    state_key: target,
    type: 'm.room.member',
    origin_server_ts: options.ts ?? DAY_1,
    // A redaction keeps `membership` and drops the rest of the content.
    content: options.redacted ? { membership: content.membership } : content,
    unsigned: options.redacted
      ? {
          redacted_because: {
            event_id: `$red_${id}`,
            type: 'm.room.redaction',
            sender: '@mod:example.org',
            origin_server_ts: options.ts ?? DAY_1,
            content: {},
            unsigned: {},
          },
          prev_content: prevContent,
        }
      : { prev_content: prevContent },
  });
  return event;
};

const joinEvent = (id: string, user: string, ts = DAY_1) =>
  memberEvent(id, user, { membership: 'join', displayname: user }, {}, { ts });

const leaveEvent = (id: string, user: string, ts = DAY_1) =>
  memberEvent(id, user, { membership: 'leave' }, { membership: 'join' }, { ts });

const inviteEvent = (id: string, target: string, sender = '@host:example.org', ts = DAY_1) =>
  memberEvent(id, target, { membership: 'invite' }, {}, { sender, ts });

const kickEvent = (id: string, target: string, sender = '@mod:example.org', ts = DAY_1) =>
  memberEvent(id, target, { membership: 'leave' }, { membership: 'join' }, { sender, ts });

const banEvent = (id: string, target: string, sender = '@mod:example.org', ts = DAY_1) =>
  memberEvent(id, target, { membership: 'ban' }, { membership: 'join' }, { sender, ts });

const unbanEvent = (id: string, target: string, sender = '@mod:example.org', ts = DAY_1) =>
  memberEvent(id, target, { membership: 'leave' }, { membership: 'ban' }, { sender, ts });

const knockEvent = (id: string, user: string, ts = DAY_1) =>
  memberEvent(id, user, { membership: 'knock' }, {}, { ts });

const acceptKnockEvent = (id: string, target: string, sender = '@mod:example.org', ts = DAY_1) =>
  memberEvent(id, target, { membership: 'invite' }, { membership: 'knock' }, { sender, ts });

const renameEvent = (id: string, user: string, from: string, to: string, ts = DAY_1) =>
  memberEvent(
    id,
    user,
    { membership: 'join', displayname: to },
    { membership: 'join', displayname: from },
    { ts }
  );

const messageEvent = (id: string, body = 'hello', ts = DAY_1) =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@sam:example.org',
    type: 'm.room.message',
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body },
  });

const stateEvent = (
  id: string,
  type: 'm.room.name' | 'm.room.topic' | 'm.room.avatar',
  content: Record<string, unknown>,
  ts = DAY_1
) =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@host:example.org',
    state_key: '',
    type,
    origin_server_ts: ts,
    content,
  });

const reactionEvent = (id: string, targetId: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@sam:example.org',
    type: 'm.reaction',
    origin_server_ts: DAY_1,
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: targetId, key: '+' } },
  });

const defaultRules = {
  isSkipped: () => false,
  pinnedIds: new Set<string>(),
};

describe('planMembershipFolds', () => {
  it('leaves runs shorter than MIN_FOLDED_MEMBERSHIP_EVENTS unfolded and folds 3 or more', () => {
    expect(MIN_FOLDED_MEMBERSHIP_EVENTS).toBe(3);

    const one = [messageEvent('$msg0'), joinEvent('$m1', '@a:x'), messageEvent('$msg1')];
    expect(planMembershipFolds(one, defaultRules)).toEqual([]);

    const two = [
      messageEvent('$msg0'),
      inviteEvent('$m1', '@a:x'),
      joinEvent('$m2', '@a:x'),
      messageEvent('$msg1'),
    ];
    expect(planMembershipFolds(two, defaultRules)).toEqual([]);

    const three = [
      messageEvent('$msg0'),
      joinEvent('$m1', '@a:x'),
      joinEvent('$m2', '@b:x'),
      joinEvent('$m3', '@c:x'),
      messageEvent('$msg1'),
    ];
    expect(planMembershipFolds(three, defaultRules)).toEqual([
      {
        key: '$m1',
        eventIds: ['$m1', '$m2', '$m3'],
        spanIds: ['$m1', '$m2', '$m3'],
        summary: {
          total: 3,
          joined: 3,
          left: 0,
          invited: 0,
          requested: 0,
          kicked: 0,
          banned: 0,
          unbanned: 0,
          profileChanges: 0,
        },
      },
    ]);
  });

  it('deduplicates repeated events per target user within each bucket while counting total events', () => {
    const events = [
      joinEvent('$m1', '@a:x'),
      joinEvent('$m2', '@a:x'),
      joinEvent('$m3', '@b:x'),
      inviteEvent('$m4', '@c:x'),
      acceptKnockEvent('$m5', '@c:x'),
      knockEvent('$m6', '@d:x'),
      renameEvent('$m7', '@a:x', 'Ada', 'Ada B'),
      renameEvent('$m8', '@a:x', 'Ada B', 'Ada C'),
      leaveEvent('$m9', '@b:x'),
      kickEvent('$m10', '@e:x'),
      banEvent('$m11', '@f:x'),
      unbanEvent('$m12', '@f:x'),
      // Uncategorized membership event still adds to total.
      memberEvent('$m13', '@g:x', { membership: 'join' }, { membership: 'join' }),
    ];

    const folds = planMembershipFolds(events, defaultRules);
    expect(folds).toHaveLength(1);
    expect(folds[0]?.summary).toEqual({
      total: 13,
      joined: 2,
      left: 1,
      invited: 1,
      requested: 1,
      kicked: 1,
      banned: 1,
      unbanned: 1,
      profileChanges: 1,
    });
  });

  it('merges consecutive membership events across multiple days', () => {
    const events = [
      joinEvent('$m1', '@a:x', DAY_1),
      joinEvent('$m2', '@b:x', DAY_1 + DAY_MS),
      leaveEvent('$m3', '@a:x', DAY_1 + 3 * DAY_MS),
    ];

    const folds = planMembershipFolds(events, defaultRules);
    expect(folds).toHaveLength(1);
    expect(folds[0]?.eventIds).toEqual(['$m1', '$m2', '$m3']);
  });

  it('breaks runs on room name, topic, and avatar changes while keeping moderation events inside', () => {
    const events = [
      joinEvent('$m1', '@a:x'),
      kickEvent('$m2', '@b:x'),
      banEvent('$m3', '@c:x'),
      stateEvent('$topic', 'm.room.topic', { topic: 'Harbor updates' }),
      joinEvent('$m4', '@d:x'),
      joinEvent('$m5', '@e:x'),
      stateEvent('$name', 'm.room.name', { name: 'Harbor' }),
      joinEvent('$m6', '@f:x'),
      joinEvent('$m7', '@g:x'),
      joinEvent('$m8', '@h:x'),
      stateEvent('$avatar', 'm.room.avatar', { url: 'mxc://example.org/pic' }),
      joinEvent('$m9', '@i:x'),
    ];

    const folds = planMembershipFolds(events, defaultRules);
    expect(folds.map((fold) => fold.eventIds)).toEqual([
      ['$m1', '$m2', '$m3'],
      ['$m6', '$m7', '$m8'],
    ]);
    expect(folds[0]?.summary).toMatchObject({ total: 3, joined: 1, kicked: 1, banned: 1 });
  });

  it('passes through rowless and skipped events without breaking a run', () => {
    const skipped = joinEvent('$skip', '@ignored:x');
    const events = [
      joinEvent('$m1', '@a:x'),
      reactionEvent('$react', '$msg0'),
      skipped,
      joinEvent('$m2', '@b:x'),
      joinEvent('$m3', '@c:x'),
    ];

    const folds = planMembershipFolds(events, {
      isSkipped: (event) => event.getId() === '$skip',
      pinnedIds: new Set(),
    });
    expect(folds).toHaveLength(1);
    expect(folds[0]?.eventIds).toEqual(['$m1', '$m2', '$m3']);
    // The fold holds the events passed over between its first event and its last.
    expect(folds[0]?.spanIds).toEqual(['$m1', '$react', '$skip', '$m2', '$m3']);
  });

  it("leaves the events passed over after a run's last event out of its span", () => {
    const events = [
      reactionEvent('$before', '$msg0'),
      joinEvent('$m1', '@a:x'),
      joinEvent('$m2', '@b:x'),
      joinEvent('$m3', '@c:x'),
      reactionEvent('$after', '$msg0'),
      messageEvent('$msg'),
    ];
    const fold = planMembershipFolds(events, defaultRules)[0];
    expect(fold?.spanIds).toEqual(['$m1', '$m2', '$m3']);
    // A run of its events alone: one list of them.
    expect(fold?.spanIds).toBe(fold?.eventIds);
  });

  it('counts a redacted event that shows as its row reads, and skips one that is hidden', () => {
    const events = [
      joinEvent('$m1', '@a:x'),
      joinEvent('$m2', '@b:x'),
      // Redacted, these keep their `membership`: their rows still read as a ban, a request, an
      // invitation, a join and a kick.
      memberEvent(
        '$ban',
        '@c:x',
        { membership: 'ban', reason: 'spam' },
        { membership: 'join' },
        { sender: '@mod:example.org', redacted: true }
      ),
      memberEvent('$knock', '@d:x', { membership: 'knock' }, {}, { redacted: true }),
      memberEvent(
        '$invite',
        '@e:x',
        { membership: 'invite' },
        {},
        { sender: '@mod:example.org', redacted: true }
      ),
      memberEvent(
        '$join',
        '@f:x',
        { membership: 'join', displayname: 'Fay' },
        {},
        {
          redacted: true,
        }
      ),
      memberEvent(
        '$kick',
        '@g:x',
        { membership: 'leave' },
        { membership: 'join' },
        { sender: '@mod:example.org', redacted: true }
      ),
      joinEvent('$m3', '@h:x'),
    ];
    expect(events[2]?.isRedacted()).toBe(true);

    // With hidden events shown, the redacted events are rows of the run.
    const shown = planMembershipFolds(events, defaultRules);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.summary).toEqual({
      total: 8,
      joined: 4,
      left: 0,
      invited: 1,
      requested: 1,
      kicked: 1,
      banned: 1,
      unbanned: 0,
      profileChanges: 0,
    });

    // Without, they are skipped: they neither part the run nor count in it.
    const hidden = planMembershipFolds(events, {
      isSkipped: (event) => event.isRedacted(),
      pinnedIds: new Set(),
    });
    expect(hidden.map((fold) => fold.eventIds)).toEqual([['$m1', '$m2', '$m3']]);
    expect(hidden[0]?.summary).toMatchObject({ total: 3, joined: 3, banned: 0 });
  });

  it('keeps a run unfolded when any of its events is in pinnedIds', () => {
    const events = [
      joinEvent('$m1', '@a:x'),
      joinEvent('$m2', '@b:x'),
      joinEvent('$m3', '@c:x'),
      messageEvent('$msg'),
      joinEvent('$m4', '@d:x'),
      joinEvent('$m5', '@e:x'),
      joinEvent('$m6', '@f:x'),
    ];

    const folds = planMembershipFolds(events, {
      isSkipped: () => false,
      pinnedIds: new Set(['$m2']),
    });
    expect(folds.map((fold) => fold.eventIds)).toEqual([['$m4', '$m5', '$m6']]);
  });

  it('keeps a run unfolded when an event passed over inside it is in pinnedIds', () => {
    const events = [
      joinEvent('$m1', '@a:x'),
      reactionEvent('$react', '$msg0'),
      joinEvent('$m2', '@b:x'),
      joinEvent('$hidden', '@ignored:x'),
      joinEvent('$m3', '@c:x'),
      reactionEvent('$after', '$msg0'),
      messageEvent('$msg'),
    ];
    const foldsWith = (...pinned: string[]) =>
      planMembershipFolds(events, {
        isSkipped: (event) => event.getId() === '$hidden',
        pinnedIds: new Set(pinned),
      }).map((fold) => fold.eventIds);
    expect(foldsWith()).toEqual([['$m1', '$m2', '$m3']]);
    // A jump to the reaction or to the hidden event lands where it would show: inside the run.
    expect(foldsWith('$react')).toEqual([]);
    expect(foldsWith('$hidden')).toEqual([]);
    // One passed over after the run's last event is a row of its own after the fold.
    expect(foldsWith('$after')).toEqual([['$m1', '$m2', '$m3']]);
  });
});

describe('viewMembershipFolds', () => {
  const fold = planMembershipFolds(
    [joinEvent('$m1', '@a:x'), joinEvent('$m2', '@b:x'), joinEvent('$m3', '@c:x')],
    defaultRules
  )[0]!;

  it('returns the shared empty view when there are no folds', () => {
    expect(viewMembershipFolds([], () => false)).toBe(EMPTY_MEMBERSHIP_FOLD_VIEW);
  });

  it('names each fold by its first event, open or closed', () => {
    expect([...viewMembershipFolds([fold], () => false).breaks]).toEqual([
      ['$m1', { fold, open: false }],
    ]);
    expect([...viewMembershipFolds([fold], () => true).breaks]).toEqual([
      ['$m1', { fold, open: true }],
    ]);
  });
});

describe('projectRoomRows', () => {
  // Loaded rows 0 to 8: a message, a run of five (a reaction among them), a message, a run of
  // two and a last message. Their places in the loaded timeline count by ten.
  const loaded = [
    messageEvent('$msg0'),
    joinEvent('$m1', '@a:x'),
    joinEvent('$m2', '@b:x'),
    reactionEvent('$react', '$msg0'),
    joinEvent('$m3', '@c:x'),
    joinEvent('$m4', '@d:x'),
    messageEvent('$msg1'),
    joinEvent('$m5', '@e:x'),
    messageEvent('$msg2'),
  ];
  const entries = loaded.map((event, index) => ({ event, absoluteIndex: index * 10 }));
  const folds = planMembershipFolds(loaded, defaultRules);
  const ids = (rows: MatrixEvent[]) => rows.map((event) => event.getId());

  it('lists a closed fold as one row at its first event, standing at its last', () => {
    const projection = projectRoomRows(
      loaded,
      entries,
      viewMembershipFolds(folds, () => false)
    );
    expect(ids(projection.rows)).toEqual(['$msg0', '$m1', '$msg1', '$m5', '$msg2']);
    // No row of the list is hidden: the fold's four events and the reaction among them are the
    // one row.
    expect(projection.loadedStarts).toEqual([0, 1, 6, 7, 8]);
    expect(projection.loadedCount).toBe(9);
    expect(
      projection.entries.map(({ event, absoluteIndex }) => [event.getId(), absoluteIndex])
    ).toEqual([
      ['$msg0', 0],
      ['$m1', 50],
      ['$msg1', 60],
      ['$m5', 70],
      ['$msg2', 80],
    ]);
    // Every loaded event the fold holds is found at its row, the reaction too: a jump to it
    // unfolds the run, and the room does not load its timeline again.
    expect([...projection.foldedRows]).toEqual([
      ['$m1', 1],
      ['$m2', 1],
      ['$react', 1],
      ['$m3', 1],
      ['$m4', 1],
    ]);
  });

  it('lists the loaded rows themselves when no fold is closed', () => {
    const open = projectRoomRows(
      loaded,
      entries,
      viewMembershipFolds(folds, () => true)
    );
    expect(open.rows).toBe(loaded);
    expect(open.entries).toBe(entries);
    expect(open.loadedStarts).toBeUndefined();
    expect(open.foldedRows.size).toBe(0);
    expect(projectRoomRows(loaded, entries, EMPTY_MEMBERSHIP_FOLD_VIEW).rows).toBe(loaded);
    const range = { start: 2, end: 7 };
    expect(rowRangeOfLoaded(open, range)).toBe(range);
    expect(loadedRangeOfRows(open, range)).toBe(range);
    expect(rowIndexOfLoaded(open, 4)).toBe(4);
  });

  it('maps loaded rows to their rows, a closed fold whole', () => {
    const projection = projectRoomRows(
      loaded,
      entries,
      viewMembershipFolds(folds, () => false)
    );
    expect(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => rowIndexOfLoaded(projection, index))
    ).toEqual([0, 1, 1, 1, 1, 1, 2, 3, 4, 5]);
    // A window the state starts inside the fold (history brought earlier events of its run) or
    // ends inside it holds the fold whole.
    expect(rowRangeOfLoaded(projection, { start: 4, end: 9 })).toEqual({ start: 1, end: 5 });
    expect(rowRangeOfLoaded(projection, { start: 0, end: 3 })).toEqual({ start: 0, end: 2 });
    expect(rowRangeOfLoaded(projection, { start: 6, end: 9 })).toEqual({ start: 2, end: 5 });
    expect(rowRangeOfLoaded(projection, { start: 0, end: 0 })).toEqual({ start: 0, end: 0 });
    // A window that ends past the loaded rows (rows left the room since) ends with the last row.
    expect(rowRangeOfLoaded(projection, { start: 6, end: 12 })).toEqual({ start: 2, end: 5 });
    expect(rowRangeOfLoaded(projection, { start: 9, end: 12 })).toEqual({ start: 5, end: 5 });
    // And a window of rows stands for whole folds of loaded rows.
    expect(loadedRangeOfRows(projection, { start: 1, end: 5 })).toEqual({ start: 1, end: 9 });
    expect(loadedRangeOfRows(projection, { start: 0, end: 2 })).toEqual({ start: 0, end: 6 });
    expect(loadedRangeOfRows(projection, { start: 2, end: 3 })).toEqual({ start: 6, end: 7 });
  });

  it('keeps every loaded row of the window when a fold near its end opens or closes', () => {
    // The state's window, in loaded rows, does not change with a fold's state: the rows it
    // stands for do.
    const stateRange = { start: 0, end: 9 };
    const closed = projectRoomRows(
      loaded,
      entries,
      viewMembershipFolds(folds, () => false)
    );
    const open = projectRoomRows(
      loaded,
      entries,
      viewMembershipFolds(folds, () => true)
    );
    const closedWindow = rowRangeOfLoaded(closed, stateRange);
    expect(ids(closed.rows.slice(closedWindow.start, closedWindow.end))).toEqual([
      '$msg0',
      '$m1',
      '$msg1',
      '$m5',
      '$msg2',
    ]);
    const openWindow = rowRangeOfLoaded(open, stateRange);
    expect(ids(open.rows.slice(openWindow.start, openWindow.end))).toEqual(ids(loaded));
  });

  it("gives the read marker and a jump inside a closed fold the fold's row", () => {
    const projection = projectRoomRows(
      loaded,
      entries,
      viewMembershipFolds(folds, () => false)
    );
    // The read marker at `$m2` (loaded row 2): the opening scroll goes to the fold's row.
    expect(rowIndexOfLoaded(projection, 2)).toBe(1);
    // A jump to `$m3` finds no row of its own, and its fold's row.
    expect(projection.rows.some((event) => event.getId() === '$m3')).toBe(false);
    expect(projection.foldedRows.get('$m3')).toBe(1);
    // Pinned, its run is unfolded and it is a row.
    const pinned = projectRoomRows(
      loaded,
      entries,
      viewMembershipFolds(
        planMembershipFolds(loaded, { isSkipped: () => false, pinnedIds: new Set(['$m3']) }),
        () => false
      )
    );
    expect(pinned.rows.findIndex((event) => event.getId() === '$m3')).toBe(4);
  });
});
