import { describe, expect, it } from 'vitest';
import { FALLBACK_BASE_URL_KEY, reconcileFallbackSessionHomeserver } from './sessions';

const createStorage = (seed: Record<string, string>) => {
  const state = new Map(Object.entries(seed));

  return {
    getItem: (key: string) => state.get(key) ?? null,
    setItem: (key: string, value: string) => {
      state.set(key, value);
    },
  };
};

describe('reconcileFallbackSessionHomeserver', () => {
  it('corrects stale cinny_hs_base_url when config enforces a single homeserver', () => {
    const storage = createStorage({
      [FALLBACK_BASE_URL_KEY]: 'https://old.example',
    });

    const changed = reconcileFallbackSessionHomeserver(
      {
        allowCustomHomeservers: false,
        homeserverList: ['https://mindroom.example'],
      },
      storage
    );

    expect(changed).toBe(true);
    expect(storage.getItem(FALLBACK_BASE_URL_KEY)).toBe('https://mindroom.example');
  });
});
