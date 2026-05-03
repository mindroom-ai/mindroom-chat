import React, { useRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageViewerOpenAtom } from '../../state/imageViewer';
import {
  getInteractiveSwipeEdge,
  getInteractiveSwipeTravel,
  shouldIgnoreInteractiveSwipeTarget,
  type InteractiveRoomThreadSwipeSnapshot,
  useInteractiveRoomThreadSwipe,
  type UseInteractiveRoomThreadSwipeOptions,
} from './useInteractiveRoomThreadSwipe';

type Listener = (event: TouchEvent) => void;

class MockStyle {
  values = new Map<string, string>();

  setProperty(name: string, value: string) {
    this.values.set(name, value);
  }

  removeProperty(name: string) {
    this.values.delete(name);
  }

  getPropertyValue(name: string) {
    return this.values.get(name) ?? '';
  }
}

class MockShell {
  clientWidth = 400;

  rectLeft = 0;

  style = new MockStyle();

  listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return;
    const fn =
      typeof listener === 'function'
        ? listener
        : (event: TouchEvent) => listener.handleEvent(event);
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(fn as Listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    const listeners = this.listeners.get(type);
    if (!listener || !listeners) return;
    listeners.delete(listener as Listener);
  }

  dispatch(type: string, event: TouchEvent) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  getBoundingClientRect() {
    return {
      bottom: 0,
      height: 0,
      left: this.rectLeft,
      right: this.rectLeft + this.clientWidth,
      top: 0,
      width: this.clientWidth,
      x: this.rectLeft,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }
}

type MockRuntime = NonNullable<UseInteractiveRoomThreadSwipeOptions['runtime']> & {
  flushRaf: () => void;
  runTimers: () => void;
  setNow: (value: number) => void;
  timerDelays: number[];
};

const createTouchList = (touches: Array<{ clientX: number; clientY: number }>) =>
  touches as unknown as TouchList;

const createTouchEvent = (
  touches: Array<{ clientX: number; clientY: number }>,
  extras: Partial<TouchEvent> = {}
) =>
  ({
    changedTouches: createTouchList(touches),
    preventDefault: vi.fn(),
    target: null,
    touches: createTouchList(touches),
    ...extras,
  } as unknown as TouchEvent & {
    __mindroomInteractiveSwipeOwned?: boolean;
    preventDefault: ReturnType<typeof vi.fn>;
  });

const createRuntime = (reducedMotion = false): MockRuntime => {
  let now = 0;
  let rafCallback: FrameRequestCallback | undefined;
  let nextTimerId = 1;
  const timers: Array<{ id: number; callback: () => void; active: boolean }> = [];
  const timerDelays: number[] = [];

  return {
    cancelAnimationFrame: vi.fn(() => {
      rafCallback = undefined;
    }),
    clearTimeout: vi.fn((handle: number) => {
      const timer = timers.find(({ id }) => id === handle);
      if (timer) timer.active = false;
    }),
    flushRaf: () => {
      const callback = rafCallback;
      rafCallback = undefined;
      callback?.(now);
    },
    matchMedia: vi.fn(() => ({ matches: reducedMotion })),
    now: () => now,
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      rafCallback = callback;
      return 1;
    }),
    runTimers: () => {
      while (timers.length > 0) {
        const timer = timers.shift();
        if (timer?.active) timer.callback();
      }
    },
    setNow: (value: number) => {
      now = value;
    },
    setTimeout: vi.fn((callback: () => void, delay: number) => {
      const id = nextTimerId;
      nextTimerId += 1;
      timerDelays.push(delay);
      timers.push({ id, callback, active: true });
      return id;
    }),
    timerDelays,
  };
};

function HookHarness({
  latest,
  options,
  shell,
}: {
  latest: { current: InteractiveRoomThreadSwipeSnapshot };
  options: Omit<UseInteractiveRoomThreadSwipeOptions, 'shellRef'>;
  shell: MockShell;
}) {
  const shellRef = useRef(shell as unknown as HTMLElement);
  latest.current = useInteractiveRoomThreadSwipe({
    ...options,
    shellRef,
  });
  return null;
}

