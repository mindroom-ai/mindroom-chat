import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { rendererState, room } = vi.hoisted(() => ({
  rendererState: {
    directRoomIds: new Set<string>(),
    renderedDirect: undefined as boolean | undefined,
  },
  room: { roomId: '!room:example.org' },
}));

vi.mock('jotai', () => ({
  useAtomValue: () => rendererState.directRoomIds,
}));

vi.mock('./RoomSettings', async () => {
  const reactModule = await import('react');
  const { useIsDirectRoom } = await import('../../hooks/useRoom');

  return {
    RoomSettings: () => {
      rendererState.renderedDirect = useIsDirectRoom();
      return reactModule.createElement('mock-room-settings');
    },
  };
});

vi.mock('../../components/Modal500', () => ({
  Modal500: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../state/hooks/roomSettings', () => ({
  useCloseRoomSettings: () => vi.fn(),
  useRoomSettingsState: () => ({ roomId: room.roomId }),
}));

vi.mock('../../hooks/useGetRoom', () => ({
  useAllJoinedRoomsSet: () => new Set([room.roomId]),
  useGetRoom: () => (roomId: string) => roomId === room.roomId ? room : undefined,
}));

vi.mock('../../state/mDirectList', () => ({
  mDirectAtom: {},
}));

describe('RoomSettingsRenderer', () => {
  afterEach(() => {
    rendererState.directRoomIds = new Set();
    rendererState.renderedDirect = undefined;
  });

  it('provides direct-room identity to settings pages', async () => {
    rendererState.directRoomIds = new Set([room.roomId]);
    const { RoomSettingsRenderer } = await import('./RoomSettingsRenderer');

    await act(async () => {
      create(React.createElement(RoomSettingsRenderer));
    });

    expect(rendererState.renderedDirect).toBe(true);
  });

  it('keeps ordinary room settings outside direct-room policy', async () => {
    const { RoomSettingsRenderer } = await import('./RoomSettingsRenderer');

    await act(async () => {
      create(React.createElement(RoomSettingsRenderer));
    });

    expect(rendererState.renderedDirect).toBe(false);
  });
});
