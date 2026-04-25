import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientLayout } from './ClientLayout';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useActiveSession } from '../../hooks/useSessionStore';
import { getLastOpenThread } from '../../mindroom/threads/lastOpenThread';
import { updateSessionLastPath } from '../../state/sessions';

vi.mock('folds', async () => {
  const reactModule = await import('react');
  return {
    Box: ({ children }: { children: React.ReactNode }) => reactModule.createElement('div', null, children),
  };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useLocation: vi.fn(),
    useNavigate: vi.fn(),
  };
});

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: vi.fn(),
}));

vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: vi.fn(),
}));

vi.mock('../../hooks/useSessionStore', () => ({
  useActiveSession: vi.fn(),
}));

vi.mock('../../mindroom/threads/lastOpenThread', () => ({
  getLastOpenThread: vi.fn(),
}));

vi.mock('../../state/sessions', () => ({
  updateSessionLastPath: vi.fn(),
}));

describe('ClientLayout', () => {
  const navigate = vi.fn();
  const navigateRoomThread = vi.fn();

  beforeEach(() => {
    vi.mocked(useMatrixClient).mockReturnValue({
      getRooms: () => [],
      getSyncState: () => null,
      getRoomIdForAlias: vi.fn().mockRejectedValue(new Error('alias not found')),
    } as ReturnType<typeof useMatrixClient>);
    vi.mocked(useRoomNavigate).mockReturnValue({
      navigateRoomThread,
    } as ReturnType<typeof useRoomNavigate>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('persists the exact active-session route including search and hash', async () => {
    const { useLocation, useNavigate } = await import('react-router-dom');
    vi.mocked(useNavigate).mockReturnValue(navigate);

    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://chat.mindroom.chat',
      userId: '@alice:mindroom.chat',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });
    vi.mocked(useLocation).mockReturnValue({
      pathname: '/space/%23lobby%3Amindroom.chat',
      search: '?threadId=%24abc',
      hash: '#reply',
    } as ReturnType<typeof useLocation>);

    await act(async () => {
      create(
        React.createElement(
          ClientLayout,
          {
            nav: React.createElement('div', null, 'nav'),
          },
          React.createElement('div', null, 'content')
        )
      );
    });

    expect(vi.mocked(updateSessionLastPath)).toHaveBeenCalledWith(
      'session-a',
      '/space/%23lobby%3Amindroom.chat?threadId=%24abc#reply'
    );
  });

  it('restores the saved room thread from the exact saved route when startup lands on bare home', async () => {
    const { useLocation, useNavigate } = await import('react-router-dom');
    vi.mocked(useNavigate).mockReturnValue(navigate);

    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://chat.mindroom.chat',
      userId: '@alice:mindroom.chat',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
      lastKnownPath: '/direct/%21saved%3Amindroom.chat/?threadId=%24stale',
    });
    vi.mocked(useLocation).mockReturnValue({
      pathname: '/home/',
      search: '',
      hash: '',
    } as ReturnType<typeof useLocation>);
    vi.mocked(getLastOpenThread).mockReturnValue('$saved-thread');

    await act(async () => {
      create(
        React.createElement(
          ClientLayout,
          {
            nav: React.createElement('div', null, 'nav'),
          },
          React.createElement('div', null, 'content')
        )
      );
    });

    expect(vi.mocked(getLastOpenThread)).toHaveBeenCalledWith('!saved:mindroom.chat');
    expect(navigate).toHaveBeenCalledWith(
      '/direct/%21saved%3Amindroom.chat/?threadId=%24saved-thread',
      { replace: true }
    );
    expect(navigateRoomThread).not.toHaveBeenCalled();
  });

  it('preserves the saved space route when restoring a thread from bare home', async () => {
    const { useLocation, useNavigate } = await import('react-router-dom');
    vi.mocked(useNavigate).mockReturnValue(navigate);

    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://chat.mindroom.chat',
      userId: '@alice:mindroom.chat',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
      lastKnownPath: '/%21space%3Amindroom.chat/%21saved%3Amindroom.chat/?threadId=%24stale-thread',
    });
    vi.mocked(useLocation).mockReturnValue({
      pathname: '/home/',
      search: '',
      hash: '',
    } as ReturnType<typeof useLocation>);
    vi.mocked(getLastOpenThread).mockReturnValue('$saved-thread');

    await act(async () => {
      create(
        React.createElement(
          ClientLayout,
          {
            nav: React.createElement('div', null, 'nav'),
          },
          React.createElement('div', null, 'content')
        )
      );
    });

    expect(vi.mocked(getLastOpenThread)).toHaveBeenCalledWith('!saved:mindroom.chat');
    expect(navigate).toHaveBeenCalledWith(
      '/%21space%3Amindroom.chat/%21saved%3Amindroom.chat/?threadId=%24saved-thread',
      { replace: true }
    );
    expect(navigateRoomThread).not.toHaveBeenCalled();
  });

  it('stores room-id restore paths even when the visible route uses canonical aliases', async () => {
    const { useLocation, useNavigate } = await import('react-router-dom');
    vi.mocked(useNavigate).mockReturnValue(navigate);

    vi.mocked(useMatrixClient).mockReturnValue({
      getRooms: () => [
        {
          roomId: '!space:mindroom.chat',
          getCanonicalAlias: () => '#space:mindroom.chat',
          getLiveTimeline: () => ({
            getState: () => ({
              getStateEvents: () => undefined,
            }),
          }),
        },
        {
          roomId: '!room:mindroom.chat',
          getCanonicalAlias: () => '#room:mindroom.chat',
          getLiveTimeline: () => ({
            getState: () => ({
              getStateEvents: () => undefined,
            }),
          }),
        },
      ],
    } as ReturnType<typeof useMatrixClient>);
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://chat.mindroom.chat',
      userId: '@alice:mindroom.chat',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });
    vi.mocked(useLocation).mockReturnValue({
      pathname: '/%23space%3Amindroom.chat/%23room%3Amindroom.chat/',
      search: '?threadId=%24abc',
      hash: '#reply',
    } as ReturnType<typeof useLocation>);

    await act(async () => {
      create(
        React.createElement(
          ClientLayout,
          {
            nav: React.createElement('div', null, 'nav'),
          },
          React.createElement('div', null, 'content')
        )
      );
    });

    expect(vi.mocked(updateSessionLastPath)).toHaveBeenCalledWith(
      'session-a',
      '/!space%3Amindroom.chat/!room%3Amindroom.chat?threadId=%24abc#reply'
    );
  });

  it('replaces alias startup routes with room-id routes before rendering nested pages', async () => {
    const { useLocation, useNavigate } = await import('react-router-dom');
    vi.mocked(useNavigate).mockReturnValue(navigate);

    const getRoomIdForAlias = vi.fn(async (alias: string) => ({
      room_id: alias === '#space:mindroom.chat' ? '!space:mindroom.chat' : '!room:mindroom.chat',
    }));

    vi.mocked(useMatrixClient).mockReturnValue({
      getRooms: () => [],
      getSyncState: () => null,
      getRoomIdForAlias,
    } as ReturnType<typeof useMatrixClient>);
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://chat.mindroom.chat',
      userId: '@alice:mindroom.chat',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });
    vi.mocked(useLocation).mockReturnValue({
      pathname: '/%23space%3Amindroom.chat/%23room%3Amindroom.chat/',
      search: '?threadId=%24abc',
      hash: '',
    } as ReturnType<typeof useLocation>);

    await act(async () => {
      create(
        React.createElement(
          ClientLayout,
          {
            nav: React.createElement('div', null, 'nav'),
          },
          React.createElement('div', null, 'content')
        )
      );
      await Promise.resolve();
    });

    expect(getRoomIdForAlias).toHaveBeenCalledWith('#space:mindroom.chat');
    expect(getRoomIdForAlias).toHaveBeenCalledWith('#room:mindroom.chat');
    expect(navigate).toHaveBeenCalledWith('/!space%3Amindroom.chat/!room%3Amindroom.chat?threadId=%24abc', {
      replace: true,
    });
  });

  it('does not override explicit room navigation on startup', async () => {
    const { useLocation, useNavigate } = await import('react-router-dom');
    vi.mocked(useNavigate).mockReturnValue(navigate);

    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://chat.mindroom.chat',
      userId: '@alice:mindroom.chat',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
      lastKnownPath: '/home/%21saved%3Amindroom.chat/',
    });
    vi.mocked(useLocation).mockReturnValue({
      pathname: '/home/%21live%3Amindroom.chat/',
      search: '',
      hash: '',
    } as ReturnType<typeof useLocation>);

    await act(async () => {
      create(
        React.createElement(
          ClientLayout,
          {
            nav: React.createElement('div', null, 'nav'),
          },
          React.createElement('div', null, 'content')
        )
      );
    });

    expect(vi.mocked(getLastOpenThread)).not.toHaveBeenCalled();
    expect(navigateRoomThread).not.toHaveBeenCalled();
  });

  it('attempts the startup restore only once per mount', async () => {
    const { useLocation, useNavigate } = await import('react-router-dom');
    vi.mocked(useNavigate).mockReturnValue(navigate);

    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://chat.mindroom.chat',
      userId: '@alice:mindroom.chat',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
      lastKnownPath: '/home/%21saved%3Amindroom.chat/',
    });
    vi.mocked(useLocation).mockReturnValue({
      pathname: '/home/',
      search: '',
      hash: '',
    } as ReturnType<typeof useLocation>);
    vi.mocked(getLastOpenThread).mockReturnValue('$saved-thread');

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientLayout,
          {
            nav: React.createElement('div', null, 'nav'),
          },
          React.createElement('div', null, 'content')
        )
      );
    });

    await act(async () => {
      renderer!.update(
        React.createElement(
          ClientLayout,
          {
            nav: React.createElement('div', null, 'nav'),
          },
          React.createElement('div', null, 'content')
        )
      );
    });

    expect(navigateRoomThread).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no active session', async () => {
    const { useLocation, useNavigate } = await import('react-router-dom');
    vi.mocked(useNavigate).mockReturnValue(navigate);

    vi.mocked(useActiveSession).mockReturnValue(undefined);
    vi.mocked(useLocation).mockReturnValue({
      pathname: '/home/',
      search: '',
      hash: '',
    } as ReturnType<typeof useLocation>);

    await act(async () => {
      create(
        React.createElement(
          ClientLayout,
          {
            nav: React.createElement('div', null, 'nav'),
          },
          React.createElement('div', null, 'content')
        )
      );
    });

    expect(vi.mocked(updateSessionLastPath)).not.toHaveBeenCalled();
    expect(navigateRoomThread).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
