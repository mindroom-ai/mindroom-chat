import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MutualRoomsChip } from './MutualRoomsChip';

const ROOM = vi.hoisted(() => ({
  roomId: '!desk:x',
  name: 'Desk \u202eksed\u202c',
  getMember: () => ({ membership: 'join' }),
  // A room without a creation event: not a space.
  getLiveTimeline: () => ({ getState: () => ({ getStateEvents: () => undefined }) }),
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getRoom: (roomId: string) => (roomId === ROOM.roomId ? ROOM : null) }),
}));
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
      renderer = create(<MutualRoomsChip userId="@quinn:x" onOpen={() => undefined} />);
    });
    const rows = renderer!.root.findAll((node) => node.props['data-menu-item'] === '');
    expect(rows.map(text)).toEqual(['Desk <U+202E>ksed<U+202C>']);
  });
});
