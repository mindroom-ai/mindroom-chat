// @vitest-environment jsdom
import { createStore } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearCompactRoomSectionsStore,
  DEFAULT_COMPACT_ROOM_SECTIONS,
  getCompactRoomSectionsAtom,
} from './compactRoomSections';

const ME = '@me:example.org';
const KEY = `compactRoomSections:${ME}`;

afterEach(() => {
  clearCompactRoomSectionsStore(ME);
  localStorage.clear();
});

describe('compactRoomSections', () => {
  it('starts off, with Quiet and Done folded', () => {
    expect(createStore().get(getCompactRoomSectionsAtom(ME))).toEqual({
      on: false,
      folded: ['quiet', 'done'],
    });
    expect(DEFAULT_COMPACT_ROOM_SECTIONS.on).toBe(false);
  });

  it('keeps the choice and the folds for the account, in every room', () => {
    const store = createStore();
    const sectionsAtom = getCompactRoomSectionsAtom(ME);

    store.set(sectionsAtom, { type: 'SET_ON', on: true });
    store.set(sectionsAtom, { type: 'TOGGLE_FOLD', id: 'done' });
    store.set(sectionsAtom, { type: 'TOGGLE_FOLD', id: 'later' });

    expect(store.get(sectionsAtom)).toEqual({ on: true, folded: ['quiet', 'later'] });
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({
      v: 2,
      on: true,
      folded: ['quiet', 'later'],
    });
  });

  it('migrates legacy v1 storage to fold Quiet and persists unfolding Quiet as v2', () => {
    localStorage.setItem(KEY, JSON.stringify({ on: true, folded: ['done'] }));
    const store = createStore();
    const sectionsAtom = getCompactRoomSectionsAtom(ME);
    expect(store.get(sectionsAtom)).toEqual({ on: true, folded: ['quiet', 'done'] });

    store.set(sectionsAtom, { type: 'TOGGLE_FOLD', id: 'quiet' });
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({
      v: 2,
      on: true,
      folded: ['done'],
    });

    // Reloading with v2 keeps Quiet unfolded.
    const saved = localStorage.getItem(KEY)!;
    clearCompactRoomSectionsStore(ME);
    localStorage.setItem(KEY, saved);
    expect(createStore().get(getCompactRoomSectionsAtom(ME))).toEqual({
      on: true,
      folded: ['done'],
    });
  });

  it('reads a stored value that is broken or partial as the default where it is', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ v: 2, on: true, folded: ['needsYou', 'nonsense', 4] })
    );
    expect(createStore().get(getCompactRoomSectionsAtom(ME))).toEqual({
      on: true,
      folded: ['needsYou'],
    });
    clearCompactRoomSectionsStore(ME);

    localStorage.setItem(KEY, JSON.stringify({ on: 'yes' }));
    expect(createStore().get(getCompactRoomSectionsAtom(ME))).toEqual(
      DEFAULT_COMPACT_ROOM_SECTIONS
    );
  });

  it('forgets the account choice when the account leaves', () => {
    const store = createStore();
    store.set(getCompactRoomSectionsAtom(ME), { type: 'SET_ON', on: true });

    clearCompactRoomSectionsStore(ME);

    expect(localStorage.getItem(KEY)).toBeNull();
    expect(createStore().get(getCompactRoomSectionsAtom(ME)).on).toBe(false);
  });
});
