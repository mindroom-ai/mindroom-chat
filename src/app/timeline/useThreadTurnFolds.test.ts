import React from 'react';
import { MatrixEvent, type EventTimelineSet, type Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  isTurnAnswer,
  isTurnCard,
  startsTurn,
  turnAnswerRank,
  turnRowWaits,
  useThreadTurnFolds,
} from './useThreadTurnFolds';

// A plugin that draws a card for each message with its key, as an artifact's card.
const CARD_KEY = 'io.example.card';
// One that draws only in its own room, from the row's IDs.
const PLAN_KEY = 'io.example.plan';
vi.mock('../plugins/registry', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  registeredPlugins: [
    {
      id: 'cards',
      tag: 'cards@1.0.0',
      defaultEnabled: true,
      messageRenderers: [
        { match: ({ content }: { content: object }) => CARD_KEY in content, Component: () => null },
        {
          match: ({
            roomId,
            eventId,
            content,
          }: {
            roomId?: string;
            eventId?: string;
            content: object;
          }) => roomId === '!room:example.org' && !!eventId && PLAN_KEY in content,
          Component: () => null,
        },
      ],
    },
  ],
}));

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

describe('turnAnswerRank', () => {
  it('reads the run metadata and the msgtype of the row as it shows now', () => {
    const reply = message('$reply', {});
    const shown = (content: Record<string, unknown>) => () => ({ msgtype: 'm.text', ...content });
    // The run's metadata arrives with the reply's latest edit.
    expect(
      turnAnswerRank(reply, shown({ 'io.mindroom.ai_run': { version: 1, status: 'completed' } }))
    ).toBe(0);
    expect(turnAnswerRank(reply, shown({}))).toBe(1);
    expect(turnAnswerRank(message('$img', {}), shown({ msgtype: 'm.image' }))).toBe(2);
    // A reply too long for one event arrives as a file that keeps its run's metadata.
    expect(
      turnAnswerRank(
        message('$long', {}),
        shown({ msgtype: 'm.file', 'io.mindroom.ai_run': { version: 1, status: 'completed' } })
      )
    ).toBe(0);
  });
});

