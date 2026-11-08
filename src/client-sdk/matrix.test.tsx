// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createClient, MatrixEvent, Room, RoomStateEvent } from 'matrix-js-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { isMindroomAgentUserId, mxcUrlToHttp, useRoomPermissions } from './matrix';

const CREATOR = '@creator:example.org';
const MODERATOR = '@moderator:example.org';
const MEMBER = '@ada:example.org';

afterEach(cleanup);

const stateEvent = (type: string, content: Record<string, unknown>) =>
  new MatrixEvent({
    type,
    room_id: '!lobby:example.org',
    sender: CREATOR,
    state_key: '',
    event_id: `$${type}-${Math.random()}`,
    content,
  });

/** A room of the room version `roomVersion` with these power levels, as its member sees it. */
const roomWith = (roomVersion: string, powerLevels: Record<string, unknown>) => {
  const client = createClient({ baseUrl: 'https://example.org', userId: MEMBER });
  const room = new Room('!lobby:example.org', client, MEMBER);
  room.currentState.setStateEvents([
    stateEvent('m.room.create', { room_version: roomVersion }),
    stateEvent('m.room.power_levels', powerLevels),
  ]);
  return room;
};

describe('useRoomPermissions', () => {
  const levels = {
    users: { [MODERATOR]: 50 },
    users_default: 0,
    events: { 'm.room.message': 10 },
    state_default: 50,
  };

  it("answers for a user below and above the room's event and state levels", () => {
    const { result } = renderHook(() => useRoomPermissions(roomWith('11', levels)));
    expect(result.current.event('m.room.message', MEMBER)).toBe(false);
    expect(result.current.stateEvent('m.room.topic', MEMBER)).toBe(false);
    expect(result.current.event('m.room.message', MODERATOR)).toBe(true);
    expect(result.current.stateEvent('m.room.topic', MODERATOR)).toBe(true);
    // Before room version 12 the creator has only the level the power levels give.
    expect(result.current.stateEvent('m.room.topic', CREATOR)).toBe(false);
  });

  it("lets a version 12 room's creator do everything, whatever the power levels say", () => {
    const { result } = renderHook(() => useRoomPermissions(roomWith('12', levels)));
    expect(result.current.stateEvent('m.room.power_levels', CREATOR)).toBe(true);
    expect(result.current.action('ban', CREATOR)).toBe(true);
    expect(result.current.stateEvent('m.room.power_levels', MEMBER)).toBe(false);
  });

  it('answers again when the room changes its power levels', () => {
    const room = roomWith('11', { users_default: 0, events_default: 0 });
    const { result } = renderHook(() => useRoomPermissions(room));
    expect(result.current.event('m.room.message', MEMBER)).toBe(true);

    const raised = stateEvent('m.room.power_levels', {
      events_default: 0,
      events: { 'm.room.message': 50 },
    });
    act(() => {
      room.currentState.setStateEvents([raised]);
      room.client.emit(RoomStateEvent.Events, raised, room.currentState, null);
    });
    expect(result.current.event('m.room.message', MEMBER)).toBe(false);
  });
});

describe('isMindroomAgentUserId', () => {
  it("tells an agent's user ID from a person's", () => {
    expect(isMindroomAgentUserId('@mindroom_helper:example.org')).toBe(true);
    expect(isMindroomAgentUserId(MEMBER)).toBe(false);
  });
});

describe('mxcUrlToHttp', () => {
  const client = createClient({ baseUrl: 'https://example.org', userId: MEMBER });

  it('gives the authenticated download URL, or a thumbnail of the size asked for', () => {
    expect(mxcUrlToHttp(client, 'mxc://example.org/avatar', true)).toBe(
      'https://example.org/_matrix/client/v1/media/download/example.org/avatar?allow_redirect=true'
    );
    expect(mxcUrlToHttp(client, 'mxc://example.org/avatar', true, 32, 32, 'crop')).toBe(
      'https://example.org/_matrix/client/v1/media/thumbnail/example.org/avatar?width=32&height=32&method=crop&allow_redirect=true'
    );
  });
});
