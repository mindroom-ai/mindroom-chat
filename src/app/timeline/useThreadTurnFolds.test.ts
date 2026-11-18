import { MatrixEvent, type EventTimelineSet, type Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { turnRowWaits } from './useThreadTurnFolds';

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

  it('holds a row that did not decrypt from a sender that is no agent by name', () => {
    const undecrypted = new MatrixEvent({
      event_id: '$enc',
      room_id: ROOM,
      sender: PERSON,
      type: 'm.room.encrypted',
      origin_server_ts: 1,
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'x' },
    });
    expect(waits(undecrypted)).toBe(true);
  });
});
