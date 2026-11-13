import { describe, expect, it } from 'vitest';
import { areMessageSearchRoomsEqual, normalizeMessageSearchRooms } from './messageSearchScope';

describe('normalizeMessageSearchRooms', () => {
  it('sorts and deduplicates room ids', () => {
    expect(
      normalizeMessageSearchRooms(['!b:example.org', '!a:example.org', '!b:example.org'])
    ).toEqual(['!a:example.org', '!b:example.org']);
  });

  it('returns undefined when no rooms are provided', () => {
    expect(normalizeMessageSearchRooms(undefined)).toBeUndefined();
  });
});

describe('areMessageSearchRoomsEqual', () => {
  it('returns true for matching ordered room scopes', () => {
    expect(
      areMessageSearchRoomsEqual(
        ['!a:example.org', '!b:example.org'],
        ['!a:example.org', '!b:example.org']
      )
    ).toBe(true);
  });

  it('returns false when room scopes differ', () => {
    expect(areMessageSearchRoomsEqual(['!a:example.org'], ['!b:example.org'])).toBe(false);
  });
});