describe('startsTurn', () => {
  const ROUTER = '@mindroom_router:example.org';
  const woke = (content: Record<string, unknown>, sender = ROUTER, type = 'm.room.message') =>
    new MatrixEvent({ event_id: '$w', room_id: ROOM, sender, type, origin_server_ts: 1, content });
  const kind = (sourceKind: string, extra: Record<string, unknown> = {}) =>
    woke({ msgtype: 'm.text', body: 'Wake', 'com.mindroom.source_kind': sourceKind, ...extra });
  const edit = new MatrixEvent({
    event_id: '$edit',
    room_id: ROOM,
    sender: PERSON,
    type: 'm.room.message',
    origin_server_ts: 2,
    content: {
      body: '* Fixed',
      'm.new_content': { body: 'Fixed' },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$p' },
    },
  });
  it.each<[string, MatrixEvent, boolean]>([
    ["a person's message", message('$p', {}, PERSON), true],
    ["a person's edit", edit, false],
    ["an agent's reply", message('$a', { 'com.mindroom.original_sender': PERSON }), false],
    ["a schedule's message", kind('scheduled', { 'com.mindroom.original_sender': PERSON }), true],
    [
      'a silent schedule, which has no row',
      woke(
        { 'com.mindroom.source_kind': 'silent_scheduled' },
        ROUTER,
        'io.mindroom.scheduled.trigger'
      ),
      true,
    ],
    ["an external trigger's message", kind('external_trigger'), true],
    ["a reactive trigger's message", kind('reactive_trigger'), true],
    ["a hook's dispatch", kind('hook_dispatch'), true],
    [
      "a plugin's relay for a person, such as a comment on a document",
      kind('hook', { 'com.mindroom.original_sender': PERSON }),
      true,
    ],
    ["a hook's progress notice", kind('hook'), false],
    ["an agent's message to another agent", kind('trusted_internal_relay'), false],
    [
      'a kind that is not a string',
      woke({ msgtype: 'm.text', body: 'Wake', 'com.mindroom.source_kind': ['scheduled'] }),
      false,
    ],
    [
      'a kind that cannot become a string',
      woke({ msgtype: 'm.text', body: 'Wake', 'com.mindroom.source_kind': { toString: null } }),
      false,
    ],
  ])('reads %s', (_name, event, expected) => {
    expect(startsTurn(event)).toBe(expected);
  });

  it('reads the kind a row was sent with, not an edit of it', () => {
    const sent = kind('external_trigger');
    sent.makeReplaced(
      new MatrixEvent({
        event_id: '$e',
        room_id: ROOM,
        sender: '@mindroom_router:example.org',
        type: 'm.room.message',
        origin_server_ts: 2,
        content: {
          body: '* Wake',
          'm.new_content': { body: 'Wake', 'com.mindroom.source_kind': 'hook' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$w' },
        },
      })
    );
    expect(startsTurn(sent)).toBe(true);
  });

  it('starts no turn from an edit that carries a wake-up kind', () => {
    const edit = new MatrixEvent({
      event_id: '$e2',
      room_id: ROOM,
      sender: ROUTER,
      type: 'm.room.message',
      origin_server_ts: 2,
      content: {
        body: '* Wake',
        'com.mindroom.source_kind': 'scheduled',
        'm.new_content': { body: 'Wake', 'com.mindroom.source_kind': 'scheduled' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$w' },
      },
    });
    expect(startsTurn(edit)).toBe(false);
  });
});

describe('isTurnCard', () => {
  const card = (content: Record<string, unknown>) =>
    isTurnCard(message('$c', content), { msgtype: 'm.text', ...content }, undefined, PERSON);
  it('keeps a card a plugin draws, such as an artifact with its Open button', () => {
    expect(card({ [CARD_KEY]: { title: 'Quarterly plan' } })).toBe(true);
  });
  it("keeps an agent's notice with a button, such as a canvas", () => {
    const canvas = { action: 'show_canvas', version: 1, canvas: { title: 'Budget sheet' } };
    expect(card({ msgtype: 'm.notice', 'io.mindroom.ui_action': canvas })).toBe(true);
  });
  it("keeps a card a plugin draws from the row's room and event IDs", () => {
    expect(card({ [PLAN_KEY]: true })).toBe(true);
  });
  it("folds an agent's message, also one with an action that is not a notice", () => {
    expect(card({})).toBe(false);
    expect(card({ 'io.mindroom.ui_action': { action: 'show_canvas' } })).toBe(false);
    expect(card({ msgtype: 'm.notice', 'io.mindroom.ui_action': '' })).toBe(false);
  });
});

describe('useThreadTurnFolds', () => {
  const RUN = { 'io.mindroom.ai_run': { version: 1, status: 'completed' } };
  const folded = (events: MatrixEvent[], skipped: ReadonlySet<string> = new Set()) => {
    const relations = { getChildEventsForEvent: () => undefined };
    const room = {
      roomId: ROOM,
      getUnfilteredTimelineSet: () => ({ relations }),
    } as unknown as Room;
    let result: ReturnType<typeof useThreadTurnFolds> | undefined;
    function Probe() {
      result = useThreadTurnFolds({
        room,
        threadId: '$q',
        events,
        viewerId: PERSON,
        getContent: (row: MatrixEvent) => row.getContent(),
        timelineSet: { relations } as unknown as EventTimelineSet,
        isSkipped: (row) => skipped.has(row.getId() ?? ''),
        isQuietMarker: () => false,
        pinnedIds: new Set<string>(),
        backgroundState: undefined,
      });
      return null;
    }
    act(() => {
      create(React.createElement(Probe));
    });
    return [[...result!.view.hiddenIds], [...result!.view.breaks.keys()]];
  };

  it('keeps a reply and its cards when an outside wake-up starts the next turn', () => {
    const events = [
      message('$q', {}, PERSON),
      message('$reply', RUN),
      message('$card1', { [CARD_KEY]: { title: 'Quarterly plan' } }),
      message('$card2', { [CARD_KEY]: { title: 'Budget sheet' } }),
      message('$card3', { [CARD_KEY]: { title: 'Team roster' } }),
      // A plugin's relay of a comment on a document, which the plugin hides in the thread.
      message(
        '$relay',
        { 'com.mindroom.source_kind': 'hook', 'com.mindroom.original_sender': PERSON },
        '@mindroom_router:example.org'
      ),
      message('$woken', RUN),
    ];
    expect(folded(events, new Set(['$relay']))).toEqual([[], []]);
  });

  it("folds a job's follow-up reply with its turn", () => {
    const events = [
      message('$q', {}, PERSON),
      message('$reply', RUN),
      message('$tool', {}),
      message('$note', {}),
      message('$follow-up', RUN),
    ];
    expect(folded(events)).toEqual([['$tool', '$note'], ['$reply']]);
  });

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
    expect(state()).toEqual([['$a2'], false]);
    act(() => result!.toggle(result!.view.breaks.get('$a1')!.fold));
    expect(state()).toEqual([[], true]);
    act(() => result!.toggle(result!.view.breaks.get('$a1')!.fold));
    expect(state()).toEqual([['$a2'], false]);
  });
});
