// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MatrixClient } from 'matrix-js-sdk';
import type { ReactNode } from 'react';
import {
  MemoryRouter,
  RouterProvider,
  createBrowserRouter,
  createHashRouter,
  useLocation,
} from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MatrixClientProvider } from '../app/matrix/hooks/useMatrixClient';
import { useRoomHref, useRoomNavigate } from './room';

const ROOM = '!lobby:example.org';
const THREAD = '$root:example.org';
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
  function Buttons() {
    const { navigateRoom, navigateRoomThread } = useRoomNavigate();
    return (
      <>
        <button type="button" onClick={() => navigateRoom(ROOM)}>
          Room
        </button>
        <button type="button" onClick={() => navigateRoomThread(ROOM, THREAD)}>
          Thread
        </button>
      </>
    );
  }
  function Address() {
    const { pathname, search } = useLocation();
    return <output>{`${pathname}${search}`}</output>;
  }

  it('opens a room, and a thread in it', () => {
    renderSignedIn(
      <MemoryRouter initialEntries={['/p/example/']}>
        <Buttons />
        <Address />
      </MemoryRouter>
    );
    const address = () => screen.getByRole('status').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Room' }));
    expect(address()).toBe('/home/!lobby%3Aexample.org');
    fireEvent.click(screen.getByRole('button', { name: 'Thread' }));
    expect(address()).toBe('/home/!lobby%3Aexample.org?threadId=%24root%3Aexample.org');
  });
});
