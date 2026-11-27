// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  animateSwipeElements,
  type InteractiveSwipeBegin,
  type InteractiveSwipeScene,
  isReducedMotion,
  resolveLogicalDirectionSign,
  SWIPE_PRIORITY,
  useInteractiveSwipe,
} from './interactiveSwipe';
import { completeLiveSlideHandoff, createLiveBackSwipeScene, PHONE_STAGE } from './phonePageSlide';

type Point = { clientX: number; clientY: number; identifier?: number };

const createTouchEvent = (
  type: string,
  points: Point[],
  timeStamp?: number,
  changedTouches?: Point[]
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: points });
  if (changedTouches !== undefined) {
    Object.defineProperty(event, 'changedTouches', { value: changedTouches });
  }
  if (timeStamp !== undefined) {
    // Keep timestamps strictly positive so getEventTimeMs does not fall back to performance.now().
    Object.defineProperty(event, 'timeStamp', { value: timeStamp + 1000 });
  }
  return event;
};

const flushMicrotasks = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const createMockScene = (extent = 400) => {
  let resolveSettle: (() => void) | null = null;
  let deferred = false;
  const update = vi.fn();
  const commit = vi.fn();
  const cleanupSpy = vi.fn();
  const settle = vi.fn((_commit: boolean, _durationMs: number, _offset: number) => {
    if (!deferred) return Promise.resolve();
    return new Promise<void>((resolve) => {
      resolveSettle = resolve;
    });
  });

  const scene: InteractiveSwipeScene = {
    extent,
    update,
    settle,
    commit,
    cleanup: cleanupSpy,
  };

  return {
    scene,
    update,
    settle,
    commit,
    cleanup: cleanupSpy,
    deferSettle: () => {
      deferred = true;
    },
    finishSettle: async () => {
      resolveSettle?.();
      resolveSettle = null;
      await flushMicrotasks();
    },
  };
};

