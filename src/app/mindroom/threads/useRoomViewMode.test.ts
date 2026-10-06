import { EventEmitter } from 'node:events';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import { RoomMemberEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { mDirectAtom } from '../../state/mDirectList';
import { createSessionId } from '../../state/sessions';
import { getRoomViewModeStorageKey, type RoomViewMode } from './roomViewMode';
import { resolveEffectiveRoomViewMode, useRoomViewMode } from './useRoomViewMode';

const simpleModeState = vi.hoisted(() => ({ value: true }));

vi.mock('../settings/useMindroomAccountSettings', () => ({
  useSimpleMode: () => simpleModeState.value,
}));

describe('resolveEffectiveRoomViewMode', () => {
  it('keeps compact and threaded preferences while Simple Mode is enabled', () => {
    expect(resolveEffectiveRoomViewMode('compact', true, false)).toBe('compact');
    expect(resolveEffectiveRoomViewMode('threaded', true, false)).toBe('threaded');
  });

  it('keeps Classic out of Simple Mode by falling back to compact', () => {
    expect(resolveEffectiveRoomViewMode('classic', true, false)).toBe('compact');
  });

  it('preserves the account-scoped room preference outside Simple Mode', () => {
    expect(resolveEffectiveRoomViewMode('classic', false, false)).toBe('classic');
    expect(resolveEffectiveRoomViewMode('threaded', false, false)).toBe('threaded');
  });

  it('shows a direct message between people in Classic, also in Simple Mode', () => {
    expect(resolveEffectiveRoomViewMode('compact', true, true)).toBe('classic');
    expect(resolveEffectiveRoomViewMode('threaded', true, true)).toBe('classic');
    expect(resolveEffectiveRoomViewMode('compact', false, true)).toBe('classic');
    expect(resolveEffectiveRoomViewMode('threaded', false, true)).toBe('classic');
  });
});

describe('useRoomViewMode', () => {
  const userId = '@alice:example.org';
  const agentId = '@mindroom_assistant:example.org';
  const sessionId = createSessionId('https://example.org', userId);
  const storage = new Map<string, string>();

  type Member = { roomId: string; userId: string; membership: string };
  const roomMembers = new Map<string, Member[]>();
  const createClient = () =>
    Object.assign(new EventEmitter(), {
      getHomeserverUrl: () => 'https://example.org',
      getSafeUserId: () => userId,
      getRoom: (roomId: string) => {
        const members = roomMembers.get(roomId);
        return members ? { getMembers: () => members } : null;
      },
    });
  const addRoom = (roomId: string, memberIds: string[]) =>
    roomMembers.set(
      roomId,
      memberIds.map((memberId) => ({ roomId, userId: memberId, membership: 'join' }))
    );
  const setMembership = (roomId: string, memberId: string, membership: string) => {
    const members = roomMembers.get(roomId) ?? [];
    const member = { roomId, userId: memberId, membership };
    roomMembers.set(roomId, [...members.filter((m) => m.userId !== memberId), member]);
    act(() => {
      mx.emit(RoomMemberEvent.Membership, {} as MatrixEvent, member, undefined);
    });
  };
  const storedMode = (roomId: string) => storage.get(getRoomViewModeStorageKey(sessionId, roomId));
  const storeMode = (roomId: string, mode: RoomViewMode) =>
    storage.set(getRoomViewModeStorageKey(sessionId, roomId), JSON.stringify(mode));

  let mx: ReturnType<typeof createClient>;
  let renderer: ReactTestRenderer | undefined;
  const results = new Map<string, ReturnType<typeof useRoomViewMode>>();

  function Probe({ roomId }: { roomId: string }) {
    results.set(roomId, useRoomViewMode(roomId));
    return null;
  }

  const render = (roomIds: string[], directRoomIds: string[]) => {
    const store = createStore();
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set(directRoomIds) });
    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            MatrixClientProvider,
            { value: mx as unknown as MatrixClient },
            roomIds.map((roomId) => React.createElement(Probe, { key: roomId, roomId }))
          )
        )
      );
    });
  };

  beforeEach(() => {
    simpleModeState.value = true;
    mx = createClient();
    vi.stubGlobal('localStorage', {
      get length() {
        return storage.size;
      },
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    } as unknown as Storage);
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    results.clear();
    storage.clear();
    roomMembers.clear();
    vi.unstubAllGlobals();
  });

  it('shows a direct message between people in Classic and offers no other mode', () => {
    const roomId = '!people-dm:example.org';
    addRoom(roomId, [userId, '@bob:example.org']);
    storeMode(roomId, 'threaded');

    render([roomId], [roomId]);

    expect(results.get(roomId)?.viewMode).toBe('classic');
    expect(results.get(roomId)?.availableViewModes).toEqual([]);
    expect(results.get(roomId)?.storedViewMode).toBe('threaded');
    expect(storedMode(roomId)).toBe('"threaded"');
  });

  it('returns to the stored mode once an agent is invited to the direct message', () => {
    const roomId = '!people-dm-invite:example.org';
    addRoom(roomId, [userId, '@bob:example.org']);
    storeMode(roomId, 'threaded');
    render([roomId], [roomId]);
    expect(results.get(roomId)?.viewMode).toBe('classic');

    setMembership(roomId, agentId, 'invite');

    expect(results.get(roomId)?.viewMode).toBe('threaded');
    expect(results.get(roomId)?.availableViewModes).toEqual(['compact', 'threaded']);
    expect(storedMode(roomId)).toBe('"threaded"');
  });

  it('keeps the stored mode in a direct message with an agent until the agent leaves', () => {
    const roomId = '!agent-dm:example.org';
    addRoom(roomId, [userId, agentId]);
    storeMode(roomId, 'threaded');
    render([roomId], [roomId]);
    expect(results.get(roomId)?.viewMode).toBe('threaded');
    expect(results.get(roomId)?.availableViewModes).toEqual(['compact', 'threaded']);

    setMembership(roomId, agentId, 'leave');

    expect(results.get(roomId)?.viewMode).toBe('classic');
    expect(storedMode(roomId)).toBe('"threaded"');
  });

  it('keeps the stored mode in a room of people that is not a direct message', () => {
    const roomId = '!people-room:example.org';
    addRoom(roomId, [userId, '@bob:example.org']);
    simpleModeState.value = false;
    storeMode(roomId, 'threaded');

    render([roomId], []);

    expect(results.get(roomId)?.viewMode).toBe('threaded');
    expect(results.get(roomId)?.availableViewModes).toEqual(['compact', 'threaded', 'classic']);
    expect(mx.listenerCount(RoomMemberEvent.Membership)).toBe(0);
  });

  it('serves every direct room from one client listener', () => {
    const firstRoomId = '!people-dm-first:example.org';
    const secondRoomId = '!people-dm-second:example.org';
    addRoom(firstRoomId, [userId, '@bob:example.org']);
    addRoom(secondRoomId, [userId, '@carol:example.org']);
    render([firstRoomId, secondRoomId], [firstRoomId, secondRoomId]);
    expect(mx.listenerCount(RoomMemberEvent.Membership)).toBe(1);

    setMembership(firstRoomId, agentId, 'join');

    expect(results.get(firstRoomId)?.viewMode).toBe('compact');
    expect(results.get(secondRoomId)?.viewMode).toBe('classic');
  });
});
