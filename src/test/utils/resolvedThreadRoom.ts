import type { Room } from 'matrix-js-sdk';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import {
  buildPerTagEventContent,
  buildPerTagStateKey,
  MINDROOM_THREAD_TAGS_EVENT,
  RESOLVED_TAG,
} from '../../app/event-store/threads/threadTags';
import { matchesEnum } from '../../app/lib/matchesEnum';
import { StateEvent } from '../../app/matrix/types/room';

export const makeResolvedTagEvent = ({
  roomId = '!room:example.org',
  rootId = '$root',
  userId = '@alice:example.org',
  ts = 1000,
  setAt = '2026-11-27T10:00:00.000Z',
} = {}) =>
  new MatrixEvent({
    content: buildPerTagEventContent(userId, undefined, undefined, setAt),
    event_id: `$resolve-${ts}`,
    origin_server_ts: ts,
    room_id: roomId,
    sender: userId,
    state_key: buildPerTagStateKey(rootId, RESOLVED_TAG),
    type: MINDROOM_THREAD_TAGS_EVENT,
  });

export const makeResolvedThreadRoom = (options?: {
  roomId?: string;
  rootId?: string;
  userId?: string;
  tagEvents?: MatrixEvent[];
  pinnedIds?: string[];
  powerLevels?: Record<string, unknown>;
  create?: { content: Record<string, unknown>; sender?: string };
}) => {
  const roomId = options?.roomId ?? '!room:example.org';
  const rootId = options?.rootId ?? '$root';
  const userId = options?.userId ?? '@alice:example.org';
  const state = {
    tagEvents: options?.tagEvents ?? [makeResolvedTagEvent({ roomId, rootId, userId })],
    pinnedIds: options?.pinnedIds ?? [],
    powerLevels: options?.powerLevels,
    create: options?.create,
  };
  const rootEvent = new MatrixEvent({
    content: { body: 'Root', msgtype: 'm.text' },
    event_id: rootId,
    origin_server_ts: 1,
    room_id: roomId,
    sender: userId,
    type: 'm.room.message',
  });
  Object.defineProperty(rootEvent, 'isThreadRoot', { value: true, configurable: true });
  const stateEvent = (type: string, content: Record<string, unknown>, sender = userId) =>
    new MatrixEvent({
      content,
      event_id: `$state-${type}`,
      origin_server_ts: 1,
      room_id: roomId,
      sender,
      state_key: '',
      type,
    });
  const roomState = {
    getStateEvents: (type: string, key?: string) => {
      if (type === MINDROOM_THREAD_TAGS_EVENT) return state.tagEvents;
      if (matchesEnum(type, StateEvent.RoomPinnedEvents) && key === '') {
        return state.pinnedIds.length
          ? stateEvent(StateEvent.RoomPinnedEvents, { pinned: state.pinnedIds })
          : null;
      }
      if (matchesEnum(type, StateEvent.RoomPowerLevels) && key === '') {
        return state.powerLevels ? stateEvent(StateEvent.RoomPowerLevels, state.powerLevels) : null;
      }
      if (matchesEnum(type, StateEvent.RoomCreate) && key === '') {
        return state.create
          ? stateEvent(StateEvent.RoomCreate, state.create.content, state.create.sender)
          : null;
      }
      return key === undefined ? [] : null;
    },
  };
  const room = {
    roomId,
    getThread: (id: string) => (id === rootId ? { rootEvent } : undefined),
    findEventById: (id: string) => (id === rootId ? rootEvent : undefined),
    getLiveTimeline: () => ({ getState: () => roomState }),
  } as unknown as Room;
  return { room, state };
};
