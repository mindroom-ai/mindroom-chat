// @vitest-environment jsdom
import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  phoneNavDrawerOpenAtom,
  phoneNavSectionRootAtom,
  useMarkPhoneSectionRoot,
} from '../navigation/phoneNavDrawer';
import { useEdgeSwipeBack } from '../navigation/useEdgeSwipeBack';
import { PhoneNavDrawer } from './PhoneNavDrawer';
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

/** A finger from the screen's left edge 112 px into the page, then lifted. */
const swipeFromLeftEdge = () => {
  const touch = (type: string, touches: { clientX: number; clientY: number }[]) =>
    window.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { touches }));
  act(() => {
    touch('touchstart', [{ clientX: 8, clientY: 300 }]);
    touch('touchmove', [{ clientX: 120, clientY: 304 }]);
    touch('touchend', []);
  });
};

/** A thread on the page, whose swipe from the left edge goes back. */
function ThreadWithBackSwipe({ onBack }: { onBack: () => void }) {
  useEdgeSwipeBack(onBack);
  return null;
}

describe('PhoneNavDrawer', () => {
  it('puts the drawer away when it unmounts, as a phone turned sideways does', () => {
    const store = createStore();
    const router = createMemoryRouter([{ path: '*', element: <PhoneNavDrawer nav={null} /> }], {
      initialEntries: ['/home/!room:example.org/'],
    });
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      );
    });
    act(() => store.set(phoneNavDrawerOpenAtom, true));
    act(() => renderer?.unmount());
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
  });

  it('opens on a shown section page and goes away when that page gives way on the spot', async () => {
    const store = createStore();
    const router = createMemoryRouter([{ path: '*', element: <PhoneNavDrawer nav={null} /> }], {
      initialEntries: ['/!space:example.org/!room:example.org/'],
    });
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      );
    });
    // A room's back chevron replaces the room with its space's own page.
    await act(async () => {
      await router.navigate('/!space:example.org/', { replace: true });
    });
    expect(router.state.historyAction).toBe('REPLACE');
    act(() => store.set(phoneNavSectionRootAtom, router.state.location.key));
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);
    // The space was left: its join page takes the place of its own page, with no navigation.
    act(() => store.set(phoneNavSectionRootAtom, null));
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
    act(() => renderer?.unmount());
  });

  it('closes on Escape though a popover stays in the inert page below', () => {
    const store = createStore();
    const router = createMemoryRouter([{ path: '*', element: <PhoneNavDrawer nav={null} /> }], {
      initialEntries: ['/home/!room:example.org/'],
    });
    const page = document.createElement('div');
    page.setAttribute('inert', '');
    page.innerHTML = '<div role="dialog">Thread statistics</div>';
    document.body.append(page);
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      );
    });
    act(() => store.set(phoneNavDrawerOpenAtom, true));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
    act(() => renderer?.unmount());
    page.remove();
  });

  it('stays out through a space alias while the address turns into the space ID', async () => {
    const store = createStore();
    const router = createMemoryRouter([{ path: '*', element: <PhoneNavDrawer nav={null} /> }], {
      initialEntries: ['/!garden:example.org/'],
    });
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      );
    });
    act(() => store.set(phoneNavSectionRootAtom, router.state.location.key));
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);
    // A tap on another space in the rail opens its alias, which shows no page until it resolves.
    await act(async () => {
      await router.navigate('/%23fields%3Aexample.org/');
    });
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);
    await act(async () => {
      await router.navigate('/!fields:example.org/', { replace: true });
    });
    act(() => store.set(phoneNavSectionRootAtom, router.state.location.key));
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);
    act(() => renderer?.unmount());
  });

  it('goes away when a room picked by its alias opens over another room', async () => {
    const store = createStore();
    const router = createMemoryRouter([{ path: '*', element: <PhoneNavDrawer nav={null} /> }], {
      initialEntries: ['/home/!alder:example.org/'],
    });
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      );
    });
    act(() => store.set(phoneNavDrawerOpenAtom, true));
    // Search opens the room by its alias, which then turns into the room ID by a replace.
    await act(async () => {
      await router.navigate('/home/%23birch%3Aexample.org/');
    });
    await act(async () => {
      await router.navigate('/home/!birch:example.org/', { replace: true });
    });
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
    act(() => renderer?.unmount());
  });

  it('shows the drawer out without sliding it on the section page it opens with', () => {
    // The first frame comes at once, as on a busy phone whose frame beats the drawer's next render.
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    function SectionPage() {
      useMarkPhoneSectionRoot();
      return null;
    }
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <>
              <SectionPage />
              <PhoneNavDrawer nav={null} />
            </>
          ),
        },
      ],
      { initialEntries: ['/home/'] }
    );
    const container = document.createElement('div');
    const root = createRoot(container);
    // The drawer's state in each commit: out, and moving.
    const commits: string[] = [];
    const record = () => {
      const panel = container.querySelector('#phone-nav-drawer');
      commits.push(
        `open=${panel?.hasAttribute('data-open')} animate=${panel?.hasAttribute('data-animate')}`
      );
    };
    act(() =>
      root.render(
        <Profiler id="drawer" onRender={record}>
          <Provider store={createStore()}>
            <RouterProvider router={router} />
          </Provider>
        </Profiler>
      )
    );
    // It comes out still and moves only from a later commit on.
    const firstOut = commits.findIndex((commit) => commit.startsWith('open=true'));
    expect(commits[firstOut]).toBe('open=true animate=false');
    expect(commits.at(-1)).toBe('open=true animate=true');
    act(() => root.unmount());
    frame.mockRestore();
  });

  it('comes out with a swipe from the left edge on a page that takes no such swipe', () => {
    const store = createStore();
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <MemoryRouter initialEntries={['/home/']}>
            <PhoneNavDrawer nav={null} />
          </MemoryRouter>
        </Provider>
      );
    });
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
    swipeFromLeftEdge();
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);
    act(() => renderer?.unmount());
  });

  it('leaves the swipe from the left edge to a thread, which goes back with it', () => {
    const store = createStore();
    const onBack = vi.fn();
    // The shell's drawer listens before any thread, as in the app.
    const page = (thread: boolean) => (
      <Provider store={store}>
        <MemoryRouter initialEntries={['/home/']}>
          <PhoneNavDrawer nav={null} />
          {thread && <ThreadWithBackSwipe onBack={onBack} />}
        </MemoryRouter>
      </Provider>
    );
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(page(true));
    });
    swipeFromLeftEdge();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
    // With the thread gone, the swipe brings the drawer out again.
    act(() => renderer?.update(page(false)));
    swipeFromLeftEdge();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);
    act(() => renderer?.unmount());
  });
});
