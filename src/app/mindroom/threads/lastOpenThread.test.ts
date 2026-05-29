import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLastOpenThread,
  clearLastOpenThreadStore,
  getLastOpenThread,
  makeLastOpenThreadAtom,
  registerLastOpenThreadAtom,
  setLastOpenThread,
} from './lastOpenThread';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
  });
});

afterEach(() => {
  clearLastOpenThreadStore('@alice:example.org');
  vi.unstubAllGlobals();
});

describe('lastOpenThread', () => {
  it('persists the active room/thread restore target per user', () => {
    const atom = makeLastOpenThreadAtom('@alice:example.org');
    const unregister = registerLastOpenThreadAtom(atom);

    setLastOpenThread('!room:example.org', '$thread-root');

    expect(getLastOpenThread('!room:example.org')).toBe('$thread-root');
    expect(storage.get('lastOpenThread@alice:example.org')).toBe(
      '{"!room:example.org":"$thread-root"}'
    );

    clearLastOpenThread('!room:example.org');

    expect(getLastOpenThread('!room:example.org')).toBeUndefined();
    expect(storage.get('lastOpenThread@alice:example.org')).toBe('{}');

    unregister();
  });

  it('ignores local-echo thread ids when storing restore targets', () => {
    const atom = makeLastOpenThreadAtom('@alice:example.org');
    const unregister = registerLastOpenThreadAtom(atom);

    setLastOpenThread('!room:example.org', '~pending');

    expect(getLastOpenThread('!room:example.org')).toBeUndefined();
    expect(storage.get('lastOpenThread@alice:example.org')).toBeUndefined();

    unregister();
  });

  it('drops legacy local-echo thread ids from stored restore targets', () => {
    storage.set(
      'lastOpenThread@alice:example.org',
      '{"!room:example.org":"~pending","!other:example.org":"$confirmed"}'
    );
    const atom = makeLastOpenThreadAtom('@alice:example.org');
    const unregister = registerLastOpenThreadAtom(atom);

    expect(getLastOpenThread('!room:example.org')).toBeUndefined();
    expect(getLastOpenThread('!other:example.org')).toBe('$confirmed');

    unregister();
  });

  it('ignores malformed stored restore targets', () => {
    storage.set('lastOpenThread@alice:example.org', 'null');
    const atom = makeLastOpenThreadAtom('@alice:example.org');
    const unregister = registerLastOpenThreadAtom(atom);

    expect(getLastOpenThread('!room:example.org')).toBeUndefined();

    unregister();
  });

  it('clears the user-scoped store and active registration', () => {
    const atom = makeLastOpenThreadAtom('@alice:example.org');
    registerLastOpenThreadAtom(atom);
    setLastOpenThread('!room:example.org', '$thread-root');

    clearLastOpenThreadStore('@alice:example.org');

    expect(getLastOpenThread('!room:example.org')).toBeUndefined();
    expect(storage.has('lastOpenThread@alice:example.org')).toBe(false);
  });
});
