// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type FocusTrap from 'focus-trap-react';
import { Provider, createStore } from 'jotai';
import { type ComponentProps, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { imageViewerOpenAtom } from '../../navigation/imageViewerState';
import { useEdgeSwipeBack } from '../../navigation/useEdgeSwipeBack';
import { ImageOverlay } from './ImageOverlay';

const IMAGE_VIEWER_HISTORY_MARKER = '__mindroomImageViewer';

// JSDOM lays nothing out, so every element counts as shown for the image viewer's focus trap.
vi.mock('focus-trap-react', async (original) => {
  const { default: RealTrap } = await original<{ default: typeof FocusTrap }>();
  return {
    default: ({ focusTrapOptions, ...props }: ComponentProps<typeof FocusTrap>) => (
      <RealTrap
        {...props}
        focusTrapOptions={{ ...focusTrapOptions, tabbableOptions: { displayCheck: 'none' } }}
      />
    ),
  };
});

type RecordedAnimation = {
  element: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions | number | undefined;
  resolve: () => void;
  cancel: ReturnType<typeof vi.fn>;
};

const flushMicrotasks = async () => {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
};

const dispatchTouch = (
  target: EventTarget,
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  touches: Array<{ clientX: number; clientY: number; identifier?: number }>,
  timeStamp: number,
  changedTouches = touches
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const toList = (items: typeof touches) =>
    items.map((point, index) => ({
      identifier: point.identifier ?? index,
      clientX: point.clientX,
      clientY: point.clientY,
      target,
    }));
  Object.defineProperty(event, 'touches', { value: toList(touches) });
  Object.defineProperty(event, 'changedTouches', { value: toList(changedTouches) });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

describe('ImageOverlay interactive edge close', () => {
  let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let nextRafId = 1;
  let animations: RecordedAnimation[] = [];
  let autoResolveAnimations = true;
  let originalAnimate: typeof Element.prototype.animate | undefined;
  let originalInnerWidth: number;
  let originalDir: string;
  let historyStack: unknown[];
  let historyIndex: number;
  let pushStateSpy: ReturnType<typeof vi.spyOn>;
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;
  let backSpy: ReturnType<typeof vi.spyOn>;

  const flushRaf = () => {
    act(() => {
      const pending = rafQueue.splice(0);
      for (const item of pending) {
        item.cb(performance.now());
      }
    });
  };

  const mockModalWidth = (width: number) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.getAttribute('role') === 'dialog' || this.hasAttribute('data-image-viewer')) {
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: width,
          bottom: 800,
          width,
          height: 800,
          toJSON: () => ({}),
        };
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 400,
        bottom: 600,
        width: 400,
        height: 600,
        toJSON: () => ({}),
      };
    });
  };

  beforeEach(() => {
    rafQueue = [];
    nextRafId = 1;
    animations = [];
    autoResolveAnimations = true;
    originalInnerWidth = window.innerWidth;
    originalDir = document.documentElement.dir;
    document.documentElement.dir = 'ltr';
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.push({ id, cb });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafQueue = rafQueue.filter((item) => item.id !== id);
    });

    originalAnimate = Element.prototype.animate;
    Element.prototype.animate = vi.fn(function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions
    ) {
      let resolve!: () => void;
      const finished = new Promise<void>((res) => {
        resolve = res;
      });
      const cancel = vi.fn();
      const record: RecordedAnimation = {
        element: this,
        keyframes: Array.isArray(keyframes) ? keyframes : [],
        options,
        resolve,
        cancel,
      };
      animations.push(record);
      if (autoResolveAnimations) {
        resolve();
      }
      return { finished, cancel } as unknown as Animation;
    });

    historyStack = [{ route: 'room' }];
    historyIndex = 0;
    Object.defineProperty(window.history, 'state', {
      configurable: true,
      get: () => historyStack[historyIndex] ?? null,
    });
    pushStateSpy = vi.spyOn(window.history, 'pushState').mockImplementation((state: unknown) => {
      historyStack.splice(historyIndex + 1);
      historyStack.push(state);
      historyIndex = historyStack.length - 1;
    });
    replaceStateSpy = vi
      .spyOn(window.history, 'replaceState')
      .mockImplementation((state: unknown) => {
        historyStack[historyIndex] = state;
      });
    backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {
      if (historyIndex > 0) historyIndex -= 1;
    });

    mockModalWidth(400);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalAnimate) {
      Element.prototype.animate = originalAnimate;
    } else {
      delete (Element.prototype as Partial<Element>).animate;
    }
    document.documentElement.dir = originalDir;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  });

  const mountViewer = ({
    onLowerBack,
    stayOpen = false,
  }: { onLowerBack?: () => void; stayOpen?: boolean } = {}) => {
    const store = createStore();
    const onClose = vi.fn();
    const requestCloseSpy = vi.fn();

    function LowerPageSwipe() {
      useEdgeSwipeBack(() => onLowerBack?.(), Boolean(onLowerBack));
      return null;
    }

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <LowerPageSwipe />
          {open && (
            <ImageOverlay
              src="blob:harbor"
              alt="harbor.jpg"
              requestClose={() => {
                requestCloseSpy();
                if (stayOpen) return;
                // Track the open->closed transition separately: FocusTrap's onDeactivate also
                // invokes requestClose once more when ImageOverlay unmounts.
                setOpen((wasOpen) => {
                  if (wasOpen) onClose();
                  return false;
                });
              }}
            />
          )}
        </>
      );
    }

    render(
      <Provider store={store}>
        <ScreenSizeProvider value={ScreenSize.Mobile}>
          <Harness />
        </ScreenSizeProvider>
      </Provider>
    );

    const modal = screen.getByRole('dialog', { name: 'harbor.jpg' });
    const backdrop = document.querySelector<HTMLElement>('[data-image-viewer-backdrop]');
    return { store, onClose, requestCloseSpy, modal, backdrop: backdrop! };
  };

  it('translates the modal and fades the backdrop proportionally during a left-edge drag, and restores cleanly on cancel', async () => {
    const { store, onClose, modal, backdrop } = mountViewer();
    expect(backdrop).toBeInstanceOf(HTMLElement);
    expect(pushStateSpy).toHaveBeenCalledOnce();
    expect(window.history.state).toEqual({
      route: 'room',
      [IMAGE_VIEWER_HISTORY_MARKER]: true,
    });

    dispatchTouch(modal, 'touchstart', [{ clientX: 8, clientY: 200 }], 100);
    // Cross 10px lock slop (lock origin at x=18) and move to x=118 (offset = 100px, progress = 0.25).
    dispatchTouch(modal, 'touchmove', [{ clientX: 118, clientY: 202 }], 300);
    flushRaf();

    expect(modal.hasAttribute('data-swiping')).toBe(true);
    expect(modal.hasAttribute('data-swipe-shadow')).toBe(true);
    expect(backdrop.hasAttribute('data-swiping')).toBe(true);
    expect(modal.style.translate).toBe('100px 0');
    expect(Number(backdrop.style.opacity)).toBeCloseTo(0.75, 5);
    expect(onClose).not.toHaveBeenCalled();
    expect(store.get(imageViewerOpenAtom)).toBe(true);

    // Release slowly below 35% threshold -> cancel and settle back to rest.
    dispatchTouch(modal, 'touchmove', [{ clientX: 118, clientY: 202 }], 500);
    dispatchTouch(modal, 'touchend', [], 550, [{ clientX: 118, clientY: 202 }]);
    await act(async () => {
      await flushMicrotasks();
    });

    expect(animations).toHaveLength(2);
    expect(animations[0]?.element).toBe(modal);
    expect(animations[0]?.keyframes).toEqual([{ translate: '100px 0' }, { translate: '0px 0' }]);
    expect(animations[1]?.element).toBe(backdrop);
    expect(animations[1]?.keyframes).toEqual([{ opacity: '0.75' }, { opacity: '1' }]);

    expect(onClose).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
    expect(store.get(imageViewerOpenAtom)).toBe(true);
    expect(window.history.state).toEqual({
      route: 'room',
      [IMAGE_VIEWER_HISTORY_MARKER]: true,
    });
    expect(modal.style.translate).toBe('');
    expect(modal.hasAttribute('data-swiping')).toBe(false);
    expect(modal.hasAttribute('data-swipe-shadow')).toBe(false);
    expect(backdrop.style.opacity).toBe('');
    expect(backdrop.hasAttribute('data-swiping')).toBe(false);
  });

  it('commits past threshold, settles offscreen and fades backdrop to 0, closes once, and consumes history entry', async () => {
    const { store, onClose, requestCloseSpy, modal, backdrop } = mountViewer();

    dispatchTouch(modal, 'touchstart', [{ clientX: 8, clientY: 200 }], 100);
    // Lock origin at x=18; move to x=218 -> offset = 200px (50% >= 35%).
    dispatchTouch(modal, 'touchmove', [{ clientX: 218, clientY: 202 }], 260);
    flushRaf();
    expect(modal.style.translate).toBe('200px 0');
    expect(Number(backdrop.style.opacity)).toBeCloseTo(0.5, 5);

    dispatchTouch(modal, 'touchend', [], 300, [{ clientX: 218, clientY: 202 }]);
    await act(async () => {
      await flushMicrotasks();
    });

    expect(animations).toHaveLength(2);
    expect(animations[0]?.keyframes).toEqual([{ translate: '200px 0' }, { translate: '400px 0' }]);
    expect(animations[1]?.keyframes).toEqual([{ opacity: '0.5' }, { opacity: '0' }]);
    expect(onClose).toHaveBeenCalledOnce();
    // scene.commit() invokes requestClose once, and FocusTrap's onDeactivate invokes it on unmount.
    expect(requestCloseSpy).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.get(imageViewerOpenAtom)).toBe(false);
    expect(backSpy).toHaveBeenCalledOnce();
    expect(historyIndex).toBe(0);
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('mirrors edge close from the right edge in RTL and ignores physical left-edge drags', async () => {
    document.documentElement.dir = 'rtl';
    const { onClose, modal, backdrop } = mountViewer();

    // Physical left edge in RTL must NOT start interactive close.
    dispatchTouch(modal, 'touchstart', [{ clientX: 8, clientY: 200 }], 100);
    dispatchTouch(modal, 'touchmove', [{ clientX: 220, clientY: 200 }], 220);
    flushRaf();
    expect(modal.style.translate).toBe('');
    dispatchTouch(modal, 'touchend', [], 250, [{ clientX: 220, clientY: 200 }]);

    // Physical right edge (logical start edge in RTL) translates negatively and commits.
    dispatchTouch(modal, 'touchstart', [{ clientX: 392, clientY: 200 }], 300);
    // Lock origin at x=382; move to x=182 -> offset = 200px, translated -200px.
    dispatchTouch(modal, 'touchmove', [{ clientX: 182, clientY: 200 }], 420);
    flushRaf();
    expect(modal.style.translate).toBe('-200px 0');
    expect(Number(backdrop.style.opacity)).toBeCloseTo(0.5, 5);

    dispatchTouch(modal, 'touchend', [], 450, [{ clientX: 182, clientY: 200 }]);
    await act(async () => {
      await flushMicrotasks();
    });

    expect(animations[0]?.keyframes).toEqual([
      { translate: '-200px 0' },
      { translate: '-400px 0' },
    ]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables edge close when zoomed in and never falls through to lower swipe layers', async () => {
    const onLowerBack = vi.fn();
    const { onClose, modal, backdrop } = mountViewer({ onLowerBack });

    // Zoom to 200%.
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(screen.getByRole('button', { name: '200%' })).toBeTruthy();

    dispatchTouch(modal, 'touchstart', [{ clientX: 8, clientY: 200 }], 100);
    dispatchTouch(modal, 'touchmove', [{ clientX: 240, clientY: 200 }], 220);
    flushRaf();
    dispatchTouch(modal, 'touchend', [], 260, [{ clientX: 240, clientY: 200 }]);
    await act(async () => {
      await flushMicrotasks();
    });

    expect(modal.style.translate).toBe('');
    expect(backdrop.style.opacity).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    expect(onLowerBack).not.toHaveBeenCalled();
  });

  it('cancels interactive close immediately when a 2nd finger touches down so pinch zoom proceeds', async () => {
    const { onClose, modal, backdrop } = mountViewer();
    const imageArea = screen.getByRole('img').parentElement!;

    dispatchTouch(imageArea, 'touchstart', [{ clientX: 10, clientY: 200, identifier: 0 }], 100);
    dispatchTouch(imageArea, 'touchmove', [{ clientX: 110, clientY: 200, identifier: 0 }], 200);
    flushRaf();
    expect(modal.style.translate).toBe('90px 0');
    expect(modal.hasAttribute('data-swiping')).toBe(true);
    expect(backdrop.hasAttribute('data-swiping')).toBe(true);

    // Probe on useZoom's target element: window capture must clear translate BEFORE element listeners run.
    let translateDuringElementTouchStart: string | undefined;
    let swipingDuringElementTouchStart: boolean | undefined;
    const onProbeTouchStart = () => {
      translateDuringElementTouchStart = modal.style.translate;
      swipingDuringElementTouchStart = modal.hasAttribute('data-swiping');
    };
    imageArea.addEventListener('touchstart', onProbeTouchStart, { once: true });

    // 2nd finger lands mid-drag -> interactive close aborts in capture phase before useZoom reads rect.
    dispatchTouch(
      imageArea,
      'touchstart',
      [
        { clientX: 110, clientY: 200, identifier: 0 },
        { clientX: 210, clientY: 200, identifier: 1 },
      ],
      220
    );
    expect(translateDuringElementTouchStart).toBe('');
    expect(swipingDuringElementTouchStart).toBe(false);
    expect(modal.style.translate).toBe('');
    expect(modal.hasAttribute('data-swiping')).toBe(false);
    expect(modal.hasAttribute('data-swipe-shadow')).toBe(false);
    expect(backdrop.style.opacity).toBe('');
    expect(backdrop.hasAttribute('data-swiping')).toBe(false);

    // Spreading fingers zooms the image cleanly.
    dispatchTouch(
      imageArea,
      'touchmove',
      [
        { clientX: 60, clientY: 200, identifier: 0 },
        { clientX: 260, clientY: 200, identifier: 1 },
      ],
      250
    );
    expect(screen.getByRole('button', { name: '200%' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('falls back to discrete close when modal has zero layout width', async () => {
    mockModalWidth(0);
    const { onClose, modal, backdrop } = mountViewer();

    dispatchTouch(modal, 'touchstart', [{ clientX: 8, clientY: 200 }], 100);
    dispatchTouch(modal, 'touchmove', [{ clientX: 140, clientY: 200 }], 220);
    flushRaf();
    expect(modal.style.translate).toBe('');
    expect(backdrop.style.opacity).toBe('');

    dispatchTouch(modal, 'touchend', [], 260, [{ clientX: 140, clientY: 200 }]);
    await act(async () => {
      await flushMicrotasks();
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('aborts an in-flight settle cleanly if popstate closes the viewer before animation completes', async () => {
    autoResolveAnimations = false;
    const { onClose, requestCloseSpy, modal, backdrop } = mountViewer();

    dispatchTouch(modal, 'touchstart', [{ clientX: 8, clientY: 200 }], 100);
    dispatchTouch(modal, 'touchmove', [{ clientX: 218, clientY: 200 }], 220);
    flushRaf();
    dispatchTouch(modal, 'touchend', [], 250, [{ clientX: 218, clientY: 200 }]);

    expect(animations).toHaveLength(2);
    expect(onClose).not.toHaveBeenCalled();

    // Browser Back closes the viewer while settle is still animating.
    act(() => {
      historyIndex = 0;
      window.dispatchEvent(new Event('popstate'));
    });

    expect(onClose).toHaveBeenCalledOnce();
    const callsAfterPopState = requestCloseSpy.mock.calls.length;
    expect(animations[0]?.cancel).toHaveBeenCalled();
    expect(animations[1]?.cancel).toHaveBeenCalled();
    expect(modal.style.translate).toBe('');
    expect(backdrop.style.opacity).toBe('');

    // Resolving the aborted animations later must not double-close.
    await act(async () => {
      animations.forEach((a) => a.resolve());
      await flushMicrotasks();
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(requestCloseSpy).toHaveBeenCalledTimes(callsAfterPopState);
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('calls requestClose strictly once on commit and clears inline styles even if caller keeps viewer open', async () => {
    const { requestCloseSpy, modal, backdrop } = mountViewer({ stayOpen: true });

    dispatchTouch(modal, 'touchstart', [{ clientX: 8, clientY: 200 }], 100);
    dispatchTouch(modal, 'touchmove', [{ clientX: 218, clientY: 200 }], 220);
    flushRaf();
    dispatchTouch(modal, 'touchend', [], 250, [{ clientX: 218, clientY: 200 }]);
    await act(async () => {
      await flushMicrotasks();
    });

    expect(requestCloseSpy).toHaveBeenCalledOnce();
    expect(modal.style.translate).toBe('');
    expect(modal.hasAttribute('data-swiping')).toBe(false);
    expect(modal.hasAttribute('data-swipe-shadow')).toBe(false);
    expect(backdrop.style.opacity).toBe('');
    expect(backdrop.hasAttribute('data-swiping')).toBe(false);
  });

  it('does not deactivate FocusTrap when a 2nd finger lands on the exposed backdrop during drag', () => {
    const { store, onClose, requestCloseSpy, modal, backdrop } = mountViewer();

    dispatchTouch(modal, 'touchstart', [{ clientX: 10, clientY: 200, identifier: 0 }], 100);
    dispatchTouch(modal, 'touchmove', [{ clientX: 150, clientY: 200, identifier: 0 }], 180);
    flushRaf();
    expect(modal.style.translate).toBe('130px 0');

    // 2nd finger lands in the newly exposed strip on the backdrop outside the translated Modal.
    dispatchTouch(
      backdrop,
      'touchstart',
      [
        { clientX: 150, clientY: 200, identifier: 0 },
        { clientX: 40, clientY: 200, identifier: 1 },
      ],
      210
    );

    expect(modal.style.translate).toBe('');
    expect(modal.hasAttribute('data-swiping')).toBe(false);
    expect(modal.hasAttribute('data-swipe-shadow')).toBe(false);
    expect(backdrop.style.opacity).toBe('');
    expect(backdrop.hasAttribute('data-swiping')).toBe(false);
    expect(requestCloseSpy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
    expect(store.get(imageViewerOpenAtom)).toBe(true);
    expect(window.history.state).toEqual({
      route: 'room',
      [IMAGE_VIEWER_HISTORY_MARKER]: true,
    });
  });

  it('does not commit close if a higher dialog opens while settle(true) is animating', async () => {
    autoResolveAnimations = false;
    const { store, onClose, requestCloseSpy, modal, backdrop } = mountViewer();

    dispatchTouch(modal, 'touchstart', [{ clientX: 8, clientY: 200 }], 100);
    dispatchTouch(modal, 'touchmove', [{ clientX: 218, clientY: 200 }], 200);
    flushRaf();
    dispatchTouch(modal, 'touchend', [], 220, [{ clientX: 218, clientY: 200 }]);

    expect(animations).toHaveLength(2);
    expect(onClose).not.toHaveBeenCalled();

    // A higher dialog opens over the viewer before settle(true) finishes.
    const higherDialog = document.createElement('div');
    higherDialog.setAttribute('role', 'dialog');
    document.body.append(higherDialog);

    await act(async () => {
      animations.forEach((a) => a.resolve());
      await flushMicrotasks();
    });

    expect(requestCloseSpy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
    expect(store.get(imageViewerOpenAtom)).toBe(true);
    expect(modal.style.translate).toBe('');
    expect(modal.hasAttribute('data-swiping')).toBe(false);
    expect(backdrop.style.opacity).toBe('');
    expect(window.history.state).toEqual({
      route: 'room',
      [IMAGE_VIEWER_HISTORY_MARKER]: true,
    });
    higherDialog.remove();
  });
});