describe('interactiveSwipe', () => {
  const originalMatchMedia = window.matchMedia;
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    document.documentElement.removeAttribute('dir');
    document.documentElement.style.direction = '';
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    document.documentElement.removeAttribute('dir');
    document.documentElement.style.direction = '';
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia,
    });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('priority arbitration and blocking', () => {
    function EdgeLayer({
      priority,
      onCommit,
      enabled = true,
      edge = 'start',
    }: {
      priority: number;
      onCommit: () => void;
      enabled?: boolean;
      edge?: 'start' | 'end';
    }) {
      useInteractiveSwipe({
        zone: 'edge',
        edge,
        direction: 'inward',
        priority,
        enabled,
        onCommit,
      });
      return null;
    }

    it('arbitrates strictly by priority tier (OVERLAY > SHEET > PANEL_INNER > PANEL > PAGE > DRAWER_OPEN)', () => {
      const drawer = vi.fn();
      const page = vi.fn();
      const panel = vi.fn();
      const panelInner = vi.fn();

      const { rerender } = render(
        <>
          <EdgeLayer priority={SWIPE_PRIORITY.DRAWER_OPEN} onCommit={drawer} />
          <EdgeLayer priority={SWIPE_PRIORITY.PAGE} onCommit={page} />
          <EdgeLayer priority={SWIPE_PRIORITY.PANEL} onCommit={panel} />
          <EdgeLayer priority={SWIPE_PRIORITY.PANEL_INNER} onCommit={panelInner} />
        </>
      );

      const swipeRight = () => {
        act(() => {
          window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 10));
          window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 120, clientY: 200 }], 40));
          window.dispatchEvent(createTouchEvent('touchend', [], 60));
        });
      };

      swipeRight();
      expect(panelInner).toHaveBeenCalledOnce();
      expect(panel).not.toHaveBeenCalled();
      expect(page).not.toHaveBeenCalled();
      expect(drawer).not.toHaveBeenCalled();

      // Disable PANEL_INNER -> PANEL takes over
      rerender(
        <>
          <EdgeLayer priority={SWIPE_PRIORITY.DRAWER_OPEN} onCommit={drawer} />
          <EdgeLayer priority={SWIPE_PRIORITY.PAGE} onCommit={page} />
          <EdgeLayer priority={SWIPE_PRIORITY.PANEL} onCommit={panel} />
          <EdgeLayer priority={SWIPE_PRIORITY.PANEL_INNER} onCommit={panelInner} enabled={false} />
        </>
      );
      swipeRight();
      expect(panel).toHaveBeenCalledOnce();
      expect(page).not.toHaveBeenCalled();
      expect(drawer).not.toHaveBeenCalled();
    });

    it('prefers later-mounted registration within the same priority tier even after enabled toggles', () => {
      const first = vi.fn();
      const second = vi.fn();

      const { rerender } = render(
        <>
          <EdgeLayer priority={SWIPE_PRIORITY.PAGE} onCommit={first} />
          <EdgeLayer priority={SWIPE_PRIORITY.PAGE} onCommit={second} />
        </>
      );

      // Toggle first off then back on: stable registration id preserves original mount order
      rerender(
        <>
          <EdgeLayer priority={SWIPE_PRIORITY.PAGE} onCommit={first} enabled={false} />
          <EdgeLayer priority={SWIPE_PRIORITY.PAGE} onCommit={second} />
        </>
      );
      rerender(
        <>
          <EdgeLayer priority={SWIPE_PRIORITY.PAGE} onCommit={first} enabled />
          <EdgeLayer priority={SWIPE_PRIORITY.PAGE} onCommit={second} />
        </>
      );

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 10));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 120, clientY: 200 }], 40));
        window.dispatchEvent(createTouchEvent('touchend', [], 60));
      });

      expect(second).toHaveBeenCalledOnce();
      expect(first).not.toHaveBeenCalled();
    });

    it('never leaks a blocked OVERLAY touch to lower-priority layers', () => {
      const overlayCommit = vi.fn();
      const pageCommit = vi.fn();
      const pageForwardCommit = vi.fn();

      function OverlayAndPage() {
        const viewerRef = useRef<HTMLDivElement>(null);
        useInteractiveSwipe({
          zone: 'edge',
          edge: 'start',
          direction: 'inward',
          priority: SWIPE_PRIORITY.OVERLAY,
          enabled: true,
          within: viewerRef,
          onCommit: overlayCommit,
        });
        useInteractiveSwipe({
          zone: 'edge',
          edge: 'start',
          direction: 'inward',
          priority: SWIPE_PRIORITY.PAGE,
          enabled: true,
          onCommit: pageCommit,
        });
        useInteractiveSwipe({
          zone: 'edge',
          edge: 'end',
          direction: 'inward',
          priority: SWIPE_PRIORITY.PAGE,
          enabled: true,
          onCommit: pageForwardCommit,
        });
        return (
          <>
            <div ref={viewerRef} data-testid="viewer" />
            <div data-testid="outside" />
          </>
        );
      }

      render(<OverlayAndPage />);

      // Touch outside viewer at start edge: blocked for OVERLAY and must NOT leak to PAGE
      const outside = screen.getByTestId('outside');
      act(() => {
        outside.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 10));
        outside.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 120, clientY: 200 }], 40));
        outside.dispatchEvent(createTouchEvent('touchend', [], 60));
      });
      expect(overlayCommit).not.toHaveBeenCalled();
      expect(pageCommit).not.toHaveBeenCalled();

      // Touch inside viewer at end edge: must NOT leak to PAGE forward
      const viewer = screen.getByTestId('viewer');
      act(() => {
        viewer.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 392, clientY: 200 }], 100));
        viewer.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 280, clientY: 200 }], 140));
        viewer.dispatchEvent(createTouchEvent('touchend', [], 160));
      });
      expect(pageForwardCommit).not.toHaveBeenCalled();

      // Touch inside viewer at start edge: OVERLAY handles it
      act(() => {
        viewer.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 200));
        viewer.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 120, clientY: 200 }], 240));
        viewer.dispatchEvent(createTouchEvent('touchend', [], 260));
      });
      expect(overlayCommit).toHaveBeenCalledOnce();
      expect(pageCommit).not.toHaveBeenCalled();
    });

    it('prevents a SHEET element touch from falling through to a lower-priority edge swipe', () => {
      const sheetCommit = vi.fn();
      const pageCommit = vi.fn();

      function SheetOverPage() {
        const panelRef = useRef<HTMLDivElement>(null);
        useInteractiveSwipe({
          zone: 'element',
          edge: 'start',
          direction: 'toward-edge',
          priority: SWIPE_PRIORITY.SHEET,
          enabled: true,
          elementRef: panelRef,
          cancelCommits: true,
          onCommit: sheetCommit,
        });
        useInteractiveSwipe({
          zone: 'edge',
          edge: 'start',
          direction: 'inward',
          priority: SWIPE_PRIORITY.PAGE,
          enabled: true,
          onCommit: pageCommit,
        });
        return (
          <div ref={panelRef} data-testid="sheet">
            <span data-testid="item">item</span>
          </div>
        );
      }

      render(<SheetOverPage />);
      const item = screen.getByTestId('item');

      // Swipe rightward from x=10 inside the sheet (wrong direction for closing start-edge sheet):
      // SHEET claims the touchstart so PAGE never triggers!
      act(() => {
        item.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 10));
        item.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 140, clientY: 200 }], 40));
        item.dispatchEvent(createTouchEvent('touchend', [], 60));
      });

      expect(sheetCommit).not.toHaveBeenCalled();
      expect(pageCommit).not.toHaveBeenCalled();
    });
  });

  describe('interactive scene lifecycle', () => {
    function InteractiveEdge({
      begin,
      onCommit,
      edge = 'start',
    }: {
      begin?: InteractiveSwipeBegin;
      onCommit: () => void;
      edge?: 'start' | 'end';
    }) {
      useInteractiveSwipe({
        zone: 'edge',
        edge,
        direction: 'inward',
        priority: SWIPE_PRIORITY.PAGE,
        enabled: true,
        onCommit,
        begin,
      });
      return (
        <button data-testid="card" type="button">
          Card
        </button>
      );
    }

    it('does not invoke begin() on vertical scroll and yields cleanly', () => {
      const begin = vi.fn();
      const onCommit = vi.fn();
      render(<InteractiveEdge begin={begin} onCommit={onCommit} />);

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 10));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 14, clientY: 230 }], 30));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 200, clientY: 230 }], 60));
        window.dispatchEvent(createTouchEvent('touchend', [], 80));
      });

      expect(begin).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('coalesces touchmoves via rAF, flushes on touchend, settles, then commits and cleans up', async () => {
      vi.useFakeTimers();
      const mock = createMockScene(400);
      mock.deferSettle();
      const begin = vi.fn(() => mock.scene);
      const onCommit = vi.fn();

      render(<InteractiveEdge begin={begin} onCommit={onCommit} />);

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 0));
        // Lock move + two more moves within one animation frame
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 20, clientY: 200 }], 10));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 200 }], 20));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 200, clientY: 200 }], 30));
      });

      expect(begin).toHaveBeenCalledOnce();
      expect(mock.update).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(mock.update).toHaveBeenCalledTimes(1);
      expect(mock.update).toHaveBeenLastCalledWith(180, 180 / 400);

      // Final move + immediate lift before next rAF -> flushed synchronously before settle
      act(() => {
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 220, clientY: 200 }], 50));
        window.dispatchEvent(createTouchEvent('touchend', [], 60));
      });

      expect(mock.update).toHaveBeenCalledTimes(2);
      expect(mock.update).toHaveBeenLastCalledWith(200, 0.5);
      expect(mock.settle).toHaveBeenCalledOnce();
      expect(mock.settle.mock.calls[0]?.[0]).toBe(true);
      expect(mock.commit).not.toHaveBeenCalled();
      expect(mock.cleanup).not.toHaveBeenCalled();

      // Active-settle guard: a new touchstart while settling must be ignored
      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 70));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 150, clientY: 200 }], 80));
      });
      expect(begin).toHaveBeenCalledOnce();

      await mock.finishSettle();
      expect(mock.commit).toHaveBeenCalledOnce();
      expect(mock.cleanup).toHaveBeenCalledWith(true);
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('cancels below commit threshold without calling commit()', async () => {
      const mock = createMockScene(400);
      render(<InteractiveEdge begin={() => mock.scene} onCommit={vi.fn()} />);

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 0));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 20, clientY: 200 }], 20));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 200 }], 500));
        window.dispatchEvent(createTouchEvent('touchend', [], 520));
      });

      await flushMicrotasks();
      expect(mock.settle).toHaveBeenCalledWith(false, expect.any(Number), 80);
      expect(mock.commit).not.toHaveBeenCalled();
      expect(mock.cleanup).toHaveBeenCalledWith(false);
    });

    it('cancels a fast sub-threshold flick after holding still for 250ms before touchend', async () => {
      const mock = createMockScene(400);
      render(<InteractiveEdge begin={() => mock.scene} onCommit={vi.fn()} />);

      act(() => {
        // Fast 60px move in 50ms on a 400px screen (lock at x=20, offset 60 < 35%).
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 100));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 20, clientY: 200 }], 110));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 80, clientY: 200 }], 150));
        // Hold still for 250ms before lifting -> stale flick velocity decays to 0.
        window.dispatchEvent(createTouchEvent('touchend', [], 400));
      });

      await flushMicrotasks();
      expect(mock.settle).toHaveBeenCalledWith(false, expect.any(Number), 60);
      expect(mock.commit).not.toHaveBeenCalled();
      expect(mock.cleanup).toHaveBeenCalledWith(false);
    });

    it('suppresses one stray click immediately after a locked drag and restores clicks next tick', () => {
      vi.useFakeTimers();
      const onClick = vi.fn();
      const mock = createMockScene(400);

      render(
        <div>
          <InteractiveEdge begin={() => mock.scene} onCommit={vi.fn()} />
          <button data-testid="btn" type="button" onClick={onClick}>
            Click
          </button>
        </div>
      );

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 0));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 90, clientY: 200 }], 200));
        window.dispatchEvent(createTouchEvent('touchend', [], 220));
      });

      const btn = screen.getByTestId('btn');
      act(() => {
        btn.click();
      });
      expect(onClick).not.toHaveBeenCalled();

      // Next click works (suppressor was one-shot)
      act(() => {
        vi.advanceTimersByTime(10);
        btn.click();
      });
      expect(onClick).toHaveBeenCalledOnce();
    });
  });

  describe('RTL and reduced motion', () => {
    it('mirrors logical start/end edges in RTL', () => {
      document.documentElement.dir = 'rtl';
      expect(resolveLogicalDirectionSign()).toBe(-1);

      const startBegin = vi.fn(() => null);
      const startCommit = vi.fn();
      const endCommit = vi.fn();

      function RtlHarness() {
        useInteractiveSwipe({
          zone: 'edge',
          edge: 'start',
          direction: 'inward',
          priority: SWIPE_PRIORITY.PAGE,
          enabled: true,
          onCommit: startCommit,
          begin: startBegin,
        });
        useInteractiveSwipe({
          zone: 'edge',
          edge: 'end',
          direction: 'inward',
          priority: SWIPE_PRIORITY.PAGE,
          enabled: true,
          onCommit: endCommit,
        });
        return null;
      }

      render(<RtlHarness />);

      // Start edge in RTL is physical RIGHT, swiping LEFT
      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 390, clientY: 200 }], 0));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 290, clientY: 200 }], 50));
        window.dispatchEvent(createTouchEvent('touchend', [], 70));
      });
      expect(startBegin).toHaveBeenCalledWith({ axisSign: -1, dirSign: -1 });
      expect(startCommit).toHaveBeenCalledOnce();
      expect(endCommit).not.toHaveBeenCalled();

      // End edge in RTL is physical LEFT, swiping RIGHT
      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 100));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 110, clientY: 200 }], 150));
        window.dispatchEvent(createTouchEvent('touchend', [], 170));
      });
      expect(endCommit).toHaveBeenCalledOnce();
    });

    it('skips interactive begin() and uses discrete threshold under prefers-reduced-motion', () => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: vi.fn().mockReturnValue({ matches: true }),
      });
      expect(isReducedMotion()).toBe(true);

      const begin = vi.fn();
      const onCommit = vi.fn();

      function ReducedHarness() {
        useInteractiveSwipe({
          zone: 'edge',
          edge: 'start',
          direction: 'inward',
          priority: SWIPE_PRIORITY.PAGE,
          enabled: true,
          onCommit,
          begin,
        });
        return null;
      }

      render(<ReducedHarness />);

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 0));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 200 }], 50));
        window.dispatchEvent(createTouchEvent('touchend', [], 70));
      });

      expect(begin).not.toHaveBeenCalled();
      expect(onCommit).toHaveBeenCalledOnce();
    });
  });

  describe('interruptions and abort safety', () => {
    function AbortHarness({
      scene,
      zone = 'edge',
      cancelCommits = false,
    }: {
      scene: InteractiveSwipeScene;
      zone?: 'edge' | 'element';
      cancelCommits?: boolean;
    }) {
      const ref = useRef<HTMLDivElement>(null);
      useInteractiveSwipe({
        zone,
        edge: 'start',
        direction: zone === 'edge' ? 'inward' : 'toward-edge',
        priority: zone === 'edge' ? SWIPE_PRIORITY.PAGE : SWIPE_PRIORITY.SHEET,
        enabled: true,
        elementRef: zone === 'element' ? ref : undefined,
        cancelCommits,
        onCommit: vi.fn(),
        begin: () => scene,
      });
      return <div ref={ref} data-testid="panel" />;
    }

    it('aborts immediately and cleans up when a dialog opens mid-drag', () => {
      const mock = createMockScene(400);
      render(<AbortHarness scene={mock.scene} />);

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 0));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 120, clientY: 200 }], 20));
      });

      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      document.body.append(dialog);

      act(() => {
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 200, clientY: 200 }], 40));
        window.dispatchEvent(createTouchEvent('touchend', [], 60));
      });

      expect(mock.cleanup).toHaveBeenCalledWith(false);
      expect(mock.commit).not.toHaveBeenCalled();
    });

    it('aborts immediately when a second finger touches down mid-drag', () => {
      const mock = createMockScene(400);
      render(<AbortHarness scene={mock.scene} />);

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 0));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 120, clientY: 200 }], 20));
        window.dispatchEvent(
          createTouchEvent(
            'touchstart',
            [
              { clientX: 120, clientY: 200 },
              { clientX: 250, clientY: 300 },
            ],
            30
          )
        );
      });

      expect(mock.cleanup).toHaveBeenCalledWith(false);
      expect(mock.commit).not.toHaveBeenCalled();
    });

    it('aborts mid-drag and mid-settle on resize and unmount without committing', async () => {
      const mock1 = createMockScene(400);
      mock1.deferSettle();
      const view = render(<AbortHarness scene={mock1.scene} />);

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 0));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 260, clientY: 200 }], 40));
        window.dispatchEvent(createTouchEvent('touchend', [], 60));
      });

      // Resize mid-settle must clean up and suppress commit when settle later resolves
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(mock1.cleanup).toHaveBeenCalledWith(false);
      await mock1.finishSettle();
      expect(mock1.commit).not.toHaveBeenCalled();

      // Unmount mid-drag must clean up
      const mock2 = createMockScene(400);
      view.rerender(<AbortHarness scene={mock2.scene} />);
      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 100));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 120, clientY: 200 }], 120));
      });
      view.unmount();
      expect(mock2.cleanup).toHaveBeenCalledWith(false);
    });

    it('cancels commit and runs cleanup(false) if a higher dialog opens while settle(true) is pending', async () => {
      const mock = createMockScene(400);
      mock.deferSettle();

      function OverlayHarness() {
        const dialogRef = useRef<HTMLDivElement>(null);
        useInteractiveSwipe({
          zone: 'edge',
          edge: 'start',
          direction: 'inward',
          priority: SWIPE_PRIORITY.OVERLAY,
          enabled: true,
          within: dialogRef,
          onCommit: vi.fn(),
          begin: () => mock.scene,
        });
        return <div ref={dialogRef} role="dialog" data-testid="viewer-dialog" />;
      }

      render(<OverlayHarness />);
      const viewer = screen.getByTestId('viewer-dialog');

      act(() => {
        viewer.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 100));
        viewer.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 240, clientY: 200 }], 150));
        viewer.dispatchEvent(createTouchEvent('touchend', [], 170));
      });

      expect(mock.settle).toHaveBeenCalledWith(true, expect.any(Number), 220);
      expect(mock.commit).not.toHaveBeenCalled();

      // A higher dialog opens over the viewer while settle(true) is still animating.
      const higherDialog = document.createElement('div');
      higherDialog.setAttribute('role', 'dialog');
      document.body.append(higherDialog);

      await mock.finishSettle();
      expect(mock.commit).not.toHaveBeenCalled();
      expect(mock.cleanup).toHaveBeenCalledWith(false);
      higherDialog.remove();
    });

    it('aborts a pending settle(true) when two fingers touch down before it ends', async () => {
      const mock = createMockScene(400);
      mock.deferSettle();
      render(<AbortHarness scene={mock.scene} />);

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 0));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 260, clientY: 200 }], 40));
        window.dispatchEvent(createTouchEvent('touchend', [], 60));
      });
      expect(mock.settle).toHaveBeenCalledWith(true, expect.any(Number), expect.any(Number));

      // One finger alone leaves the settle be.
      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 200, clientY: 300 }], 70));
      });
      expect(mock.cleanup).not.toHaveBeenCalled();

      act(() => {
        window.dispatchEvent(
          createTouchEvent(
            'touchstart',
            [
              { clientX: 200, clientY: 300 },
              { clientX: 250, clientY: 320 },
            ],
            80
          )
        );
      });
      expect(mock.cleanup).toHaveBeenCalledTimes(1);
      expect(mock.cleanup).toHaveBeenCalledWith(false);

      await mock.finishSettle();
      expect(mock.commit).not.toHaveBeenCalled();
      expect(mock.cleanup).toHaveBeenCalledTimes(1);
    });

    it('aborts a pending settle(true) at once when a dialog opens, though it closes again before the settle ends', async () => {
      const mock = createMockScene(400);
      mock.deferSettle();
      render(<AbortHarness scene={mock.scene} />);

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 0));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 260, clientY: 200 }], 40));
        window.dispatchEvent(createTouchEvent('touchend', [], 60));
      });
      expect(mock.settle).toHaveBeenCalledWith(true, expect.any(Number), expect.any(Number));
      expect(mock.cleanup).not.toHaveBeenCalled();

      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      document.body.append(dialog);
      await flushMicrotasks();
      expect(mock.cleanup).toHaveBeenCalledTimes(1);
      expect(mock.cleanup).toHaveBeenCalledWith(false);

      // Gone again by the time the settle ends: nothing blocks then, and still nothing commits.
      dialog.remove();
      await mock.finishSettle();
      expect(mock.commit).not.toHaveBeenCalled();
      expect(mock.cleanup).toHaveBeenCalledTimes(1);
    });

    it('aborts a drag at once when the touched node leaves the document, with no further touch', async () => {
      const mock = createMockScene(400);
      render(<AbortHarness scene={mock.scene} />);
      // A row of the page, as a timeline's: not React's, so the test can take it away.
      const row = document.createElement('div');
      screen.getByTestId('panel').append(row);

      act(() => {
        row.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 0));
        row.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 120, clientY: 200 }], 20));
      });
      expect(mock.cleanup).not.toHaveBeenCalled();

      // Its touchmove and touchend would no longer reach the window.
      row.remove();
      await flushMicrotasks();

      expect(mock.cleanup).toHaveBeenCalledTimes(1);
      expect(mock.cleanup).toHaveBeenCalledWith(false);
      expect(mock.settle).not.toHaveBeenCalled();
      expect(mock.commit).not.toHaveBeenCalled();
    });

    it('resets edge swipe on touchcancel, but evaluates commit on element swipe with cancelCommits', async () => {
      const edgeMock = createMockScene(400);
      const { unmount } = render(<AbortHarness scene={edgeMock.scene} zone="edge" />);

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 0));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 260, clientY: 200 }], 40));
        window.dispatchEvent(createTouchEvent('touchcancel', [], 60));
      });
      await flushMicrotasks();
      expect(edgeMock.commit).not.toHaveBeenCalled();
      expect(edgeMock.cleanup).toHaveBeenCalledWith(false);
      unmount();

      const elMock = createMockScene(300);
      render(<AbortHarness scene={elMock.scene} zone="element" cancelCommits />);
      const panel = screen.getByTestId('panel');
      act(() => {
        panel.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 260, clientY: 200 }], 0));
        panel.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 80, clientY: 200 }], 40));
        panel.dispatchEvent(createTouchEvent('touchcancel', [], 60));
      });
      await flushMicrotasks();
      expect(elMock.commit).toHaveBeenCalledOnce();
      expect(elMock.cleanup).toHaveBeenCalledWith(true);
    });

    it('recovers from a dropped drag without touchend when a new 1-finger touchstart arrives', async () => {
      const staleMock = createMockScene(400);
      const freshMock = createMockScene(400);
      let callIndex = 0;

      function RecoverHarness() {
        useInteractiveSwipe({
          zone: 'edge',
          edge: 'start',
          direction: 'inward',
          priority: SWIPE_PRIORITY.PAGE,
          enabled: true,
          onCommit: vi.fn(),
          begin: () => {
            callIndex += 1;
            return callIndex === 1 ? staleMock.scene : freshMock.scene;
          },
        });
        return null;
      }

      render(<RecoverHarness />);

      // Start first drag and drop it with no touchend/touchcancel (simulates target removed mid-drag)
      act(() => {
        window.dispatchEvent(
          createTouchEvent('touchstart', [{ clientX: 10, clientY: 200, identifier: 1 }], 0)
        );
        window.dispatchEvent(
          createTouchEvent('touchmove', [{ clientX: 140, clientY: 200, identifier: 1 }], 30)
        );
      });
      expect(staleMock.cleanup).not.toHaveBeenCalled();

      // New 1-finger drag must clean up the stale gesture and arbitrate + commit cleanly
      act(() => {
        window.dispatchEvent(
          createTouchEvent('touchstart', [{ clientX: 10, clientY: 200, identifier: 2 }], 100)
        );
        window.dispatchEvent(
          createTouchEvent('touchmove', [{ clientX: 260, clientY: 200, identifier: 2 }], 140)
        );
        window.dispatchEvent(
          createTouchEvent('touchend', [], 160, [{ clientX: 260, clientY: 200, identifier: 2 }])
        );
      });

      await flushMicrotasks();
      expect(staleMock.cleanup).toHaveBeenCalledWith(false);
      expect(staleMock.commit).not.toHaveBeenCalled();
      expect(freshMock.commit).toHaveBeenCalledOnce();
      expect(freshMock.cleanup).toHaveBeenCalledWith(true);
    });

    it('ignores touchend for a different touch identifier', async () => {
      const mock = createMockScene(400);
      render(<AbortHarness scene={mock.scene} />);

      act(() => {
        window.dispatchEvent(
          createTouchEvent('touchstart', [{ clientX: 10, clientY: 200, identifier: 7 }], 0)
        );
        window.dispatchEvent(
          createTouchEvent('touchmove', [{ clientX: 240, clientY: 200, identifier: 7 }], 30)
        );
        // Unrelated finger identifier lifts -> must NOT settle yet
        window.dispatchEvent(
          createTouchEvent('touchend', [{ clientX: 240, clientY: 200, identifier: 7 }], 40, [
            { clientX: 300, clientY: 300, identifier: 99 },
          ])
        );
      });

      expect(mock.settle).not.toHaveBeenCalled();

      act(() => {
        window.dispatchEvent(
          createTouchEvent('touchend', [], 60, [{ clientX: 240, clientY: 200, identifier: 7 }])
        );
      });
      await flushMicrotasks();
      expect(mock.commit).toHaveBeenCalledOnce();
    });

    it('cancels WAAPI animations on mid-settle resize abort and never re-applies finalFrame', async () => {
      const target = document.createElement('div');
      const resolvers: Array<() => void> = [];
      const cancelAnim = vi.fn();
      target.animate = vi.fn().mockImplementation(() => ({
        finished: new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
        cancel: cancelAnim,
      }));

      const commit = vi.fn();
      const cleanupScene = vi.fn(() => {
        target.style.translate = '';
      });
      const scene: InteractiveSwipeScene = {
        extent: 400,
        update: (offsetPx) => {
          target.style.translate = `${offsetPx}px 0`;
        },
        settle: (shouldCommit, durationMs, currentOffsetPx) =>
          animateSwipeElements(
            [
              {
                element: target,
                keyframes: [
                  { translate: `${currentOffsetPx}px 0` },
                  { translate: shouldCommit ? '400px 0' : '0px 0' },
                ],
              },
            ],
            durationMs
          ),
        commit,
        cleanup: cleanupScene,
      };

      render(<AbortHarness scene={scene} />);

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 0));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 260, clientY: 200 }], 40));
        window.dispatchEvent(createTouchEvent('touchend', [], 60));
      });

      expect(target.animate).toHaveBeenCalledOnce();
      expect(cancelAnim).not.toHaveBeenCalled();

      // Abort mid-settle via resize: must cancel WAAPI immediately and clear inline styles
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(cancelAnim).toHaveBeenCalled();
      expect(cleanupScene).toHaveBeenCalledWith(false);
      expect(target.style.translate).toBe('');

      // Even if the animation's finished promise later resolves, finalFrame must NOT be written
      resolvers.forEach((resolve) => resolve());
      await flushMicrotasks();
      expect(target.style.translate).toBe('');
      expect(commit).not.toHaveBeenCalled();
    });

    it('aborts a hung settle via watchdog timeout and catches settle rejections cleanly', async () => {
      vi.useFakeTimers();
      const hungCleanup = vi.fn();
      const hungCommit = vi.fn();
      const hungScene: InteractiveSwipeScene = {
        extent: 400,
        update: vi.fn(),
        settle: () => new Promise<void>(() => undefined),
        commit: hungCommit,
        cleanup: hungCleanup,
      };

      const view = render(<AbortHarness scene={hungScene} />);

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 0));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 260, clientY: 200 }], 40));
        window.dispatchEvent(createTouchEvent('touchend', [], 60));
      });

      expect(hungCleanup).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(hungCleanup).toHaveBeenCalledWith(false);
      expect(hungCommit).not.toHaveBeenCalled();

      // Subsequent drag works after watchdog recovery, and rejected settle cleans up cleanly
      const rejectCleanup = vi.fn();
      const rejectCommit = vi.fn();
      const rejectScene: InteractiveSwipeScene = {
        extent: 400,
        update: vi.fn(),
        settle: () => Promise.reject(new Error('settle failed')),
        commit: rejectCommit,
        cleanup: rejectCleanup,
      };
      view.rerender(<AbortHarness scene={rejectScene} />);

      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 200));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 260, clientY: 200 }], 240));
        window.dispatchEvent(createTouchEvent('touchend', [], 260));
      });
      await flushMicrotasks();
      expect(rejectCommit).not.toHaveBeenCalled();
      expect(rejectCleanup).toHaveBeenCalledWith(false);
    });
  });

  describe('animateSwipeElements', () => {
    it('runs WAAPI with forwards fill, applies final styles, and cancels cleanly', async () => {
      const el = document.createElement('div');
      const cancel = vi.fn();
      const animate = vi.fn().mockReturnValue({
        finished: Promise.resolve(),
        cancel,
      });
      el.animate = animate;

      await animateSwipeElements(
        [{ element: el, keyframes: [{ translate: '100px 0' }, { translate: '390px 0' }] }],
        180
      );

      expect(animate).toHaveBeenCalledWith([{ translate: '100px 0' }, { translate: '390px 0' }], {
        duration: 180,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
        fill: 'forwards',
      });
      expect(el.style.translate).toBe('390px');
      expect(cancel).toHaveBeenCalledOnce();
    });

    it('handles aborted WAAPI animations without unhandled rejections', async () => {
      const el = document.createElement('div');
      const cancel = vi.fn();
      el.animate = vi.fn().mockReturnValue({
        finished: Promise.reject(new Error('aborted')),
        cancel,
      });

      await expect(
        animateSwipeElements(
          [{ element: el, keyframes: [{ opacity: '0.5' }, { opacity: '0' }] }],
          150
        )
      ).resolves.toBeUndefined();

      // Aborted/rejected animations must not write finalFrame inline
      expect(el.style.opacity).toBe('');
      expect(cancel).toHaveBeenCalledOnce();
    });

    it('skips WAAPI and applies final style immediately when duration is 0 or reduced motion', async () => {
      const el = document.createElement('div');
      const animate = vi.fn();
      el.animate = animate;

      await animateSwipeElements(
        [{ element: el, keyframes: [{ opacity: '1' }, { opacity: '0' }] }],
        0
      );
      expect(animate).not.toHaveBeenCalled();
      expect(el.style.opacity).toBe('0');
    });
  });

  it('blocks a second edge swipe (including discrete fallback) while interactive phone slide handoff is claimed', async () => {
    const stage = document.createElement('div');
    stage.setAttribute(PHONE_STAGE, '');
    document.body.append(stage);

    const onCommit = vi.fn();
    function Harness() {
      useInteractiveSwipe({
        zone: 'edge',
        edge: 'start',
        direction: 'inward',
        priority: SWIPE_PRIORITY.PAGE,
        enabled: true,
        onCommit,
        // Simulates begin() returning null while playing/claimed.
        begin: () => null,
      });
      return null;
    }

    render(<Harness />);
    const over = document.createElement('div');
    const under = document.createElement('div');
    stage.append(under, over);
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
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
    const scene = createLiveBackSwipeScene({
      enterLiveUnder: () => ({ stage, over, under, exit: () => undefined }),
      onCommit: () => undefined,
    });
    expect(scene).not.toBeNull();
    scene!.commit();

    try {
      // Swipe dispatched directly on window while handoff awaits popstate must not commit.
      act(() => {
        window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 8, clientY: 120 }], 100));
        window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 160, clientY: 120 }], 130));
        window.dispatchEvent(
          createTouchEvent('touchend', [], 160, [{ clientX: 160, clientY: 120 }])
        );
      });
      await flushMicrotasks();
      expect(onCommit).not.toHaveBeenCalled();

      // Swipe dispatched on the hold shield must also not commit.
      const shield = stage.querySelector<HTMLElement>('[data-swipe-hold-shield]');
      expect(shield).not.toBeNull();
      act(() => {
        shield!.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 8, clientY: 120 }], 200));
        shield!.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 160, clientY: 120 }], 230));
        shield!.dispatchEvent(
          createTouchEvent('touchend', [], 260, [{ clientX: 160, clientY: 120 }])
        );
      });
      await flushMicrotasks();
      expect(onCommit).not.toHaveBeenCalled();
    } finally {
      completeLiveSlideHandoff();
    }

    // Once handoff releases, edge swipes work normally again.
    act(() => {
      window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 8, clientY: 120 }], 300));
      window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 160, clientY: 120 }], 330));
      window.dispatchEvent(createTouchEvent('touchend', [], 360, [{ clientX: 160, clientY: 120 }]));
    });
    await flushMicrotasks();
    expect(onCommit).toHaveBeenCalledTimes(1);
    stage.remove();
  });

  it('feeds touchend lift coordinates into the release decision so a reverse on lift cancels', async () => {
    const mock = createMockScene(400);
    const onCommit = vi.fn();

    function LiftHarness() {
      useInteractiveSwipe({
        zone: 'edge',
        edge: 'start',
        direction: 'inward',
        priority: SWIPE_PRIORITY.PAGE,
        enabled: true,
        onCommit,
        begin: () => mock.scene,
      });
      return null;
    }

    render(<LiftHarness />);

    act(() => {
      window.dispatchEvent(
        createTouchEvent('touchstart', [{ identifier: 1, clientX: 8, clientY: 300 }], 0)
      );
      window.dispatchEvent(
        createTouchEvent('touchmove', [{ identifier: 1, clientX: 58, clientY: 300 }], 40)
      );
      window.dispatchEvent(
        createTouchEvent('touchend', [], 60, [{ identifier: 1, clientX: 15, clientY: 300 }])
      );
    });
    await flushMicrotasks();

    expect(mock.settle).toHaveBeenCalledWith(false, expect.any(Number), 0);
    expect(mock.commit).not.toHaveBeenCalled();
    expect(mock.cleanup).toHaveBeenCalledWith(false);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('aborts a stationary held drag immediately when a blocking dialog mounts without another touchmove', async () => {
    const mock = createMockScene(400);
    const onCommit = vi.fn();

    function HeldHarness() {
      useInteractiveSwipe({
        zone: 'edge',
        edge: 'start',
        direction: 'inward',
        priority: SWIPE_PRIORITY.PAGE,
        enabled: true,
        onCommit,
        begin: () => mock.scene,
      });
      return null;
    }

    render(<HeldHarness />);

    act(() => {
      window.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 200 }], 0));
      window.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 220, clientY: 200 }], 40));
    });
    expect(mock.cleanup).not.toHaveBeenCalled();

    // Append a blocking dialog while the finger is held stationary (no further touchmove).
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);

    await flushMicrotasks();

    expect(mock.cleanup).toHaveBeenCalledTimes(1);
    expect(mock.cleanup).toHaveBeenCalledWith(false);

    // Removing the dialog and lifting the finger afterwards must not commit.
    dialog.remove();
    act(() => {
      window.dispatchEvent(createTouchEvent('touchend', [], 100));
    });
    await flushMicrotasks();

    expect(mock.commit).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
