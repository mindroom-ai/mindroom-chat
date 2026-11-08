// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createClient, MatrixEvent, Room, RoomStateEvent } from 'matrix-js-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getMemberDisplayName,
  getRoomPermissions,
  isMindroomAgentUserId,
  mxcUrlToHttp,
  useRoomPermissions,
} from './matrix';

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

describe('getRoomPermissions', () => {
  const levels = {
    users: { [MODERATOR]: 50 },
    users_default: 0,
    events: { 'm.room.message': 10, 'm.room.power_levels': 100 },
    state_default: 50,
  };

  /** Every kind of answer `permissions` gives for `userId`. */
  const answers = (permissions: ReturnType<typeof getRoomPermissions>, userId: string) => [
    permissions.event('m.room.message', userId),
    permissions.stateEvent('m.room.topic', userId),
    permissions.stateEvent('m.room.power_levels', userId),
    permissions.action('ban', userId),
    permissions.notification('room', userId),
  ];

  it("gives, read once, the hook's answers for a user below the levels, a moderator and a version 12 room's creator", () => {
    const room = roomWith('12', levels);
    const { result } = renderHook(() => useRoomPermissions(room));
    const permissions = getRoomPermissions(room);
    const users = [MEMBER, MODERATOR, CREATOR];
    expect(users.map((userId) => answers(permissions, userId))).toEqual([
      [false, false, false, false, false],
      [true, true, false, true, true],
      [true, true, true, true, true],
    ]);
    expect(users.map((userId) => answers(permissions, userId))).toEqual(
      users.map((userId) => answers(result.current, userId))
    );
  });

  it('has a change of power levels in the next read', () => {
    const room = roomWith('11', { users_default: 0, events_default: 0 });
    expect(getRoomPermissions(room).event('m.room.message', MEMBER)).toBe(true);
    room.currentState.setStateEvents([
      stateEvent('m.room.power_levels', { events_default: 0, events: { 'm.room.message': 50 } }),
    ]);
    expect(getRoomPermissions(room).event('m.room.message', MEMBER)).toBe(false);
  });
});

describe('getMemberDisplayName', () => {
  const memberEvent = (
    userId: string,
    membership: string,
    displayname?: string,
    previousName?: string
  ) =>
    new MatrixEvent({
      type: 'm.room.member',
      room_id: '!lobby:example.org',
      sender: userId,
      state_key: userId,
      content: { membership, displayname },
      unsigned: previousName
        ? { prev_content: { membership: 'join', displayname: previousName } }
        : undefined,
    });

  it('names a member as the app does: a unique name, a shared one with the user ID, and the last name of one who left', () => {
    const client = createClient({ baseUrl: 'https://example.org', userId: MEMBER });
    const room = new Room('!lobby:example.org', client, MEMBER);
    room.currentState.setStateEvents([
      memberEvent(MEMBER, 'join', 'Ada'),
      memberEvent('@sam:example.org', 'join', 'Sam'),
      memberEvent('@samuel:example.org', 'join', 'Sam'),
      memberEvent('@grace:example.org', 'leave', undefined, 'Grace'),
    ]);
    expect(getMemberDisplayName(room, MEMBER)).toBe('Ada');
    expect(getMemberDisplayName(room, '@sam:example.org')).toBe(
      'Sam (\u2066@sam:example.org\u2069)'
    );
    expect(getMemberDisplayName(room, '@samuel:example.org')).toBe(
      'Sam (\u2066@samuel:example.org\u2069)'
    );
    expect(getMemberDisplayName(room, '@grace:example.org')).toBe('Grace');
    expect(getMemberDisplayName(room, '@stranger:example.org')).toBeUndefined();
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
