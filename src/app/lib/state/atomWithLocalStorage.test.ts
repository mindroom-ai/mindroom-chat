// @vitest-environment jsdom
import { createStore } from 'jotai';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from './atomWithLocalStorage';

const KEY = 'atomWithLocalStorage.test';

const makeAtom = (setItem = setLocalStorageItem<string>) =>
  atomWithLocalStorage<string>(KEY, (key) => getLocalStorageItem(key, 'default'), setItem);

beforeEach(() => localStorage.clear());

describe('atomWithLocalStorage', () => {
  it('reads what another tab stored while nothing here watched, when it mounts again', () => {
    const store = createStore();
    const valueAtom = makeAtom();
    store.sub(valueAtom, () => undefined)();
    // The storage event fires while no store has the atom mounted.
    localStorage.setItem(KEY, JSON.stringify('other tab'));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

    const unsubscribe = store.sub(valueAtom, () => undefined);
    expect(store.get(valueAtom)).toBe('other tab');
    unsubscribe();
  });

  it('keeps a value storage refused when it mounts again', () => {
    const store = createStore();
    const valueAtom = makeAtom(() => undefined);
    store.sub(valueAtom, () => undefined)();
    store.set(valueAtom, 'kept for the session');

    const unsubscribe = store.sub(valueAtom, () => undefined);
    expect(store.get(valueAtom)).toBe('kept for the session');
    unsubscribe();
  });

  it('keeps all of its own write, of which storage keeps less, when it mounts again', () => {
    const store = createStore();
    // Like the recent threads, which store an encrypted room's thread without its text.
    const valueAtom = makeAtom((key, value) => setLocalStorageItem(key, value.slice(0, 4)));
    store.sub(valueAtom, () => undefined)();
    store.set(valueAtom, 'room with its text');

    const unsubscribe = store.sub(valueAtom, () => undefined);
    expect(store.get(valueAtom)).toBe('room with its text');
    unsubscribe();
  });

  it('follows another tab while mounted', () => {
    const store = createStore();
    const valueAtom = makeAtom();
    const unsubscribe = store.sub(valueAtom, () => undefined);
    localStorage.setItem(KEY, JSON.stringify('other tab'));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(store.get(valueAtom)).toBe('other tab');
    unsubscribe();
  });
});
