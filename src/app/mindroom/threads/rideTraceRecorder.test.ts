// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installRideTraceRecorder } from './rideTraceRecorder';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<boolean>>(),
}));

vi.mock('../../utils/dom', () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

vi.mock('./cacheProbe', () => ({
  getCacheProbeSnapshot: () => ({}),
}));

vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => false,
}));

const clickOverlay = async (overlay: HTMLButtonElement): Promise<void> => {
  const result = overlay.onclick?.call(overlay, new MouseEvent('click'));
  await result;
};

describe('ride trace clipboard export', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    document.querySelectorAll('[data-ride-trace-overlay]').forEach((element) => element.remove());
    vi.restoreAllMocks();
  });

  it('uses the shared clipboard path and confirms a successful export', async () => {
    mocks.copyToClipboard.mockResolvedValue(true);
    const cleanup = installRideTraceRecorder(document.createElement('div'), () => null, {
      roomId: '!room:example.org',
    });
    const overlay = document.querySelector<HTMLButtonElement>('[data-ride-trace-overlay]')!;

    await clickOverlay(overlay);

    expect(mocks.copyToClipboard).toHaveBeenCalledWith(
      expect.stringContaining('"kind":"mindroom-ride-trace"')
    );
    expect(overlay.textContent).toMatch(/^TRACE copied ✓/);
    cleanup();
  });

  it('does not claim clipboard success when every copy path fails', async () => {
    mocks.copyToClipboard.mockResolvedValue(false);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const cleanup = installRideTraceRecorder(document.createElement('div'), () => null, {
      roomId: '!room:example.org',
    });
    const overlay = document.querySelector<HTMLButtonElement>('[data-ride-trace-overlay]')!;

    await clickOverlay(overlay);

    expect(overlay.textContent).toBe('TRACE in console');
    expect(consoleLog).toHaveBeenCalledWith(
      '[ride-trace]',
      expect.stringContaining('"kind":"mindroom-ride-trace"')
    );
    cleanup();
  });
});