describe('interactive room/thread swipe helpers', () => {
  it('gates left and right edges', () => {
    expect(getInteractiveSwipeEdge(12, 400)).toBe('left');
    expect(getInteractiveSwipeEdge(390, 400)).toBe('right');
    expect(getInteractiveSwipeEdge(200, 400)).toBeUndefined();
    expect(getInteractiveSwipeEdge(12, 400, true)).toBeUndefined();
    expect(getInteractiveSwipeEdge(-1, 400)).toBeUndefined();
    expect(getInteractiveSwipeEdge(401, 400)).toBeUndefined();
  });

  it('computes directional travel', () => {
    expect(getInteractiveSwipeTravel('left', 10, 90)).toBe(80);
    expect(getInteractiveSwipeTravel('right', 390, 310)).toBe(80);
  });

  it('suppresses explicit ignored targets', () => {
    class MockElement {
      constructor(private readonly ignored: boolean) {}

      closest() {
        return this.ignored ? this : null;
      }
    }
    vi.stubGlobal('Element', MockElement);

    expect(shouldIgnoreInteractiveSwipeTarget(new MockElement(true) as never)).toBe(true);
    expect(shouldIgnoreInteractiveSwipeTarget(new MockElement(false) as never)).toBe(false);
  });
});

describe('useInteractiveRoomThreadSwipe', () => {
  const originalWindow = globalThis.window;
  let renderer: ReactTestRenderer | undefined;
  let shell: MockShell;
  let runtime: MockRuntime;
  let latest: { current: InteractiveRoomThreadSwipeSnapshot };
  let onCommit: ReturnType<typeof vi.fn>;
  let onPreviewFreeze: ReturnType<typeof vi.fn>;
  let store: ReturnType<typeof createStore>;

  const createHookElement = (
    options: Partial<Omit<UseInteractiveRoomThreadSwipeOptions, 'onCommit' | 'shellRef'>> = {},
    currentStore = store
  ) =>
    React.createElement(
      Provider,
      { store: currentStore },
      React.createElement(HookHarness, {
        latest,
        options: {
          enabled: true,
          leftTarget: { threadId: '$left', label: 'Thread' },
          onCommit,
          onPreviewFreeze,
          rightTarget: { threadId: '$right', label: 'Previous thread' },
          runtime,
          ...options,
        },
        shell,
      })
    );

  const renderHook = (
    options: Partial<Omit<UseInteractiveRoomThreadSwipeOptions, 'onCommit' | 'shellRef'>> = {},
    imageViewerOpen = false
  ) => {
    store = createStore();
    store.set(imageViewerOpenAtom, imageViewerOpen);
    act(() => {
      renderer = create(createHookElement(options));
    });
  };

  const updateHook = (
    options: Partial<Omit<UseInteractiveRoomThreadSwipeOptions, 'onCommit' | 'shellRef'>> = {}
  ) => {
    act(() => {
      renderer?.update(createHookElement(options));
    });
  };

  const startLeft = () => {
    act(() => {
      shell.dispatch('touchstart', createTouchEvent([{ clientX: 12, clientY: 20 }]));
    });
  };

  const moveLeft = (clientX: number, clientY = 22) => {
    const event = createTouchEvent([{ clientX, clientY }]);
    act(() => {
      shell.dispatch('touchmove', event);
    });
    return event;
  };

  beforeEach(() => {
    vi.stubGlobal('window', {
      cancelAnimationFrame: vi.fn(),
      clearTimeout: vi.fn(),
      matchMedia: vi.fn(() => ({ matches: false })),
      requestAnimationFrame: vi.fn(),
      setTimeout: vi.fn(),
    });
    shell = new MockShell();
    runtime = createRuntime();
    latest = { current: { phase: 'idle' } };
    onCommit = vi.fn();
    onPreviewFreeze = vi.fn();
    store = createStore();
  });

  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    renderer = undefined;
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('arms from a valid left edge target without committing during drag', () => {
    renderHook();

    startLeft();
    expect(latest.current.phase).toBe('armed');

    const moveEvent = moveLeft(140);
    runtime.flushRaf();

    expect(latest.current.phase).toBe('dragging');
    expect(moveEvent.preventDefault).toHaveBeenCalledOnce();
    expect(moveEvent.__mindroomInteractiveSwipeOwned).toBe(true);
    expect(onPreviewFreeze).toHaveBeenCalledWith({
      direction: 'left',
      label: 'Thread',
      threadId: '$left',
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('128px');
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-preview-x')).toBe('-272px');
  });

  it('does not engage when the edge has no target', () => {
    renderHook({ leftTarget: undefined });

    startLeft();
    moveLeft(160);

    expect(latest.current.phase).toBe('idle');
    expect(onPreviewFreeze).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits by distance only after settle cleanup', () => {
    renderHook();

    startLeft();
    runtime.setNow(20);
    moveLeft(230);
    runtime.flushRaf();

    act(() => {
      shell.dispatch('touchend', createTouchEvent([]));
    });

    expect(latest.current.phase).toBe('settling');
    expect(onCommit).not.toHaveBeenCalled();
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('218px');
    runtime.flushRaf();
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('400px');

    act(() => {
      runtime.runTimers();
    });

    expect(latest.current.phase).toBe('idle');
    expect(onCommit).toHaveBeenCalledWith({
      direction: 'left',
      label: 'Thread',
      threadId: '$left',
    });
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('');
  });

  it('keeps the release transform before the transitioned settle frame', () => {
    renderHook();

    startLeft();
    runtime.setNow(20);
    moveLeft(230);

    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('');

    act(() => {
      shell.dispatch('touchend', createTouchEvent([]));
    });

    expect(latest.current.phase).toBe('settling');
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('218px');

    runtime.flushRaf();

    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('400px');
  });

  it('commits when touchend changedTouches crosses the distance threshold', () => {
    renderHook();

    startLeft();
    runtime.setNow(20);
    moveLeft(180);
    runtime.flushRaf();

    act(() => {
      shell.dispatch(
        'touchend',
        createTouchEvent([], {
          changedTouches: createTouchList([{ clientX: 230, clientY: 22 }]),
        })
      );
    });

    expect(latest.current.phase).toBe('settling');
    runtime.flushRaf();
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('400px');

    act(() => {
      runtime.runTimers();
    });

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith({
      direction: 'left',
      label: 'Thread',
      threadId: '$left',
    });
  });

  it('commits by release velocity below the distance threshold', () => {
    renderHook();

    startLeft();
    runtime.setNow(10);
    moveLeft(30);
    runtime.setNow(30);
    moveLeft(70);
    runtime.flushRaf();

    act(() => {
      shell.dispatch('touchend', createTouchEvent([]));
      runtime.runTimers();
    });

    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ direction: 'left' }));
  });

  it('expires stale release velocity before committing below the distance threshold', () => {
    renderHook();

    startLeft();
    runtime.setNow(20);
    moveLeft(150);
    runtime.flushRaf();
    runtime.setNow(220);

    act(() => {
      shell.dispatch('touchend', createTouchEvent([]));
      runtime.runTimers();
    });

    expect(latest.current.phase).toBe('idle');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('cancels over-threshold drags on touchcancel without committing', () => {
    renderHook();

    startLeft();
    runtime.setNow(20);
    moveLeft(230);
    runtime.flushRaf();

    act(() => {
      shell.dispatch('touchcancel', createTouchEvent([]));
    });

    expect(latest.current.phase).toBe('canceling');
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('218px');
    runtime.flushRaf();
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('0px');

    act(() => {
      runtime.runTimers();
    });

    expect(latest.current.phase).toBe('idle');
    expect(onCommit).not.toHaveBeenCalled();
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('');
  });

  it('cancels velocity-threshold drags on touchcancel without committing', () => {
    renderHook();

    startLeft();
    runtime.setNow(10);
    moveLeft(30);
    runtime.setNow(30);
    moveLeft(70);
    runtime.flushRaf();

    act(() => {
      shell.dispatch('touchcancel', createTouchEvent([]));
      runtime.runTimers();
    });

    expect(latest.current.phase).toBe('idle');
    expect(onCommit).not.toHaveBeenCalled();
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('');
  });

  it('keeps a committed swipe pending when a new touch starts before settle cleanup', () => {
    renderHook();

    startLeft();
    runtime.setNow(20);
    moveLeft(230);
    runtime.flushRaf();

    act(() => {
      shell.dispatch('touchend', createTouchEvent([]));
    });

    expect(latest.current.phase).toBe('settling');
    runtime.flushRaf();
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('400px');

    act(() => {
      shell.dispatch('touchstart', createTouchEvent([{ clientX: 12, clientY: 20 }]));
      runtime.runTimers();
    });

    expect(latest.current.phase).toBe('idle');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      direction: 'left',
      label: 'Thread',
      threadId: '$left',
    });
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('');
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-preview-x')).toBe('');

    startLeft();

    expect(latest.current.phase).toBe('armed');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('flushes a committed swipe exactly once when cleanup interrupts settle', () => {
    renderHook();

    startLeft();
    runtime.setNow(20);
    moveLeft(230);
    runtime.flushRaf();

    act(() => {
      shell.dispatch('touchend', createTouchEvent([]));
    });

    expect(latest.current.phase).toBe('settling');
    expect(onCommit).not.toHaveBeenCalled();
    runtime.flushRaf();

    updateHook({ enabled: false });

    expect(latest.current.phase).toBe('idle');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      direction: 'left',
      label: 'Thread',
      threadId: '$left',
    });

    act(() => {
      runtime.runTimers();
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('cancels below threshold and leaves route callbacks untouched', () => {
    renderHook();

    startLeft();
    runtime.setNow(100);
    moveLeft(60);
    runtime.flushRaf();

    act(() => {
      shell.dispatch('touchend', createTouchEvent([]));
    });

    expect(latest.current.phase).toBe('canceling');
    runtime.flushRaf();
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('0px');

    act(() => {
      runtime.runTimers();
    });

    expect(latest.current.phase).toBe('idle');
    expect(onCommit).not.toHaveBeenCalled();
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('');
  });

  it('cancels vertical-dominant movement and multi-touch movement', () => {
    renderHook();

    startLeft();
    act(() => {
      shell.dispatch('touchmove', createTouchEvent([{ clientX: 17, clientY: 35 }]));
      runtime.runTimers();
    });

    expect(latest.current.phase).toBe('idle');
    expect(onCommit).not.toHaveBeenCalled();
    expect(runtime.setTimeout).not.toHaveBeenCalled();

    startLeft();
    act(() => {
      shell.dispatch(
        'touchmove',
        createTouchEvent([
          { clientX: 40, clientY: 20 },
          { clientX: 42, clientY: 22 },
        ])
      );
      runtime.runTimers();
    });

    expect(latest.current.phase).toBe('idle');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('uses right-edge targets with mirrored CSS offsets', () => {
    renderHook();

    act(() => {
      shell.dispatch('touchstart', createTouchEvent([{ clientX: 392, clientY: 20 }]));
    });
    const moveEvent = createTouchEvent([{ clientX: 300, clientY: 20 }]);
    act(() => {
      shell.dispatch('touchmove', moveEvent);
    });
    runtime.flushRaf();

    expect(latest.current.target).toEqual({
      direction: 'right',
      label: 'Previous thread',
      threadId: '$right',
    });
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('-92px');
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-preview-x')).toBe('308px');
  });

  it('detects edges using shell-local coordinates when the shell is offset', () => {
    shell.rectLeft = 80;
    renderHook();

    act(() => {
      shell.dispatch('touchstart', createTouchEvent([{ clientX: 392, clientY: 20 }]));
    });

    expect(latest.current.phase).toBe('idle');

    act(() => {
      shell.dispatch('touchstart', createTouchEvent([{ clientX: 470, clientY: 20 }]));
    });
    const moveEvent = createTouchEvent([{ clientX: 380, clientY: 20 }]);
    act(() => {
      shell.dispatch('touchmove', moveEvent);
    });
    runtime.flushRaf();

    expect(latest.current.target).toEqual({
      direction: 'right',
      label: 'Previous thread',
      threadId: '$right',
    });
    expect(moveEvent.preventDefault).toHaveBeenCalledOnce();
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('-90px');
  });

  it('suppresses image-viewer and portal gestures', () => {
    renderHook({}, true);
    startLeft();
    moveLeft(160);
    expect(latest.current.phase).toBe('idle');

    act(() => {
      renderer?.unmount();
    });
    renderHook({ isPortalOpen: () => true });
    startLeft();
    moveLeft(160);
    expect(latest.current.phase).toBe('idle');
  });

  it('snaps reduced-motion settles while preserving commit ordering', () => {
    runtime = createRuntime(true);
    renderHook();

    startLeft();
    moveLeft(230);
    act(() => {
      shell.dispatch('touchend', createTouchEvent([]));
    });

    expect(runtime.timerDelays.at(-1)).toBe(0);
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      runtime.runTimers();
    });

    expect(onCommit).toHaveBeenCalledOnce();
  });

  it('cleans listeners and CSS variables on teardown', () => {
    renderHook();

    startLeft();
    moveLeft(160);
    runtime.flushRaf();

    expect(shell.listeners.get('touchstart')?.size).toBe(1);
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).not.toBe('');

    act(() => {
      renderer?.unmount();
    });

    expect(shell.listeners.get('touchstart')?.size).toBe(0);
    expect(shell.style.getPropertyValue('--mindroom-room-thread-swipe-active-x')).toBe('');
  });
});
