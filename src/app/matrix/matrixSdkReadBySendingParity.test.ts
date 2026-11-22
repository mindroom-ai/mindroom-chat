import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import fixture from './fixtures/readBySendingOutcomes.sdk-41.7.0.json';

// Whether a member has read an event (`Room.hasUserReadEvent`) must stay what it was with
// matrix-js-sdk 41.7.0, at the same cost. The row of readers under a timeline asks it of every
// joined member (RoomViewFollowing.tsx). Without a receipt that covers the event, 41.7.0 looked at
// the newest event of the timeline only: a member who sent that one has read everything. 45 looks
// for any event the member sent at or after the one asked about, and for a reply of theirs in the
// thread an event is the root of (matrix-js-sdk #5525), by walking the timeline for each member.
// Our SDK patch puts 41.7.0's rule back in its place (patches/matrix-js-sdk+45.1.0.patch,
// `src/models/room-receipts.ts`).
//
// The fixture holds what the client of main (41.7.0 with its patch) answered in each case below,
// and how many times it asked an event for its sender and for its ID to do so; this file asserts
// the same of the client it runs with. It is recorded by running this file on a checkout of main
// with RECORD_READ_BY_SENDING_OUTCOMES=1, which writes it instead of comparing with it.

const FIXTURE_PATH = 'src/app/matrix/fixtures/readBySendingOutcomes.sdk-41.7.0.json';
const RECORDING = process.env.RECORD_READ_BY_SENDING_OUTCOMES === '1';

const ROOM = '!room:example.org';
const ME = '@me:example.org';
const WRITER = '@writer:example.org';
const OTHER = '@other:example.org';
const READER = '@reader:example.org';

type Outcome = {
  /** What the SDK answered, by the question's name. */
  answers: Record<string, unknown>;
  /** How many times it asked an event for its sender to answer. */
  senderLookups: number;
  /** How many times it asked an event for its ID to answer. */
  idLookups: number;
};

const event = (
  id: string,
  sender: string,
  ts: number,
  type: string,
  content: Record<string, unknown>,
  extra: Record<string, unknown> = {}
) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM,
    type,
    sender,
    origin_server_ts: ts,
    content,
    ...extra,
  });
const message = (id: string, sender: string, ts: number, threadRootId?: string) =>
  event(id, sender, ts, 'm.room.message', {
    msgtype: 'm.text',
    body: `message ${id}`,
    ...(threadRootId ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadRootId } } : {}),
  });

const members = (count: number, name: string) =>
  Array.from({ length: count }, (_, index) => `@${name}-${index}:example.org`);

const newRoom = () => {
  const client = createClient({ baseUrl: 'https://example.org', userId: ME });
  vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
  return new Room(ROOM, client, ME, { timelineSupport: true });
};

/**
 * Adds `events`, oldest first, before what the live timeline holds, as history the client paged
 * in: the SDK makes up a read receipt for the sender of an event that arrives live, none for these.
 */
const pageIn = (room: Room, events: MatrixEvent[]) =>
  room.addEventsToTimeline([...events].reverse(), true, false, room.getLiveTimeline());

/** The members of `userIds` who have read the event, as the row of readers asks. */
const readersOf = (room: Room, eventId: string, userIds: string[]) =>
  userIds.filter((userId) => room.hasUserReadEvent(userId, eventId));

/** Whether `userId` has read each of `eventIds`. */
const readBy = (room: Room, userId: string, eventIds: string[]) =>
  Object.fromEntries(
    eventIds.map((eventId) => [`${userId} ${eventId}`, room.hasUserReadEvent(userId, eventId)])
  );

/** What `ask` answers, with the lookups the SDK made while it ran. */
const outcomeOf = (ask: () => Record<string, unknown>): Outcome => {
  const getSender = vi.spyOn(MatrixEvent.prototype, 'getSender');
  const getId = vi.spyOn(MatrixEvent.prototype, 'getId');
  const answers = ask();
  const outcome = {
    answers,
    senderLookups: getSender.mock.calls.length,
    idLookups: getId.mock.calls.length,
  };
  getSender.mockRestore();
  getId.mockRestore();
  return outcome;
};

