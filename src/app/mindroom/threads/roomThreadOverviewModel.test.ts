import { describe, expect, it } from 'vitest';
import type { ThreadFilterState } from './roomThreadOverviewModel';

const makeDefaultState = (overrides?: Partial<ThreadFilterState>): ThreadFilterState => ({
  resolved: 'any',
  streaming: 'any',
  scheduled: 'any',
  unread: 'any',
  idle: 'any',
  sortBy: 'natural',
  sortDirection: 'desc',
  tags: new Map(),
  freeText: '',
  unsupportedQuery: '',
  statusMode: 'and',
  ...overrides,
});

describe('roomThreadOverviewModel', () => {
  describe('filter state serialization', () => {
    it('round-trips the default filter state', async () => {
      const {
        createDefaultThreadFilterState,
        deserializeThreadFilterState,
        serializeThreadFilterState,
      } = await import('./roomThreadOverviewModel');

      const state = createDefaultThreadFilterState();
      expect(serializeThreadFilterState(state)).toEqual({
        v: 2,
        resolved: 'any',
        streaming: 'any',
        scheduled: 'any',
        unread: 'any',
        idle: 'any',
        sortBy: 'lastReply',
        sortDirection: 'desc',
        tags: {},
        freeText: '',
        unsupportedQuery: '',
        statusMode: 'and',
      });
      expect(deserializeThreadFilterState(serializeThreadFilterState(state))).toEqual(state);
    });

    it('round-trips non-default filters, sort state, tags, search, and OR mode', async () => {
      const { deserializeThreadFilterState, serializeThreadFilterState } = await import(
        './roomThreadOverviewModel'
      );
      const state = makeDefaultState({
        resolved: 'include',
        streaming: 'exclude',
        scheduled: 'include',
        unread: 'exclude',
        idle: 'include',
        sortBy: 'lastReply',
        sortDirection: 'asc',
        freeText: 'hello',
        statusMode: 'or',
        tags: new Map([
          ['blocked', 'exclude'],
          ['needs-review', 'include'],
        ]),
      });

      expect(deserializeThreadFilterState(serializeThreadFilterState(state))).toEqual(state);
    });

    it('sanitizes malformed persisted filter state', async () => {
      const { deserializeThreadFilterState } = await import('./roomThreadOverviewModel');

      const result = deserializeThreadFilterState({
        v: 1,
        resolved: 'bad',
        streaming: 'include',
        scheduled: 'exclude',
        unread: 123,
        idle: 'any',
        sortBy: 'bad',
        sortDirection: 'bad',
        tags: {
          priority: 'include',
          ignored: 'any',
          blocked: 'exclude',
          invalid: 'wat',
        },
        searchQuery: 42,
        statusMode: 'wat',
      });

      expect(result).toEqual({
        resolved: 'any',
        streaming: 'include',
        scheduled: 'exclude',
        unread: 'any',
        idle: 'any',
        sortBy: 'lastReply',
        sortDirection: 'desc',
        tags: new Map([
          ['blocked', 'exclude'],
          ['priority', 'include'],
        ]),
        freeText: '',
        unsupportedQuery: '',
        statusMode: 'and',
      });
    });
  });

  describe('filter state helpers', () => {
    it('detects active/default room-overview states', async () => {
      const {
        createDefaultThreadFilterState,
        hasActiveThreadFilters,
        isDefaultThreadFilterState,
        isRoomThreadOverviewActive,
      } = await import('./roomThreadOverviewModel');

      const defaultState = createDefaultThreadFilterState();
      expect(isDefaultThreadFilterState(defaultState)).toBe(true);
      expect(hasActiveThreadFilters(defaultState)).toBe(false);
      expect(isRoomThreadOverviewActive(undefined, defaultState)).toBe(true);
      expect(isRoomThreadOverviewActive('$thread', defaultState)).toBe(false);

      const workingState = makeDefaultState({
        streaming: 'include',
        scheduled: 'include',
        statusMode: 'or',
      });
      expect(hasActiveThreadFilters(workingState)).toBe(true);
    });
  });

  describe('tag filter helpers', () => {
    it('counts tag filters', async () => {
      const { collectAvailableRoomTags } = await import('./roomThreadOverviewModel');

      expect(
        collectAvailableRoomTags(
          new Map([
            ['$a', { tags: { resolved: {}, priority: {} } }],
            ['$b', { tags: { blocked: {}, priority: {} } }],
            ['$c', { tags: null }],
          ])
        )
      ).toEqual(['blocked', 'priority', 'resolved']);
    });
  });

  describe('thread ordering helpers', () => {
    it('applies frozen order while preserving new live ids', async () => {
      const { applyFrozenThreadOrder } = await import('./roomThreadOverviewModel');

      expect(applyFrozenThreadOrder(['$c', '$missing', '$a'], ['$a', '$b', '$c', '$d'])).toEqual([
        '$c',
        '$a',
        '$b',
        '$d',
      ]);
    });

    it('creates stable sort-control signatures', async () => {
      const { createThreadSortControlSignature } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({
        tags: new Map([
          ['z', 'include'],
          ['a', 'exclude'],
        ]),
      });

      expect(createThreadSortControlSignature({ state, searchQuery: 'needle' })).toContain(
        '"searchQuery":"needle"'
      );
      expect(createThreadSortControlSignature({ state })).toBe(
        createThreadSortControlSignature({
          state: makeDefaultState({
            tags: new Map([
              ['a', 'exclude'],
              ['z', 'include'],
            ]),
          }),
        })
      );
    });
  });
});
