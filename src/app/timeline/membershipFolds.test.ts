import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_MEMBERSHIP_FOLD_VIEW,
  MIN_FOLDED_MEMBERSHIP_EVENTS,
  planMembershipFolds,
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
    content: options.redacted ? {} : content,
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
        hiddenIds: ['$m1', '$m2', '$m3'],
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
    expect(folds[0]?.hiddenIds).toEqual(['$m1', '$m2', '$m3']);
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
    expect(folds.map((fold) => fold.hiddenIds)).toEqual([
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
    expect(folds[0]?.hiddenIds).toEqual(['$m1', '$m2', '$m3']);
  });

  it('excludes redacted membership events when shown, breaking the run', () => {
    const events = [
      joinEvent('$m1', '@a:x'),
      joinEvent('$m2', '@b:x'),
      memberEvent('$red', '@c:x', {}, {}, { redacted: true }),
      joinEvent('$m3', '@d:x'),
      joinEvent('$m4', '@e:x'),
    ];

    // When showHiddenEvents is true, redacted events are not skipped and break the run.
    expect(planMembershipFolds(events, defaultRules)).toEqual([]);

    // When showHiddenEvents is false, redacted events are skipped and do not break the run.
    const skippedRedacted = planMembershipFolds(events, {
      isSkipped: (event) => event.isRedacted(),
      pinnedIds: new Set(),
    });
    expect(skippedRedacted.map((fold) => fold.hiddenIds)).toEqual([['$m1', '$m2', '$m3', '$m4']]);
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
    expect(folds.map((fold) => fold.hiddenIds)).toEqual([['$m4', '$m5', '$m6']]);
  });
});

describe('viewMembershipFolds', () => {
  const fold = planMembershipFolds(
    [
      joinEvent('$m1', '@a:x'),
      joinEvent('$m2', '@b:x'),
      joinEvent('$m3', '@c:x'),
      joinEvent('$m4', '@d:x'),
    ],
    defaultRules
  )[0]!;

  it('returns the shared empty view when there are no folds', () => {
    expect(viewMembershipFolds([], () => false)).toBe(EMPTY_MEMBERSHIP_FOLD_VIEW);
  });

  it('anchors the break on the first row in visibleIds when a run starts before the window', () => {
    const visibleIds = new Set(['$m3', '$m4', '$msg']);
    const closed = viewMembershipFolds([fold], () => false, visibleIds);
    expect([...closed.breaks.keys()]).toEqual(['$m3']);
    expect(closed.breaks.get('$m3')).toEqual({ fold, open: false });
    expect([...closed.hiddenIds].sort()).toEqual(['$m1', '$m2', '$m4']);

    const open = viewMembershipFolds([fold], () => true, visibleIds);
    expect([...open.breaks.keys()]).toEqual(['$m3']);
    expect(open.breaks.get('$m3')).toEqual({ fold, open: true });
    expect(open.hiddenIds.size).toBe(0);
  });

  it('falls back to hiddenIds[0] when the entire run lies outside visibleIds', () => {
    const view = viewMembershipFolds([fold], () => false, new Set(['$msg']));
    expect([...view.breaks.keys()]).toEqual(['$m1']);
    expect([...view.hiddenIds].sort()).toEqual(['$m2', '$m3', '$m4']);
  });
});
