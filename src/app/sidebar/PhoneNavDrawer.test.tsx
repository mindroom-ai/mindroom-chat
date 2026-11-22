// @vitest-environment jsdom
import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { act as domAct } from '@testing-library/react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  PHONE_NAV_MENU_BUTTON_ID,
  PHONE_SLIDE_OUT_MS,
  phoneNavDrawerOpenAtom,
  phoneNavSectionRootAtom,
  useMarkPhoneSectionRoot,
} from '../navigation/phoneNavDrawer';
import { PHONE_STAGE, isPhonePageSlideActive, slidePhonePage } from '../navigation/phonePageSlide';
import { useEdgeSwipeBack } from '../navigation/useEdgeSwipeBack';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { NoticeSlot, drawerNoticeSlotAtom, pageNoticeSlotAtom } from '../ui/noticeSlots';
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
  ListColumn: 'list-column',
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

  it('offers a notice place of its own from when it comes out until it has slid away', () => {
    vi.useFakeTimers();
    const store = createStore();
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <MemoryRouter initialEntries={['/home/!room:example.org/']}>
            <PhoneNavDrawer nav={null} />
          </MemoryRouter>
        </Provider>
      );
    });
    const places = () => renderer?.root.findAllByType(NoticeSlot).map((slot) => slot.props.place);
    expect(places()).toEqual([]);
    act(() => store.set(phoneNavDrawerOpenAtom, true));
    expect(places()).toEqual(['drawer']);
    // Put away, it keeps the place while it slides: a notice there does not jump to the page.
    act(() => store.set(phoneNavDrawerOpenAtom, false));
    expect(places()).toEqual(['drawer']);
    act(() => {
      vi.advanceTimersByTime(PHONE_SLIDE_OUT_MS);
    });
    expect(places()).toEqual([]);
    act(() => renderer?.unmount());
    vi.useRealTimers();
  });

  it('comes out over the page with no page slide, not even a moment of one', () => {
    // On the phone layout, where a navigation is marked as a page slide from its call.
    const stage = document.createElement('div');
    stage.setAttribute(PHONE_STAGE, '');
    document.body.append(stage);
    try {
      const store = createStore();
      let renderer: ReturnType<typeof create> | undefined;
      act(() => {
        renderer = create(
          <Provider store={store}>
            <MemoryRouter initialEntries={['/home/!room:example.org/']}>
              <PhoneNavDrawer nav={null} />
            </MemoryRouter>
          </Provider>
        );
      });
      swipeFromLeftEdge();
      expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);
      // The drawer slides in on its own: nothing turns its slide off.
      expect(document.documentElement.dataset.pageSlide).toBeUndefined();
      act(() => renderer?.unmount());
    } finally {
      stage.remove();
    }
  });

  it('stays put away when the phone layout goes while its opening waits for a page slide', async () => {
    // A navigation waits a frame for its page slide before it shows; the swipe skips that slide,
    // and the drawer would come out once it is over.
    const change = vi.fn();
    const stage = document.createElement('div');
    stage.setAttribute(PHONE_STAGE, '');
    document.body.append(stage);
    try {
      const store = createStore();
      let renderer: ReturnType<typeof create> | undefined;
      act(() => {
        renderer = create(
          <Provider store={store}>
            <MemoryRouter initialEntries={['/home/!room:example.org/']}>
              <PhoneNavDrawer nav={null} />
            </MemoryRouter>
          </Provider>
        );
      });
      slidePhonePage(change);
      swipeFromLeftEdge();
      expect(change).not.toHaveBeenCalled();
      expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);

      // The phone layout goes (a phone turned sideways), and the skipped slide runs and ends.
      act(() => renderer?.unmount());
      stage.remove();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(change).toHaveBeenCalledWith(true);
      expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
    } finally {
      stage.remove();
      delete document.documentElement.dataset.pageSlide;
    }
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
    // The room gives way on the spot to its space's own page.
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

const dispatchTouch = (
  target: EventTarget,
  type: string,
  touches: Array<{ clientX: number; clientY: number; identifier?: number }>,
  timeStamp: number
) => {
  const list = touches.map((touch) => ({ identifier: 1, ...touch }));
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: list });
  Object.defineProperty(event, 'changedTouches', {
    value: list.length > 0 ? list : [{ identifier: 1, clientX: 0, clientY: 0 }],
  });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  target.dispatchEvent(event);
};