const scenarios: Record<string, () => Outcome | Promise<Outcome>> = {
  'the newest of 2,000 messages, asked of 500 members who have sent nothing': () => {
    const room = newRoom();
    pageIn(
      room,
      Array.from({ length: 2_000 }, (_, index) => message(`$message-${index}`, WRITER, index + 1))
    );
    const quiet = members(500, 'quiet');
    return outcomeOf(() => ({
      readers: readersOf(room, '$message-1999', [...quiet, WRITER]),
    }));
  },

  'a thread root that is the newest event, asked of 50 members who have not replied and one who has':
    () => {
      const room = newRoom();
      const root = message('$root', OTHER, 1_000);
      pageIn(room, [message('$before', OTHER, 1), root]);
      const replies = Array.from({ length: 400 }, (_, index) =>
        message(`$reply-${index}`, index === 7 ? WRITER : OTHER, 2_000 + index, '$root')
      );
      const thread = room.createThread('$root', root, [root, ...replies], true);
      const quiet = members(50, 'quiet');
      return outcomeOf(() => ({
        'events of the thread': thread.timeline.length,
        'readers of the root': readersOf(room, '$root', [...quiet, WRITER, OTHER]),
        'readers of the newest reply': readersOf(room, '$reply-399', [...quiet, WRITER, OTHER]),
        'readers of an older reply': readersOf(room, '$reply-3', [...quiet, WRITER, OTHER]),
      }));
    },

  'the first of 400 messages, asked of the 50 members who sent the last 50': () => {
    const room = newRoom();
    const late = members(50, 'late');
    pageIn(
      room,
      Array.from({ length: 400 }, (_, index) =>
        message(`$message-${index}`, index < 350 ? OTHER : late[index - 350] ?? OTHER, index + 1)
      )
    );
    const ask = () => ({ readers: readersOf(room, '$message-0', late) });
    const cold = outcomeOf(ask);
    const warm = outcomeOf(ask);
    return {
      answers: {
        cold: cold.answers,
        warm: warm.answers,
        'warm sender lookups': warm.senderLookups,
      },
      senderLookups: cold.senderLookups,
      idLookups: warm.idLookups,
    };
  },

  'a join as the newest event, then the same event with the membership before it': () => {
    const room = newRoom();
    const join = event(
      '$join',
      READER,
      2,
      'm.room.member',
      { membership: 'join', displayname: 'Reader' },
      { state_key: READER }
    );
    pageIn(room, [message('$message', OTHER, 1), join]);
    return outcomeOf(() => {
      const asJoin = room.hasUserReadEvent(READER, '$message');
      // The app fills this in on the event it holds (mergeSameIdEventRevision): the member had
      // joined before, so the event is a change of their profile, which reads nothing for them.
      join.setUnsigned({ prev_content: { membership: 'join', displayname: 'R' } });
      return {
        'as a join': asJoin,
        'as a profile change': room.hasUserReadEvent(READER, '$message'),
      };
    });
  },

  'a member who sent a message that is not the newest, and one who sent the newest': () => {
    const room = newRoom();
    const ids = ['$first', '$written', '$after', '$newest'];
    pageIn(room, [
      message('$first', OTHER, 1),
      message('$written', WRITER, 2),
      message('$after', OTHER, 3),
      message('$newest', READER, 4),
    ]);
    return outcomeOf(() => ({
      ...readBy(room, WRITER, ids),
      ...readBy(room, READER, ids),
      ...readBy(room, OTHER, ids),
    }));
  },

  'a message redacted after it was paged in': async () => {
    const room = newRoom();
    const ids = ['$first', '$written', '$redaction'];
    pageIn(room, [message('$first', OTHER, 1), message('$written', WRITER, 2)]);
    await room.addLiveEvents(
      [event('$redaction', READER, 3, 'm.room.redaction', {}, { redacts: '$written' })],
      { addToState: false }
    );
    return outcomeOf(() => ({
      redacted: room.findEventById('$written')?.isRedacted(),
      ...readBy(room, WRITER, ids),
      ...readBy(room, READER, ids),
      ...readBy(room, OTHER, ids),
    }));
  },

  'events that came live, a gap in the sync, then history and a live event after it': async () => {
    const room = newRoom();
    const ids = ['$live-1', '$live-2', '$history', '$live-3'];
    await room.addLiveEvents([message('$live-1', OTHER, 1), message('$live-2', WRITER, 2)], {
      addToState: false,
    });
    const beforeTheGap = outcomeOf(() => ({
      ...readBy(room, WRITER, ids.slice(0, 2)),
      ...readBy(room, OTHER, ids.slice(0, 2)),
      ...readBy(room, READER, ids.slice(0, 2)),
    }));
    room.resetLiveTimeline('back', 'forward');
    const afterTheGap = outcomeOf(() => ({
      ...readBy(room, WRITER, ids.slice(0, 2)),
      ...readBy(room, OTHER, ids.slice(0, 2)),
    }));
    pageIn(room, [message('$history', READER, 3)]);
    await room.addLiveEvents([message('$live-3', OTHER, 4)], { addToState: false });
    const atTheEnd = outcomeOf(() => ({
      ...readBy(room, WRITER, ids),
      ...readBy(room, OTHER, ids),
      ...readBy(room, READER, ids),
    }));
    return {
      answers: {
        'before the gap': beforeTheGap.answers,
        'after the gap': afterTheGap.answers,
        'at the end': atTheEnd.answers,
      },
      senderLookups:
        beforeTheGap.senderLookups + afterTheGap.senderLookups + atTheEnd.senderLookups,
      idLookups: beforeTheGap.idLookups + afterTheGap.idLookups + atTheEnd.idLookups,
    };
  },

  'a receipt on the second of three messages': () => {
    const room = newRoom();
    const ids = ['$first', '$second', '$third'];
    pageIn(
      room,
      ids.map((id, index) => message(id, OTHER, index + 1))
    );
    room.addReceipt(
      event('$receipt', READER, 4, 'm.receipt', {
        $second: { 'm.read': { [READER]: { ts: 4, thread_id: 'main' } } },
      })
    );
    return outcomeOf(() => ({ ...readBy(room, READER, ids), ...readBy(room, WRITER, ids) }));
  },
};

describe('who has read an event, compared with what matrix-js-sdk 41.7.0 answered', () => {
  const recorded: Record<string, Outcome> = {};

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (!RECORDING) return;
    const { version } = JSON.parse(
      readFileSync(resolve('node_modules/matrix-js-sdk/package.json'), 'utf8')
    ) as { version: string };
    writeFileSync(
      resolve(FIXTURE_PATH),
      `${JSON.stringify({ sdkVersion: version, outcomes: recorded }, null, 2)}\n`
    );
  });

  it.each(Object.keys(scenarios))('%s', async (name) => {
    const outcome = await scenarios[name]?.();

    if (RECORDING) {
      if (outcome) recorded[name] = outcome;
      return;
    }
    expect(outcome).toEqual((fixture.outcomes as Record<string, Outcome>)[name]);
  });

  it.skipIf(RECORDING)('compares with a recording of 41.7.0 that has every case', () => {
    expect(fixture.sdkVersion).toBe('41.7.0');
    expect(Object.keys(fixture.outcomes)).toEqual(Object.keys(scenarios));
  });
});
