// @vitest-environment jsdom
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import {
  createMemoryRouter,
  Route,
  RouterProvider,
  createRoutesFromElements,
} from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import {
  isLiveSlideActive,
  PHONE_STAGE,
  skipActiveLiveSlide,
  SWIPE_OVER_THREAD,
  SWIPE_THREAD_STAGE,
  SWIPE_UNDER_THREAD,
  type LiveThreadBackUnder,
} from '../navigation/phonePageSlide';
import { finishSwipeTransitions } from '../navigation/__tests__/swipeTransitions';
import {
  SPACE_LOBBY_PATH,
  SPACE_PATH,
  SPACE_ROOM_PATH,
  SPACE_SEARCH_PATH,
  SPACE_THREADS_PATH,
} from '../routes/paths';
import { withRoomThreadExitTargetState } from '../routes/roomNavigateState';
import {
  useIsSpaceThreadsPassive,
  useSpaceUnderLayer,
  type SpaceUnderLayerContextValue,
} from '../spaces/spaceUnderLayerContext';
import { SpaceSectionPage } from './SpaceSectionPage';

const SPACE_A = '!spaceA:example.org';
const SPACE_B = '!spaceB:example.org';
const ROOM_1 = '!room1:example.org';

const probe = vi.hoisted(() => ({
  spaceId: '!spaceA:example.org',
  threadsMounts: 0,
  threadsLayoutReveals: 0,
  threadsLayoutHides: 0,
  activePolls: 0,
  passiveDuringReveal: [] as boolean[],
  scrollTopRestoredOnReveal: [] as number[],
  underLayer: null as SpaceUnderLayerContextValue | null,
  outletMounts: 0,
  stageHadMarkerOnHide: [] as boolean[],
}));

const makeSpace = (roomId: string): Room =>
  ({
    roomId,
    name: roomId,
    getCanonicalAlias: () => null,
    getAltAliases: () => [],
  }) as unknown as Room;

