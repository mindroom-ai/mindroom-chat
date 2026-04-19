import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageViewerOpenAtom } from '../state/imageViewer';
import { useEdgeSwipeBack } from './useEdgeSwipeBack';

type Listener = (event: Event) => void;

class MockEventTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return;

    const fn =
      typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event);
    const current = this.listeners.get(type) ?? new Set<Listener>();
    current.add(fn);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return;

    const current = this.listeners.get(type);
    if (!current) return;

    for (const candidate of current) {
      if (candidate === listener) {
        current.delete(candidate);
      }
    }
  }

  dispatch(type: string, event: Event) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

type MockWindow = MockEventTarget;

const createTouchList = (touches: Array<{ clientX: number; clientY: number }>) =>
  touches as unknown as TouchList;

function HookHarness({ onBack }: { onBack: () => void }) {
  useEdgeSwipeBack(onBack);
  return null;
}

describe('useEdgeSwipeBack', () => {
  const originalWindow = globalThis.window;

  let mockWindow: MockWindow;
  let renderer: ReactTestRenderer | undefined;

  const swipeFromLeftEdge = (preventDefault = vi.fn()) => {
    act(() => {
      mockWindow.dispatch(
        'touchstart',
        {
          touches: createTouchList([{ clientX: 12, clientY: 20 }]),
        } as unknown as TouchEvent
      );
      mockWindow.dispatch(
        'touchmove',
        {
          preventDefault,
          touches: createTouchList([{ clientX: 96, clientY: 24 }]),
        } as unknown as TouchEvent
      );
    });

    return preventDefault;
  };

  beforeEach(() => {
    mockWindow = new MockEventTarget();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: mockWindow,
    });
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });

    vi.restoreAllMocks();
  });

  it('does not call onBack while the image viewer atom is true', () => {
    const onBack = vi.fn();
    const store = createStore();
    store.set(imageViewerOpenAtom, true);

    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(HookHarness, {
            onBack,
          })
        )
      );
    });

    const preventDefault = swipeFromLeftEdge();

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('preserves the original edge-swipe back behavior when the viewer atom is false', () => {
    const onBack = vi.fn();
    const store = createStore();

    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(HookHarness, {
            onBack,
          })
        )
      );
    });

    const preventDefault = swipeFromLeftEdge();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
