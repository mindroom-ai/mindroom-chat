// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter, useLocation, useNavigate, type Location } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientLayout } from './ClientLayout';
import { putSession } from '../matrix/session/sessions';

// The notice places are tested in ui/noticeSlots.test.tsx.
vi.mock('../ui/noticeSlots', () => ({ NoticeSlot: () => null }));
vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
const getRoomIdForAlias = vi.fn();
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getRooms: () => [
      {
        roomId: '!room:example.org',
        getCanonicalAlias: () => '#room:example.org',
        getAltAliases: () => [],
      },
    ],
    getRoomIdForAlias,
  }),
}));
vi.mock('../matrix/session/useSessionStore', async () => {
  const sessions = await import('../matrix/session/sessions');
  return { useActiveSession: () => sessions.getActiveSession() };
});

afterEach(() => localStorage.clear());

describe('ClientLayout with an alias the client knows', () => {
  it('keeps the page mounted while the room ID route replaces the address', async () => {
    putSession({
      baseUrl: 'https://matrix.example.org',
      userId: '@alice:example.org',
      deviceId: 'DEVICE',
      accessToken: 'fake',
    });
    const mounted = { count: 0, unmounted: 0 };
    let navigate: ReturnType<typeof useNavigate> | undefined;
    let location: Location | undefined;
    const Page = () => {
      useEffect(() => {
        mounted.count += 1;
        return () => {
          mounted.unmounted += 1;
        };
      }, []);
      return null;
    };
    const Probe = () => {
      navigate = useNavigate();
      location = useLocation();
      return null;
    };
    await act(async () => {
      create(
        <MemoryRouter initialEntries={['/home/!room%3Aexample.org']}>
          <Probe />
          <ClientLayout nav={null}>
            <Page />
          </ClientLayout>
        </MemoryRouter>
      );
    });
    expect(mounted.count).toBe(1);

    // A thread link the app built names the room by its alias.
    await act(async () => {
      navigate?.('/home/%23room%3Aexample.org?threadId=%24root');
      await Promise.resolve();
    });

    expect(location?.pathname).toBe('/home/!room%3Aexample.org');
    expect(location?.search).toBe('?threadId=%24root');
    expect(mounted).toEqual({ count: 1, unmounted: 0 });
    expect(getRoomIdForAlias).not.toHaveBeenCalled();
  });
});
