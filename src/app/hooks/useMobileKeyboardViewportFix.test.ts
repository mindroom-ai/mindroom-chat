import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { useMobileKeyboardViewportFix } from './useMobileKeyboardViewportFix';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(),
    isNativePlatform: vi.fn(),
    isPluginAvailable: vi.fn(),
  },
}));

vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    addListener: vi.fn(),
  },
}));

type Listener = (...args: never[]) => void;

type ViewportTestEnv = {
  emitKeyboard: (eventName: string) => void;
  emitWindow: (eventName: string) => void;
  emitVisualViewportResize: () => void;
  flushAnimationFrames: () => void;
  setActiveElement: (element: 'editable' | 'none') => void;
  setInnerHeight: (height: number) => void;
  setVisualViewportHeight: (height: number) => void;
  styleValues: Map<string, string>;
};

type ViewportTestEnvOptions = {
  autoFlushAnimationFrames?: boolean;
  honorCancelAnimationFrame?: boolean;
  isNativePlatform?: boolean;
  keyboardAvailable?: boolean;
  platform?: 'android' | 'ios' | 'web';
  userAgent?: string;
};

const ANDROID_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36';

const IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';

function TestViewportHook() {
  useMobileKeyboardViewportFix();
  return null;
}

const createListenerMap = () => new Map<string, Set<Listener>>();

const addListener = (
  listeners: Map<string, Set<Listener>>,
  eventName: string,
  listener: Listener
) => {
  const eventListeners = listeners.get(eventName) ?? new Set<Listener>();
  eventListeners.add(listener);
  listeners.set(eventName, eventListeners);
};

const removeListener = (
  listeners: Map<string, Set<Listener>>,
  eventName: string,
  listener: Listener
) => {
  listeners.get(eventName)?.delete(listener);
};

const emit = (listeners: Map<string, Set<Listener>>, eventName: string) => {
  listeners.get(eventName)?.forEach((listener) => listener());
};

const createActiveElement = (): Pick<Element, 'getAttribute' | 'nodeName'> => ({
  getAttribute: vi.fn(() => null),
  nodeName: 'TEXTAREA',
});

