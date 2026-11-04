import {
  EventStatus,
  EventType,
  MatrixEvent,
  PendingEventOrdering,
  RelationType,
  Room,
} from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createMatrixClient } from '../matrix/matrixClientFactory';
import { getActiveAnnotationsByKey } from '../../utils/reactionAnnotations';
import { toggleReaction } from './reactionToggle';

const ME = '@alice:example.org';
const ROOM_ID = '!room:example.org';

/** A client whose homeserver answers every send with `status`, and a room it knows. */
const setup = async (status: number) => {
  const fetchFn = vi.fn(async () =>
    status === 200
      ? new Response(JSON.stringify({ event_id: '$sent' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      : new Response(JSON.stringify({ errcode: 'M_FORBIDDEN', error: 'Forbidden' }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
  );
  const mx = createMatrixClient({
    baseUrl: 'https://matrix.example',
    userId: ME,
    accessToken: 'token',
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  const room = new Room(ROOM_ID, mx, ME, {
    pendingEventOrdering: PendingEventOrdering.Chronological,
  });
  mx.store.storeRoom(room);
  const message = new MatrixEvent({
    event_id: '$message',
    type: EventType.RoomMessage,
    room_id: ROOM_ID,
    sender: '@bob:example.org',
    origin_server_ts: 1,
    content: { msgtype: 'm.text', body: 'Lunch?' },
  });
  await room.addLiveEvents([message], { addToState: false });
  const reactions = () =>
    room
      .getUnfilteredTimelineSet()
      .relations.getChildEventsForEvent('$message', RelationType.Annotation, EventType.Reaction);
  // The chips the message shows.
  const keys = () =>
    getActiveAnnotationsByKey(reactions()).map(([key, events]) => [key, events.size]);
  return { mx, room, reactions, keys, fetchFn };
};

describe('toggleReaction', () => {
  it('sends the reaction, which stays once the server took it', async () => {
    const { mx, room, keys } = await setup(200);

    await toggleReaction(mx, { room, targetEventId: '$message', key: '👍' });

    expect(keys()).toEqual([['👍', 1]]);
  });

  it('drops a reaction the server refused, so no chip only this user sees is left', async () => {
    const { mx, room, keys } = await setup(403);

    await expect(toggleReaction(mx, { room, targetEventId: '$message', key: '👍' })).rejects.toThrow();

    expect(keys()).toEqual([]);
    expect(
      room
        .getLiveTimeline()
        .getEvents()
        .filter((event) => event.status === EventStatus.NOT_SENT)
    ).toEqual([]);
  });

  it('drops a redaction the server refused, so it is not left unsent', async () => {
    const { mx, room, reactions } = await setup(403);
    const reaction = new MatrixEvent({
      event_id: '$reaction',
      type: EventType.Reaction,
      room_id: ROOM_ID,
      sender: ME,
      origin_server_ts: 2,
      content: {
        'm.relates_to': { rel_type: RelationType.Annotation, event_id: '$message', key: '👍' },
      },
    });
    await room.addLiveEvents([reaction], { addToState: false });

    await expect(
      toggleReaction(mx, {
        room,
        targetEventId: '$message',
        key: '👍',
        relations: reactions(),
      })
    ).rejects.toThrow();

    expect(reaction.isRedacted()).toBe(false);
    expect(
      room
        .getLiveTimeline()
        .getEvents()
        .filter((event) => event.status === EventStatus.NOT_SENT)
    ).toEqual([]);
  });
});
