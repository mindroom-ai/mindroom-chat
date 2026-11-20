import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MutualRoomsChip, useMutualRooms } from './MutualRoomsChip';

const ROOM = vi.hoisted(() => ({
  roomId: '!desk:x',
  name: 'Desk \u202eksed\u202c',
  membership: 'join',
  getMember: () => ({ membership: ROOM.membership }),
  // A room without a creation event: not a space.
  getLiveTimeline: () => ({ getState: () => ({ getStateEvents: () => undefined }) }),
}));

const CLIENT = vi.hoisted(() => ({
  getRoom: (roomId: string) => (roomId === '!desk:x' ? ROOM : null),
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => CLIENT }));
vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: vi.fn(), navigateSpace: vi.fn() }),
}));
vi.mock('../../matrix/state/roomList', async () => {
  const { atom } = await import('jotai');
  return { allRoomsAtom: atom([ROOM.roomId]) };
});
vi.mock('../../matrix/state/mDirectList', async () => {
  const { atom } = await import('jotai');
  return { mDirectAtom: atom(new Set<string>()) };
});
vi.mock('./ProfilePopMenu', () => ({
  ProfilePopMenu: ({
    trigger,
    children,
  }: {
    trigger: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <>
      {trigger}
      {children}
    </>
  ),
}));
vi.mock('../../ui/glass/GlassPrimitives', () => ({
  MenuItem: ({ children }: { children: React.ReactNode }) => (
    <button type="button" data-menu-item="">
      {children}
    </button>
  ),
}));

let renderer: ReactTestRenderer | undefined;

/** The chip with the rooms the client shares with `userId`, as the profile card passes them. */
function Chip({ userId }: { userId: string }) {
  return <MutualRoomsChip shared={useMutualRooms(userId)} onOpen={() => undefined} />;
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const text = (node: unknown): string =>
  typeof node === 'string'
    ? node
    : ((node as { children?: unknown[] }).children ?? []).map(text).join('');

describe('MutualRoomsChip', () => {
  it('shows the direction controls of a shared room name as code points, as the room list does', () => {
    act(() => {
      renderer = create(<Chip userId="@quinn:x" />);
    });
    const rows = renderer!.root.findAll((node) => node.props['data-menu-item'] === '');
    expect(rows.map(text)).toEqual(['Desk <U+202E>ksed<U+202C>']);
  });

  it('counts again when their membership event changes, as when they are kicked', () => {
    const counts: number[] = [];
    function Count({ event }: { event: object }) {
      counts.push(useMutualRooms('@quinn:x', event).rooms.length);
      return null;
    }
    act(() => {
      renderer = create(<Count event={{}} />);
    });
    ROOM.membership = 'leave';
    act(() => renderer!.update(<Count event={{}} />));
    ROOM.membership = 'join';
    expect([counts[0], counts.at(-1)]).toEqual([1, 0]);
  });
});
