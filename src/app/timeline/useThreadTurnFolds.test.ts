import React from 'react';
import { MatrixEvent, type EventTimelineSet, type Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { isTurnAnswer, turnRowWaits, useThreadTurnFolds } from './useThreadTurnFolds';

// Whether a thread row keeps its turn unfolded, read from the row as the timeline holds it.

const ROOM = '!room:example.org';
const AGENT = '@mindroom_ops:example.org';
const PERSON = '@sam:example.org';
const QUESTION = {
  question_text: 'Which table should I index?',
  options: { '✅': 'archive', '📄': 'events', '1': 'archive', '2': 'events' },
  option_labels: { '✅': 'archive', '📄': 'events', '1': 'archive', '2': 'events' },
};

const message = (id: string, content: Record<string, unknown>, sender = AGENT) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM,
    sender,
    type: 'm.room.message',
    origin_server_ts: 1,
    content: { msgtype: 'm.text', body: id, ...content },
  });

const reaction = (targetId: string, key: string, sender = PERSON) =>
  new MatrixEvent({
    event_id: `$react-${key}`,
    room_id: ROOM,
    sender,
    type: 'm.reaction',
    origin_server_ts: 2,
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: targetId, key } },
  });

const waits = (event: MatrixEvent, reactions: MatrixEvent[] = [], pending?: Set<string>) => {
  const relations = { getChildEventsForEvent: vi.fn(() => undefined) };
  const roomRelations = {
    getChildEventsForEvent: () => ({ getRelations: () => reactions }),
  };
  const room = {
    roomId: ROOM,
    getUnfilteredTimelineSet: () => ({ relations: roomRelations }),
  } as unknown as Room;
  return turnRowWaits(event, {
    room,
    timelineSet: { relations } as unknown as EventTimelineSet,
    getContent: (row) => row.getContent(),
    pendingApprovalIds: pending,
    viewerId: PERSON,
    now: Date.now(),
  });
};

describe('turnRowWaits', () => {
  it('lets a finished reply fold', () => {
    expect(waits(message('$done', { 'io.mindroom.stream_status': 'completed' }))).toBe(false);
  });

  it.each(['pending', 'streaming'])('holds a reply that says it is %s', (status) => {
    // Whether the client could vouch for it yet or not (isStreamingReplyCurrent).
    expect(waits(message('$live', { 'io.mindroom.stream_status': status }))).toBe(true);
  });

  it('holds a question until a reaction answers it, whatever came after it', () => {
    const question = message('$ask', { 'io.mindroom.interactive': QUESTION });
    expect(waits(question)).toBe(true);
    // An agent's own option reactions answer nothing.
    expect(waits(question, [reaction('$ask', '✅', AGENT)])).toBe(true);
    expect(waits(question, [reaction('$ask', '✅')])).toBe(false);
  });

  it("asks nothing of a person's message", () => {
    expect(waits(message('$p', { 'io.mindroom.interactive': QUESTION }, PERSON))).toBe(false);
  });

  it('holds an approval that waits for a decision', () => {
    expect(waits(message('$card', {}), [], new Set(['$card']))).toBe(true);
  });

  it.each([PERSON, AGENT])('holds a row from %s that did not decrypt', (sender) => {
    const undecrypted = new MatrixEvent({
      event_id: '$enc',
      room_id: ROOM,
      sender,
      type: 'm.room.encrypted',
      origin_server_ts: 1,
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'x' },
    });
    expect(waits(undecrypted)).toBe(true);
  });
});

describe('isTurnAnswer', () => {
  const redacted = message('$gone', {});
  redacted.setUnsigned({ redacted_because: { type: 'm.room.redaction' } } as never);
  it.each<[string, MatrixEvent, boolean, boolean]>([
    ["an agent's message", message('$a', {}), false, true],
    ["a person's message", message('$p', {}, PERSON), false, false],
    ["an agent's notice", message('$n', { msgtype: 'm.notice' }), false, false],
    ['a quiet marker', message('$m', {}), true, false],
    ["an agent's redacted message", redacted, false, false],
    [
      "an agent's message not decrypted",
      new MatrixEvent({
        event_id: '$enc',
        room_id: ROOM,
        sender: AGENT,
        type: 'm.room.encrypted',
        origin_server_ts: 1,
        content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'x' },
      }),
      false,
      false,
    ],
  ])('reads %s', (_name, row, quiet, answers) => {
    expect(
      isTurnAnswer(
        row,
        (event) => event.getContent(),
        () => quiet
      )
    ).toBe(answers);
  });
});

describe('useThreadTurnFolds', () => {
  it('opens a turn on a toggle and folds it on the next', () => {
    const events = [
      message('$q', {}, PERSON),
      message('$a1', {}),
      message('$a2', {}),
      message('$ans', {}),
    ];
    const relations = { getChildEventsForEvent: () => undefined };
    const room = {
      roomId: ROOM,
      getUnfilteredTimelineSet: () => ({ relations }),
    } as unknown as Room;
    const options = {
      room,
      threadId: '$q',
      events,
      viewerId: PERSON,
      getContent: (row: MatrixEvent) => row.getContent(),
      timelineSet: { relations } as unknown as EventTimelineSet,
      isSkipped: () => false,
      isQuietMarker: () => false,
      pinnedIds: new Set<string>(),
      backgroundState: undefined,
    };
    let result: ReturnType<typeof useThreadTurnFolds> | undefined;
    function Probe() {
      result = useThreadTurnFolds(options);
      return null;
    }
    act(() => {
      create(React.createElement(Probe));
    });
    const state = () => [[...result!.view.hiddenIds], result!.view.breaks.get('$a1')?.open];
    expect(state()).toEqual([['$a1', '$a2'], false]);
    act(() => result!.toggle(result!.view.breaks.get('$a1')!.fold));
    expect(state()).toEqual([[], true]);
    act(() => result!.toggle(result!.view.breaks.get('$a1')!.fold));
    expect(state()).toEqual([['$a1', '$a2'], false]);
  });
});
