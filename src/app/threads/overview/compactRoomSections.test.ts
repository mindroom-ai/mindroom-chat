// @vitest-environment jsdom
import { createStore } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearCompactRoomSectionsStore,
  DEFAULT_COMPACT_ROOM_SECTIONS,
  getCompactRoomSectionsAtom,
} from './compactRoomSections';
import { COMPACT_THREAD_SECTION_ORDER } from './compactThreadSections';

const ME = '@me:example.org';
const KEY = `compactRoomSections:${ME}`;
const DEFAULT_ORDER = [...COMPACT_THREAD_SECTION_ORDER];

afterEach(() => {
  clearCompactRoomSectionsStore(ME);
  localStorage.clear();
});

describe('compactRoomSections', () => {
  it('starts off, with Quiet and Done folded and canonical order', () => {
    expect(createStore().get(getCompactRoomSectionsAtom(ME))).toEqual({
      on: false,
      columns: false,
      folded: ['quiet', 'done'],
      order: DEFAULT_ORDER,
    });
    expect(DEFAULT_COMPACT_ROOM_SECTIONS.on).toBe(false);
    expect(DEFAULT_COMPACT_ROOM_SECTIONS.columns).toBe(false);
  });

  it('keeps the choice, columns mode, folds, and custom order for the account', () => {
    const store = createStore();
    const sectionsAtom = getCompactRoomSectionsAtom(ME);

    store.set(sectionsAtom, { type: 'SET_ON', on: true });
    store.set(sectionsAtom, { type: 'TOGGLE_FOLD', id: 'done' });
    store.set(sectionsAtom, { type: 'TOGGLE_FOLD', id: 'later' });

    expect(store.get(sectionsAtom)).toEqual({
      on: true,
      columns: false,
      folded: ['quiet', 'later'],
      order: DEFAULT_ORDER,
    });
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({
      v: 3,
      on: true,
      columns: false,
      folded: ['quiet', 'later'],
      order: DEFAULT_ORDER,
    });
  });

  it('transitions cleanly between flat, vertical sections, and columns', () => {
    const store = createStore();
    const sectionsAtom = getCompactRoomSectionsAtom(ME);

    store.set(sectionsAtom, { type: 'SET_COLUMNS', columns: true });
    expect(store.get(sectionsAtom)).toMatchObject({ on: true, columns: true });

    // Clicking Group from Columns switches to vertical grouped sections.
    store.set(sectionsAtom, { type: 'SET_ON', on: true });
    expect(store.get(sectionsAtom)).toMatchObject({ on: true, columns: false });

    // Turning Columns on and then off disables both columns and grouping.
    store.set(sectionsAtom, { type: 'SET_COLUMNS', columns: true });
    store.set(sectionsAtom, { type: 'SET_COLUMNS', columns: false });
    expect(store.get(sectionsAtom)).toMatchObject({ on: false, columns: false });

    // Turning Group off also clears columns.
    store.set(sectionsAtom, { type: 'SET_COLUMNS', columns: true });
    store.set(sectionsAtom, { type: 'SET_ON', on: false });
    expect(store.get(sectionsAtom)).toMatchObject({ on: false, columns: false });
  });

  it('reorders sections while deduplicating and preserving every valid bucket', () => {
    const store = createStore();
    const sectionsAtom = getCompactRoomSectionsAtom(ME);

    store.set(sectionsAtom, {
      type: 'REORDER_SECTIONS',
      order: ['working', 'done', 'working'],
    });
    expect(store.get(sectionsAtom).order).toEqual(['working', 'done', 'needsYou', 'later', 'quiet']);
  });

  it('migrates legacy v1 and v2 storage backward-compatibly to v3', () => {
    localStorage.setItem(KEY, JSON.stringify({ on: true, folded: ['done'] }));
    const store = createStore();
    const sectionsAtom = getCompactRoomSectionsAtom(ME);
    expect(store.get(sectionsAtom)).toEqual({
      on: true,
      columns: false,
      folded: ['quiet', 'done'],
      order: DEFAULT_ORDER,
    });

    store.set(sectionsAtom, { type: 'TOGGLE_FOLD', id: 'quiet' });
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({
      v: 3,
      on: true,
      columns: false,
      folded: ['done'],
      order: DEFAULT_ORDER,
    });

    // Reloading v2 storage preserves unfolded Quiet and fills missing columns/order defaults.
    clearCompactRoomSectionsStore(ME);
    localStorage.setItem(KEY, JSON.stringify({ v: 2, on: true, folded: ['done'] }));
    expect(createStore().get(getCompactRoomSectionsAtom(ME))).toEqual({
      on: true,
      columns: false,
      folded: ['done'],
      order: DEFAULT_ORDER,
    });
  });

  it('reads a stored value that is broken or partial as the default where it is', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        v: 3,
        on: true,
        columns: true,
        folded: ['needsYou', 'nonsense', 4],
        order: ['done', 'bogus', 'done', 'working'],
      })
    );
    expect(createStore().get(getCompactRoomSectionsAtom(ME))).toEqual({
      on: true,
      columns: true,
      folded: ['needsYou'],
      order: ['done', 'working', 'needsYou', 'later', 'quiet'],
    });
    clearCompactRoomSectionsStore(ME);

    localStorage.setItem(KEY, JSON.stringify({ on: 'yes', columns: true }));
    expect(createStore().get(getCompactRoomSectionsAtom(ME))).toEqual(
      DEFAULT_COMPACT_ROOM_SECTIONS
    );
  });

  it('forgets the account choice when the account leaves', () => {
    const store = createStore();
    store.set(getCompactRoomSectionsAtom(ME), { type: 'SET_COLUMNS', columns: true });

    clearCompactRoomSectionsStore(ME);

    expect(localStorage.getItem(KEY)).toBeNull();
    expect(createStore().get(getCompactRoomSectionsAtom(ME))).toEqual(
      DEFAULT_COMPACT_ROOM_SECTIONS
    );
  });
});
