import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { useBindAtoms } from './useBindAtoms';
import { useBindLiveReplyFrames } from '../../mindroom/live/bindLiveReplyFrames';
import { useModelControllerLifetime } from '../../mindroom/models/useModelPicker';
import { useBindArchivedRoomsAtom } from '../../mindroom/rooms/archivedRooms';

vi.mock('../mDirectList', () => ({ mDirectAtom: {}, useBindMDirectAtom: vi.fn() }));
vi.mock('../room-list/inviteList', () => ({ allInvitesAtom: {}, useBindAllInvitesAtom: vi.fn() }));
vi.mock('../room-list/roomList', () => ({ allRoomsAtom: {}, useBindAllRoomsAtom: vi.fn() }));
vi.mock('../room/roomToParents', () => ({
  roomToParentsAtom: {},
  useBindRoomToParentsAtom: vi.fn(),
}));
vi.mock('../room/roomToUnread', () => ({ roomToUnreadAtom: {}, useBindRoomToUnreadAtom: vi.fn() }));
vi.mock('../typingMembers', () => ({
  roomIdToTypingMembersAtom: {},
  useBindRoomIdToTypingMembersAtom: vi.fn(),
}));
vi.mock('../../mindroom/live/bindLiveReplyFrames', () => ({ useBindLiveReplyFrames: vi.fn() }));
vi.mock('../../mindroom/models/useModelPicker', () => ({ useModelControllerLifetime: vi.fn() }));
vi.mock('../../mindroom/rooms/archivedRooms', () => ({ useBindArchivedRoomsAtom: vi.fn() }));

describe('useBindAtoms', () => {
  it("feeds the account's live reply frames to its store, so streamed replies update live", () => {
    const client = { id: 'account' } as unknown as MatrixClient;
    function Probe() {
      useBindAtoms(client);
      return null;
    }

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(React.createElement(Probe));
    });

    expect(useBindLiveReplyFrames).toHaveBeenCalledWith(client);
    act(() => renderer?.unmount());
  });

  it("seeds the account's archived rooms behind the same gate as its room lists", () => {
    const client = { id: 'account' } as unknown as MatrixClient;
    function Probe() {
      useBindAtoms(client);
      return null;
    }

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(React.createElement(Probe));
    });

    expect(useBindArchivedRoomsAtom).toHaveBeenCalledWith(client);
    act(() => renderer?.unmount());
  });

  it('keeps the model picker owner for the life of the client', () => {
    const client = { id: 'account' } as unknown as MatrixClient;
    function Probe() {
      useBindAtoms(client);
      return null;
    }

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(React.createElement(Probe));
    });

    expect(useModelControllerLifetime).toHaveBeenCalled();
    act(() => renderer?.unmount());
  });
});
