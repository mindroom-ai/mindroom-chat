// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MatrixClient } from 'matrix-js-sdk';
import { BrowserRouter, HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { getRoomThreadExitTargetFromHistoryState } from '../routes/roomNavigateState';
import { useHistoryStackRecorder } from '../routes/historyStack';
import { useRoomNavigate } from './useRoomNavigate';

const ROOM = '!lobby:example.org';
const THREAD = '$root:example.org';
// A client that knows no room by an alias, so paths name rooms by their ID.
const client = { getRoom: () => null } as unknown as MatrixClient;

afterEach(cleanup);

/**
 * Goes to a plugin's page, opens the thread from there, and leaves it for the address it recorded
 * as the page it was opened from, which a thread's Back reads after a reload.
 */
function Thread() {
  // As in the app, whose signed-in pages all sit inside the recorder.
  useHistoryStackRecorder(undefined);
  const { pathname, search } = useLocation();
  const { navigatePath, navigateRoomThread } = useRoomNavigate();
  const back = () => {
    const exitPath = getRoomThreadExitTargetFromHistoryState(window.history.state)?.exitPath;
    if (exitPath) navigatePath(exitPath, { replace: true });
  };
  return (
    <>
      <button type="button" onClick={() => navigatePath('/p/example/#notes')}>
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

/** Search results: one opens its thread once its event is fetched, when the page may be gone. */
let openFetchedResult = () => {};
function Search() {
  const { navigateRoomThread } = useRoomNavigate();
  openFetchedResult = () => navigateRoomThread(ROOM, THREAD);
  return null;
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const address = () => screen.getByRole('status').textContent;
const THREAD_ADDRESS = '/home/!lobby%3Aexample.org?threadId=%24root%3Aexample.org';

const openAndLeaveThread = () => {
  click('Plugin');
  click('Open');
  expect(address()).toBe(THREAD_ADDRESS);
  click('Back');
  return address();
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
    expect(`${window.location.pathname}${window.location.hash}`).toBe('/chat/p/example/#notes');
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
    expect(window.location.hash).toBe('#/p/example/#notes');
  });

  it('leads back to the page on screen when the page that asked for the thread is gone', () => {
    window.history.replaceState(null, '', '/home/search/');
    render(
      <MatrixClientProvider value={client}>
        <BrowserRouter>
          <Routes>
            <Route path="/home/search/" element={<Search />} />
            <Route path="*" element={null} />
          </Routes>
          <Thread />
        </BrowserRouter>
      </MatrixClientProvider>
    );
    click('Plugin');
    act(() => openFetchedResult());
    expect(address()).toBe(THREAD_ADDRESS);
    click('Back');
    expect(address()).toBe('/p/example/');
  });
});
