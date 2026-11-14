import { describe, expect, it } from 'vitest';
import type { ThreadFilterState } from './roomThreadOverviewModel';

const makeDefaultState = (overrides?: Partial<ThreadFilterState>): ThreadFilterState => ({
  resolved: 'any',
  snoozed: 'any',
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
        snoozed: 'any',
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
        snoozed: 'include',
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
        snoozed: 'exclude',
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

    it('reads a stored filter state without a snoozed key as excluding snoozed threads', async () => {
      const { deserializeThreadFilterState, serializeThreadFilterState } = await import(
        './roomThreadOverviewModel'
      );
      const stored = { ...serializeThreadFilterState(makeDefaultState()) } as Record<
        string,
        unknown
      >;
      delete stored.snoozed;

      expect(deserializeThreadFilterState(stored).snoozed).toBe('exclude');
      expect(deserializeThreadFilterState({ ...stored, snoozed: 'bad' }).snoozed).toBe('exclude');
      expect(deserializeThreadFilterState({ ...stored, snoozed: 'any' }).snoozed).toBe('any');
      // A v1 state stored its filters as a query too; one without is:snoozed excludes them.
      expect(
        deserializeThreadFilterState({ ...stored, v: 1, searchQuery: '-is:resolved' })
      ).toMatchObject({ resolved: 'exclude', snoozed: 'exclude' });
      expect(
        deserializeThreadFilterState({ ...stored, v: 1, searchQuery: 'is:snoozed' }).snoozed
      ).toBe('include');
      const { snoozed: _ignored, ...withoutSnoozed } = makeDefaultState();
      expect(serializeThreadFilterState(withoutSnoozed as ThreadFilterState).snoozed).toBe(
        'exclude'
      );
    });
  });

  describe('filter state helpers', () => {
    it('does not count the default snoozed exclusion of an old stored state as a filter', async () => {
      const {
        deserializeThreadFilterState,
        hasActiveThreadFilters,
        hasChosenThreadFilters,
        isRoomThreadOverviewActive,
      } = await import('./roomThreadOverviewModel');
      // Stored before snoozing existed: every status any, natural sort, no snoozed key.
      const stored = deserializeThreadFilterState({
        v: 2,
        resolved: 'any',
        streaming: 'any',
        scheduled: 'any',
        unread: 'any',
        idle: 'any',
        sortBy: 'natural',
        sortDirection: 'desc',
        tags: {},
      });

      expect(stored.snoozed).toBe('exclude');
      expect(hasActiveThreadFilters(stored)).toBe(true);
      expect(hasChosenThreadFilters(stored)).toBe(false);
      expect(isRoomThreadOverviewActive(undefined, stored)).toBe(false);
      expect(isRoomThreadOverviewActive(undefined, { ...stored, snoozed: 'include' })).toBe(true);
      expect(isRoomThreadOverviewActive(undefined, { ...stored, resolved: 'exclude' })).toBe(true);
    });

    it('cycles status filters and resets status mode to AND', async () => {
      const { updateThreadFilterKey } = await import('./roomThreadOverviewModel');

      expect(
        updateThreadFilterKey(makeDefaultState({ statusMode: 'or' }), 'resolved')
      ).toMatchObject({
        resolved: 'include',
        statusMode: 'and',
      });
      expect(
        updateThreadFilterKey(makeDefaultState({ resolved: 'include' }), 'resolved').resolved
      ).toBe('exclude');
      expect(
        updateThreadFilterKey(makeDefaultState({ resolved: 'exclude' }), 'resolved').resolved
      ).toBe('any');
    });

    it('cycles natural/last-reply sort modes in the UI order', async () => {
      const { cycleSortMode } = await import('./roomThreadOverviewModel');

      expect(cycleSortMode(makeDefaultState({ sortBy: 'natural' }))).toEqual({
        sortBy: 'lastReply',
        sortDirection: 'desc',
      });
      expect(
        cycleSortMode(makeDefaultState({ sortBy: 'lastReply', sortDirection: 'desc' }))
      ).toEqual({
        sortBy: 'lastReply',
        sortDirection: 'asc',
      });
      expect(
        cycleSortMode(makeDefaultState({ sortBy: 'lastReply', sortDirection: 'asc' }))
      ).toEqual({
        sortBy: 'natural',
        sortDirection: 'desc',
      });
    });

    it('detects active/default room-overview states', async () => {
      const {
        createDefaultThreadFilterState,
        hasActiveThreadFilters,
        isOrModeStatusChip,
        isRoomThreadOverviewActive,
        resetThreadFilterState,
      } = await import('./roomThreadOverviewModel');

      const defaultState = createDefaultThreadFilterState();
      expect(hasActiveThreadFilters(defaultState)).toBe(false);
      expect(isRoomThreadOverviewActive(undefined, defaultState)).toBe(true);
      expect(isRoomThreadOverviewActive('$thread', defaultState)).toBe(false);
      expect(resetThreadFilterState()).toEqual(defaultState);

      const workingState = makeDefaultState({
        streaming: 'include',
        scheduled: 'include',
        statusMode: 'or',
      });
      expect(hasActiveThreadFilters(workingState)).toBe(true);
      expect(isOrModeStatusChip(workingState, 'streaming')).toBe(true);
      expect(isOrModeStatusChip(workingState, 'resolved')).toBe(false);
    });
  });

  describe('tag filter helpers', () => {
    it('adds, removes, and counts tag filters', async () => {
      const { addTagFilter, collectAvailableRoomTags, removeTagFilter } = await import(
        './roomThreadOverviewModel'
      );

      const defaultState = makeDefaultState();
      const added = addTagFilter(defaultState, 'blocked');
      expect(added.tags.get('blocked')).toBe('include');
      expect(removeTagFilter(added, 'blocked').tags.has('blocked')).toBe(false);

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

  describe('filter presets', () => {
    it('has a Snoozed preset and keeps snoozed threads out of Needs attention and Unread', async () => {
      const { FILTER_PRESETS, applyPreset } = await import('./roomThreadOverviewModel');
      const preset = (id: string) => {
        const found = FILTER_PRESETS.find((candidate) => candidate.id === id);
        if (!found) throw new Error(`${id} preset missing`);
        return found;
      };

      expect(preset('snoozed')).toMatchObject({
        label: 'Snoozed',
        description: 'Snoozed threads only',
        apply: { snoozed: 'include' },
      });
      expect(
        applyPreset(makeDefaultState({ resolved: 'include' }), preset('snoozed'))
      ).toMatchObject({ resolved: 'any', snoozed: 'include' });
      expect(applyPreset(makeDefaultState(), preset('needs-attention')).snoozed).toBe('exclude');
      expect(applyPreset(makeDefaultState(), preset('review-queue')).snoozed).toBe('exclude');
      expect(
        applyPreset(makeDefaultState({ snoozed: 'exclude' }), preset('archived')).snoozed
      ).toBe('any');
    });

    it('keeps only an excluding snoozed filter in Simple mode', async () => {
      const { simplifyThreadFilterState } = await import('./roomThreadOverviewModel');

      expect(simplifyThreadFilterState(makeDefaultState({ snoozed: 'exclude' })).snoozed).toBe(
        'exclude'
      );
      expect(simplifyThreadFilterState(makeDefaultState({ snoozed: 'include' })).snoozed).toBe(
        'any'
      );
    });

    it('materializes the working preset as streaming OR scheduled and serializes it', async () => {
      const { FILTER_PRESETS, applyPreset } = await import('./roomThreadOverviewModel');
      const { serializeThreadFilterQuery } = await import('./threadFilterDsl');
      const workingPreset = FILTER_PRESETS.find((preset) => preset.id === 'working');
      if (!workingPreset) throw new Error('working preset missing');

      const state = applyPreset(makeDefaultState(), workingPreset);

      expect(state).toMatchObject({
        streaming: 'include',
        scheduled: 'include',
        statusMode: 'or',
      });
      expect(serializeThreadFilterQuery(state)).toBe('is:streaming OR is:scheduled');
    });

    it('resets all filters for the all preset', async () => {
      const { FILTER_PRESETS, applyPreset } = await import('./roomThreadOverviewModel');
      const allPreset = FILTER_PRESETS.find((preset) => preset.id === 'all');
      if (!allPreset) throw new Error('all preset missing');

      const state = applyPreset(
        makeDefaultState({
          resolved: 'include',
          tags: new Map([['priority', 'include']]),
          freeText: 'needle',
          unsupportedQuery: 'tag:a OR tag:b',
        }),
        allPreset
      );

      expect(state.tags.size).toBe(0);
      expect(state.freeText).toBe('');
      expect(state.unsupportedQuery).toBe('');
      expect(state.resolved).toBe('any');
    });
  });

  describe('simplifyAgentlessSimpleThreadFilterState', () => {
    it('keeps only the sort, leaving the resolved and snoozed filters inactive', async () => {
      const { simplifyAgentlessSimpleThreadFilterState } = await import(
        './roomThreadOverviewModel'
      );

      expect(
        simplifyAgentlessSimpleThreadFilterState(
          makeDefaultState({
            resolved: 'exclude',
            snoozed: 'exclude',
            sortBy: 'lastReply',
            sortDirection: 'asc',
          })
        )
      ).toEqual({
        ...makeDefaultState(),
        sortBy: 'lastReply',
        sortDirection: 'asc',
      });
    });
  });

  describe('simplifyAgentlessThreadFilterState', () => {
    it('keeps only text search and sorting from the full toolbar state', async () => {
      const { simplifyAgentlessThreadFilterState } = await import('./roomThreadOverviewModel');

      const projected = simplifyAgentlessThreadFilterState(
        makeDefaultState({
          resolved: 'include',
          snoozed: 'exclude',
          streaming: 'exclude',
          scheduled: 'include',
          unread: 'exclude',
          idle: 'include',
          sortBy: 'lastReply',
          sortDirection: 'asc',
          statusMode: 'or',
          tags: new Map([['priority', 'include']]),
          freeText: 'needle',
          unsupportedQuery: 'from:alice',
        })
      );

      expect(projected).toEqual({
        ...makeDefaultState(),
        sortBy: 'lastReply',
        sortDirection: 'asc',
        freeText: 'needle',
        unsupportedQuery: 'from:alice',
      });
    });
  });
});
