import { describe, expect, it, vi } from 'vitest';
import type { NavigateOptions } from 'react-router-dom';
import {
  getRoomThreadExitTargetFromHistoryState,
  ROOM_THREAD_EXIT_TARGET_STATE_KEY,
} from '../routes/roomNavigateState';
import { isReturnToRoom } from '../routes/historyStack';
import { navigateToRoomThread } from './threadNavigation';

describe('navigateToRoomThread', () => {
  it('seeds pushed thread opens with an exit target and persists it after navigation', () => {
    const navigateRoomThreadDirect = vi.fn();
    const scheduled: (() => void)[] = [];
    const historyState = { key: 'thread-navigation-test-pushed' };

    navigateToRoomThread({
      roomId: '!room:example.org',
      threadId: '$thread',
      eventId: '$reply',
      navigateRoomThreadDirect,
      location: { pathname: '/home/!room:example.org', search: '?filter=open', hash: '#reply' },
      getHistoryState: () => historyState,
      schedule: (callback) => {
        scheduled.push(callback);
      },
      isNativeIOSDevice: () => false,
      replaceHistoryState: () => undefined,
    });

    expect(navigateRoomThreadDirect).toHaveBeenCalledWith(
      '!room:example.org',
      '$thread',
      '$reply',
      {
        state: {
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room:example.org?filter=open#reply',
            roomId: '!room:example.org',
            threadId: '$thread',
            useHistoryBack: true,
          },
        },
      }
    );
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toBeTypeOf('function');

    scheduled[0]!();
    expect(getRoomThreadExitTargetFromHistoryState(historyState)).toEqual({
      exitPath: '/home/!room:example.org?filter=open#reply',
      roomId: '!room:example.org',
      threadId: '$thread',
      useHistoryBack: true,
    });
  });

  it('records the account that opened the thread in its exit target', () => {
    const navigateRoomThreadDirect = vi.fn();
    navigateToRoomThread({
      roomId: '!room:example.org',
      threadId: '$thread',
      navigateRoomThreadDirect,
      location: { pathname: '/home/!room:example.org', search: '', hash: '' },
      getHistoryState: () => ({ key: 'thread-navigation-test-account' }),
      schedule: () => undefined,
      isNativeIOSDevice: () => true,
      replaceHistoryState: () => undefined,
      getSessionId: () => 'session-a',
    });
    expect(navigateRoomThreadDirect.mock.calls[0]?.[3]).toMatchObject({
      state: { [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: { sessionId: 'session-a' } },
    });
  });

  it('preserves existing navigate state when adding the exit target', () => {
    const navigateRoomThreadDirect = vi.fn();
    const opts: NavigateOptions = { state: { source: 'test-suite' } };

    navigateToRoomThread({
      roomId: '!room:example.org',
      threadId: '$thread',
      opts,
      navigateRoomThreadDirect,
      location: { pathname: '/home/!room:example.org', search: '', hash: '' },
      schedule: () => undefined,
      isNativeIOSDevice: () => false,
      getHistoryState: () => null,
      replaceHistoryState: () => undefined,
    });

    expect(navigateRoomThreadDirect).toHaveBeenCalledWith(
      '!room:example.org',
      '$thread',
      undefined,
      {
        state: {
          source: 'test-suite',
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room:example.org',
            roomId: '!room:example.org',
            threadId: '$thread',
            useHistoryBack: true,
          },
        },
      }
    );
  });

  it('marks native iOS thread opens to use the exact exit path instead of history back', () => {
    const navigateRoomThreadDirect = vi.fn();

    navigateToRoomThread({
      roomId: '!room:example.org',
      threadId: '$thread',
      navigateRoomThreadDirect,
      location: { pathname: '/home/!room:example.org', search: '', hash: '' },
      schedule: () => undefined,
      isNativeIOSDevice: () => true,
      getHistoryState: () => null,
      replaceHistoryState: () => undefined,
    });

    expect(navigateRoomThreadDirect).toHaveBeenCalledWith(
      '!room:example.org',
      '$thread',
      undefined,
      {
        state: {
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room:example.org',
            roomId: '!room:example.org',
            threadId: '$thread',
            useHistoryBack: false,
          },
        },
      }
    );
  });

  it('does not seed replace navigations', () => {
    const navigateRoomThreadDirect = vi.fn();
    const schedule = vi.fn();
    const opts: NavigateOptions = { replace: true };

    navigateToRoomThread({
      roomId: '!room:example.org',
      threadId: '$thread',
      opts,
      navigateRoomThreadDirect,
      schedule,
    });

    expect(navigateRoomThreadDirect).toHaveBeenCalledWith(
      '!room:example.org',
      '$thread',
      undefined,
      opts
    );
    expect(schedule).not.toHaveBeenCalled();
  });

  // A step back to the page a thread was opened from (the browser's Back) shows the room, also
  // when its address names an event of that thread: `RETURN_TO_ROOM_STATE`.
  const open = (search: string, opts?: NavigateOptions) => {
    const calls: string[] = [];
    const written: unknown[] = [];
    navigateToRoomThread({
      roomId: '!room:example.org',
      threadId: '$thread',
      opts,
      navigateRoomThreadDirect: () => calls.push('navigate'),
      location: { pathname: '/home/!room:example.org/$reply', search, hash: '' },
      getHistoryState: () => ({ key: 'left', idx: 3, usr: { openedFromOutside: true } }),
      replaceHistoryState: (state) => {
        calls.push('mark');
        written.push(state);
      },
      schedule: () => undefined,
    });
    return { calls, written };
  };

  it('marks the page a thread is opened from as a return to the room, before it leaves it', () => {
    const { calls, written } = open('');

    expect(calls).toEqual(['mark', 'navigate']);
    expect(written).toEqual([
      { key: 'left', idx: 3, usr: { openedFromOutside: true, returnedToRoom: true } },
    ]);
    expect(isReturnToRoom((written[0] as { usr: unknown }).usr)).toBe(true);
  });

  it.each([
    ['a page that asks for its event in the room', '?focusEvent=1', undefined],
    ['the page a thread takes the place of', '', { replace: true }],
  ])('leaves %s as it is', (_page, search, opts) => {
    expect(open(search, opts).calls).toEqual(['navigate']);
  });
});
