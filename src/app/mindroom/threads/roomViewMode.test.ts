import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StorageListener = (event: StorageEvent) => void;

describe('roomViewMode', () => {
  const storageState = new Map<string, string>();
  const storageListeners = new Set<StorageListener>();

  const emitStorageEvent = (key: string) => {
    storageListeners.forEach((listener) => listener({ key } as StorageEvent));
  };

  beforeEach(() => {
    vi.resetModules();
    storageState.clear();
    storageListeners.clear();

    vi.stubGlobal('localStorage', {
      get length() {
        return storageState.size;
      },
      clear: vi.fn(() => {
        storageState.clear();
      }),
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      key: vi.fn((index: number) => Array.from(storageState.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => {
        storageState.delete(key);
      }),
      setItem: vi.fn((key: string, value: string) => {
        storageState.set(key, value);
      }),
    } as unknown as Storage);

    vi.stubGlobal('window', {
      addEventListener: vi.fn((type: string, listener: StorageListener) => {
        if (type === 'storage') storageListeners.add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: StorageListener) => {
        if (type === 'storage') storageListeners.delete(listener);
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    storageState.clear();
    storageListeners.clear();
  });

  it('defaults rooms to compact view', async () => {
    const { roomViewModeAtomFamily } = await import('./roomViewMode');
    const atom = roomViewModeAtomFamily('!room-a:example.org');
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    expect(store.get(atom)).toBe('compact');

    unmount();
  });

  it('persists room view mode per room', async () => {
    const { roomViewModeAtomFamily } = await import('./roomViewMode');
    const roomAAtom = roomViewModeAtomFamily('!room-a:example.org');
    const roomBAtom = roomViewModeAtomFamily('!room-b:example.org');
    const store = createStore();
    const unmountRoomA = store.sub(roomAAtom, () => undefined);
    const unmountRoomB = store.sub(roomBAtom, () => undefined);

    store.set(roomAAtom, 'threaded');

    expect(storageState.get('roomViewMode:!room-a:example.org')).toBe('"threaded"');
    expect(store.get(roomAAtom)).toBe('threaded');
    expect(store.get(roomBAtom)).toBe('compact');

    unmountRoomA();
    unmountRoomB();
  });

  it('updates mounted consumers when storage changes', async () => {
    const { roomViewModeAtomFamily } = await import('./roomViewMode');
    const atom = roomViewModeAtomFamily('!room-a:example.org');
    const storeA = createStore();
    const storeB = createStore();
    const unmountA = storeA.sub(atom, () => undefined);
    const unmountB = storeB.sub(atom, () => undefined);

    storeA.set(atom, 'threaded');
    expect(storeB.get(atom)).toBe('compact');

    emitStorageEvent('roomViewMode:!room-a:example.org');

    expect(storeB.get(atom)).toBe('threaded');

    unmountA();
    unmountB();
  });

  it('migrates legacy normal mode to threaded mode', async () => {
    storageState.set('roomViewMode:!room-a:example.org', '"normal"');
    const { roomViewModeAtomFamily } = await import('./roomViewMode');
    const atom = roomViewModeAtomFamily('!room-a:example.org');
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    expect(store.get(atom)).toBe('threaded');

    unmount();
  });
});
