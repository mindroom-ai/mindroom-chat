import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { NO_MODEL_CHANGES, planModelChanges, sameModelChangePlan } from './modelChanges';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';

const ROOM = '!room:example.org';
const ROOT = '$root';
const ROUTER = '@mindroom_router:example.org';
const PERSON = '@sam:example.org';
const SELECTION = 'io.mindroom.model_selection';
const RESULT = 'io.mindroom.model_selection_result';

const inThread = (rootId = ROOT) => ({
  'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
});

const message = (
  id: string,
  content: Record<string, unknown>,
  { sender = PERSON, roomId = ROOM, type = 'm.room.message' } = {}
) => new MatrixEvent({ event_id: id, type, sender, room_id: roomId, content });

/** A typed command in the thread. */
const typed = (body: string, id = '$command', sender = PERSON) =>
  message(id, { msgtype: 'm.text', body, ...inThread() }, { sender });

/** The picker's command: the readable body with the structured operation. */
const picked = (operation: 'set' | 'reset', model?: string, id = '$command') =>
  message(id, {
    msgtype: 'm.text',
    body: `!model ${model ?? 'reset'}`,
    ...inThread(),
    [SELECTION]: {
      version: 1,
      runtime_user_id: ROUTER,
      runtime_device_id: 'DEVICE',
      operation,
      ...(model ? { model } : {}),
    },
  });

const result = (changes: Record<string, unknown> = {}) => ({
  version: 1,
  command_event_id: '$command',
  room_id: ROOM,
  thread_id: ROOT,
  runtime_user_id: ROUTER,
  runtime_device_id: 'DEVICE',
  operation: 'set',
  model: 'fast',
  status: 'applied',
  override: 'fast',
  ...changes,
});
const RESET = { operation: 'reset', model: undefined, override: null };

/** The router's reply with `resultContent`, in the thread. */
const ack = (
  resultContent: Record<string, unknown> = result(),
  { id = '$ack', sender = ROUTER, relation = inThread() as Record<string, unknown> } = {}
) =>
  message(
    id,
    {
      msgtype: 'm.text',
      body: '✅ This thread now uses fast',
      ...relation,
      [RESULT]: resultContent,
    },
    { sender }
  );

const replaceWith = (event: MatrixEvent, newContent: Record<string, unknown>) => {
  event.makeReplaced(
    new MatrixEvent({
      event_id: `${event.getId() ?? ''}-edit`,
      type: 'm.room.message',
      sender: event.getSender(),
      room_id: ROOM,
      content: {
        ...newContent,
        'm.new_content': newContent,
        'm.relates_to': { rel_type: 'm.replace', event_id: event.getId() },
      },
    })
  );
  return event;
};

const plan = (
  events: MatrixEvent[],
  options: {
    ignored?: ReadonlySet<string>;
    revealed?: ReadonlySet<string>;
    routerUserId?: string | undefined;
  } = {}
) =>
  planModelChanges({
    events,
    // As the timeline reads a row: the latest replacement by the event's own sender.
    getContent: (event) =>
      getLatestMessageContent(event, getEditedEvent(event.getId() ?? '', event, undefined)),
    // The room's router, unless a test names another or none (an explicit undefined).
    routerUserId: ROUTER,
    ignored: new Set<string>(),
    revealed: new Set<string>(),
    ...options,
  });