const flushMicrotasks = async () => {
  await domAct(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('PhoneNavDrawer interactive swipes', () => {
  const mountDomDrawer = ({ withList = true }: { withList?: boolean } = {}) => {
    const store = createStore();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    domAct(() => {
      root.render(
        <Provider store={store}>
          <MemoryRouter initialEntries={['/home/!room:example.org/']}>
            <ScreenSizeProvider value={ScreenSize.Mobile}>
              <button id={PHONE_NAV_MENU_BUTTON_ID} type="button">
                Menu
              </button>
              <PhoneNavDrawer
                nav={
                  <nav data-testid="drawer-rail">
                    <button type="button" data-testid="drawer-rail-button">
                      Rail
                    </button>
                  </nav>
                }
              />
              {withList && (
                <MobileFriendlyPageNav>
                  <div data-testid="drawer-list">Section List</div>
                </MobileFriendlyPageNav>
              )}
            </ScreenSizeProvider>
          </MemoryRouter>
        </Provider>
      );
    });
    const panel = container.querySelector<HTMLElement>(`#${PHONE_NAV_DRAWER_ID}`)!;
    const scrim = container.querySelector<HTMLElement>('.scrim')!;
    const menuButton = container.querySelector<HTMLButtonElement>(`#${PHONE_NAV_MENU_BUTTON_ID}`)!;
    return {
      store,
      container,
      panel,
      scrim,
      menuButton,
      unmount: () => {
        domAct(() => root.unmount());
        container.remove();
      },
    };
  };

  it('peeks rail and list during drag without flipping atom or moving focus, and cleans up on cancel', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const drawer = mountDomDrawer({ withList: true });
    vi.spyOn(drawer.panel, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 600,
      top: 0,
      left: 0,
      right: 300,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    try {
      drawer.menuButton.focus();
      expect(document.activeElement).toBe(drawer.menuButton);
      expect(drawer.container.querySelector('[data-testid="drawer-rail"]')).toBeNull();
      expect(drawer.container.querySelector('[data-testid="drawer-list"]')).toBeNull();

      domAct(() => {
        dispatchTouch(window, 'touchstart', [{ clientX: 8, clientY: 200 }], 100);
        // 10 px lock slop -> lockX = 18; clientX = 108 => offset = 90 (30% of 300, below 35% commit).
        dispatchTouch(window, 'touchmove', [{ clientX: 108, clientY: 200 }], 250);
      });

      // Mid-drag: peeking mounted rail + list, inline styles track finger, global atom & focus untouched.
      expect(drawer.container.querySelector('[data-testid="drawer-rail"]')).not.toBeNull();
      expect(drawer.container.querySelector('[data-testid="drawer-list"]')).not.toBeNull();
      expect(drawer.store.get(phoneNavDrawerOpenAtom)).toBe(false);
      expect(drawer.panel.hasAttribute('data-open')).toBe(false);
      expect(drawer.panel.hasAttribute('data-swiping')).toBe(true);
      expect(drawer.scrim.hasAttribute('data-swiping')).toBe(true);
      expect(drawer.panel.style.translate).toBe('90px 0');
      expect(drawer.scrim.style.opacity).toBe('0.3');
      expect(document.activeElement).toBe(drawer.menuButton);

      // Slow release at 30% cancels cleanly.
      domAct(() => {
        dispatchTouch(window, 'touchmove', [{ clientX: 108, clientY: 200 }], 500);
        dispatchTouch(window, 'touchend', [], 520);
      });
      await flushMicrotasks();

      expect(drawer.store.get(phoneNavDrawerOpenAtom)).toBe(false);
      expect(drawer.container.querySelector('[data-testid="drawer-rail"]')).toBeNull();
      expect(drawer.container.querySelector('[data-testid="drawer-list"]')).toBeNull();
      expect(drawer.panel.style.translate).toBe('');
      expect(drawer.scrim.style.opacity).toBe('');
      expect(drawer.panel.hasAttribute('data-swiping')).toBe(false);
      expect(drawer.scrim.hasAttribute('data-swiping')).toBe(false);
      expect(document.activeElement).toBe(drawer.menuButton);
    } finally {
      drawer.unmount();
      raf.mockRestore();
    }
  });

  it('commits interactive open seamlessly and measures narrower rail-only width after peeking', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const drawer = mountDomDrawer({ withList: false });
    // Returns 0 while empty, 64 px once the rail mounts during peek (mirroring rail-only pages).
    vi.spyOn(drawer.panel, 'getBoundingClientRect').mockImplementation(() => {
      const hasRail = drawer.panel.querySelector('[data-testid="drawer-rail"]') !== null;
      const width = hasRail ? 64 : 0;
      return {
        width,
        height: 600,
        top: 0,
        left: 0,
        right: width,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });

    try {
      domAct(() => {
        dispatchTouch(window, 'touchstart', [{ clientX: 8, clientY: 200 }], 100);
        // lockX = 18 -> offset = 26 px, which is 40.6% of 64 px (>= 35% commit threshold).
        dispatchTouch(window, 'touchmove', [{ clientX: 44, clientY: 200 }], 220);
      });

      expect(drawer.panel.style.translate).toBe('26px 0');
      expect(drawer.scrim.style.opacity).toBe(String(26 / 64));

      domAct(() => {
        dispatchTouch(window, 'touchend', [], 240);
      });
      await flushMicrotasks();

      expect(drawer.store.get(phoneNavDrawerOpenAtom)).toBe(true);
      expect(drawer.panel.hasAttribute('data-open')).toBe(true);
      expect(drawer.scrim.hasAttribute('data-open')).toBe(true);
      expect(drawer.panel.style.translate).toBe('');
      expect(drawer.scrim.style.opacity).toBe('');
      expect(drawer.panel.hasAttribute('data-swiping')).toBe(false);
      expect(drawer.scrim.hasAttribute('data-swiping')).toBe(false);
      expect(drawer.container.querySelector('[data-testid="drawer-rail"]')).not.toBeNull();
    } finally {
      drawer.unmount();
      raf.mockRestore();
    }
  });

  it('tracks interactive close, cancels without closing, and commits immediately without 320 ms delay', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] });
    const drawer = mountDomDrawer({ withList: true });
    vi.spyOn(drawer.panel, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 600,
      top: 0,
      left: 0,
      right: 300,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    try {
      domAct(() => {
        drawer.store.set(phoneNavDrawerOpenAtom, true);
      });
      expect(drawer.panel.hasAttribute('data-open')).toBe(true);

      // Short drag left (offset = 60 px = 20% of 300) cancels.
      domAct(() => {
        dispatchTouch(drawer.panel, 'touchstart', [{ clientX: 200, clientY: 200 }], 100);
        dispatchTouch(drawer.panel, 'touchmove', [{ clientX: 130, clientY: 200 }], 300);
        vi.advanceTimersToNextFrame();
      });

      expect(drawer.panel.style.translate).toBe('-60px 0');
      expect(drawer.scrim.style.opacity).toBe('0.8');
      expect(drawer.panel.hasAttribute('data-swiping')).toBe(true);
      expect(drawer.store.get(phoneNavDrawerOpenAtom)).toBe(true);

      domAct(() => {
        dispatchTouch(drawer.panel, 'touchmove', [{ clientX: 130, clientY: 200 }], 500);
        dispatchTouch(drawer.panel, 'touchend', [], 520);
      });
      await flushMicrotasks();

      expect(drawer.store.get(phoneNavDrawerOpenAtom)).toBe(true);
      expect(drawer.panel.style.translate).toBe('');
      expect(drawer.scrim.style.opacity).toBe('');
      expect(drawer.panel.hasAttribute('data-swiping')).toBe(false);

      // Drag past 35% (offset = 140 px) commits and unmounts content immediately (no 320 ms wait).
      domAct(() => {
        dispatchTouch(drawer.panel, 'touchstart', [{ clientX: 250, clientY: 200 }], 600);
        dispatchTouch(drawer.panel, 'touchmove', [{ clientX: 100, clientY: 200 }], 700);
        vi.advanceTimersToNextFrame();
      });
      expect(drawer.panel.style.translate).toBe('-140px 0');

      domAct(() => {
        dispatchTouch(drawer.panel, 'touchend', [], 720);
      });
      await flushMicrotasks();

      expect(drawer.store.get(phoneNavDrawerOpenAtom)).toBe(false);
      expect(drawer.panel.hasAttribute('data-open')).toBe(false);
      expect(drawer.panel.style.translate).toBe('');
      expect(drawer.scrim.style.opacity).toBe('');
      expect(drawer.panel.hasAttribute('data-swiping')).toBe(false);
      expect(drawer.scrim.hasAttribute('data-swiping')).toBe(false);
      // Unmounted immediately without advancing timers by PHONE_SLIDE_OUT_MS.
      expect(drawer.container.querySelector('[data-testid="drawer-rail"]')).toBeNull();
      expect(drawer.container.querySelector('[data-testid="drawer-list"]')).toBeNull();
    } finally {
      drawer.unmount();
      vi.useRealTimers();
    }
  });

  it('mirrors interactive open and close translation in RTL', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const prevDir = document.documentElement.dir;
    const prevWidth = window.innerWidth;
    document.documentElement.dir = 'rtl';
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    const drawer = mountDomDrawer({ withList: true });
    vi.spyOn(drawer.panel, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 600,
      top: 0,
      left: 90,
      right: 390,
      bottom: 600,
      x: 90,
      y: 0,
      toJSON: () => ({}),
    });

    try {
      // RTL open: drag inward (left) from physical right edge (x = 382 -> 220; lockX = 372, offset = 152).
      domAct(() => {
        dispatchTouch(window, 'touchstart', [{ clientX: 382, clientY: 200 }], 100);
        dispatchTouch(window, 'touchmove', [{ clientX: 220, clientY: 200 }], 200);
      });
      expect(drawer.panel.style.translate).toBe('-152px 0');

      domAct(() => {
        dispatchTouch(window, 'touchend', [], 220);
      });
      await flushMicrotasks();
      expect(drawer.store.get(phoneNavDrawerOpenAtom)).toBe(true);

      // RTL close: drag toward physical right edge (x = 150 -> 300; lockX = 160, offset = 140).
      domAct(() => {
        dispatchTouch(drawer.panel, 'touchstart', [{ clientX: 150, clientY: 200 }], 300);
        dispatchTouch(drawer.panel, 'touchmove', [{ clientX: 300, clientY: 200 }], 400);
      });
      expect(drawer.panel.style.translate).toBe('140px 0');

      domAct(() => {
        dispatchTouch(drawer.panel, 'touchend', [], 420);
      });
      await flushMicrotasks();
      expect(drawer.store.get(phoneNavDrawerOpenAtom)).toBe(false);
    } finally {
      drawer.unmount();
      document.documentElement.dir = prevDir;
      Object.defineProperty(window, 'innerWidth', { value: prevWidth, configurable: true });
      raf.mockRestore();
    }
  });

  it('does not mount drawer NoticeSlot while peeking and mounts it only once open commits', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const drawer = mountDomDrawer({ withList: true });
    vi.spyOn(drawer.panel, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 600,
      top: 0,
      left: 0,
      right: 300,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    try {
      // Peek mid-drag (offset = 90 < 35% of 300): rail mounts, but drawer NoticeSlot stays unmounted.
      domAct(() => {
        dispatchTouch(window, 'touchstart', [{ clientX: 8, clientY: 200 }], 100);
        dispatchTouch(window, 'touchmove', [{ clientX: 108, clientY: 200 }], 250);
      });
      expect(drawer.container.querySelector('[data-testid="drawer-rail"]')).not.toBeNull();
      expect(drawer.store.get(drawerNoticeSlotAtom)).toBeNull();

      // Cancel: drawer NoticeSlot still never mounted.
      domAct(() => {
        dispatchTouch(window, 'touchmove', [{ clientX: 108, clientY: 200 }], 500);
        dispatchTouch(window, 'touchend', [], 520);
      });
      await flushMicrotasks();
      expect(drawer.store.get(drawerNoticeSlotAtom)).toBeNull();

      // Commit open: drawer NoticeSlot mounts once committed.
      domAct(() => {
        dispatchTouch(window, 'touchstart', [{ clientX: 8, clientY: 200 }], 600);
        dispatchTouch(window, 'touchmove', [{ clientX: 180, clientY: 200 }], 700);
        dispatchTouch(window, 'touchend', [], 720);
      });
      await flushMicrotasks();
      expect(drawer.store.get(phoneNavDrawerOpenAtom)).toBe(true);
      expect(drawer.store.get(drawerNoticeSlotAtom)).not.toBeNull();
    } finally {
      drawer.unmount();
      raf.mockRestore();
    }
  });

  it('falls back to discrete movePhoneNavDrawer when a phonePageSlide is active', async () => {
    const stage = document.createElement('div');
    stage.setAttribute(PHONE_STAGE, '');
    document.body.append(stage);
    const change = vi.fn();
    const drawer = mountDomDrawer({ withList: true });
    vi.spyOn(drawer.panel, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 600,
      top: 0,
      left: 0,
      right: 300,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    try {
      slidePhonePage(change);
      expect(isPhonePageSlideActive()).toBe(true);

      domAct(() => {
        dispatchTouch(window, 'touchstart', [{ clientX: 8, clientY: 200 }], 100);
        dispatchTouch(window, 'touchmove', [{ clientX: 130, clientY: 200 }], 200);
      });

      // Did not enter interactive peek while a phone page slide is active.
      expect(drawer.panel.hasAttribute('data-swiping')).toBe(false);
      expect(drawer.panel.style.translate).toBe('');
      expect(drawer.container.querySelector('[data-testid="drawer-rail"]')).toBeNull();

      domAct(() => {
        dispatchTouch(window, 'touchend', [], 220);
      });
      await flushMicrotasks();

      expect(change).toHaveBeenCalledWith(true);
      expect(drawer.store.get(phoneNavDrawerOpenAtom)).toBe(true);
      expect(drawer.panel.hasAttribute('data-open')).toBe(true);
    } finally {
      drawer.unmount();
      stage.remove();
      delete document.documentElement.dataset.pageSlide;
    }
  });

  it('returns focus to the menu button when interactively swiped closed from a focused rail button', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const drawer = mountDomDrawer({ withList: true });
    vi.spyOn(drawer.panel, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 600,
      top: 0,
      left: 0,
      right: 300,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    try {
      domAct(() => {
        drawer.store.set(phoneNavDrawerOpenAtom, true);
      });
      const railButton = drawer.container.querySelector<HTMLButtonElement>(
        '[data-testid="drawer-rail-button"]'
      )!;
      railButton.focus();
      expect(document.activeElement).toBe(railButton);

      domAct(() => {
        dispatchTouch(drawer.panel, 'touchstart', [{ clientX: 250, clientY: 200 }], 100);
        dispatchTouch(drawer.panel, 'touchmove', [{ clientX: 100, clientY: 200 }], 200);
        dispatchTouch(drawer.panel, 'touchend', [], 220);
      });
      await flushMicrotasks();

      expect(drawer.store.get(phoneNavDrawerOpenAtom)).toBe(false);
      expect(document.activeElement).toBe(drawer.menuButton);
    } finally {
      drawer.unmount();
      raf.mockRestore();
    }
  });

  it('falls back to discrete close without snapping when entry transform transition is running', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const drawer = mountDomDrawer({ withList: true });
    vi.spyOn(drawer.panel, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 600,
      top: 0,
      left: 0,
      right: 300,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(drawer.panel, 'getAnimations', {
      configurable: true,
      value: () => [
        { transitionProperty: 'transform', playState: 'running', finished: Promise.resolve() },
      ],
    });

    try {
      domAct(() => {
        drawer.store.set(phoneNavDrawerOpenAtom, true);
      });

      domAct(() => {
        dispatchTouch(drawer.panel, 'touchstart', [{ clientX: 250, clientY: 200 }], 100);
        dispatchTouch(drawer.panel, 'touchmove', [{ clientX: 150, clientY: 200 }], 200);
      });

      // Entry transition is not interrupted by data-swiping or inline translate.
      expect(drawer.panel.hasAttribute('data-swiping')).toBe(false);
      expect(drawer.scrim.hasAttribute('data-swiping')).toBe(false);
      expect(drawer.panel.style.translate).toBe('');
      expect(drawer.scrim.style.opacity).toBe('');

      // Releasing past discrete threshold (>= 56 px) still closes cleanly.
      domAct(() => {
        dispatchTouch(drawer.panel, 'touchend', [], 220);
      });
      await flushMicrotasks();
      expect(drawer.store.get(phoneNavDrawerOpenAtom)).toBe(false);
    } finally {
      drawer.unmount();
      raf.mockRestore();
    }
  });

  it('keeps settled open styles pinned until a mid-settle phonePageSlide finishes and opens the drawer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] });
    const stage = document.createElement('div');
    stage.setAttribute(PHONE_STAGE, '');
    document.body.append(stage);
    const change = vi.fn();
    const drawer = mountDomDrawer({ withList: true });
    vi.spyOn(drawer.panel, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 600,
      top: 0,
      left: 0,
      right: 300,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const finishers: Array<() => void> = [];
    const mockAnimate = () => {
      let finish = () => {};
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      finishers.push(finish);
      return { finished, cancel: vi.fn() } as unknown as Animation;
    };
    Object.defineProperty(drawer.panel, 'animate', { configurable: true, value: mockAnimate });
    Object.defineProperty(drawer.scrim, 'animate', { configurable: true, value: mockAnimate });

    try {
      // Begin interactive open drag past 35% and release so WAAPI settle is in-flight.
      domAct(() => {
        dispatchTouch(window, 'touchstart', [{ clientX: 8, clientY: 200 }], 100);
        dispatchTouch(window, 'touchmove', [{ clientX: 180, clientY: 200 }], 200);
        vi.advanceTimersToNextFrame();
        dispatchTouch(window, 'touchend', [], 220);
      });
      expect(finishers).toHaveLength(2);

      // A phone page slide starts mid-settle before commit() runs.
      slidePhonePage(change);
      expect(isPhonePageSlideActive()).toBe(true);

      // Resolve WAAPI settle so commit() runs, while the skipped page slide's microtask is still pending.
      // Check synchronously inside the settle resolution before the deferred slide finishes.
      let pinnedBeforeOpen = false;
      let translateBeforeOpen = '';
      let opacityBeforeOpen = '';
      let railMountedBeforeOpen = false;
      const originalSet = drawer.store.set.bind(drawer.store);
      const setSpy = vi.spyOn(drawer.store, 'set').mockImplementation((atom, ...args) => {
        if (atom === phoneNavDrawerOpenAtom && args[0] === true) {
          pinnedBeforeOpen =
            drawer.panel.hasAttribute('data-swiping') && drawer.scrim.hasAttribute('data-swiping');
          translateBeforeOpen = drawer.panel.style.translate;
          opacityBeforeOpen = drawer.scrim.style.opacity;
          railMountedBeforeOpen =
            drawer.container.querySelector('[data-testid="drawer-rail"]') !== null;
        }
        return originalSet(atom, ...args);
      });

      domAct(() => {
        finishers.forEach((finish) => finish());
      });
      await flushMicrotasks();
      setSpy.mockRestore();

      // Right up until the deferred open committed, the settled open drawer stayed pinned with zero snap-offscreen.
      expect(pinnedBeforeOpen).toBe(true);
      expect(translateBeforeOpen).toBe('300px 0');
      expect(opacityBeforeOpen).toBe('1');
      expect(railMountedBeforeOpen).toBe(true);

      // Once open commits, [data-open] takes over cleanly and swipe styles are cleared.
      expect(change).toHaveBeenCalledWith(true);
      expect(drawer.store.get(phoneNavDrawerOpenAtom)).toBe(true);
      expect(drawer.panel.hasAttribute('data-open')).toBe(true);
      expect(drawer.scrim.hasAttribute('data-open')).toBe(true);
      expect(drawer.panel.style.translate).toBe('');
      expect(drawer.scrim.style.opacity).toBe('');
      expect(drawer.panel.hasAttribute('data-swiping')).toBe(false);
      expect(drawer.scrim.hasAttribute('data-swiping')).toBe(false);
    } finally {
      drawer.unmount();
      stage.remove();
      delete document.documentElement.dataset.pageSlide;
      vi.useRealTimers();
    }
  });

  it('still opens interactively on rail-only pages when pageNoticeSlotAtom has a page-only notice', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const drawer = mountDomDrawer({ withList: false });
    vi.spyOn(drawer.panel, 'getBoundingClientRect').mockReturnValue({
      width: 64,
      height: 600,
      top: 0,
      left: 0,
      right: 64,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const pageNoticeSlot = document.createElement('div');
    const noticeButton = document.createElement('button');
    noticeButton.type = 'button';
    noticeButton.textContent = 'Connection lost';
    pageNoticeSlot.append(noticeButton);
    document.body.append(pageNoticeSlot);
    drawer.store.set(pageNoticeSlotAtom, pageNoticeSlot);
    noticeButton.focus();

    try {
      // Mid-drag: interactive finger-following works on rail-only pages, while drawer NoticeSlot stays
      // unmounted during peek so focus on the page notice is never stolen.
      domAct(() => {
        dispatchTouch(window, 'touchstart', [{ clientX: 8, clientY: 200 }], 100);
        dispatchTouch(window, 'touchmove', [{ clientX: 44, clientY: 200 }], 200);
      });

      expect(drawer.panel.hasAttribute('data-swiping')).toBe(true);
      expect(drawer.panel.style.translate).toBe('26px 0');
      expect(drawer.container.querySelector('[data-testid="drawer-rail"]')).not.toBeNull();
      expect(drawer.store.get(drawerNoticeSlotAtom)).toBeNull();
      expect(document.activeElement).toBe(noticeButton);

      // Release past 35% of 64 px: commits cleanly and mounts drawer NoticeSlot once open.
      domAct(() => {
        dispatchTouch(window, 'touchend', [], 220);
      });
      await flushMicrotasks();
      expect(drawer.store.get(phoneNavDrawerOpenAtom)).toBe(true);
      expect(drawer.panel.hasAttribute('data-open')).toBe(true);
      expect(drawer.store.get(drawerNoticeSlotAtom)).not.toBeNull();
      expect(drawer.panel.style.translate).toBe('');
      expect(drawer.panel.hasAttribute('data-swiping')).toBe(false);
    } finally {
      drawer.unmount();
      pageNoticeSlot.remove();
      raf.mockRestore();
    }
  });
});
