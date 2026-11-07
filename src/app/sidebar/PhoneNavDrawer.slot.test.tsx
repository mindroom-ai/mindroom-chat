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
import { followRouterSignalsInNode } from '../../test/utils/nodeSignalRequests';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
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

describe('PhoneNavDrawer slot', () => {
  it('lets the list in it leave while it is still on the page', () => {
    vi.useFakeTimers();
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

    act(() => store.set(phoneNavDrawerOpenAtom, true));
    expect(container.querySelector('[data-nav-slot] > div')).not.toBeNull();
    act(() => store.set(phoneNavDrawerOpenAtom, false));
    act(() => {
      vi.advanceTimersByTime(PHONE_SLIDE_OUT_MS);
    });

    expect(container.querySelector('[data-nav-slot] > div')).toBeNull();
    expect(leftOnPage).toEqual([true]);
    act(() => root.unmount());
    container.remove();
  });
});