const installViewportTestEnv = ({
  autoFlushAnimationFrames = true,
  honorCancelAnimationFrame = true,
  isNativePlatform = true,
  keyboardAvailable = true,
  platform = 'android',
  userAgent = ANDROID_USER_AGENT,
}: ViewportTestEnvOptions = {}): ViewportTestEnv => {
  const visualViewportListeners = createListenerMap();
  const windowListeners = createListenerMap();
  const keyboardListeners = createListenerMap();
  const styleValues = new Map<string, string>();
  let innerHeight = 800;
  let visualViewportHeight = 800;
  let activeElement: Pick<Element, 'getAttribute' | 'nodeName'> | undefined;
  const animationFrames = new Map<number, FrameRequestCallback>();

  const style = {
    removeProperty: vi.fn((propertyName: string) => {
      styleValues.delete(propertyName);
    }),
    setProperty: vi.fn((propertyName: string, value: string) => {
      styleValues.set(propertyName, value);
    }),
  };

  const documentStub = {
    documentElement: {
      clientHeight: innerHeight,
      style,
    },
  };
  Object.defineProperty(documentStub, 'activeElement', {
    configurable: true,
    get: () => activeElement,
  });
  vi.stubGlobal('document', documentStub);

  vi.stubGlobal('window', {
    addEventListener: vi.fn((eventName: string, listener: Listener) =>
      addListener(windowListeners, eventName, listener)
    ),
    get innerHeight() {
      return innerHeight;
    },
    navigator: {
      userAgent,
    },
    removeEventListener: vi.fn((eventName: string, listener: Listener) =>
      removeListener(windowListeners, eventName, listener)
    ),
    scrollTo: vi.fn(),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    visualViewport: {
      addEventListener: vi.fn((eventName: string, listener: Listener) =>
        addListener(visualViewportListeners, eventName, listener)
      ),
      get height() {
        return visualViewportHeight;
      },
      removeEventListener: vi.fn((eventName: string, listener: Listener) =>
        removeListener(visualViewportListeners, eventName, listener)
      ),
    },
  });

  let rafId = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      rafId += 1;
      animationFrames.set(rafId, callback);
      if (autoFlushAnimationFrames) {
        const nextRafId = rafId;
        queueMicrotask(() => {
          const animationFrame = animationFrames.get(nextRafId);
          if (!animationFrame) return;

          animationFrames.delete(nextRafId);
          animationFrame(0);
        });
      }
      return rafId;
    })
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((canceledRafId: number) => {
      if (honorCancelAnimationFrame) {
        animationFrames.delete(canceledRafId);
      }
    })
  );

  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(isNativePlatform);
  vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
  vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(keyboardAvailable);
  vi.mocked(Keyboard.addListener).mockImplementation((eventName, listener) => {
    addListener(keyboardListeners, eventName, listener as Listener);
    return Promise.resolve({
      remove: vi.fn(() => {
        removeListener(keyboardListeners, eventName, listener as Listener);
        return Promise.resolve();
      }),
    });
  });

  return {
    emitKeyboard: (eventName) => emit(keyboardListeners, eventName),
    emitWindow: (eventName) => emit(windowListeners, eventName),
    emitVisualViewportResize: () => emit(visualViewportListeners, 'resize'),
    flushAnimationFrames: () => {
      const pendingAnimationFrames = Array.from(animationFrames.values());
      animationFrames.clear();
      pendingAnimationFrames.forEach((callback) => callback(0));
    },
    setActiveElement: (element) => {
      activeElement = element === 'editable' ? createActiveElement() : undefined;
    },
    setInnerHeight: (height) => {
      innerHeight = height;
      Object.defineProperty(document.documentElement, 'clientHeight', {
        configurable: true,
        value: height,
      });
    },
    setVisualViewportHeight: (height) => {
      visualViewportHeight = height;
    },
    styleValues,
  };
};

describe('useMobileKeyboardViewportFix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores Android native app height after keyboard hide when visual viewport is stale', async () => {
    const env = installViewportTestEnv();

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(TestViewportHook));
    });

    expect(env.styleValues.get('--app-height')).toBe('800px');

    env.setInnerHeight(500);
    env.setVisualViewportHeight(500);
    await act(async () => {
      env.emitVisualViewportResize();
    });

    expect(env.styleValues.get('--app-height')).toBe('500px');

    env.setInnerHeight(800);
    env.setVisualViewportHeight(500);
    await act(async () => {
      env.emitKeyboard('keyboardDidHide');
    });

    expect(env.styleValues.get('--app-height')).toBe('800px');

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('keeps iOS browser app height at the visual viewport during input focus transfer', async () => {
    const env = installViewportTestEnv({
      isNativePlatform: false,
      keyboardAvailable: false,
      platform: 'web',
      userAgent: IOS_USER_AGENT,
    });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(TestViewportHook));
    });

    expect(env.styleValues.get('--app-height')).toBe('800px');

    env.setVisualViewportHeight(500);
    await act(async () => {
      env.emitVisualViewportResize();
    });

    expect(env.styleValues.get('--app-height')).toBe('500px');

    env.setActiveElement('editable');
    await act(async () => {
      env.emitWindow('focusout');
    });

    expect(env.styleValues.get('--app-height')).toBe('500px');

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('ignores pending animation frame writes after cleanup', async () => {
    const env = installViewportTestEnv({
      autoFlushAnimationFrames: false,
      honorCancelAnimationFrame: false,
    });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(TestViewportHook));
    });

    await act(async () => {
      renderer?.unmount();
    });

    expect(env.styleValues.get('--app-height')).toBeUndefined();

    await act(async () => {
      env.flushAnimationFrames();
    });

    expect(env.styleValues.get('--app-height')).toBeUndefined();
  });
});
