import { EventEmitter } from 'node:events';
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MatrixClient, MatrixEvent, Room, RoomMember, RoomMemberEvent } from 'matrix-js-sdk';
import { useRoomMembers } from './useRoomMembers';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const createMember = (userId: string): RoomMember =>
  ({
    userId,
    membership: 'join',
  } as RoomMember);

const createMembershipEvent = (roomId: string): MatrixEvent =>
  ({
    getRoomId: () => roomId,
  } as MatrixEvent);

type UseRoomMembersProbeProps = {
  mx: MatrixClient;
  roomId: string;
};
function UseRoomMembersProbe({ mx, roomId }: UseRoomMembersProbeProps) {
  const members = useRoomMembers(mx, roomId);
  return <output>{members.map((member) => member.userId).join(',')}</output>;
}

describe('useRoomMembers', () => {
  it('publishes live membership updates while full member load is still pending', async () => {
    const roomId = '!room:example.org';
    const alice = createMember('@alice:example.org');
    const bob = createMember('@bob:example.org');
    const carol = createMember('@carol:example.org');
    let members = [alice];
    const memberLoad = deferred<void>();
    const room = {
      roomId,
      getMembers: vi.fn(() => members),
      loadMembersIfNeeded: vi.fn(() => memberLoad.promise),
    } as unknown as Room;
    const mx = Object.assign(new EventEmitter(), {
      getRoom: vi.fn(() => room),
    }) as unknown as MatrixClient;

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<UseRoomMembersProbe mx={mx} roomId={roomId} />);
    });

    expect(renderer?.root.findByType('output').children.join('')).toBe('@alice:example.org');

    members = [alice, bob];
    act(() => {
      (mx as unknown as EventEmitter).emit(
        RoomMemberEvent.Membership,
        createMembershipEvent(roomId),
        bob,
        'invite'
      );
    });

    expect(renderer?.root.findByType('output').children.join('')).toBe(
      '@alice:example.org,@bob:example.org'
    );

    members = [alice, bob, carol];
    await act(async () => {
      memberLoad.resolve();
      await memberLoad.promise;
    });

    expect(renderer?.root.findByType('output').children.join('')).toBe(
      '@alice:example.org,@bob:example.org,@carol:example.org'
    );
  });
});
