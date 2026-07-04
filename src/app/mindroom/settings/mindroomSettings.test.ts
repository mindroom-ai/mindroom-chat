import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StorageRecord = Record<string, unknown>;

let storageValue: string | null = null;

describe('mindroom settings (CINNY-207 P6.1 / D4)', () => {
  beforeEach(() => {
    vi.resetModules();
    storageValue = null;
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => storageValue),
      setItem: vi.fn((_key: string, value: string) => {
        storageValue = value;
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    } as unknown as Storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops a stored paginationLimit value without mapping it onto prefetchDepth', async () => {
    // D4 semantics: the legacy value is discarded rather than translated.
    // A user who had `paginationLimit: 120` gets `prefetchDepth: 10000`
    // (the D4 default), not `prefetchDepth: 200` (a naive clamp).
    storageValue = JSON.stringify({ paginationLimit: 120 });
    const { mindroomSettingsAtom } = await import('./mindroomSettings');
    const store = createStore();
    const snapshot = store.get(mindroomSettingsAtom);

    expect(snapshot.prefetchDepth).toBe(10000);
    expect(snapshot.prefetchScope).toBe('my-server');
    expect((snapshot as StorageRecord).paginationLimit).toBeUndefined();
  });

  it('coerces a garbage prefetchScope back to the default', async () => {
    storageValue = JSON.stringify({ prefetchScope: 'invalid', prefetchDepth: 2500 });
    const { mindroomSettingsAtom } = await import('./mindroomSettings');
    const store = createStore();
    const snapshot = store.get(mindroomSettingsAtom);

    expect(snapshot.prefetchScope).toBe('my-server');
    expect(snapshot.prefetchDepth).toBe(2500);
  });

  it('never writes a paginationLimit key back to the settings blob after a settings update', async () => {
    storageValue = JSON.stringify({
      pageZoom: 90,
      paginationLimit: 120,
      prefetchScope: 'my-server',
      prefetchDepth: 1000,
    });
    const { mindroomSettingsAtom } = await import('./mindroomSettings');
    const store = createStore();

    store.set(mindroomSettingsAtom, {
      ...store.get(mindroomSettingsAtom),
      prefetchDepth: 3000,
    });

    const saved = JSON.parse(storageValue ?? '{}') as StorageRecord;
    expect(saved.pageZoom).toBe(90);
    expect(saved.prefetchDepth).toBe(3000);
    expect(saved.prefetchScope).toBe('my-server');
    // The legacy field is stripped on every write regardless of what
    // an in-memory Settings snapshot may still carry.
    expect(Object.prototype.hasOwnProperty.call(saved, 'paginationLimit')).toBe(false);
  });

  it('scrubs a legacy paginationLimit key from stored settings at module import', async () => {
    // The scrub is imported by `src/index.tsx` before `state/settings.ts`
    // initializes. This test invokes the scrub directly and asserts the
    // stored blob loses the legacy key while preserving everything else.
    storageValue = JSON.stringify({
      pageZoom: 100,
      paginationLimit: 120,
      showNotifications: true,
    });
    const { dropLegacyMindroomSettings } = await import('./mindroomSettingsBootstrap');
    dropLegacyMindroomSettings();

    const scrubbed = JSON.parse(storageValue ?? '{}') as StorageRecord;
    expect(Object.prototype.hasOwnProperty.call(scrubbed, 'paginationLimit')).toBe(false);
    expect(scrubbed.pageZoom).toBe(100);
    expect(scrubbed.showNotifications).toBe(true);
  });

  it('scrub is a no-op when the legacy key is absent', async () => {
    storageValue = JSON.stringify({ pageZoom: 100 });
    const before = storageValue;
    const { dropLegacyMindroomSettings } = await import('./mindroomSettingsBootstrap');
    dropLegacyMindroomSettings();
    expect(storageValue).toBe(before);
  });

  it('scrub is a no-op on a missing or malformed blob', async () => {
    const { dropLegacyMindroomSettings } = await import('./mindroomSettingsBootstrap');

    storageValue = null;
    expect(() => dropLegacyMindroomSettings()).not.toThrow();
    expect(storageValue).toBeNull();

    storageValue = '{not json}';
    expect(() => dropLegacyMindroomSettings()).not.toThrow();
    expect(storageValue).toBe('{not json}');

    storageValue = '["array"]';
    expect(() => dropLegacyMindroomSettings()).not.toThrow();
    expect(storageValue).toBe('["array"]');
  });

  // CINNY-207 P7.2 audit finding #4 — belt-and-braces guard: even if
  // the bootstrap scrub has NOT run (older stored blob, tests, race),
  // the plain `settingsAtom` write-back path must not resurrect the
  // legacy `paginationLimit` key. The existing "never writes" test at
  // the top of this file exercises the mindroom-aware
  // `mindroomSettingsAtom`; this case covers the plain `settingsAtom`
  // path used by every non-mindroom settings toggle in the app.
  it('never writes a paginationLimit key back via the plain settingsAtom write-back path', async () => {
    storageValue = JSON.stringify({
      pageZoom: 100,
      paginationLimit: 120,
      isPeopleDrawer: true,
    });
    // Note: this test imports state/settings.ts DIRECTLY (bypassing
    // mindroomSettings) — that's the failure surface finding #4
    // describes. `getSettings()` must strip `paginationLimit` at read
    // time so a later `setSettings(atomValue)` cannot re-persist it.
    const { settingsAtom } = await import('../../state/settings');
    const store = createStore();
    const snapshot = store.get(settingsAtom);
    expect((snapshot as StorageRecord).paginationLimit).toBeUndefined();

    // Simulate any non-mindroom settings toggle: flip isPeopleDrawer,
    // spread the current atom value, write back. The write path is the
    // one that would spread a contaminated atom back to storage.
    store.set(settingsAtom, {
      ...snapshot,
      isPeopleDrawer: false,
    });

    const saved = JSON.parse(storageValue ?? '{}') as StorageRecord;
    expect(saved.pageZoom).toBe(100);
    expect(saved.isPeopleDrawer).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(saved, 'paginationLimit')).toBe(false);
  });
});
