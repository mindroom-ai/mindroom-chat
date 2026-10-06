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

  type Member = { userId: string; membership: string };
  const roomMembers = new Map<string, Member[]>();
  const mx = Object.assign(new EventEmitter(), {
    getHomeserverUrl: () => 'https://example.org',
    getSafeUserId: () => userId,
    getRoom: (roomId: string) => {
      const members = roomMembers.get(roomId);
      return members ? { getMembers: () => members } : null;
    },
  });
  const joined = (memberId: string): Member => ({ userId: memberId, membership: 'join' });
  const storedMode = (roomId: string) => storage.get(getRoomViewModeStorageKey(sessionId, roomId));
  const storeMode = (roomId: string, mode: RoomViewMode) =>
    storage.set(getRoomViewModeStorageKey(sessionId, roomId), JSON.stringify(mode));

  let renderer: ReactTestRenderer | undefined;
  let result: ReturnType<typeof useRoomViewMode> | undefined;

  function Probe({ roomId }: { roomId: string }) {
    result = useRoomViewMode(roomId);
    return null;
  }

  const render = (roomId: string, directRoomIds: string[]) => {
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
            React.createElement(Probe, { roomId })
          )
        )
      );
    });
  };

  beforeEach(() => {
    simpleModeState.value = true;
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
    result = undefined;
    storage.clear();
    roomMembers.clear();
    mx.removeAllListeners();
    vi.unstubAllGlobals();
  });

  it('shows a direct message between people in Classic and offers no other mode', () => {
    const roomId = '!people-dm:example.org';
    roomMembers.set(roomId, [joined(userId), joined('@bob:example.org')]);
    storeMode(roomId, 'threaded');

    render(roomId, [roomId]);

    expect(result?.viewMode).toBe('classic');
    expect(result?.availableViewModes).toEqual([]);
    expect(result?.storedViewMode).toBe('threaded');
    expect(storedMode(roomId)).toBe('"threaded"');
  });

  it('returns to the stored mode once an agent is invited to the direct message', () => {
    const roomId = '!people-dm-invite:example.org';
    roomMembers.set(roomId, [joined(userId), joined('@bob:example.org')]);
    storeMode(roomId, 'threaded');
    render(roomId, [roomId]);
    expect(result?.viewMode).toBe('classic');

    const invite = { userId: agentId, membership: 'invite' };
    roomMembers.get(roomId)?.push(invite);
    act(() => {
      mx.emit(RoomMemberEvent.Membership, {} as MatrixEvent, invite, undefined);
    });

    expect(result?.viewMode).toBe('threaded');
    expect(result?.availableViewModes).toEqual(['compact', 'threaded']);
    expect(storedMode(roomId)).toBe('"threaded"');
  });

  it('keeps the stored mode in a direct message with an agent', () => {
    const roomId = '!agent-dm:example.org';
    roomMembers.set(roomId, [joined(userId), joined(agentId)]);

    render(roomId, [roomId]);

    expect(result?.viewMode).toBe('compact');
    expect(result?.availableViewModes).toEqual(['compact', 'threaded']);
  });

  it('keeps the stored mode in a room of people that is not a direct message', () => {
    const roomId = '!people-room:example.org';
    roomMembers.set(roomId, [joined(userId), joined('@bob:example.org')]);
    simpleModeState.value = false;
    storeMode(roomId, 'threaded');

    render(roomId, []);

    expect(result?.viewMode).toBe('threaded');
    expect(result?.availableViewModes).toEqual(['compact', 'threaded', 'classic']);
  });
});
