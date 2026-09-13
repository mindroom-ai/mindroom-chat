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

describe('sanitizePaginationLimit', () => {
  it('returns DEFAULT for NaN', async () => {
    const { sanitizePaginationLimit, DEFAULT_PAGINATION_LIMIT } = await import('./settings');
    expect(sanitizePaginationLimit(NaN)).toBe(DEFAULT_PAGINATION_LIMIT);
  });

  it('returns DEFAULT for Infinity', async () => {
    const { sanitizePaginationLimit, DEFAULT_PAGINATION_LIMIT } = await import('./settings');
    expect(sanitizePaginationLimit(Infinity)).toBe(DEFAULT_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(-Infinity)).toBe(DEFAULT_PAGINATION_LIMIT);
  });

  it('returns DEFAULT for non-number types', async () => {
    const { sanitizePaginationLimit, DEFAULT_PAGINATION_LIMIT } = await import('./settings');
    expect(sanitizePaginationLimit(undefined)).toBe(DEFAULT_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(null)).toBe(DEFAULT_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit('300')).toBe(DEFAULT_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(true)).toBe(DEFAULT_PAGINATION_LIMIT);
  });

  it('clamps values below minimum to MIN_PAGINATION_LIMIT', async () => {
    const { sanitizePaginationLimit, MIN_PAGINATION_LIMIT } = await import('./settings');
    expect(sanitizePaginationLimit(0)).toBe(MIN_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(10)).toBe(MIN_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(49)).toBe(MIN_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(-100)).toBe(MIN_PAGINATION_LIMIT);
  });

  it('returns MIN_PAGINATION_LIMIT for the boundary value', async () => {
    const { sanitizePaginationLimit, MIN_PAGINATION_LIMIT } = await import('./settings');
    expect(sanitizePaginationLimit(50)).toBe(MIN_PAGINATION_LIMIT);
  });

  it('truncates decimal values', async () => {
    const { sanitizePaginationLimit, MIN_PAGINATION_LIMIT } = await import('./settings');
    expect(sanitizePaginationLimit(300.9)).toBe(300);
    expect(sanitizePaginationLimit(50.5)).toBe(50);
    expect(sanitizePaginationLimit(49.9)).toBe(MIN_PAGINATION_LIMIT);
  });

  it('passes through valid integer values', async () => {
    const { sanitizePaginationLimit } = await import('./settings');
    expect(sanitizePaginationLimit(100)).toBe(100);
    expect(sanitizePaginationLimit(300)).toBe(300);
    expect(sanitizePaginationLimit(1000)).toBe(1000);
  });
});

describe('getSettings', () => {
  it('sanitizes persisted page zoom values', async () => {
    const { getSettings, PAGE_ZOOM_DEFAULT, PAGE_ZOOM_MAX, PAGE_ZOOM_MIN } = await import(
      './settings'
    );

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
