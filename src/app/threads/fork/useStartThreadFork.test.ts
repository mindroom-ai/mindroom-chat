// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import type { NavigateOptions } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ROOM_THREAD_EXIT_TARGET_STATE_KEY } from '../../routes/roomNavigateState';
import { useStartThreadFork } from './useStartThreadFork';

const navigation = vi.hoisted(() => ({
  navigatePath: vi.fn<(path: string, opts?: NavigateOptions) => void>(),
  roomPath: (roomId: string, eventId?: string) => `/home/${roomId}/${eventId ?? ''}`,
}));
vi.mock('../../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => navigation }));

describe('useStartThreadFork', () => {
  it('opens the draft of a fork at its point, which it loads around, with the way back to where it was asked for', () => {
    const room = { roomId: '!room:example.org' } as Room;
    const { result } = renderHook(() => useStartThreadFork(room));

    result.current({ threadId: '$parent', eventId: '$point' });

    expect(navigation.navigatePath).toHaveBeenCalledTimes(1);
    const [path, opts] = navigation.navigatePath.mock.calls[0]!;
    const url = new URL(path, 'https://chat.example.org');
    // The fork point is the address's event: the thread loads around it, however old it is.
    expect(url.pathname).toBe('/home/!room:example.org/$point');
    expect(Object.fromEntries(url.searchParams)).toEqual({ threadId: '$parent', forkAt: '$point' });
    // Like any thread it opens, the draft's back button returns to where the person was.
    expect(
      (opts?.state as Record<string, unknown>)[ROOM_THREAD_EXIT_TARGET_STATE_KEY]
    ).toMatchObject({ roomId: '!room:example.org', threadId: '$parent' });
  });

  it('opens a cross-room fork draft in the target room with forkRoom/forkThread/forkAt and no threadId', () => {
    navigation.navigatePath.mockClear();
    const room = { roomId: '!alpha:example.org' } as Room;
    const { result } = renderHook(() => useStartThreadFork(room));

    result.current({ threadId: '$parent', eventId: '$point' }, '!beta:example.org');

    expect(navigation.navigatePath).toHaveBeenCalledTimes(1);
    const [path, opts] = navigation.navigatePath.mock.calls[0]!;
    const url = new URL(path, 'https://chat.example.org');
    expect(url.pathname).toBe('/home/!beta:example.org/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      forkRoom: '!alpha:example.org',
      forkThread: '$parent',
      forkAt: '$point',
    });
    expect(url.searchParams.has('threadId')).toBe(false);
    expect(
      (opts?.state as Record<string, unknown>)[ROOM_THREAD_EXIT_TARGET_STATE_KEY]
    ).toMatchObject({ roomId: '!beta:example.org', threadId: '$parent' });
  });

  it('uses ref.roomId when forking a cross-room prefix row into the current room or back into its own room', () => {
    navigation.navigatePath.mockClear();
    const room = { roomId: '!beta:example.org' } as Room;
    const { result } = renderHook(() => useStartThreadFork(room));

    // Fork from here on a prefix message from Alpha while viewing Beta -> cross-room draft in Beta.
    result.current({ roomId: '!alpha:example.org', threadId: '$parent', eventId: '$point' });
    const [crossPath] = navigation.navigatePath.mock.calls[0]!;
    const crossUrl = new URL(crossPath, 'https://chat.example.org');
    expect(crossUrl.pathname).toBe('/home/!beta:example.org/');
    expect(Object.fromEntries(crossUrl.searchParams)).toEqual({
      forkRoom: '!alpha:example.org',
      forkThread: '$parent',
      forkAt: '$point',
    });

    // Fork to room picking Alpha itself -> same-room draft in Alpha.
    result.current(
      { roomId: '!alpha:example.org', threadId: '$parent', eventId: '$point' },
      '!alpha:example.org'
    );
    const [samePath] = navigation.navigatePath.mock.calls[1]!;
    const sameUrl = new URL(samePath, 'https://chat.example.org');
    expect(sameUrl.pathname).toBe('/home/!alpha:example.org/$point');
    expect(Object.fromEntries(sameUrl.searchParams)).toEqual({
      threadId: '$parent',
      forkAt: '$point',
    });
  });
});
