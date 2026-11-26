import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

let storageValue: string | null = null;

beforeAll(() => {
  globalThis.localStorage = {
    getItem: () => storageValue,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    length: 0,
    key: () => null,
  };
});

describe('settings ownership', () => {
  it('does not own MindRoom pagination policy in generic settings state', () => {
    const source = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('DEFAULT_PAGINATION_LIMIT');
    expect(source).not.toContain('sanitizePaginationLimit');
    expect(source).not.toContain('paginationLimit:');
    expect(source).not.toContain('../event-store/cache/preloadSettings');
    expect(source).not.toContain('../event-store/engine/prefetchSettings');
  });
});

describe('getSettings', () => {
  it('falls back to defaults when stored settings JSON is malformed', async () => {
    const { getSettings } = await import('./settings');
    storageValue = '{not json}';

    expect(() => getSettings()).not.toThrow();
    expect(getSettings().useSystemTheme).toBe(true);

    storageValue = null;
  });

  it('turns the voice key on until the person switches it off', async () => {
    const { getSettings } = await import('./settings');
    storageValue = null;

    expect(getSettings().voiceHoldShortcut).toBe(true);
  });

  it.each(['showToolCalls', 'showUsageDetails', 'autoZipLargeFiles'] as const)(
    'defaults %s to false',
    async (key) => {
      const { getSettings } = await import('./settings');
      storageValue = null;

      expect(getSettings()[key]).toBe(false);
    }
  );

  it('persists autoZipLargeFiles as a boolean', async () => {
    const { getSettings } = await import('./settings');
    for (const [raw, expected] of [
      [true, true],
      [false, false],
      [0, false],
    ] as const) {
      storageValue = JSON.stringify({ autoZipLargeFiles: raw });
      expect(getSettings().autoZipLargeFiles).toBe(expected);
    }
    storageValue = null;
  });

  it('sends with Auto while an agent replies, as a message without a mode does, unless a known mode is stored', async () => {
    const { getSettings } = await import('./settings');
    const stored = (midTurnSend: unknown) => {
      storageValue = JSON.stringify({ midTurnSend });
      return getSettings().midTurnSend;
    };

    storageValue = null;
    expect(getSettings().midTurnSend).toBe('auto');
    expect(stored('queue')).toBe('queue');
    expect(stored('steer')).toBe('steer');
    expect(stored('Queue')).toBe('auto');
    expect(stored(1)).toBe('auto');

    storageValue = null;
  });

  it('defaults mediaCompression to balanced and preserves only known presets', async () => {
    const { getSettings } = await import('./settings');
    const stored = (mediaCompression: unknown) => {
      storageValue = JSON.stringify({ mediaCompression });
      return getSettings().mediaCompression;
    };

    storageValue = null;
    expect(getSettings().mediaCompression).toBe('balanced');
    expect(stored('off')).toBe('off');
    expect(stored('balanced')).toBe('balanced');
    expect(stored('small')).toBe('small');
    expect(stored('Balanced')).toBe('balanced');
    expect(stored('high')).toBe('balanced');
    expect(stored('')).toBe('balanced');
    expect(stored(1)).toBe('balanced');
    expect(stored(null)).toBe('balanced');

    storageValue = null;
  });

  it('sanitizes persisted page zoom values', async () => {
    const { getSettings, PAGE_ZOOM_DEFAULT, PAGE_ZOOM_MAX, PAGE_ZOOM_MIN } =
      await import('./settings');

    storageValue = JSON.stringify({ pageZoom: 0 });
    expect(getSettings().pageZoom).toBe(PAGE_ZOOM_MIN);

    storageValue = JSON.stringify({ pageZoom: 200 });
    expect(getSettings().pageZoom).toBe(PAGE_ZOOM_MAX);

    storageValue = JSON.stringify({ pageZoom: Number.NaN });
    expect(getSettings().pageZoom).toBe(PAGE_ZOOM_DEFAULT);

    storageValue = JSON.stringify({ pageZoom: 89.6 });
    expect(getSettings().pageZoom).toBe(90);

    storageValue = null;
  });

  it('hydrates only fields owned by the generic settings model', async () => {
    const { getSettings } = await import('./settings');
    storageValue = JSON.stringify({
      pageZoom: 90,
      forkExtension: 'not-owned-here',
    });

    const settings = getSettings() as Record<string, unknown>;
    expect(settings.pageZoom).toBe(90);
    expect(settings.forkExtension).toBeUndefined();

    storageValue = null;
  });

  it('falls back to defaults when localStorage lacks getItem', async () => {
    const originalLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem: () => undefined,
      },
    });

    try {
      const { getSettings, PAGE_ZOOM_DEFAULT } = await import('./settings');
      expect(getSettings().pageZoom).toBe(PAGE_ZOOM_DEFAULT);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      });
    }
  });
});

describe('stepPageZoom', () => {
  it('steps through the Settings values, from between two steps to the next one, and stops at the ends', async () => {
    const { PAGE_ZOOM_MAX, PAGE_ZOOM_MIN, stepPageZoom } = await import('./settings');
    expect(stepPageZoom(100, 1)).toBe(110);
    expect(stepPageZoom(100, -1)).toBe(90);
    // A pinch stored 117 %.
    expect(stepPageZoom(117, 1)).toBe(125);
    expect(stepPageZoom(117, -1)).toBe(110);
    expect(stepPageZoom(PAGE_ZOOM_MAX, 1)).toBe(PAGE_ZOOM_MAX);
    expect(stepPageZoom(PAGE_ZOOM_MIN, -1)).toBe(PAGE_ZOOM_MIN);
  });
});
