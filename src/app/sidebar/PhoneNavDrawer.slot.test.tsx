// @vitest-environment jsdom
import { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { Provider, createStore } from 'jotai';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHONE_SLIDE_OUT_MS, phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { MobileFriendlyPageNav } from './MobileFriendly';
import { PhoneNavDrawer } from './PhoneNavDrawer';
import { PHONE_NAV_DRAWER_ID } from './PhoneTopBar';
import { followRouterSignalsInNode } from '../../test/utils/nodeSignalRequests';

// Partly: the app's i18n setup, which the plugin registry loads, takes the rest of the module.
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./PhoneNavDrawer.css', () => ({
  SheetSlot: 'sheet-slot',
  Scrim: 'scrim',
  Panel: 'panel',
  Slot: 'slot',
}));

// The data router builds a Request per navigation; under jsdom its signal needs this.
followRouterSignalsInNode();

afterEach(() => {
  vi.useRealTimers();
});

/** The drawer over a room, with a list in its slot; `leftOnPage` tells where the list was as it left. */
const renderDrawer = () => {
  // A list that remembers where the reader left it reads its rows as it leaves.
  const leftOnPage: boolean[] = [];
  function List() {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      const list = ref.current;
      return () => {
        leftOnPage.push(list?.isConnected ?? false);
      };
    }, []);
    return <div ref={ref} />;
  }
  const store = createStore();
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <ScreenSizeProvider value={ScreenSize.Mobile}>
            <PhoneNavDrawer nav={null} />
            <MobileFriendlyPageNav>
              <List />
            </MobileFriendlyPageNav>
          </ScreenSizeProvider>
        ),
      },
    ],
    { initialEntries: ['/home/!room:example.org/'] }
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <Provider store={store}>
        <RouterProvider router={router} />
      </Provider>
    );
  });
  return {
    store,
    leftOnPage,
    panel: () => container.querySelector<HTMLElement>(`#${PHONE_NAV_DRAWER_ID}`)!,
    list: () => container.querySelector('[data-nav-slot] > div'),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

describe('PhoneNavDrawer slot', () => {
  it('lets the list in it leave while it is still on the page', () => {
    vi.useFakeTimers();
    const drawer = renderDrawer();

    act(() => drawer.store.set(phoneNavDrawerOpenAtom, true));
    expect(drawer.list()).not.toBeNull();
    act(() => drawer.store.set(phoneNavDrawerOpenAtom, false));
    act(() => {
      vi.advanceTimersByTime(PHONE_SLIDE_OUT_MS);
    });

    expect(drawer.list()).toBeNull();
    expect(drawer.leftOnPage).toEqual([true]);
    drawer.unmount();
  });

  it('holds the list until the slide out the browser plays has ended, however late it starts', async () => {
    vi.useFakeTimers();
    const drawer = renderDrawer();
    act(() => drawer.store.set(phoneNavDrawerOpenAtom, true));
    // jsdom plays no transitions: the browser's slide out, as a room that opens behind the drawer
    // holds the main thread before it starts.
    let end = () => {};
    const finished = new Promise<void>((resolve) => {
      end = resolve;
    });
    const fade = { transitionProperty: 'visibility', finished: Promise.resolve() };
    const slide = { transitionProperty: 'transform', finished };
    Object.defineProperty(drawer.panel(), 'getAnimations', { value: () => [fade, slide] });

    act(() => drawer.store.set(phoneNavDrawerOpenAtom, false));
    await act(async () => {
      vi.advanceTimersByTime(PHONE_SLIDE_OUT_MS * 10);
    });
    expect(drawer.list()).not.toBeNull();

    await act(async () => end());
    expect(drawer.list()).toBeNull();
    expect(drawer.leftOnPage).toEqual([true]);
    drawer.unmount();
  });
});
