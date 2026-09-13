import { SyncState } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  areMessageSearchRoomsEqual,
  isInitialMessageSearchCatchupInProgress,
  normalizeMessageSearchRooms,
  shouldDeferImplicitMessageSearch,
} from './messageSearchScope';

describe('normalizeMessageSearchRooms', () => {
  it('sorts and deduplicates room ids', () => {
    expect(
      normalizeMessageSearchRooms([
        '!b:example.org',
        '!a:example.org',
        '!b:example.org',
      ])
    ).toEqual(['!a:example.org', '!b:example.org']);
  });

  it('returns undefined when no rooms are provided', () => {
    expect(normalizeMessageSearchRooms(undefined)).toBeUndefined();
  });
});

describe('areMessageSearchRoomsEqual', () => {
  it('returns true for matching ordered room scopes', () => {
    expect(
      areMessageSearchRoomsEqual(['!a:example.org', '!b:example.org'], [
        '!a:example.org',
        '!b:example.org',
      ])
    ).toBe(true);
  });

  it('returns false when room scopes differ', () => {
    expect(
      areMessageSearchRoomsEqual(['!a:example.org'], ['!b:example.org'])
    ).toBe(false);
  });
});

describe('isInitialMessageSearchCatchupInProgress', () => {
  it('treats the initial Prepared state as catchup', () => {
    expect(
      isInitialMessageSearchCatchupInProgress({
        current: SyncState.Prepared,
        previous: undefined,
      })
    ).toBe(true);
  });

  it('stops treating Syncing as initial catchup after steady-state sync', () => {
    expect(
      isInitialMessageSearchCatchupInProgress({
        current: SyncState.Syncing,
        previous: SyncState.Syncing,
      })
    ).toBe(false);
  });
});

describe('shouldDeferImplicitMessageSearch', () => {
  it('defers implicit room-scoped searches during initial catchup', () => {
    expect(
      shouldDeferImplicitMessageSearch({
        hasTerm: true,
        global: false,
        hasExplicitRooms: false,
        implicitRoomsReady: false,
      })
    ).toBe(true);
  });

  it('does not defer explicit room-scoped searches', () => {
    expect(
      shouldDeferImplicitMessageSearch({
        hasTerm: true,
        global: false,
        hasExplicitRooms: true,
        implicitRoomsReady: false,
      })
    ).toBe(false);
  });

  it('does not defer global searches', () => {
    expect(
      shouldDeferImplicitMessageSearch({
        hasTerm: true,
        global: true,
        hasExplicitRooms: false,
        implicitRoomsReady: false,
      })
    ).toBe(false);
  });

  it('defers implicit searches until the default room scope settles', () => {
    expect(
      shouldDeferImplicitMessageSearch({
        hasTerm: true,
        global: false,
        hasExplicitRooms: false,
        implicitRoomsReady: false,
      })
    ).toBe(true);
  });

  it('does not defer once the implicit room scope snapshot is ready', () => {
    expect(
      shouldDeferImplicitMessageSearch({
        hasTerm: true,
        global: false,
        hasExplicitRooms: false,
        implicitRoomsReady: true,
      })
    ).toBe(false);
  });
});