vi.mock('../matrix/hooks/useSpace', () => ({
  useSpace: () => makeSpace(probe.spaceId),
}));
vi.mock('../sidebar/Navigation', () => ({
  SpacePageRoot: ({ children }: { children: ReactNode }) => (
    <div data-testid="space-root">{children}</div>
  ),
}));
vi.mock('../sidebar/ResizablePageNav', () => ({
  CollapsiblePageNav: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../sidebar/space/Space', () => ({ Space: () => null }));

vi.mock('../spaces/threads/SpaceThreadsPage', () => ({
  SpaceThreadsPage: () => {
    const passive = useIsSpaceThreadsPassive();
    const scrollRef = useRef<HTMLDivElement>(null);
    const savedScrollRef = useRef<number | undefined>(undefined);
    const [instanceId] = useState(() => {
      probe.threadsMounts += 1;
      return probe.threadsMounts;
    });

    useEffect(() => {
      if (!passive) probe.activePolls += 1;
    }, [passive]);

    useLayoutEffect(() => {
      const el = scrollRef.current;
      if (el && savedScrollRef.current !== undefined) {
        el.scrollTop = savedScrollRef.current;
        savedScrollRef.current = undefined;
      }
      probe.threadsLayoutReveals += 1;
      probe.passiveDuringReveal.push(passive);
      probe.scrollTopRestoredOnReveal.push(el?.scrollTop ?? -1);
      return () => {
        probe.threadsLayoutHides += 1;
        if (el) savedScrollRef.current = el.scrollTop;
        const stage = document.querySelector('[data-space-section-stage]');
        const under = document.querySelector('[data-space-threads-layer]');
        probe.stageHadMarkerOnHide.push(
          Boolean(
            stage?.hasAttribute(SWIPE_THREAD_STAGE) && under?.hasAttribute(SWIPE_UNDER_THREAD)
          )
        );
      };
    }, [passive]);

    return (
      <div
        ref={scrollRef}
        data-testid="space-threads-page"
        data-instance={instanceId}
        data-passive={passive ? 'true' : 'false'}
      >
        Space All threads
      </div>
    );
  },
}));

function ThreadOutletProbe() {
  probe.underLayer = useSpaceUnderLayer();
  useEffect(() => {
    probe.outletMounts += 1;
  }, []);
  return <div data-testid="room-thread-page">Thread view</div>;
}

const mx = {
  getRoom: (id: string) => makeSpace(id),
} as unknown as MatrixClient;

const spacePath = (spaceId: string, suffix: string) => `/${encodeURIComponent(spaceId)}/${suffix}`;

const mountSpaceRouter = (
  initialEntry: string | { pathname: string; search?: string; state?: unknown },
  screenSize: ScreenSize
) => {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route path={SPACE_PATH} element={<SpaceSectionPage />}>
        <Route path={SPACE_LOBBY_PATH} element={<div data-testid="space-lobby">Lobby</div>} />
        <Route
          path={SPACE_THREADS_PATH}
          element={<div data-testid="outlet-threads">Outlet threads</div>}
        />
        <Route path={SPACE_SEARCH_PATH} element={<div data-testid="space-search">Search</div>} />
        <Route path={SPACE_ROOM_PATH} element={<ThreadOutletProbe />} />
      </Route>
    ),
    { initialEntries: [initialEntry] }
  );
  const rendered = render(
    <MatrixClientProvider value={mx}>
      <ScreenSizeProvider value={screenSize}>
        <div {...(screenSize === ScreenSize.Mobile ? { [PHONE_STAGE]: '' } : {})}>
          <RouterProvider router={router} />
        </div>
      </ScreenSizeProvider>
    </MatrixClientProvider>
  );
  return { router, rendered };
};

beforeEach(() => {
  probe.spaceId = SPACE_A;
  probe.threadsMounts = 0;
  probe.threadsLayoutReveals = 0;
  probe.threadsLayoutHides = 0;
  probe.activePolls = 0;
  probe.passiveDuringReveal = [];
  probe.scrollTopRestoredOnReveal = [];
  probe.underLayer = null;
  probe.outletMounts = 0;
  probe.stageHadMarkerOnHide = [];
});

afterEach(() => {
  skipActiveLiveSlide();
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SpaceSectionPage live 2-layer stack', () => {
  it('renders one SpaceThreadsPage on desktop All threads and unmounts it cleanly when navigating away', async () => {
    const { router } = mountSpaceRouter(spacePath(SPACE_A, 'threads/'), ScreenSize.Desktop);
    try {
      expect(screen.getAllByTestId('space-threads-page')).toHaveLength(1);
      expect(screen.queryByTestId('outlet-threads')).toBeNull();
      expect(probe.threadsMounts).toBe(1);

      // Navigating away on desktop unmounts SpaceThreadsPage (never parked) and mounts Outlet.
      await act(async () => {
        await router.navigate(spacePath(SPACE_A, 'lobby/'));
      });
      expect(screen.queryByTestId('space-threads-page')).toBeNull();
      expect(screen.getByTestId('space-lobby')).toBeTruthy();
    } finally {
      router.dispose();
    }
  });

  it('keeps the exact same SpaceThreadsPage instance mounted across Mobile -> Desktop -> Mobile rotation', () => {
    const { router, rendered } = mountSpaceRouter(
      spacePath(SPACE_A, 'threads/'),
      ScreenSize.Mobile
    );
    try {
      expect(probe.threadsMounts).toBe(1);
      const initialEl = screen.getByTestId('space-threads-page');
      expect(initialEl.dataset.instance).toBe('1');
      expect(screen.queryByTestId('outlet-threads')).toBeNull();

      rendered.rerender(
        <MatrixClientProvider value={mx}>
          <ScreenSizeProvider value={ScreenSize.Desktop}>
            <div>
              <RouterProvider router={router} />
            </div>
          </ScreenSizeProvider>
        </MatrixClientProvider>
      );
      expect(probe.threadsMounts).toBe(1);
      expect(screen.getByTestId('space-threads-page')).toBe(initialEl);
      expect(screen.getByTestId('space-threads-page').dataset.instance).toBe('1');
      expect(screen.queryByTestId('outlet-threads')).toBeNull();

      rendered.rerender(
        <MatrixClientProvider value={mx}>
          <ScreenSizeProvider value={ScreenSize.Mobile}>
            <div data-phone-stage="">
              <RouterProvider router={router} />
            </div>
          </ScreenSizeProvider>
        </MatrixClientProvider>
      );
      expect(probe.threadsMounts).toBe(1);
      expect(screen.getByTestId('space-threads-page')).toBe(initialEl);
      expect(screen.getByTestId('space-threads-page').dataset.instance).toBe('1');
    } finally {
      router.dispose();
    }
  });

  it('on phones mounts SpaceThreadsPage once, plays forward slide into Thread, preserves scrollTop across Activity hide/reveal, peeks passively, and commits continuously', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] });
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 390,
      height: 800,
      top: 0,
      left: 0,
      right: 390,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const threadsUrl = spacePath(SPACE_A, 'threads/');
    const threadUrl = `${spacePath(SPACE_A, encodeURIComponent(ROOM_1))}/?threadId=%24t1`;
    const returnState = withRoomThreadExitTargetState(undefined, {
      exitPath: threadsUrl,
      roomId: ROOM_1,
      threadId: '$t1',
      useHistoryBack: true,
      returnToOrigin: true,
    });

    const { router } = mountSpaceRouter(threadsUrl, ScreenSize.Mobile);
    try {
      // 1. On SPACE_THREADS_PATH: mounted once in Layer 0, no duplicate Outlet.
      expect(screen.getAllByTestId('space-threads-page')).toHaveLength(1);
      expect(screen.queryByTestId('outlet-threads')).toBeNull();
      expect(probe.threadsMounts).toBe(1);
      const threadsEl = screen.getByTestId('space-threads-page');
      threadsEl.scrollTop = 480;

      // 2. Forward navigation SpaceThreads -> Thread (with returnToOrigin):
      //    keeps Activity visible + inert during 280 ms forward slide, then flips hidden on settle.
      await act(async () => {
        await router.navigate(threadUrl, { state: returnState });
      });
      expect(isLiveSlideActive()).toBe(true);
      expect(probe.underLayer?.isSpaceSlideOwningThread()).toBe(true);
      expect(probe.underLayer?.hasWarmSpaceThreads()).toBe(true);
      const threadsLayer = document.querySelector<HTMLElement>('[data-space-threads-layer]')!;
      expect(threadsLayer.inert).toBe(true);
      expect(threadsLayer.getAttribute('aria-hidden')).toBe('true');
      expect(
        document.querySelector('[data-space-outlet-layer]')?.hasAttribute(SWIPE_OVER_THREAD)
      ).toBe(true);
      // Activity stayed visible during slide (not hidden yet).
      expect(threadsEl.style.display).not.toBe('none');

      act(() => {
        vi.advanceTimersToNextFrame();
        vi.advanceTimersToNextFrame();
      });
      expect(
        document.querySelector<HTMLElement>('[data-space-outlet-layer]')?.style.transition
      ).toContain('translate');

      probe.stageHadMarkerOnHide = [];
      await act(async () => {
        finishSwipeTransitions();
        await Promise.resolve();
        await Promise.resolve();
      });
      // Activity hid synchronously inside exit() WHILE slide markers were still present.
      expect(probe.stageHadMarkerOnHide).toEqual([true]);
      expect(isLiveSlideActive()).toBe(false);
      expect(probe.underLayer?.isSpaceSlideOwningThread()).toBe(false);
      // Activity flipped to hidden (React sets display: none !important on child).
      expect(threadsEl.style.display).toBe('none');
      expect(probe.threadsLayoutHides).toBeGreaterThanOrEqual(1);

      // Simulate WebKit resetting scrollTop to 0 while display: none is applied.
      threadsEl.scrollTop = 0;
      const pollsBeforePeek = probe.activePolls;

      // 3. Swipe-back peek reveals SpaceThreadsPage passively without starting polling/rescans,
      //    and restores scrollTop synchronously on reveal.
      let live: LiveThreadBackUnder | null = null;
      act(() => {
        live = probe.underLayer?.enterLiveSpaceThreadsPeek() ?? null;
      });
      expect(live).not.toBeNull();
      expect(live!.stage.hasAttribute(SWIPE_THREAD_STAGE)).toBe(true);
      expect(live!.under.hasAttribute(SWIPE_UNDER_THREAD)).toBe(true);
      expect(threadsEl.style.display).not.toBe('none');
      expect(threadsEl.dataset.passive).toBe('true');
      expect(threadsEl.scrollTop).toBe(480);
      expect(probe.activePolls).toBe(pollsBeforePeek);

      // Cancelled peek re-hides cleanly without starting active polls.
      act(() => {
        live!.exit(false);
      });
      expect(threadsEl.style.display).toBe('none');
      expect(probe.activePolls).toBe(pollsBeforePeek);

      // 4. Committed back keeps the exact same SpaceThreadsPage instance mounted and activates it.
      threadsEl.scrollTop = 0;
      act(() => {
        live = probe.underLayer?.enterLiveSpaceThreadsPeek() ?? null;
      });
      await act(async () => {
        await router.navigate(threadsUrl);
      });
      act(() => {
        live!.exit(true);
      });
      expect(probe.threadsMounts).toBe(1);
      expect(screen.getByTestId('space-threads-page')).toBe(threadsEl);
      expect(threadsEl.dataset.instance).toBe('1');
      expect(threadsEl.dataset.passive).toBe('false');
      expect(threadsEl.scrollTop).toBe(480);
      expect(threadsLayer.inert).toBe(false);
      expect(probe.activePolls).toBeGreaterThan(pollsBeforePeek);
    } finally {
      router.dispose();
      rectSpy.mockRestore();
    }
  });

  it('unmounts parked SpaceThreadsPage when navigating to Lobby, Search, Room without returnToOrigin, or another Space', async () => {
    const threadsUrl = spacePath(SPACE_A, 'threads/');
    const threadUrl = `${spacePath(SPACE_A, encodeURIComponent(ROOM_1))}/?threadId=%24t1`;
    const returnState = withRoomThreadExitTargetState(undefined, {
      exitPath: threadsUrl,
      roomId: ROOM_1,
      threadId: '$t1',
      useHistoryBack: true,
      returnToOrigin: true,
    });

    const { router } = mountSpaceRouter(threadsUrl, ScreenSize.Mobile);
    try {
      expect(screen.getByTestId('space-threads-page')).toBeDefined();

      // Park in thread returning to Space A.
      await act(async () => {
        await router.navigate(threadUrl, { state: returnState });
      });
      expect(document.querySelector('[data-space-threads-layer]')).not.toBeNull();

      // Navigate to Lobby -> unmounts SpaceThreadsPage.
      await act(async () => {
        await router.navigate(spacePath(SPACE_A, 'lobby/'));
      });
      expect(document.querySelector('[data-space-threads-layer]')).toBeNull();

      // Re-mount on SpaceThreads -> park -> navigate to Search -> unmounts.
      await act(async () => {
        await router.navigate(threadsUrl);
      });
      await act(async () => {
        await router.navigate(threadUrl, { state: returnState });
      });
      expect(document.querySelector('[data-space-threads-layer]')).not.toBeNull();
      await act(async () => {
        await router.navigate(spacePath(SPACE_A, 'search/'));
      });
      expect(document.querySelector('[data-space-threads-layer]')).toBeNull();

      // Re-mount -> navigate to Room WITHOUT returnToOrigin -> unmounts.
      await act(async () => {
        await router.navigate(threadsUrl);
      });
      await act(async () => {
        await router.navigate(`${spacePath(SPACE_A, encodeURIComponent(ROOM_1))}/?threadId=%24t2`);
      });
      expect(document.querySelector('[data-space-threads-layer]')).toBeNull();

      // Re-mount -> park -> switch to Space B -> unmounts Space A's threads.
      await act(async () => {
        await router.navigate(threadsUrl);
      });
      await act(async () => {
        await router.navigate(threadUrl, { state: returnState });
      });
      expect(document.querySelector('[data-space-threads-layer]')).not.toBeNull();
      probe.spaceId = SPACE_B;
      await act(async () => {
        await router.navigate(`${spacePath(SPACE_B, encodeURIComponent(ROOM_1))}/?threadId=%24t3`);
      });
      expect(document.querySelector('[data-space-threads-layer]')).toBeNull();
    } finally {
      router.dispose();
    }
  });

  it('cold-reload directly inside a thread with returnToOrigin does not mount SpaceThreadsPage eagerly and returns null from enterLiveSpaceThreadsPeek', () => {
    const threadsUrl = spacePath(SPACE_A, 'threads/');
    const threadEntry = {
      pathname: `${spacePath(SPACE_A, encodeURIComponent(ROOM_1))}/`,
      search: '?threadId=%24t1',
      state: withRoomThreadExitTargetState(undefined, {
        exitPath: threadsUrl,
        roomId: ROOM_1,
        threadId: '$t1',
        useHistoryBack: true,
        returnToOrigin: true,
      }),
    };

    const { router } = mountSpaceRouter(threadEntry, ScreenSize.Mobile);
    try {
      expect(probe.threadsMounts).toBe(0);
      expect(document.querySelector('[data-space-threads-layer]')).toBeNull();
      expect(probe.underLayer?.hasWarmSpaceThreads()).toBe(false);
      expect(probe.underLayer?.enterLiveSpaceThreadsPeek()).toBeNull();
    } finally {
      router.dispose();
    }
  });

  it('keeps the same Outlet instance mounted across phone <-> desktop rotation without losing thread state', () => {
    const threadsUrl = spacePath(SPACE_A, 'threads/');
    const threadEntry = {
      pathname: `${spacePath(SPACE_A, encodeURIComponent(ROOM_1))}/`,
      search: '?threadId=%24t1',
      state: withRoomThreadExitTargetState(undefined, {
        exitPath: threadsUrl,
        roomId: ROOM_1,
        threadId: '$t1',
        useHistoryBack: true,
        returnToOrigin: true,
      }),
    };
    const { router, rendered } = mountSpaceRouter(threadEntry, ScreenSize.Mobile);
    try {
      expect(probe.outletMounts).toBe(1);
      expect(screen.getByTestId('room-thread-page')).toBeTruthy();

      rendered.rerender(
        <MatrixClientProvider value={mx}>
          <ScreenSizeProvider value={ScreenSize.Desktop}>
            <div>
              <RouterProvider router={router} />
            </div>
          </ScreenSizeProvider>
        </MatrixClientProvider>
      );
      expect(probe.outletMounts).toBe(1);
      expect(screen.getByTestId('room-thread-page')).toBeTruthy();

      rendered.rerender(
        <MatrixClientProvider value={mx}>
          <ScreenSizeProvider value={ScreenSize.Mobile}>
            <div {...{ [PHONE_STAGE]: '' }}>
              <RouterProvider router={router} />
            </div>
          </ScreenSizeProvider>
        </MatrixClientProvider>
      );
      expect(probe.outletMounts).toBe(1);
    } finally {
      router.dispose();
    }
  });

  it('unmounts parked SpaceThreadsPage when navigating directly from Thread A to Thread B without returnToOrigin and hides Activity before clearing cancel markers', async () => {
    const threadsUrl = spacePath(SPACE_A, 'threads/');
    const threadAUrl = `${spacePath(SPACE_A, encodeURIComponent(ROOM_1))}/?threadId=%24t1`;
    const threadBUrl = `${spacePath(SPACE_A, encodeURIComponent(ROOM_1))}/?threadId=%24t2`;
    const returnState = withRoomThreadExitTargetState(undefined, {
      exitPath: threadsUrl,
      roomId: ROOM_1,
      threadId: '$t1',
      useHistoryBack: true,
      returnToOrigin: true,
    });

    const { router } = mountSpaceRouter(threadsUrl, ScreenSize.Mobile);
    try {
      await act(async () => {
        await router.navigate(threadAUrl, { state: returnState });
      });
      expect(document.querySelector('[data-space-threads-layer]')).not.toBeNull();

      // Cancelled back-peek hides Activity synchronously WHILE stage/under markers are still set.
      let peek: LiveThreadBackUnder | null = null;
      act(() => {
        peek = probe.underLayer?.enterLiveSpaceThreadsPeek() ?? null;
      });
      expect(peek).not.toBeNull();
      probe.stageHadMarkerOnHide = [];
      act(() => {
        peek!.exit(false);
      });
      expect(probe.stageHadMarkerOnHide).toEqual([true]);
      expect(peek!.stage.hasAttribute(SWIPE_THREAD_STAGE)).toBe(false);
      expect(peek!.under.hasAttribute(SWIPE_UNDER_THREAD)).toBe(false);

      // Direct navigation from Thread A -> Thread B without returnToOrigin (e.g. Universal Link)
      // unmounts SpaceThreadsPage instead of retaining Thread A's parked list.
      await act(async () => {
        await router.navigate(threadBUrl);
      });
      expect(document.querySelector('[data-space-threads-layer]')).toBeNull();
      expect(probe.underLayer?.hasWarmSpaceThreads()).toBe(false);
    } finally {
      router.dispose();
    }
  });
});
