// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, renderHook } from '@testing-library/react';
import { RoomEvent, RoomMemberEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { useRoomMemberChanges } from './useRoomMemberChanges';

const ROOM = '!room:x';

const setup = () => {
  const mx = new EventEmitter();
  const room = Object.assign(new EventEmitter(), { roomId: ROOM });
  const hook = renderHook(() =>
    useRoomMemberChanges(mx as unknown as MatrixClient, room as unknown as Room)
  );
  return { mx, room, hook };
};

const timelineEvent = (type: string) => ({ getType: () => type });

describe('useRoomMemberChanges', () => {
  it("counts a member's new name or membership in this room, and in no other", () => {
    const { mx, hook } = setup();
    expect(hook.result.current).toBe(0);
    act(() => void mx.emit(RoomMemberEvent.Name, undefined, { roomId: ROOM }));
    expect(hook.result.current).toBe(1);
    act(() => void mx.emit(RoomMemberEvent.Membership, undefined, { roomId: ROOM }));
    expect(hook.result.current).toBe(2);
    act(() => {
      mx.emit(RoomMemberEvent.Name, undefined, { roomId: '!other:x' });
      mx.emit(RoomMemberEvent.Membership, undefined, { roomId: '!other:x' });
    });
    expect(hook.result.current).toBe(2);
  });

  it("counts a member event the room's timeline takes, as a new avatar comes, and no other event", () => {
    const { room, hook } = setup();
    act(() => void room.emit(RoomEvent.Timeline, timelineEvent('m.room.message')));
    expect(hook.result.current).toBe(0);
    act(() => void room.emit(RoomEvent.Timeline, timelineEvent('m.room.member')));
    expect(hook.result.current).toBe(1);
  });

  it('stops listening when it unmounts', () => {
    const { mx, room, hook } = setup();
    hook.unmount();
    expect(mx.listenerCount(RoomMemberEvent.Name)).toBe(0);
    expect(mx.listenerCount(RoomMemberEvent.Membership)).toBe(0);
    expect(room.listenerCount(RoomEvent.Timeline)).toBe(0);
  });
});
