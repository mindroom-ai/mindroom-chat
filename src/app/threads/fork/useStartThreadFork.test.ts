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
  it('opens the draft of a fork at its point, with the way back to where it was asked for', () => {
    const room = { roomId: '!room:example.org' } as Room;
    const { result } = renderHook(() => useStartThreadFork(room));

    result.current({ threadId: '$parent', eventId: '$point' });

    expect(navigation.navigatePath).toHaveBeenCalledTimes(1);
    const [path, opts] = navigation.navigatePath.mock.calls[0]!;
    const url = new URL(path, 'https://chat.example.org');
    expect(url.pathname).toBe('/home/!room:example.org/');
    expect(Object.fromEntries(url.searchParams)).toEqual({ threadId: '$parent', forkAt: '$point' });
    // Like any thread it opens, the draft's back button returns to where the person was.
    expect(
      (opts?.state as Record<string, unknown>)[ROOM_THREAD_EXIT_TARGET_STATE_KEY]
    ).toMatchObject({ roomId: '!room:example.org', threadId: '$parent' });
  });
});
