import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearToolCallOverrides,
  resolveToolCallsShown,
  sanitizeToolCallOverrides,
  withToolCallsShown,
} from './toolCallVisibility';

const ROOM = '!room:example.org';
const OTHER_ROOM = '!other:example.org';
const THREAD = '$root';

describe('resolveToolCallsShown', () => {
  it('follows the default where nothing was chosen', () => {
    expect(resolveToolCallsShown({}, false, ROOM, THREAD)).toBe(false);
    expect(resolveToolCallsShown({}, true, ROOM)).toBe(true);
    expect(resolveToolCallsShown({}, true)).toBe(true);
  });

  it("takes the room's choice over the default, and the thread's over the room's", () => {
    const overrides = { [ROOM]: { room: true, threads: { [THREAD]: false } } };
    expect(resolveToolCallsShown(overrides, false, ROOM)).toBe(true);
    expect(resolveToolCallsShown(overrides, false, ROOM, '$another')).toBe(true);
    expect(resolveToolCallsShown(overrides, false, ROOM, THREAD)).toBe(false);
    expect(resolveToolCallsShown(overrides, false, OTHER_ROOM, THREAD)).toBe(false);
  });
});

describe('withToolCallsShown', () => {
  it('keeps a choice that differs from what the level above gives', () => {
    const room = withToolCallsShown({}, false, ROOM, undefined, true);
    expect(room).toEqual({ [ROOM]: { room: true } });
    const thread = withToolCallsShown(room, false, ROOM, THREAD, false);
    expect(thread).toEqual({ [ROOM]: { room: true, threads: { [THREAD]: false } } });
  });

  it('forgets a choice equal to what the level above gives, so the room follows it again', () => {
    const overrides = { [ROOM]: { room: true, threads: { [THREAD]: false } } };
    expect(withToolCallsShown(overrides, false, ROOM, THREAD, true)).toEqual({
      [ROOM]: { room: true },
    });
    expect(withToolCallsShown({ [ROOM]: { room: true } }, false, ROOM, undefined, false)).toEqual(
      {}
    );
  });
});

describe('sanitizeToolCallOverrides', () => {
  it('keeps only boolean choices', () => {
    expect(
      sanitizeToolCallOverrides({
        [ROOM]: { room: true, threads: { [THREAD]: false, $bad: 'yes' } },
        [OTHER_ROOM]: { room: 'no', threads: [] },
        '!list:example.org': [],
      })
    ).toEqual({ [ROOM]: { room: true, threads: { [THREAD]: false } } });
    expect(sanitizeToolCallOverrides('nonsense')).toEqual({});
    expect(sanitizeToolCallOverrides(null)).toEqual({});
  });
});

describe('clearToolCallOverrides', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forgets one account's room and thread choices, and keeps another account's", () => {
    const choices = JSON.stringify({ [ROOM]: { room: true, threads: { [THREAD]: false } } });
    const stored = new Map([
      ['toolCallsShown:one', choices],
      ['toolCallsShown:two', choices],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
    clearToolCallOverrides('one');
    expect([...stored.keys()]).toEqual(['toolCallsShown:two']);
  });
});
