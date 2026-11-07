// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientLayout } from './ClientLayout';
import { resolveRootRouteRedirect } from '../navigation/routeSessionGuards';
import { getActiveSession, putSession, updateSessionLastPath } from '../matrix/session/sessions';

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
// The notice places are tested in ui/noticeSlots.test.tsx.
vi.mock('../ui/noticeSlots', () => ({ NoticeSlot: () => null }));
vi.mock('../matrix/session/useSessionStore', async () => {
  const sessions = await import('../matrix/session/sessions');
  return { useActiveSession: () => sessions.getActiveSession() };
});

const ROOM_PATH = '/home/!room%3Aexample.org';

const visit = async (path: string) => {
  await act(async () => {
    create(
      <MemoryRouter initialEntries={[path]}>
        <ClientLayout nav={null}>{null}</ClientLayout>
      </MemoryRouter>
    );
  });
};

afterEach(() => localStorage.clear());

describe('ClientLayout', () => {
  it('remembers the route a session last showed', async () => {
    putSession({
      baseUrl: 'https://matrix.example.org',
      userId: '@alice:example.org',
      deviceId: 'DEVICE',
      accessToken: 'fake',
    });
    await visit(ROOM_PATH);
    expect(getActiveSession()?.lastKnownPath).toBe(ROOM_PATH);
  });

  it('keeps the route of a session that became active without a navigation', async () => {
    putSession({
      baseUrl: 'https://matrix.example.org',
      userId: '@alice:example.org',
      deviceId: 'DEVICE',
      accessToken: 'fake',
    });
    // A new element each time, so the layout renders again; the router keeps its location.
    const page = () => (
      <MemoryRouter initialEntries={[ROOM_PATH]}>
        <ClientLayout nav={null}>{null}</ClientLayout>
      </MemoryRouter>
    );
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(page());
    });
    // Alice logs out elsewhere in the page and Bob, already signed in, becomes active on her route.
    const bob = putSession({
      baseUrl: 'https://matrix.example.org',
      userId: '@bob:example.org',
      deviceId: 'DEVICE',
      accessToken: 'fake',
      lastKnownPath: '/home/!bobs-room%3Aexample.org',
    });
    await act(async () => {
      renderer?.update(page());
    });
    expect(getActiveSession()?.sessionId).toBe(bob.sessionId);
    expect(getActiveSession()?.lastKnownPath).toBe('/home/!bobs-room%3Aexample.org');
  });

  it('opens the last route of a session that became active without a navigation', async () => {
    putSession({
      baseUrl: 'https://matrix.example.org',
      userId: '@alice:example.org',
      deviceId: 'DEVICE',
      accessToken: 'fake',
    });
    let shown: string | undefined;
    function Shown() {
      shown = useLocation().pathname;
      return null;
    }
    const page = () => (
      <MemoryRouter initialEntries={[ROOM_PATH]}>
        <ClientLayout nav={null}>
          <Shown />
        </ClientLayout>
      </MemoryRouter>
    );
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(page());
    });
    expect(shown).toBe(ROOM_PATH);
    // Another tab switches to Bob: this tab leaves Alice's room for Bob's last route.
    putSession({
      baseUrl: 'https://matrix.example.org',
      userId: '@bob:example.org',
      deviceId: 'DEVICE',
      accessToken: 'fake',
      lastKnownPath: '/home/!bobs-room%3Aexample.org',
    });
    await act(async () => {
      renderer?.update(page());
    });
    expect(shown).toBe('/home/!bobs-room%3Aexample.org');
  });

  it.each(['/connections', '/connections/'])(
    'keeps the earlier route through %s, which hands the tab to the portal',
    async (path) => {
      putSession({
        baseUrl: 'https://matrix.example.org',
        userId: '@alice:example.org',
        deviceId: 'DEVICE',
        accessToken: 'fake',
      });
      updateSessionLastPath(getActiveSession()!.sessionId, ROOM_PATH);
      await visit(path);
      expect(getActiveSession()?.lastKnownPath).toBe(ROOM_PATH);
      // Opening Chat's root, as Back from the portal does, returns to the room instead of the hand-off.
      expect(resolveRootRouteRedirect('https://chat.example.org/').redirectTo).toBe(ROOM_PATH);
    }
  );
});
