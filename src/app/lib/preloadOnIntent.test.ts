// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preloadOnIntent } from './preloadOnIntent';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('preloadOnIntent', () => {
  it('starts the load when the pointer reaches the control, and when the focus does', () => {
    const load = vi.fn(() => Promise.resolve('panel'));
    const intent = preloadOnIntent(load);
    expect(load).not.toHaveBeenCalled();

    intent.onPointerEnter?.();
    expect(load).toHaveBeenCalledTimes(1);
    intent.onFocus?.();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps a load that fails to itself: the part reports it when it loads', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      preloadOnIntent(() => Promise.reject(new Error('chunk gone'))).onPointerEnter?.();
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('starts nothing while the device is offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const load = vi.fn(() => Promise.resolve());
    const intent = preloadOnIntent(load);

    intent.onPointerEnter?.();
    intent.onFocus?.();
    expect(load).not.toHaveBeenCalled();
  });
});
