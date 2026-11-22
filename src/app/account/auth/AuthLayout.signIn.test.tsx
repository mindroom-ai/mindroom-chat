// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { createStore, Provider } from 'jotai';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import type { LoginResponse, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAfterLoginRedirectPath,
  getAfterLoginRedirectPath,
  setAfterLoginRedirectPath,
} from '../../routes/afterLoginRedirectPath';
import { getActiveSession, removeSession } from '../../matrix/session/sessions';
import { followRouterSignalsInNode } from '../../../test/utils/nodeSignalRequests';
import { getLoginPath } from '../../routes/pathUtils';
import { LOGIN_PATH } from '../../routes/paths';
import { AuthLayout } from './AuthLayout';
import { liveVoiceRecordingAtom } from '../../composer/voice/liveVoiceRecording';
import { startLiveVoiceRecording } from '../../composer/voice/startLiveVoiceRecording';
import {
  pendingVoiceSendDraftAtom,
  type PendingVoiceSendContext,
} from '../../composer/roomInputDrafts';
import { useLoginComplete } from './login/loginUtil';

vi.mock('../../ui/styles/Glass.css', () => ({ glassOverBackdrop: 'glass-over-backdrop' }));
vi.mock('../../config/useClientConfig', () => ({
  useClientConfig: () => ({ homeserverList: ['example.org'] }),
  useOptionalClientConfig: () => ({ homeserverList: ['example.org'] }),
}));
// The server each discovery asked, in the order asked.
const { discovered } = vi.hoisted(() => ({ discovered: [] as string[] }));
vi.mock('../../matrix/cs-api', async () => ({
  ...(await vi.importActual<typeof import('../../matrix/cs-api')>('../../matrix/cs-api')),
  autoDiscovery: (_fetch: unknown, server: string) => {
    discovered.push(server);
    return Promise.resolve([undefined, { 'm.homeserver': { base_url: 'https://example.org' } }]);
  },
}));

followRouterSignalsInNode();
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  }
);

const loginResponse = {
  access_token: 'access',
  device_id: 'DEVICE',
  user_id: '@alice:example.org',
} as LoginResponse;

/** A login page whose sign-in completes on a click, as a password form's does. */
function SignIn() {
  const [response, setResponse] = useState<LoginResponse>();
  useLoginComplete(response && { baseUrl: 'https://example.org', response });
  return (
    <button type="button" onClick={() => setResponse(loginResponse)}>
      sign in
    </button>
  );
}

/** Signs in on the login page of the app's kind of router; returns where it ends up. */
const signIn = async (): Promise<string> => {
  window.history.replaceState(null, '', '/login/example.org/');
  const router = createBrowserRouter([
    { element: <AuthLayout />, children: [{ path: '/login/:server?/', element: <SignIn /> }] },
    { path: '/home/', element: <p>home page</p> },
    { path: '/p/:plugin/:page', element: <p>plugin page</p> },
  ]);
  render(<RouterProvider router={router} />);
  await act(async () => undefined);
  fireEvent.click(screen.getByText('sign in'));
  await act(async () => undefined);
  const { pathname } = router.state.location;
  router.dispose();
  return pathname;
};

afterEach(() => {
  cleanup();
  const session = getActiveSession();
  if (session) removeSession(session.sessionId);
  deleteAfterLoginRedirectPath();
  discovered.length = 0;
  window.history.replaceState(null, '', '/');
});

// A server entered as a full URL keeps its path as written: `%41` is no `A`, a literal `%2F` no `/`.
describe('the server a sign-in page names', () => {
  it.each([
    'example.org',
    'https://example.org/team/eu',
    'https://example.org/team%2Feu',
    'https://example.org/a%41',
  ])('looks %s up as written', async (server) => {
    window.history.replaceState(null, '', getLoginPath(server));
    const router = createBrowserRouter([
      { element: <AuthLayout />, children: [{ path: LOGIN_PATH, element: <p>login page</p> }] },
    ]);
    render(<RouterProvider router={router} />);
    await act(async () => undefined);
    expect(discovered).toEqual([server]);
    expect(router.state.location.pathname).toBe(getLoginPath(server));
    router.dispose();
  });
});

describe('signing in on the sign-in pages', () => {
  it('opens the page the person asked for before signing in', async () => {
    setAfterLoginRedirectPath('/p/example/page');
    expect(await signIn()).toBe('/p/example/page');
    expect(screen.getByText('plugin page')).toBeTruthy();
    expect(getAfterLoginRedirectPath()).toBeUndefined();
  });

  it('opens Home when no page was asked for', async () => {
    expect(await signIn()).toBe('/home/');
    expect(screen.getByText('home page')).toBeTruthy();
  });
});

// Add account opens the sign-in pages from the signed-in ones, without a change of session.
// Last in the file: it puts the globals back, the file's own ResizeObserver with them.
it('parks a live voice recording, which no sign-in page shows, as a recovered one', async () => {
  // A recorder as the browser's: stopped, it hands over the audio it still holds, then says so.
  class Recorder extends EventTarget {
    state = 'inactive';

    mimeType = 'audio/webm';

    start() {
      this.state = 'recording';
    }

    stop() {
      this.state = 'inactive';
      this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob(['voice']) }));
      this.dispatchEvent(new Event('stop'));
    }
  }
  const track = { stop: vi.fn() };
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) },
  });
  const store = createStore();
  const room = { roomId: '!example:example.org', name: 'Example room' } as unknown as Room;
  const context: PendingVoiceSendContext = {
    ownerSessionId: '@alice:example.org',
    roomId: room.roomId,
    room,
    threadId: undefined,
    replyDraft: undefined,
    threadingEnabled: true,
    signalBridgedRoom: false,
  };
  expect(await startLiveVoiceRecording(store, context)).toBe(true);

  window.history.replaceState(null, '', getLoginPath('example.org'));
  const router = createBrowserRouter([
    { element: <AuthLayout />, children: [{ path: LOGIN_PATH, element: <p>login page</p> }] },
  ]);
  render(
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  );
  await act(async () => undefined);

  // The microphone is released, and the audio waits for the way back to the signed-in pages.
  expect(track.stop).toHaveBeenCalledOnce();
  expect(store.get(liveVoiceRecordingAtom)).toBeUndefined();
  const parked = store.get(pendingVoiceSendDraftAtom);
  expect(parked).toMatchObject({ recovered: true, context });
  expect(parked?.file.size).toBe('voice'.length);
  router.dispose();
  vi.unstubAllGlobals();
});
