import React, { useCallback, useState } from 'react';
import { MatrixClient, Room } from 'matrix-js-sdk';
import { ReactTestRenderer, act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PendingSpaceDrop, useResolvedPendingSpaceDrop } from './useResolvedPendingSpaceDrop';

const pendingDrop: PendingSpaceDrop = {
  roomId: '!room:example.org',
  spaceId: '!space:example.org',
  placement: {
    orderKey: 'space:!space:example.org',
    roomIds: ['!room:example.org'],
  },
};

let latestPending: PendingSpaceDrop | undefined;
let latestResolved: ReturnType<typeof useResolvedPendingSpaceDrop>;

function PendingDropHarness({
  mx,
  revision,
  roomIds,
  spaceIds,
}: {
  mx: MatrixClient;
  revision: number;
  roomIds: string[];
  spaceIds: string[];
}) {
  const [pending, setPending] = useState<PendingSpaceDrop | undefined>(pendingDrop);
  const clearPending = useCallback(() => setPending(undefined), []);
  const resolved = useResolvedPendingSpaceDrop(mx, pending, roomIds, spaceIds, clearPending);

  latestPending = pending;
  latestResolved = resolved;
  return <span data-revision={revision} />;
}

describe('pending Space drops', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    latestPending = undefined;
    latestResolved = undefined;
  });

  it('clears a hidden confirmation so it cannot reopen after the Space rejoins', () => {
    const room = { roomId: pendingDrop.roomId } as Room;
    const space = { roomId: pendingDrop.spaceId } as Room;
    const rooms = new Map([
      [room.roomId, room],
      [space.roomId, space],
    ]);
    const mx = {
      getRoom: vi.fn((roomId: string) => rooms.get(roomId)),
    } as unknown as MatrixClient;

    act(() => {
      renderer = create(
        <PendingDropHarness
          mx={mx}
          revision={0}
          roomIds={[room.roomId]}
          spaceIds={[space.roomId]}
        />
      );
    });
    expect(latestResolved?.room).toBe(room);
    expect(latestResolved?.space).toBe(space);

    act(() => {
      renderer?.update(
        <PendingDropHarness mx={mx} revision={1} roomIds={[room.roomId]} spaceIds={[]} />
      );
    });
    expect(latestPending).toBeUndefined();
    expect(latestResolved).toBeUndefined();
    expect(mx.getRoom(space.roomId)).toBe(space);

    act(() => {
      renderer?.update(
        <PendingDropHarness
          mx={mx}
          revision={2}
          roomIds={[room.roomId]}
          spaceIds={[space.roomId]}
        />
      );
    });
    expect(latestPending).toBeUndefined();
    expect(latestResolved).toBeUndefined();
  });

  it('clears a confirmation when its SDK room object disappears', () => {
    const room = { roomId: pendingDrop.roomId } as Room;
    const space = { roomId: pendingDrop.spaceId } as Room;
    const rooms = new Map([
      [room.roomId, room],
      [space.roomId, space],
    ]);
    const mx = {
      getRoom: vi.fn((roomId: string) => rooms.get(roomId)),
    } as unknown as MatrixClient;

    act(() => {
      renderer = create(
        <PendingDropHarness
          mx={mx}
          revision={0}
          roomIds={[room.roomId]}
          spaceIds={[space.roomId]}
        />
      );
    });
    expect(latestResolved?.space).toBe(space);

    rooms.delete(space.roomId);
    act(() => {
      renderer?.update(
        <PendingDropHarness
          mx={mx}
          revision={1}
          roomIds={[room.roomId]}
          spaceIds={[space.roomId]}
        />
      );
    });

    expect(latestPending).toBeUndefined();
    expect(latestResolved).toBeUndefined();
  });
});
