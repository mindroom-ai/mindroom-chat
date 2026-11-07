// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  RouterProvider,
  createBrowserRouter,
  createHashRouter,
  createMemoryRouter,
} from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MatrixClientProvider } from '../app/matrix/hooks/useMatrixClient';
import { useRoomHref, useRoomNavigate } from './room';

const ROOM = '!lobby:example.org';
const THREAD = '$root:example.org';
// A client that knows no room by an alias, so paths name rooms by their ID.
const client = { getRoom: () => null } as unknown as MatrixClient;

afterEach(cleanup);

/** Renders `element` in a router `createRouter` makes, signed in to `client`. */
const renderIn = (
  createRouter: typeof createBrowserRouter,
  element: JSX.Element,
  options: Parameters<typeof createBrowserRouter>[1] = {}
) => {
  const router = createRouter([{ path: '*', element }], options);
  render(
    <MatrixClientProvider value={client}>
      <RouterProvider router={router} />
    </MatrixClientProvider>
  );
  return router;
};

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
    const router = renderIn(createRouter, <Links />, { basename });
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

  it('opens a room, and a thread in it', () => {
    const router = renderIn(createMemoryRouter, <Buttons />, { initialEntries: ['/p/example/'] });
    const at = () => `${router.state.location.pathname}${router.state.location.search}`;
    act(() => screen.getByRole('button', { name: 'Room' }).click());
    expect(at()).toBe('/home/!lobby%3Aexample.org');
    act(() => screen.getByRole('button', { name: 'Thread' }).click());
    expect(at()).toBe('/home/!lobby%3Aexample.org?threadId=%24root%3Aexample.org');
    router.dispose();
  });
});
