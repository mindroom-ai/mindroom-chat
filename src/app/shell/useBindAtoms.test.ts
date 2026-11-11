import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { useBindAtoms } from './useBindAtoms';
import { useBindLiveReplyFrames } from '../messages/live/bindLiveReplyFrames';
import { useBindSubagentFrames } from '../messages/live/bindSubagentFrames';
import { useModelControllerLifetime } from '../models/useModelPicker';
import { useBindArchivedRoomsAtom } from '../matrix/state/archivedRooms';
import { useBindReplacedRoomsAtom } from '../matrix/state/replacedRooms';
import { useBindAccountSettings } from '../matrix/hooks/useAccountSettings';
import { useBindRoamingSettings } from '../matrix/hooks/useBindRoamingSettings';

vi.mock('../matrix/state/mDirectList', () => ({ mDirectAtom: {}, useBindMDirectAtom: vi.fn() }));
vi.mock('../matrix/state/inviteList', () => ({ allInvitesAtom: {}, useBindAllInvitesAtom: vi.fn() }));
vi.mock('../matrix/state/roomList', () => ({ allRoomsAtom: {}, useBindAllRoomsAtom: vi.fn() }));
vi.mock('../matrix/state/roomToParents', () => ({
  roomToParentsAtom: {},
  useBindRoomToParentsAtom: vi.fn(),
}));
vi.mock('../matrix/state/roomToUnread', () => ({ roomToUnreadAtom: {}, useBindRoomToUnreadAtom: vi.fn() }));
vi.mock('../matrix/state/typingMembers', () => ({
  roomIdToTypingMembersAtom: {},
  useBindRoomIdToTypingMembersAtom: vi.fn(),
}));
vi.mock('../messages/live/bindLiveReplyFrames', () => ({ useBindLiveReplyFrames: vi.fn() }));
vi.mock('../messages/live/bindSubagentFrames', () => ({ useBindSubagentFrames: vi.fn() }));
vi.mock('../models/useModelPicker', () => ({ useModelControllerLifetime: vi.fn() }));
vi.mock('../matrix/state/archivedRooms', () => ({ useBindArchivedRoomsAtom: vi.fn() }));
vi.mock('../matrix/state/replacedRooms', () => ({ useBindReplacedRoomsAtom: vi.fn() }));
vi.mock('../matrix/hooks/useAccountSettings', () => ({
  useBindAccountSettings: vi.fn(),
}));
vi.mock('../matrix/hooks/useBindRoamingSettings', () => ({ useBindRoamingSettings: vi.fn() }));

describe('useBindAtoms', () => {
  it("feeds the account's live reply and sub-agent frames to their stores, so both update live", () => {
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
    expect(useBindSubagentFrames).toHaveBeenCalledWith(client);
    act(() => renderer?.unmount());
  });

  it("seeds the account's archived and replaced rooms behind the same gate as its room lists", () => {
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
    expect(useBindReplacedRoomsAtom).toHaveBeenCalledWith(client);
    act(() => renderer?.unmount());
  });

  it("seeds the account's MindRoom settings behind the gate, so the first page render reads them", () => {
    const client = { id: 'account' } as unknown as MatrixClient;
    function Probe() {
      useBindAtoms(client);
      return null;
    }

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(React.createElement(Probe));
    });

    expect(useBindAccountSettings).toHaveBeenCalledWith(client);
    act(() => renderer?.unmount());
  });

  it("seeds the account's roaming app settings behind the gate, so the first page render shows them", () => {
    const client = { id: 'account' } as unknown as MatrixClient;
    function Probe() {
      useBindAtoms(client);
      return null;
    }

    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(React.createElement(Probe));
    });

    expect(useBindRoamingSettings).toHaveBeenCalledWith(client);
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
