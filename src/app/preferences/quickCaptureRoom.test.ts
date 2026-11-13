// @vitest-environment jsdom
import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearQuickCaptureRoomStore, getQuickCaptureRoomAtom } from './quickCaptureRoom';

const KEY = 'quickCaptureRoom:@a:x';

beforeEach(() => {
  localStorage.clear();
  clearQuickCaptureRoomStore('@a:x');
  clearQuickCaptureRoomStore('@b:x');
});

afterEach(() => {
  clearQuickCaptureRoomStore('@a:x');
  clearQuickCaptureRoomStore('@b:x');
  localStorage.clear();
});

describe('quick capture default room', () => {
  it('starts empty, keeps the room per account and stores it', () => {
    const store = createStore();
    const roomAtom = getQuickCaptureRoomAtom('@a:x');
    expect(store.get(roomAtom)).toBeNull();

    store.set(roomAtom, '!r:x');

    expect(store.get(roomAtom)).toBe('!r:x');
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toBe('!r:x');
    expect(store.get(getQuickCaptureRoomAtom('@b:x'))).toBeNull();
  });

  it('reads a stored value that is not a string as no room', () => {
    localStorage.setItem(KEY, JSON.stringify(42));

    expect(createStore().get(getQuickCaptureRoomAtom('@a:x'))).toBeNull();
  });

  it('removes the key when cleared and when set to null', () => {
    const store = createStore();
    store.set(getQuickCaptureRoomAtom('@a:x'), '!r:x');
    clearQuickCaptureRoomStore('@a:x');

    expect(localStorage.getItem(KEY)).toBeNull();
    expect(createStore().get(getQuickCaptureRoomAtom('@a:x'))).toBeNull();

    const roomAtom = getQuickCaptureRoomAtom('@a:x');
    store.set(roomAtom, '!s:x');
    store.set(roomAtom, null);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
