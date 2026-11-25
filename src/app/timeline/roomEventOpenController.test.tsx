// @vitest-environment jsdom
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRoomEventOpenController } from './roomEventOpenController';

type ControllerOptions = Parameters<typeof useRoomEventOpenController>[0];

describe('useRoomEventOpenController thread scrub options', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  const mount = (mountedTarget: HTMLElement | null) => {
    const scrollEl = document.createElement('div');
    if (mountedTarget) scrollEl.appendChild(mountedTarget);
    const setFocusItem = vi.fn();
    const scrollToElement = vi.fn(() => true);
    const scrollThreadEventIntoView = vi.fn(() => true);
    let controller!: ReturnType<typeof useRoomEventOpenController>;

    function Probe() {
      controller = useRoomEventOpenController({
        alive: () => true,
        effectiveViewMode: 'compact',
        hideMembershipEvents: false,
        hideNickAvatarEvents: false,
        ignoredUsersSet: new Set(),
        mx: {},
        room: { roomId: '!room:example.org', findEventById: () => undefined },
        roomThreadListThreads: [],
        overviewThreadRootIds: [],
        scrollRef: { current: scrollEl },
        scrollThreadEventIntoView,
        scrollToElement,
        scrollToItem: vi.fn(() => true),
        setFocusItem,
        setTimeline: vi.fn(),
        threadEventIndexMapRef: { current: new Map([['$m1', 1]]) },
        threadFilteredEvents: [],
        threadId: '$root',
      } as unknown as ControllerOptions);
      return null;
    }

    act(() => {
      renderer = create(createElement(Probe));
    });
    return { controller, scrollEl, setFocusItem, scrollToElement, scrollThreadEventIntoView };
  };

  it('applies instant, stopInView: false, and updateFocus: false for mounted and virtualized thread targets', async () => {
    const mounted = document.createElement('div');
    mounted.setAttribute('data-message-id', '$m1');
    const { controller, setFocusItem, scrollToElement } = mount(mounted);

    await act(() =>
      controller.handleOpenEvent('$m1', false, undefined, {
        behavior: 'instant',
        stopInView: false,
        updateFocus: false,
      })
    );
    expect(setFocusItem).not.toHaveBeenCalled();
    expect(scrollToElement).toHaveBeenCalledWith(mounted, {
      behavior: 'instant',
      align: 'center',
      stopInView: false,
    });

    // Default options still update focus and scroll smoothly with stopInView: true.
    await act(() => controller.handleOpenEvent('$m1', false));
    expect(setFocusItem).toHaveBeenCalledWith({
      eventId: '$m1',
      index: 1,
      scrollTo: false,
      highlight: false,
    });
    expect(scrollToElement).toHaveBeenLastCalledWith(mounted, {
      behavior: 'smooth',
      align: 'center',
      stopInView: true,
    });

    act(() => renderer?.unmount());
    renderer = undefined;

    // Virtualized retry target also forwards scrub options without touching focus.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    const retry = mount(null);
    await act(() =>
      retry.controller.handleOpenEvent('$m1', false, undefined, {
        behavior: 'instant',
        stopInView: false,
        updateFocus: false,
      })
    );
    expect(retry.setFocusItem).not.toHaveBeenCalled();
    expect(retry.scrollThreadEventIntoView).toHaveBeenCalledWith('$m1');

    const laterTarget = document.createElement('div');
    laterTarget.setAttribute('data-message-id', '$m1');
    retry.scrollEl.appendChild(laterTarget);
    act(() => {
      frames.shift()?.(0);
    });
    expect(retry.scrollToElement).toHaveBeenCalledWith(laterTarget, {
      behavior: 'instant',
      align: 'center',
      stopInView: false,
    });
  });
});
