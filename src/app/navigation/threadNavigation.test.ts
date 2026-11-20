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

  // A step back (the browser's Back) to the room at an event of the thread that is opened from it
  // shows the room: `RETURN_TO_ROOM_STATE`.
  const EVENT_PAGE = '/home/!room%3Aexample.org/%24reply';
  const open = (
    pathname = EVENT_PAGE,
    search = '',
    opts?: NavigateOptions,
    usr: Record<string, unknown> = { openedFromOutside: true },
    replaceHistoryState: (state: unknown) => void = () => undefined
  ) => {
    const calls: string[] = [];
    const written: unknown[] = [];
    navigateToRoomThread({
      roomId: '!room:example.org',
      threadId: '$thread',
      opts,
      navigateRoomThreadDirect: () => calls.push('navigate'),
      location: { pathname, search, hash: '' },
      getHistoryState: () => ({ key: 'left', idx: 3, usr }),
      replaceHistoryState: (state) => {
        calls.push('mark');
        written.push(state);
        replaceHistoryState(state);
      },
      schedule: () => undefined,
    });
    return { calls, written };
  };

  it('marks the room at an event as a return to the room, before the thread leaves it', () => {
    const { calls, written } = open();

    expect(calls).toEqual(['mark', 'navigate']);
    expect(written).toEqual([
      { key: 'left', idx: 3, usr: { openedFromOutside: true, returnedToRoom: true } },
    ]);
    expect(isReturnToRoom((written[0] as { usr: unknown }).usr)).toBe(true);
    // The room at an event in a space.
    const inSpace = '/!space%3Aexample.org/!room%3Aexample.org/%24reply';
    expect(open(inSpace).calls).toEqual(['mark', 'navigate']);
  });

  it('opens the thread all the same when the browser refuses the mark', () => {
    const refuse = () => {
      throw new DOMException('Too many calls to the History API', 'SecurityError');
    };

    expect(open(EVENT_PAGE, '', undefined, {}, refuse).calls).toEqual(['mark', 'navigate']);
  });

  it.each<[string, string, string, NavigateOptions?, Record<string, unknown>?]>([
    ['the room without an event', '/home/!room%3Aexample.org/', ''],
    ['an event of another room', '/home/!other%3Aexample.org/%24reply', ''],
    ['an event in an open thread', EVENT_PAGE, '?threadId=%24other'],
    ['a page that asks for its event in the room', EVENT_PAGE, '?focusEvent=1'],
    ['the page the thread takes the place of', EVENT_PAGE, '', { replace: true }],
    ['a page that has the mark', EVENT_PAGE, '', undefined, { returnedToRoom: true }],
  ])('leaves %s as it is', (_page, pathname, search, opts, usr) => {
    expect(open(pathname, search, opts, usr).calls).toEqual(['navigate']);
  });
});
