// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MatrixClient } from 'matrix-js-sdk';
import type { MouseEvent, ReactNode } from 'react';
import {
  BrowserRouter,
  HashRouter,
  MemoryRouter,
  RouterProvider,
  createBrowserRouter,
  createHashRouter,
  useLocation,
} from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MatrixClientProvider } from '../app/matrix/hooks/useMatrixClient';
import { useRoomHref, useRoomNavigate, type RoomNavigate } from './room';

const ROOM = '!lobby:example.org';
const THREAD = '$root:example.org';
const REPLY = '$reply:example.org';
// A client that knows no room by an alias, so paths name rooms by their ID.
const client = { getRoom: () => null } as unknown as MatrixClient;

afterEach(cleanup);

/** Renders `ui` signed in to `client`. */
const renderSignedIn = (ui: ReactNode) =>
  render(<MatrixClientProvider value={client}>{ui}</MatrixClientProvider>);

describe('useRoomHref', () => {
  function Links() {
    return (
      <>
        <a href={useRoomHref(ROOM)}>Room</a>
        <a href={useRoomHref(ROOM, THREAD)}>Thread</a>
      </>
    );
  }
  const hrefs = (createRouter: typeof createBrowserRouter, basename: string) => {
    const router = createRouter([{ path: '*', element: <Links /> }], { basename });
    renderSignedIn(<RouterProvider router={router} />);
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    const found = [href('Room'), href('Thread')];
    cleanup();
    router.dispose();
    return found;
  };

  it("links to a room and to its thread under the browser router's base path", () => {
    window.history.replaceState(null, '', '/chat/p/example/');
    expect(hrefs(createBrowserRouter, '/chat')).toEqual([
      '/chat/home/!lobby%3Aexample.org',
      '/chat/home/!lobby%3Aexample.org?threadId=%24root%3Aexample.org',
    ]);
  });

  it('puts the paths after the hash with the hash router', () => {
    window.history.replaceState(null, '', '/#/p/example/');
    expect(hrefs(createHashRouter, '/')).toEqual([
      '#/home/!lobby%3Aexample.org',
      '#/home/!lobby%3Aexample.org?threadId=%24root%3Aexample.org',
    ]);
  });
});

describe('useRoomNavigate', () => {
  /** A room picker that tells its callbacks more than the room: an index, a name, or the click. */
  function Picker({
    onPick,
    onPickThread,
  }: {
    onPick: (roomId: string, how: number | string | MouseEvent) => void;
    onPickThread: (roomId: string, threadId: string, index: number) => void;
  }) {
    return (
      <>
        <button type="button" onClick={() => onPick(ROOM, 1)}>
          Pick the second
        </button>
        <button type="button" onClick={() => onPick(ROOM, 'clicked')}>
          Pick by name
        </button>
        <button type="button" onClick={(event) => onPick(ROOM, event)}>
          Pick by click
        </button>
        <button type="button" onClick={() => onPickThread(ROOM, THREAD, 2)}>
          Pick the thread
        </button>
      </>
    );
  }
  function Buttons() {
    const { navigateRoom, navigateRoomThread } = useRoomNavigate();
    /** A plugin's own wrapper, typed by the SDK's parameters, so the options may be left out. */
    const openRoom = (...args: Parameters<RoomNavigate['navigateRoom']>) => navigateRoom(...args);
    return (
      <>
        <button type="button" onClick={() => openRoom(ROOM)}>
          Room
        </button>
        <button type="button" onClick={() => navigateRoomThread(ROOM, THREAD)}>
          Thread
        </button>
        <button type="button" onClick={() => navigateRoom(ROOM, { eventId: THREAD })}>
          Room at the root
        </button>
        <button type="button" onClick={() => navigateRoomThread(ROOM, THREAD, { eventId: REPLY })}>
          Thread at the reply
        </button>
        <button type="button" onClick={() => navigateRoom(ROOM, { replace: true })}>
          Room in place
        </button>
        <button type="button" onClick={() => navigateRoomThread(ROOM, THREAD, { replace: true })}>
          Thread in place
        </button>
        <Picker onPick={navigateRoom} onPickThread={navigateRoomThread} />
      </>
    );
  }
  function Address() {
    const { pathname, search } = useLocation();
    return <output>{`${pathname}${search}`}</output>;
  }
  const renderButtons = () =>
    renderSignedIn(
      <MemoryRouter initialEntries={['/p/example/']}>
        <Buttons />
        <Address />
      </MemoryRouter>
    );
  const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
  const address = () => screen.getByRole('status').textContent;

  it('opens a room, and a thread in it', () => {
    renderButtons();
    click('Room');
    expect(address()).toBe('/home/!lobby%3Aexample.org');
    click('Thread');
    expect(address()).toBe('/home/!lobby%3Aexample.org?threadId=%24root%3Aexample.org');
  });

  it("opens the room at an event and the thread at a reply, at the app's own addresses", () => {
    renderButtons();
    click('Room at the root');
    expect(address()).toBe('/home/!lobby%3Aexample.org/%24root%3Aexample.org');
    click('Thread at the reply');
    expect(address()).toBe(
      '/home/!lobby%3Aexample.org/%24reply%3Aexample.org?threadId=%24root%3Aexample.org'
    );
  });

  it('opens the room or the thread itself, as a new page, as a callback that gets more arguments', () => {
    window.history.replaceState(null, '', '/p/example/');
    renderSignedIn(
      <BrowserRouter>
        <Buttons />
      </BrowserRouter>
    );
    for (const pick of ['Pick the second', 'Pick by name', 'Pick by click']) {
      click('Thread');
      const entries = window.history.length;
      click(pick);
      expect(`${window.location.pathname}${window.location.search}`).toBe(
        '/home/!lobby%3Aexample.org'
      );
      expect(window.history.length).toBe(entries + 1);
    }
    click('Room');
    const entries = window.history.length;
    click('Pick the thread');
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      '/home/!lobby%3Aexample.org?threadId=%24root%3Aexample.org'
    );
    expect(window.history.length).toBe(entries + 1);
  });

  for (const [name, Router, start, shown] of [
    ['browser', BrowserRouter, '/p/example/', () => window.location.pathname],
    ['hash', HashRouter, '/#/p/example/', () => window.location.hash],
  ] as const) {
    it(`replaces the page it leaves with the ${name} router, and adds one without replace`, () => {
      window.history.replaceState(null, '', start);
      renderSignedIn(
        <Router>
          <Buttons />
        </Router>
      );
      const entries = window.history.length;
      click('Room in place');
      expect(shown()).toContain('/home/!lobby%3Aexample.org');
      click('Thread in place');
      expect(window.location.search || window.location.hash).toContain('threadId=');
      expect(window.history.length).toBe(entries);
      click('Room');
      expect(window.history.length).toBe(entries + 1);
    });
  }
});
