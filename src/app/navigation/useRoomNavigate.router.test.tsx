// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MatrixClient } from 'matrix-js-sdk';
import { BrowserRouter, HashRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { getRoomThreadExitTargetFromHistoryState } from '../routes/roomNavigateState';
import { useRoomNavigate } from './useRoomNavigate';

const ROOM = '!lobby:example.org';
const THREAD = '$root:example.org';
// A client that knows no room by an alias, so paths name rooms by their ID.
const client = { getRoom: () => null } as unknown as MatrixClient;

afterEach(cleanup);

/**
 * Goes to a plugin's page, opens the thread from there, and leaves it for the address it recorded,
 * as a thread's Back does when it neither steps back in history nor knows the page before: in the
 * iOS app or an iOS home-screen web app, after a reload.
 */
function Thread() {
  const { pathname, search } = useLocation();
  const { navigatePath, navigateRoomThread } = useRoomNavigate();
  const back = () => {
    const exitPath = getRoomThreadExitTargetFromHistoryState(window.history.state)?.exitPath;
    if (exitPath) navigatePath(exitPath, { replace: true });
  };
  return (
    <>
      <button type="button" onClick={() => navigatePath('/p/example/')}>
        Plugin
      </button>
      <button type="button" onClick={() => navigateRoomThread(ROOM, THREAD)}>
        Open
      </button>
      <button type="button" onClick={back}>
        Back
      </button>
      <output>{`${pathname}${search}`}</output>
    </>
  );
}

const openAndLeaveThread = () => {
  const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
  click('Plugin');
  click('Open');
  expect(screen.getByRole('status').textContent).toBe(
    '/home/!lobby%3Aexample.org?threadId=%24root%3Aexample.org'
  );
  click('Back');
  return screen.getByRole('status').textContent;
};

describe("a thread's recorded return address", () => {
  it("leads back to the page the thread was opened from under the browser router's base path", () => {
    window.history.replaceState(null, '', '/chat/home/');
    render(
      <MatrixClientProvider value={client}>
        <BrowserRouter basename="/chat">
          <Thread />
        </BrowserRouter>
      </MatrixClientProvider>
    );
    expect(openAndLeaveThread()).toBe('/p/example/');
    expect(window.location.pathname).toBe('/chat/p/example/');
  });

  it('leads back to the page the thread was opened from with the hash router', () => {
    window.history.replaceState(null, '', '/#/home/');
    render(
      <MatrixClientProvider value={client}>
        <HashRouter>
          <Thread />
        </HashRouter>
      </MatrixClientProvider>
    );
    expect(openAndLeaveThread()).toBe('/p/example/');
    expect(window.location.hash).toBe('#/p/example/');
  });
});