describe('planModelChanges', () => {
  it('pairs a typed change with its acknowledgement and hides the command', () => {
    const made = plan([typed('!model fast'), ack()]);
    expect([...made.hiddenEventIds]).toEqual(['$command']);
    expect(made.byAckId.get('$ack')).toEqual({
      commandId: '$command',
      operation: 'set',
      model: 'fast',
      senderId: PERSON,
      threadId: ROOT,
    });
  });

  it.each([
    ['a slash command', '/model fast'],
    ['another case and spacing', '  !MODEL   fast '],
  ])('pairs %s', (_case, body) => {
    expect(plan([typed(body), ack()]).byAckId.has('$ack')).toBe(true);
  });

  it('pairs a model at a level by its whole reference', () => {
    const made = plan([
      typed('!model fast@high'),
      ack(result({ model: 'fast@high', override: 'fast@high' })),
    ]);
    expect(made.byAckId.get('$ack')?.model).toBe('fast@high');
  });

  it.each([
    ['reset', '!model reset'],
    ['clear', '/model Clear'],
  ])('pairs a typed %s with an applied reset', (_case, body) => {
    const made = plan([typed(body), ack(result(RESET))]);
    expect(made.byAckId.get('$ack')).toMatchObject({ operation: 'reset', model: undefined });
  });

  it("pairs the picker's command by its structured operation, whatever its body says", () => {
    const set = picked('set', 'fast');
    expect(plan([set, ack()]).byAckId.get('$ack')).toMatchObject({ operation: 'set' });
    const reset = picked('reset');
    expect(plan([reset, ack(result(RESET))]).byAckId.get('$ack')).toMatchObject({
      operation: 'reset',
    });
  });

  it('pairs a model named reset when the router set it', () => {
    const made = plan([typed('!model reset'), ack(result({ model: 'reset', override: 'reset' }))]);
    expect(made.byAckId.get('$ack')).toMatchObject({ operation: 'set', model: 'reset' });
  });

  it.each([
    ['an ordinary message', 'which model is fast?'],
    ['a listing', '!model'],
    ['a listing by name', '!model list'],
    ['another model than the one applied', '!model slow'],
    ['a model in another case', '!model Fast'],
    ['the room model command', '!room_model fast'],
    ['a command behind other words', 'please !model fast'],
    ['a command with more lines', '!model fast\nand thanks'],
    ['a voice transcript of the command', '🎤 !model fast'],
  ])('keeps both rows when the named message is %s', (_case, body) => {
    expect(plan([typed(body), ack()])).toBe(NO_MODEL_CHANGES);
  });

  it('keeps both rows of a typed set that the router applied as a reset, and the reverse', () => {
    expect(plan([typed('!model fast'), ack(result(RESET))])).toBe(NO_MODEL_CHANGES);
    expect(plan([typed('!model reset'), ack()])).toBe(NO_MODEL_CHANGES);
  });

  it("keeps both rows when the picker's operation differs from the result", () => {
    expect(plan([picked('set', 'slow'), ack()])).toBe(NO_MODEL_CHANGES);
    expect(plan([picked('reset'), ack()])).toBe(NO_MODEL_CHANGES);
    // A structured command is never read as typed text.
    const malformed = message('$command', {
      msgtype: 'm.text',
      body: '!model fast',
      ...inThread(),
      [SELECTION]: { operation: 'set' },
    });
    expect(plan([malformed, ack()])).toBe(NO_MODEL_CHANGES);
  });

  it.each([
    ['rejected', result({ status: 'rejected', override: undefined, error: 'Unknown model' })],
    ['malformed', { status: 'applied' }],
    ['of another version', result({ version: 2 })],
    ['for another room', result({ room_id: '!other:example.org' })],
    ['for another thread', result({ thread_id: '$other' })],
    ['in the name of another runtime account', result({ runtime_user_id: '@mindroom_x:e.org' })],
    ['for a command that is not loaded', result({ command_event_id: '$elsewhere' })],
    ['for itself', result({ command_event_id: '$ack' })],
  ])('keeps both rows when the result is %s', (_case, resultContent) => {
    expect(plan([typed('!model fast'), ack(resultContent)])).toBe(NO_MODEL_CHANGES);
  });

  it('keeps both rows of a reply without a result, as an older backend answers a typed change', () => {
    const reply = message(
      '$ack',
      { msgtype: 'm.text', body: '✅ This thread now uses fast', ...inThread() },
      { sender: ROUTER }
    );
    expect(plan([typed('!model fast'), reply])).toBe(NO_MODEL_CHANGES);
  });

  it.each([
    ['another agent', '@mindroom_helper:example.org'],
    ["another installation's router", '@mindroom_router_lab1:example.org'],
    ['a person', PERSON],
  ])('keeps both rows when %s sent the result, the room naming another router', (_case, sender) => {
    const forged = ack(result({ runtime_user_id: sender }), { sender });
    expect(plan([typed('!model fast'), forged])).toBe(NO_MODEL_CHANGES);
  });

  it('keeps both rows while the room names no router it trusts, or one the viewer ignores', () => {
    const events = [typed('!model fast'), ack()];
    expect(plan(events, { routerUserId: undefined })).toBe(NO_MODEL_CHANGES);
    expect(plan(events, { ignored: new Set([ROUTER]) })).toBe(NO_MODEL_CHANGES);
  });

  it.each([
    ['outside the thread', {}],
    ['in another thread', inThread('$other')],
    ['an edit of another message', { 'm.relates_to': { rel_type: 'm.replace', event_id: '$x' } }],
  ])('keeps both rows of an acknowledgement %s', (_case, relation) => {
    expect(plan([typed('!model fast'), ack(result(), { relation })])).toBe(NO_MODEL_CHANGES);
  });

  it.each([
    ['is redacted', () => Object.assign(typed('!model fast'), { isRedacted: () => true })],
    ['comes from an ignored sender', () => typed('!model fast', '$command', '@ignored:e.org')],
    [
      'comes from an agent, which sends it for someone else',
      () => typed('!model fast', '$command', '@mindroom_helper:example.org'),
    ],
    ['is the thread root', () => message('$command', { msgtype: 'm.text', body: '!model fast' })],
    [
      'is in another thread',
      () => message('$command', { msgtype: 'm.text', body: '!model fast', ...inThread('$other') }),
    ],
    [
      'is in another room',
      () =>
        message(
          '$command',
          { msgtype: 'm.text', body: '!model fast', ...inThread() },
          { roomId: '!other:example.org' }
        ),
    ],
    [
      'is no message',
      () =>
        message(
          '$command',
          { msgtype: 'm.text', body: '!model fast', ...inThread() },
          { type: 'm.sticker' }
        ),
    ],
  ])('keeps both rows when the command %s', (_case, command) => {
    expect(plan([command(), ack()], { ignored: new Set(['@ignored:e.org']) })).toBe(
      NO_MODEL_CHANGES
    );
  });

  it('keeps both rows of a redacted acknowledgement', () => {
    const redacted = Object.assign(ack(), { isRedacted: () => true });
    expect(plan([typed('!model fast'), redacted])).toBe(NO_MODEL_CHANGES);
  });

  it('keeps both rows once the command was edited into another message', () => {
    const edited = replaceWith(typed('!model fast'), {
      msgtype: 'm.text',
      body: 'never mind',
      ...inThread(),
    });
    expect(plan([edited, ack()])).toBe(NO_MODEL_CHANGES);
  });

  it('reads the result from the latest version of the acknowledgement', () => {
    const rejected = result({ status: 'rejected', override: undefined });
    const now = { msgtype: 'm.text', body: '✅ applied', ...inThread() };
    expect(
      plan([typed('!model fast'), replaceWith(ack(rejected), { ...now, [RESULT]: result() })])
        .byAckId.size
    ).toBe(1);
    expect(plan([typed('!model fast'), replaceWith(ack(), { ...now, [RESULT]: rejected })])).toBe(
      NO_MODEL_CHANGES
    );
  });

  it('keeps both rows when an encrypted command is answered in the clear', () => {
    const command = Object.assign(typed('!model fast'), { isEncrypted: () => true });
    expect(plan([command, ack()])).toBe(NO_MODEL_CHANGES);
    const encryptedAck = Object.assign(ack(), { isEncrypted: () => true });
    expect(plan([command, encryptedAck]).byAckId.size).toBe(1);
  });

  it('keeps the rows the route or a jump opened', () => {
    const events = [typed('!model fast'), ack()];
    expect(plan(events, { revealed: new Set(['$command']) })).toBe(NO_MODEL_CHANGES);
    expect(plan(events, { revealed: new Set(['$ack']) })).toBe(NO_MODEL_CHANGES);
  });

  it('pairs a command once: a second acknowledgement of it keeps its row', () => {
    const made = plan([typed('!model fast'), ack(), ack(result(), { id: '$again' })]);
    expect([...made.byAckId.keys()]).toEqual(['$ack']);
    expect([...made.hiddenEventIds]).toEqual(['$command']);
  });

  it('pairs each change of a thread with its own command', () => {
    const made = plan([
      typed('!model fast', '$first'),
      ack(result({ command_event_id: '$first' }), { id: '$ack1' }),
      message('$talk', { msgtype: 'm.text', body: 'thanks', ...inThread() }),
      typed('!model reset', '$second'),
      ack(result({ ...RESET, command_event_id: '$second' }), { id: '$ack2' }),
    ]);
    expect([...made.hiddenEventIds]).toEqual(['$first', '$second']);
    expect(made.byAckId.get('$ack1')).toMatchObject({ commandId: '$first', operation: 'set' });
    expect(made.byAckId.get('$ack2')).toMatchObject({ commandId: '$second', operation: 'reset' });
  });
});

describe('sameModelChangePlan', () => {
  it('holds while the plans draw the same lines', () => {
    const first = plan([typed('!model fast'), ack()]);
    expect(sameModelChangePlan(first, plan([typed('!model fast'), ack()]))).toBe(true);
    expect(sameModelChangePlan(first, NO_MODEL_CHANGES)).toBe(false);
    const other = plan([
      typed('!model fast@high'),
      ack(result({ model: 'fast@high', override: 'fast@high' })),
    ]);
    expect(sameModelChangePlan(first, other)).toBe(false);
  });
});
