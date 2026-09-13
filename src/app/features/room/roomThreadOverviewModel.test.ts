import { describe, expect, it, vi } from 'vitest';
import type { ThreadOverviewMetadata, ThreadFilterState, TriState } from './roomThreadOverviewModel';

vi.mock('../../hooks/useThreadLastActivityTs', () => ({
  getThreadLastActivityTs: (_room: unknown, threadRootId: string) => {
    const map: Record<string, number> = {
      '$thread-1': 1000,
      '$thread-2': 2000,
      '$thread-3': 3000,
      '$thread-streaming': 2500,
      '$thread-scheduled': 1500,
    };
    return map[threadRootId] ?? 0;
  },
}));

vi.mock('../../hooks/useThreadStreamingState', () => ({
  getThreadStreamingState: (_room: unknown, threadRootId: string) =>
    threadRootId === '$thread-streaming',
}));

vi.mock('../../utils/scheduledTaskContract', () => ({
  parseScheduledTaskStateEvent: (event: {
    getStateKey: () => string;
    getContent: () => Record<string, unknown>;
  }) => {
    const content = event.getContent();
    return {
      taskId: event.getStateKey(),
      status: content.status as string,
      threadId: content.thread_id as string | null,
      newThread: content.new_thread as boolean,
      executeAt: content.execute_at as string | null,
    };
  },
}));

const makeDefaultState = (overrides?: Partial<ThreadFilterState>): ThreadFilterState => ({
  resolved: 'any',
  streaming: 'any',
  scheduled: 'any',
  unread: 'any',
  idle: 'any',
  sortBy: 'natural',
  sortDirection: 'desc',
  tags: new Map(),
  searchQuery: '',
  statusMode: 'and',
  ...overrides,
});

// ─── Thread metadata fixtures ────────────────────────────────────────────────

const mkMeta = (overrides: Partial<ThreadOverviewMetadata> = {}): ThreadOverviewMetadata => ({
  isResolved: false,
  isUnread: false,
  isStreaming: false,
  scheduledTaskCount: 0,
  lastActivityTs: 0,
  absoluteIndex: 0,
  lastSenderId: undefined,
  lastSenderDisplayName: undefined,
  participantDisplayName: undefined,
  summaryText: undefined,
  rootPreviewText: undefined,
  messageCount: 0,
  tags: [],
  ...overrides,
});

const makeRootPreviewEvent = (body: string, editedBody?: string, ts = 0) =>
  ({
    getContent: () =>
      editedBody
        ? {
            body,
            'm.new_content': {
              body: editedBody,
            },
          }
        : { body },
    replacingEvent: () => undefined,
    getSender: () => '@agent:x',
    getId: () => '$thread-1',
    getTs: () => ts,
    getType: () => 'm.room.message',
    getUnsigned: () => undefined,
  }) as never;

const makeHiddenThreadTagEvent = (threadRootId: string, ts: number, sender = '@agent:x') =>
  ({
    getContent: () => ({
      'm.relates_to': {
        event_id: threadRootId,
        rel_type: 'm.thread',
      },
    }),
    getId: () => `$thread-tag-${threadRootId}`,
    getRelation: () => ({ event_id: threadRootId, rel_type: 'm.thread' }),
    getSender: () => sender,
    getTs: () => ts,
    getType: () => 'com.mindroom.thread.tag',
    isRedacted: () => false,
    isRedaction: () => false,
    threadRootId,
  }) as never;

const makeVisibleThreadReplyEvent = (
  eventId: string,
  threadRootId: string,
  ts: number,
  sender = '@agent:x'
) =>
  ({
    getContent: () => ({
      body: eventId,
      msgtype: 'm.text',
      'm.relates_to': {
        event_id: threadRootId,
        rel_type: 'm.thread',
      },
    }),
    getId: () => eventId,
    getRelation: () => ({ event_id: threadRootId, rel_type: 'm.thread' }),
    getSender: () => sender,
    getTs: () => ts,
    getType: () => 'm.room.message',
    isRedacted: () => false,
    isRedaction: () => false,
    threadRootId,
  }) as never;

describe('roomThreadOverviewModel', () => {
  describe('serializeThreadFilterState', () => {
    it('round-trips the default filter state', async () => {
      const {
        createDefaultThreadFilterState,
        deserializeThreadFilterState,
        serializeThreadFilterState,
      } = await import('./roomThreadOverviewModel');

      const state = createDefaultThreadFilterState();
      expect(serializeThreadFilterState(state)).toEqual({
        v: 1,
        resolved: 'any',
        streaming: 'any',
        scheduled: 'any',
        unread: 'any',
        idle: 'any',
        sortBy: 'lastReply',
        sortDirection: 'desc',
        tags: {},
        searchQuery: '',
        statusMode: 'and',
      });
      expect(deserializeThreadFilterState(serializeThreadFilterState(state))).toEqual(state);
    });

    it('round-trips non-default filters, sort state, and tags', async () => {
      const {
        deserializeThreadFilterState,
        serializeThreadFilterState,
      } = await import('./roomThreadOverviewModel');

      const state = makeDefaultState({
        resolved: 'include',
        streaming: 'exclude',
        scheduled: 'include',
        unread: 'exclude',
        idle: 'include',
        sortBy: 'lastReply',
        sortDirection: 'asc',
        searchQuery: 'hello',
        statusMode: 'or',
        tags: new Map([
          ['blocked', 'exclude'],
          ['needs-review', 'include'],
        ]),
      });

      const serialized = serializeThreadFilterState(state);
      expect(serialized).toEqual({
        v: 1,
        resolved: 'include',
        streaming: 'exclude',
        scheduled: 'include',
        unread: 'exclude',
        idle: 'include',
        sortBy: 'lastReply',
        sortDirection: 'asc',
        tags: {
          blocked: 'exclude',
          'needs-review': 'include',
        },
        searchQuery: 'hello',
        statusMode: 'or',
      });
      expect(deserializeThreadFilterState(serialized)).toEqual(state);
    });

    it('falls back to defaults for malformed payloads', async () => {
      const {
        createDefaultThreadFilterState,
        deserializeThreadFilterState,
      } = await import('./roomThreadOverviewModel');

      expect(deserializeThreadFilterState('nope')).toEqual(createDefaultThreadFilterState());
      expect(deserializeThreadFilterState(null)).toEqual(createDefaultThreadFilterState());
      expect(deserializeThreadFilterState(['bad'])).toEqual(createDefaultThreadFilterState());
    });

    it('recovers valid fields from partially invalid payloads', async () => {
      const { deserializeThreadFilterState } = await import('./roomThreadOverviewModel');

      expect(
        deserializeThreadFilterState({
          v: 1,
          resolved: 'include',
          streaming: 'broken',
          scheduled: 'exclude',
          unread: 'any',
          idle: 'include',
          sortBy: 'natural',
          sortDirection: 'asc',
          tags: {
            blocked: 'exclude',
            ignored: 'any',
            broken: 'maybe',
          },
        })
      ).toEqual(
        makeDefaultState({
          resolved: 'include',
          scheduled: 'exclude',
          idle: 'include',
          sortBy: 'natural',
          sortDirection: 'desc',
          tags: new Map([['blocked', 'exclude']]),
        })
      );
    });

    it('defaults missing searchQuery and statusMode for older persisted payloads', async () => {
      const { deserializeThreadFilterState } = await import('./roomThreadOverviewModel');

      expect(
        deserializeThreadFilterState({
          v: 1,
          resolved: 'include',
          streaming: 'exclude',
          scheduled: 'any',
          unread: 'include',
          idle: 'any',
          sortBy: 'lastReply',
          sortDirection: 'asc',
          tags: {
            blocked: 'exclude',
          },
        })
      ).toEqual(
        makeDefaultState({
          resolved: 'include',
          streaming: 'exclude',
          unread: 'include',
          sortBy: 'lastReply',
          sortDirection: 'asc',
          tags: new Map([['blocked', 'exclude']]),
          searchQuery: '',
          statusMode: 'and',
        })
      );
    });

    it('guards on the serialized version field', async () => {
      const {
        createDefaultThreadFilterState,
        deserializeThreadFilterState,
      } = await import('./roomThreadOverviewModel');

      expect(
        deserializeThreadFilterState({
          v: 2,
          resolved: 'include',
        })
      ).toEqual(createDefaultThreadFilterState());
    });
  });

  // ═══ Tri-state cycling ═══════════════════════════════════════════════════

  describe('cycleTriState', () => {
    it('cycles any -> include -> exclude -> any', async () => {
      const { cycleTriState } = await import('./roomThreadOverviewModel');
      expect(cycleTriState('any')).toBe('include');
      expect(cycleTriState('include')).toBe('exclude');
      expect(cycleTriState('exclude')).toBe('any');
    });
  });

  // ═══ matchesTriState ═══════════════════════════════════════════════════

  describe('matchesTriState', () => {
    it('returns true for any regardless of value', async () => {
      const { matchesTriState } = await import('./roomThreadOverviewModel');
      expect(matchesTriState(true, 'any')).toBe(true);
      expect(matchesTriState(false, 'any')).toBe(true);
    });

    it('returns the value for include', async () => {
      const { matchesTriState } = await import('./roomThreadOverviewModel');
      expect(matchesTriState(true, 'include')).toBe(true);
      expect(matchesTriState(false, 'include')).toBe(false);
    });

    it('returns the negated value for exclude', async () => {
      const { matchesTriState } = await import('./roomThreadOverviewModel');
      expect(matchesTriState(true, 'exclude')).toBe(false);
      expect(matchesTriState(false, 'exclude')).toBe(true);
    });
  });

  // ═══ matchesThreadFilterState ═════════════════════════════════════════

  describe('matchesThreadFilterState', () => {
    it('matches all threads when all filters are any', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState();
      expect(matchesThreadFilterState(mkMeta(), state)).toBe(true);
      expect(matchesThreadFilterState(mkMeta({ isResolved: true }), state)).toBe(true);
    });

    it('include resolved shows only resolved threads', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ resolved: 'include' });
      expect(matchesThreadFilterState(mkMeta({ isResolved: true }), state)).toBe(true);
      expect(matchesThreadFilterState(mkMeta({ isResolved: false }), state)).toBe(false);
    });

    it('exclude resolved shows only unresolved threads', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ resolved: 'exclude' });
      expect(matchesThreadFilterState(mkMeta({ isResolved: false }), state)).toBe(true);
      expect(matchesThreadFilterState(mkMeta({ isResolved: true }), state)).toBe(false);
    });

    it('include streaming shows only streaming threads', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ streaming: 'include' });
      expect(matchesThreadFilterState(mkMeta({ isStreaming: true }), state)).toBe(true);
      expect(matchesThreadFilterState(mkMeta({ isStreaming: false }), state)).toBe(false);
    });

    it('include scheduled shows only scheduled threads', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ scheduled: 'include' });
      expect(matchesThreadFilterState(mkMeta({ scheduledTaskCount: 2 }), state)).toBe(true);
      expect(matchesThreadFilterState(mkMeta({ scheduledTaskCount: 0 }), state)).toBe(false);
    });

    it('include unread shows only unread threads', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ unread: 'include' });
      expect(matchesThreadFilterState(mkMeta({ isUnread: true }), state)).toBe(true);
      expect(matchesThreadFilterState(mkMeta({ isUnread: false }), state)).toBe(false);
    });

    it('idle derivation: resolved && !streaming && scheduledTaskCount===0', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ idle: 'include' });
      // Idle thread
      expect(
        matchesThreadFilterState(
          mkMeta({ isResolved: true, isStreaming: false, scheduledTaskCount: 0 }),
          state
        )
      ).toBe(true);
      // Not idle: streaming
      expect(
        matchesThreadFilterState(
          mkMeta({ isResolved: true, isStreaming: true, scheduledTaskCount: 0 }),
          state
        )
      ).toBe(false);
      // Not idle: has scheduled tasks
      expect(
        matchesThreadFilterState(
          mkMeta({ isResolved: true, isStreaming: false, scheduledTaskCount: 1 }),
          state
        )
      ).toBe(false);
      // Not idle: not resolved
      expect(
        matchesThreadFilterState(
          mkMeta({ isResolved: false, isStreaming: false, scheduledTaskCount: 0 }),
          state
        )
      ).toBe(false);
    });

    it('exclude idle hides idle threads', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ idle: 'exclude' });
      // Idle thread should be excluded
      expect(
        matchesThreadFilterState(
          mkMeta({ isResolved: true, isStreaming: false, scheduledTaskCount: 0 }),
          state
        )
      ).toBe(false);
      // Non-idle passes
      expect(
        matchesThreadFilterState(
          mkMeta({ isResolved: true, isStreaming: true, scheduledTaskCount: 0 }),
          state
        )
      ).toBe(true);
    });

    // AND composition
    it('unread include + resolved exclude shows only unread unresolved', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ unread: 'include', resolved: 'exclude' });
      expect(
        matchesThreadFilterState(mkMeta({ isUnread: true, isResolved: false }), state)
      ).toBe(true);
      expect(
        matchesThreadFilterState(mkMeta({ isUnread: true, isResolved: true }), state)
      ).toBe(false);
      expect(
        matchesThreadFilterState(mkMeta({ isUnread: false, isResolved: false }), state)
      ).toBe(false);
    });

    it('scheduled exclude + streaming include shows streaming non-scheduled', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ scheduled: 'exclude', streaming: 'include' });
      expect(
        matchesThreadFilterState(
          mkMeta({ isStreaming: true, scheduledTaskCount: 0 }),
          state
        )
      ).toBe(true);
      expect(
        matchesThreadFilterState(
          mkMeta({ isStreaming: true, scheduledTaskCount: 1 }),
          state
        )
      ).toBe(false);
    });

    it('resolved include + idle include narrows to resolved non-streaming non-scheduled', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ resolved: 'include', idle: 'include' });
      expect(
        matchesThreadFilterState(
          mkMeta({ isResolved: true, isStreaming: false, scheduledTaskCount: 0 }),
          state
        )
      ).toBe(true);
      expect(
        matchesThreadFilterState(
          mkMeta({ isResolved: true, isStreaming: true, scheduledTaskCount: 0 }),
          state
        )
      ).toBe(false);
    });

    it('idle include + resolved exclude yields empty (contradictory)', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ idle: 'include', resolved: 'exclude' });
      // idle requires resolved=true, but resolved=exclude requires resolved=false
      expect(
        matchesThreadFilterState(
          mkMeta({ isResolved: true, isStreaming: false, scheduledTaskCount: 0 }),
          state
        )
      ).toBe(false);
      expect(
        matchesThreadFilterState(
          mkMeta({ isResolved: false, isStreaming: false, scheduledTaskCount: 0 }),
          state
        )
      ).toBe(false);
    });
  });

  // ═══ hasActiveThreadFilters ═══════════════════════════════════════════

  describe('hasActiveThreadFilters', () => {
    it('returns false when all filters are any', async () => {
      const { hasActiveThreadFilters } = await import('./roomThreadOverviewModel');
      expect(hasActiveThreadFilters(makeDefaultState())).toBe(false);
    });

    it('returns true when any filter is not any', async () => {
      const { hasActiveThreadFilters } = await import('./roomThreadOverviewModel');
      expect(hasActiveThreadFilters(makeDefaultState({ resolved: 'include' }))).toBe(true);
      expect(hasActiveThreadFilters(makeDefaultState({ idle: 'exclude' }))).toBe(true);
    });

    it('does NOT consider sortDirection', async () => {
      const { hasActiveThreadFilters } = await import('./roomThreadOverviewModel');
      expect(hasActiveThreadFilters(makeDefaultState({ sortDirection: 'asc' }))).toBe(false);
    });
  });

  // ═══ isRoomThreadOverviewActive ═══════════════════════════════════════

  describe('isRoomThreadOverviewActive', () => {
    it('returns false when in thread view', async () => {
      const { isRoomThreadOverviewActive } = await import('./roomThreadOverviewModel');
      expect(
        isRoomThreadOverviewActive('$thread', makeDefaultState({ resolved: 'include' }))
      ).toBe(false);
    });

    it('returns false when all default', async () => {
      const { isRoomThreadOverviewActive } = await import('./roomThreadOverviewModel');
      expect(isRoomThreadOverviewActive(undefined, makeDefaultState())).toBe(false);
    });

    it('returns true when any filter is active', async () => {
      const { isRoomThreadOverviewActive } = await import('./roomThreadOverviewModel');
      expect(
        isRoomThreadOverviewActive(undefined, makeDefaultState({ streaming: 'include' }))
      ).toBe(true);
    });

    it('returns true when sortBy is lastReply', async () => {
      const { isRoomThreadOverviewActive } = await import('./roomThreadOverviewModel');
      expect(
        isRoomThreadOverviewActive(undefined, makeDefaultState({ sortBy: 'lastReply' }))
      ).toBe(true);
    });
  });

  // ═══ isDefaultThreadFilterState ═══════════════════════════════════════

  describe('isDefaultThreadFilterState', () => {
    it('returns true for the persisted default state', async () => {
      const { createDefaultThreadFilterState, isDefaultThreadFilterState } = await import(
        './roomThreadOverviewModel'
      );
      expect(isDefaultThreadFilterState(createDefaultThreadFilterState())).toBe(true);
    });

    it('returns false when filter is active', async () => {
      const { createDefaultThreadFilterState, isDefaultThreadFilterState } = await import(
        './roomThreadOverviewModel'
      );
      expect(
        isDefaultThreadFilterState({
          ...createDefaultThreadFilterState(),
          resolved: 'include',
        })
      ).toBe(false);
    });

    it('returns false for the natural-sort inactive baseline', async () => {
      const { isDefaultThreadFilterState } = await import('./roomThreadOverviewModel');
      expect(isDefaultThreadFilterState(makeDefaultState())).toBe(false);
    });
  });

  // ═══ filterThreadRootEvents ═══════════════════════════════════════════

  describe('filterThreadRootEvents (v2)', () => {
    const metadataMap = new Map<string, ThreadOverviewMetadata>([
      ['$resolved-idle', mkMeta({ isResolved: true, absoluteIndex: 0, lastActivityTs: 100 })],
      ['$unresolved-unread', mkMeta({ isUnread: true, absoluteIndex: 1, lastActivityTs: 200 })],
      ['$streaming', mkMeta({ isStreaming: true, absoluteIndex: 2, lastActivityTs: 300 })],
      [
        '$scheduled',
        mkMeta({ scheduledTaskCount: 2, absoluteIndex: 3, lastActivityTs: 150 }),
      ],
    ]);
    const ids = ['$resolved-idle', '$unresolved-unread', '$streaming', '$scheduled'];

    it('returns all IDs when no filters active', async () => {
      const { filterThreadRootEvents } = await import('./roomThreadOverviewModel');
      expect(filterThreadRootEvents(ids, makeDefaultState(), metadataMap)).toEqual(ids);
    });

    it('filters by resolved include', async () => {
      const { filterThreadRootEvents } = await import('./roomThreadOverviewModel');
      expect(
        filterThreadRootEvents(ids, makeDefaultState({ resolved: 'include' }), metadataMap)
      ).toEqual(['$resolved-idle']);
    });

    it('filters by resolved exclude', async () => {
      const { filterThreadRootEvents } = await import('./roomThreadOverviewModel');
      expect(
        filterThreadRootEvents(ids, makeDefaultState({ resolved: 'exclude' }), metadataMap)
      ).toEqual(['$unresolved-unread', '$streaming', '$scheduled']);
    });

    it('filters with AND composition', async () => {
      const { filterThreadRootEvents } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ streaming: 'include', resolved: 'exclude' });
      expect(filterThreadRootEvents(ids, state, metadataMap)).toEqual(['$streaming']);
    });

    it('returns empty when thread has no metadata', async () => {
      const { filterThreadRootEvents } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ resolved: 'include' });
      expect(filterThreadRootEvents(['$unknown'], state, metadataMap)).toEqual([]);
    });

    it('handles empty thread list', async () => {
      const { filterThreadRootEvents } = await import('./roomThreadOverviewModel');
      expect(
        filterThreadRootEvents([], makeDefaultState({ resolved: 'include' }), metadataMap)
      ).toEqual([]);
    });

    it('returns empty when all filtered out', async () => {
      const { filterThreadRootEvents } = await import('./roomThreadOverviewModel');
      // idle include + resolved exclude is contradictory
      const state = makeDefaultState({ idle: 'include', resolved: 'exclude' });
      expect(filterThreadRootEvents(ids, state, metadataMap)).toEqual([]);
    });
  });

  // ═══ sortThreadRootEvents ═════════════════════════════════════════════

  describe('sortThreadRootEvents (v2)', () => {
    const metadataMap = new Map<string, ThreadOverviewMetadata>([
      ['$a', mkMeta({ lastActivityTs: 1000, absoluteIndex: 0 })],
      ['$b', mkMeta({ lastActivityTs: 2000, absoluteIndex: 1 })],
      ['$c', mkMeta({ lastActivityTs: 3000, absoluteIndex: 2 })],
    ]);
    const ids = ['$a', '$b', '$c'];

    it('natural sort preserves original order', async () => {
      const { sortThreadRootEvents } = await import('./roomThreadOverviewModel');
      expect(sortThreadRootEvents(ids, 'natural', 'desc', metadataMap)).toEqual(['$a', '$b', '$c']);
    });

    it('sorts descending (newest first)', async () => {
      const { sortThreadRootEvents } = await import('./roomThreadOverviewModel');
      expect(sortThreadRootEvents(ids, 'lastReply', 'desc', metadataMap)).toEqual(['$c', '$b', '$a']);
    });

    it('sorts ascending (oldest first)', async () => {
      const { sortThreadRootEvents } = await import('./roomThreadOverviewModel');
      expect(sortThreadRootEvents(ids, 'lastReply', 'asc', metadataMap)).toEqual(['$a', '$b', '$c']);
    });

    it('stable tiebreaker: equal timestamps use absoluteIndex (NOT reversed)', async () => {
      const { sortThreadRootEvents } = await import('./roomThreadOverviewModel');
      const tiedMap = new Map<string, ThreadOverviewMetadata>([
        ['$x', mkMeta({ lastActivityTs: 1000, absoluteIndex: 2 })],
        ['$y', mkMeta({ lastActivityTs: 1000, absoluteIndex: 0 })],
        ['$z', mkMeta({ lastActivityTs: 1000, absoluteIndex: 1 })],
      ]);
      // Desc: timestamps equal, so sort by absoluteIndex ascending
      expect(sortThreadRootEvents(['$x', '$y', '$z'], 'lastReply', 'desc', tiedMap)).toEqual([
        '$y',
        '$z',
        '$x',
      ]);
      // Asc: timestamps equal, tiebreaker same direction
      expect(sortThreadRootEvents(['$x', '$y', '$z'], 'lastReply', 'asc', tiedMap)).toEqual([
        '$y',
        '$z',
        '$x',
      ]);
    });
  });

  describe('applyFrozenThreadOrder', () => {
    it('keeps the frozen order for live items and appends new matches at the end', async () => {
      const { applyFrozenThreadOrder } = await import('./roomThreadOverviewModel');

      expect(
        applyFrozenThreadOrder(['$b', '$a', '$c'], ['$c', '$d', '$a', '$b'])
      ).toEqual(['$b', '$a', '$c', '$d']);
    });

    it('drops removed or no-longer-matching items immediately', async () => {
      const { applyFrozenThreadOrder } = await import('./roomThreadOverviewModel');

      expect(applyFrozenThreadOrder(['$b', '$a', '$c'], ['$c', '$a'])).toEqual(['$a', '$c']);
    });

    it('does not mutate the frozen or live input arrays', async () => {
      const { applyFrozenThreadOrder } = await import('./roomThreadOverviewModel');
      const frozenIds = ['$b', '$a'];
      const liveIds = ['$a', '$c', '$b'];

      expect(applyFrozenThreadOrder(frozenIds, liveIds)).toEqual(['$b', '$a', '$c']);
      expect(frozenIds).toEqual(['$b', '$a']);
      expect(liveIds).toEqual(['$a', '$c', '$b']);
    });
  });

  // ═══ cycleSortMode ══════════════════════════════════════════════════

  describe('cycleSortMode', () => {
    it('cycles natural -> lastReply desc -> lastReply asc -> natural', async () => {
      const { cycleSortMode } = await import('./roomThreadOverviewModel');
      const s0 = makeDefaultState();
      expect(s0.sortBy).toBe('natural');

      const s1 = cycleSortMode(s0);
      expect(s1).toEqual({ sortBy: 'lastReply', sortDirection: 'desc' });

      const s2 = cycleSortMode({ ...s0, ...s1 });
      expect(s2).toEqual({ sortBy: 'lastReply', sortDirection: 'asc' });

      const s3 = cycleSortMode({ ...s0, ...s2 });
      expect(s3).toEqual({ sortBy: 'natural', sortDirection: 'desc' });
    });
  });

  describe('createThreadSortControlSignature', () => {
    it('stays stable for equivalent tag filters regardless of insertion order', async () => {
      const { createThreadSortControlSignature } = await import('./roomThreadOverviewModel');
      const firstState = makeDefaultState({
        sortBy: 'lastReply',
        sortDirection: 'asc',
        resolved: 'include',
        tags: new Map([
          ['beta', 'exclude'],
          ['alpha', 'include'],
        ]),
      });
      const secondState = makeDefaultState({
        sortBy: 'lastReply',
        sortDirection: 'asc',
        resolved: 'include',
        tags: new Map([
          ['alpha', 'include'],
          ['beta', 'exclude'],
        ]),
      });

      expect(
        createThreadSortControlSignature({
          state: firstState,
          searchQuery: 'agents',
          viewMode: 'compact',
        })
      ).toBe(
        createThreadSortControlSignature({
          state: secondState,
          searchQuery: 'agents',
          viewMode: 'compact',
        })
      );
    });

    it('changes when an applied control changes', async () => {
      const { createThreadSortControlSignature } = await import('./roomThreadOverviewModel');
      const baseState = makeDefaultState({ sortBy: 'lastReply', sortDirection: 'desc' });

      expect(
        createThreadSortControlSignature({
          state: baseState,
          searchQuery: 'agents',
          viewMode: 'normal',
        })
      ).not.toBe(
        createThreadSortControlSignature({
          state: baseState,
          searchQuery: 'agents',
          viewMode: 'compact',
        })
      );
    });
  });

  // ═══ updateThreadFilterKey ═══════════════════════════════════════════

  describe('updateThreadFilterKey', () => {
    it('cycles the specified key', async () => {
      const { updateThreadFilterKey } = await import('./roomThreadOverviewModel');
      const s1 = updateThreadFilterKey(makeDefaultState(), 'resolved');
      expect(s1.resolved).toBe('include');
      const s2 = updateThreadFilterKey(s1, 'resolved');
      expect(s2.resolved).toBe('exclude');
      const s3 = updateThreadFilterKey(s2, 'resolved');
      expect(s3.resolved).toBe('any');
    });

    it('does not mutate other keys', async () => {
      const { updateThreadFilterKey } = await import('./roomThreadOverviewModel');
      const base = makeDefaultState({ streaming: 'include' });
      const next = updateThreadFilterKey(base, 'resolved');
      expect(next.streaming).toBe('include');
      expect(next.sortDirection).toBe('desc');
    });
  });

  // ═══ Tag filter helpers ═══════════════════════════════════════════════

  describe('matchesTagFilters', () => {
    it('matches when no tag filters are set', async () => {
      const { matchesTagFilters } = await import('./roomThreadOverviewModel');
      expect(matchesTagFilters(['resolved', 'blocked'], new Map())).toBe(true);
    });

    it('include requires tag to be present', async () => {
      const { matchesTagFilters } = await import('./roomThreadOverviewModel');
      const filters = new Map([['resolved', 'include' as const]]);
      expect(matchesTagFilters(['resolved', 'blocked'], filters)).toBe(true);
      expect(matchesTagFilters(['blocked'], filters)).toBe(false);
    });

    it('exclude requires tag to be absent', async () => {
      const { matchesTagFilters } = await import('./roomThreadOverviewModel');
      const filters = new Map([['resolved', 'exclude' as const]]);
      expect(matchesTagFilters(['blocked'], filters)).toBe(true);
      expect(matchesTagFilters(['resolved', 'blocked'], filters)).toBe(false);
    });

    it('multiple tag filters use AND composition', async () => {
      const { matchesTagFilters } = await import('./roomThreadOverviewModel');
      const filters = new Map([
        ['resolved', 'include' as const],
        ['blocked', 'exclude' as const],
      ]);
      expect(matchesTagFilters(['resolved'], filters)).toBe(true);
      expect(matchesTagFilters(['resolved', 'blocked'], filters)).toBe(false);
      expect(matchesTagFilters(['blocked'], filters)).toBe(false);
    });
  });

  describe('matchesThreadFilterState with tags', () => {
    it('tag filters compose with status filters via AND', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({
        resolved: 'include',
        tags: new Map([['priority', 'include']]),
      });
      // has resolved + priority → match
      expect(matchesThreadFilterState(mkMeta({ isResolved: true, tags: ['resolved', 'priority'] }), state)).toBe(true);
      // has resolved but no priority → no match
      expect(matchesThreadFilterState(mkMeta({ isResolved: true, tags: ['resolved'] }), state)).toBe(false);
      // has priority but not resolved → no match
      expect(matchesThreadFilterState(mkMeta({ isResolved: false, tags: ['priority'] }), state)).toBe(false);
    });
  });

  describe('hasActiveThreadFilters with tags', () => {
    it('returns true when tag filters are set', async () => {
      const { hasActiveThreadFilters } = await import('./roomThreadOverviewModel');
      expect(hasActiveThreadFilters(makeDefaultState({ tags: new Map([['blocked', 'include']]) }))).toBe(true);
    });

    it('returns false when tag map is empty', async () => {
      const { hasActiveThreadFilters } = await import('./roomThreadOverviewModel');
      expect(hasActiveThreadFilters(makeDefaultState())).toBe(false);
    });
  });

  describe('cycleTagFilter', () => {
    it('adds tag with include on first cycle', async () => {
      const { cycleTagFilter } = await import('./roomThreadOverviewModel');
      const result = cycleTagFilter(makeDefaultState(), 'blocked');
      expect(result.tags.get('blocked')).toBe('include');
    });

    it('cycles include → exclude', async () => {
      const { cycleTagFilter } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ tags: new Map([['blocked', 'include']]) });
      const result = cycleTagFilter(state, 'blocked');
      expect(result.tags.get('blocked')).toBe('exclude');
    });

    it('removes tag on cycle from exclude → any', async () => {
      const { cycleTagFilter } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ tags: new Map([['blocked', 'exclude']]) });
      const result = cycleTagFilter(state, 'blocked');
      expect(result.tags.has('blocked')).toBe(false);
    });
  });

  describe('addTagFilter', () => {
    it('adds tag with include state', async () => {
      const { addTagFilter } = await import('./roomThreadOverviewModel');
      const result = addTagFilter(makeDefaultState(), 'priority');
      expect(result.tags.get('priority')).toBe('include');
    });

    it('does not overwrite existing tag filter', async () => {
      const { addTagFilter } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ tags: new Map([['priority', 'exclude']]) });
      const result = addTagFilter(state, 'priority');
      expect(result.tags.get('priority')).toBe('exclude');
    });
  });

  describe('removeTagFilter', () => {
    it('removes existing tag filter', async () => {
      const { removeTagFilter } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ tags: new Map([['priority', 'include']]) });
      const result = removeTagFilter(state, 'priority');
      expect(result.tags.has('priority')).toBe(false);
    });

    it('returns same state when tag not present', async () => {
      const { removeTagFilter } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState();
      const result = removeTagFilter(state, 'priority');
      expect(result).toBe(state);
    });
  });

  describe('collectAvailableRoomTags', () => {
    it('collects and sorts unique tags from all threads', async () => {
      const { collectAvailableRoomTags } = await import('./roomThreadOverviewModel');
      const tagsMap = new Map<string, { tags: Record<string, unknown> | null }>([
        ['$t1', { tags: { resolved: {}, priority: {} } }],
        ['$t2', { tags: { blocked: {}, resolved: {} } }],
        ['$t3', { tags: { bug: {} } }],
      ]);
      expect(collectAvailableRoomTags(tagsMap)).toEqual(['blocked', 'bug', 'priority', 'resolved']);
    });

    it('returns empty array when no tags', async () => {
      const { collectAvailableRoomTags } = await import('./roomThreadOverviewModel');
      expect(collectAvailableRoomTags(new Map())).toEqual([]);
    });
  });

  describe('filterThreadRootEvents with tags', () => {
    it('filters by tag include', async () => {
      const { filterThreadRootEvents } = await import('./roomThreadOverviewModel');
      const metadataMap = new Map([
        ['$a', mkMeta({ tags: ['resolved', 'priority'] })],
        ['$b', mkMeta({ tags: ['blocked'] })],
        ['$c', mkMeta({ tags: ['resolved'] })],
      ]);
      const state = makeDefaultState({ tags: new Map([['priority', 'include']]) });
      expect(filterThreadRootEvents(['$a', '$b', '$c'], state, metadataMap)).toEqual(['$a']);
    });

    it('filters by tag exclude', async () => {
      const { filterThreadRootEvents } = await import('./roomThreadOverviewModel');
      const metadataMap = new Map([
        ['$a', mkMeta({ tags: ['resolved', 'priority'] })],
        ['$b', mkMeta({ tags: ['blocked'] })],
        ['$c', mkMeta({ tags: ['resolved'] })],
      ]);
      const state = makeDefaultState({ tags: new Map([['resolved', 'exclude']]) });
      expect(filterThreadRootEvents(['$a', '$b', '$c'], state, metadataMap)).toEqual(['$b']);
    });
  });

  // ═══ computeStatusCounts ═══════════════════════════════════════════════

  describe('computeStatusCounts', () => {
    it('counts threads matching each dimension', async () => {
      const { computeStatusCounts } = await import('./roomThreadOverviewModel');
      const metadataMap = new Map<string, ThreadOverviewMetadata>([
        ['$a', mkMeta({ isResolved: true, isStreaming: false, scheduledTaskCount: 0, isUnread: false })],
        ['$b', mkMeta({ isResolved: false, isStreaming: true, scheduledTaskCount: 0, isUnread: true })],
        ['$c', mkMeta({ isResolved: true, isStreaming: false, scheduledTaskCount: 2, isUnread: true })],
        ['$d', mkMeta({ isResolved: true, isStreaming: false, scheduledTaskCount: 0, isUnread: false })],
      ]);
      const counts = computeStatusCounts(['$a', '$b', '$c', '$d'], metadataMap);
      expect(counts.resolved).toBe(3);
      expect(counts.streaming).toBe(1);
      expect(counts.scheduled).toBe(1);
      expect(counts.unread).toBe(2);
      // idle = resolved && !streaming && scheduledTaskCount===0: $a, $d
      expect(counts.idle).toBe(2);
    });

    it('returns zeros for empty list', async () => {
      const { computeStatusCounts } = await import('./roomThreadOverviewModel');
      const counts = computeStatusCounts([], new Map());
      expect(counts).toEqual({ resolved: 0, streaming: 0, scheduled: 0, unread: 0, idle: 0 });
    });

    it('skips IDs with no metadata', async () => {
      const { computeStatusCounts } = await import('./roomThreadOverviewModel');
      const metadataMap = new Map<string, ThreadOverviewMetadata>([
        ['$a', mkMeta({ isStreaming: true })],
      ]);
      const counts = computeStatusCounts(['$a', '$missing'], metadataMap);
      expect(counts.streaming).toBe(1);
      expect(counts.resolved).toBe(0);
    });
  });

  // ═══ Legacy tests preserved (getRoomScheduledTaskCounts, isThreadUnread, etc.) ═══

  describe('getRoomScheduledTaskCounts', () => {
    it('groups pending future scheduled tasks by threadId', async () => {
      const { getRoomScheduledTaskCounts } = await import('./roomThreadOverviewModel');

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const pastDate = new Date(Date.now() - 86400000).toISOString();

      const events = [
        {
          getStateKey: () => 'task-1',
          getContent: () => ({
            status: 'pending',
            thread_id: '$thread-1',
            new_thread: false,
            execute_at: futureDate,
          }),
        },
        {
          getStateKey: () => 'task-2',
          getContent: () => ({
            status: 'pending',
            thread_id: '$thread-1',
            new_thread: false,
            execute_at: futureDate,
          }),
        },
        {
          getStateKey: () => 'task-3',
          getContent: () => ({
            status: 'pending',
            thread_id: '$thread-2',
            new_thread: false,
            execute_at: futureDate,
          }),
        },
        // Should be excluded: completed
        {
          getStateKey: () => 'task-4',
          getContent: () => ({
            status: 'completed',
            thread_id: '$thread-1',
            new_thread: false,
            execute_at: futureDate,
          }),
        },
        // Should be excluded: newThread
        {
          getStateKey: () => 'task-5',
          getContent: () => ({
            status: 'pending',
            thread_id: '$thread-1',
            new_thread: true,
            execute_at: futureDate,
          }),
        },
        // Should be excluded: past executeAt
        {
          getStateKey: () => 'task-6',
          getContent: () => ({
            status: 'pending',
            thread_id: '$thread-3',
            new_thread: false,
            execute_at: pastDate,
          }),
        },
        // Should be excluded: no threadId
        {
          getStateKey: () => 'task-7',
          getContent: () => ({
            status: 'pending',
            thread_id: null,
            new_thread: false,
            execute_at: futureDate,
          }),
        },
      ];

      const result = getRoomScheduledTaskCounts(events as never);
      expect(result.get('$thread-1')).toBe(2);
      expect(result.get('$thread-2')).toBe(1);
      expect(result.has('$thread-3')).toBe(false);
    });
  });

  describe('isThreadUnread', () => {
    const makeThread = (replies: Array<{ sender: string; ts: number }>) => ({
      events: replies.map((r) => ({
        getSender: () => r.sender,
        getTs: () => r.ts,
      })),
    });

    const makeRoom = (threads: Map<string, ReturnType<typeof makeThread>>) => ({
      getThread: (id: string) => threads.get(id) ?? null,
    });

    it('returns true when last reply is from another user and newer than read marker', async () => {
      const { isThreadUnread } = await import('./roomThreadOverviewModel');
      const room = makeRoom(
        new Map([['$t1', makeThread([{ sender: '@bob:x', ts: 200 }])]])
      );
      expect(isThreadUnread(room as never, '$t1', '@alice:x', 100)).toBe(true);
    });

    it('returns false when user sent the last reply', async () => {
      const { isThreadUnread } = await import('./roomThreadOverviewModel');
      const room = makeRoom(
        new Map([
          [
            '$t1',
            makeThread([
              { sender: '@bob:x', ts: 100 },
              { sender: '@alice:x', ts: 200 },
            ]),
          ],
        ])
      );
      expect(isThreadUnread(room as never, '$t1', '@alice:x', 50)).toBe(false);
    });

    it('returns false when no thread exists', async () => {
      const { isThreadUnread } = await import('./roomThreadOverviewModel');
      const room = makeRoom(new Map());
      expect(isThreadUnread(room as never, '$t1', '@alice:x', 100)).toBe(false);
    });

    it('returns true when no read marker exists and there is reply from another user', async () => {
      const { isThreadUnread } = await import('./roomThreadOverviewModel');
      const room = makeRoom(
        new Map([['$t1', makeThread([{ sender: '@bob:x', ts: 50 }])]])
      );
      expect(isThreadUnread(room as never, '$t1', '@alice:x', undefined)).toBe(true);
    });

    it('returns false when reply is older than read marker', async () => {
      const { isThreadUnread } = await import('./roomThreadOverviewModel');
      const room = makeRoom(
        new Map([['$t1', makeThread([{ sender: '@bob:x', ts: 50 }])]])
      );
      expect(isThreadUnread(room as never, '$t1', '@alice:x', 100)).toBe(false);
    });
  });

  describe('buildThreadMetadataMap', () => {
    it('produces correct metadata for mixed thread states', async () => {
      const { buildThreadMetadataMap } = await import('./roomThreadOverviewModel');
      const room = {
        getThread: (id: string) =>
          id === '$thread-1'
            ? {
                events: [makeVisibleThreadReplyEvent('$thread-1-reply', '$thread-1', 500, '@bob:x')],
              }
            : null,
        findEventById: () => undefined,
        getMember: () => null,
      };
      const tagsMap = new Map<string, { isResolved: boolean; tags: Record<string, unknown> | null }>([
        [
          '$thread-2',
          {
            isResolved: true,
            tags: {
              resolved: { set_by: '@user:x', set_at: '2025-01-01T00:00:00.000Z' },
            },
          },
        ],
      ]);
      const scheduledCounts = new Map([['$thread-1', 3]]);
      const threadReplyCountMap = new Map<string, number>();
      const threadParticipantMap = new Map<string, string[]>();
      const summaryMap = new Map();
      const absoluteIndexMap = new Map([
        ['$thread-1', 0],
        ['$thread-2', 5],
        ['$thread-streaming', 10],
      ]);

      const result = buildThreadMetadataMap(
        room as never,
        ['$thread-1', '$thread-2', '$thread-streaming'],
        tagsMap,
        scheduledCounts,
        threadReplyCountMap,
        threadParticipantMap,
        summaryMap,
        '@alice:x',
        100,
        absoluteIndexMap
      );

      expect(result.get('$thread-1')).toEqual({
        isResolved: false,
        isUnread: true,
        isStreaming: false,
        scheduledTaskCount: 3,
        lastActivityTs: 1000,
        absoluteIndex: 0,
        lastSenderId: '@bob:x',
        lastSenderDisplayName: '@bob:x',
        latestReplyPreviewText: '$thread-1-reply',
        participantDisplayName: '@bob:x',
        summaryText: undefined,
        rootPreviewText: undefined,
        messageCount: 1,
        tags: [],
      });

      expect(result.get('$thread-2')).toEqual({
        isResolved: true,
        isUnread: false,
        isStreaming: false,
        scheduledTaskCount: 0,
        lastActivityTs: 2000,
        absoluteIndex: 5,
        lastSenderId: undefined,
        lastSenderDisplayName: undefined,
        latestReplyPreviewText: undefined,
        participantDisplayName: undefined,
        summaryText: undefined,
        rootPreviewText: undefined,
        messageCount: 0,
        tags: ['resolved'],
      });

      expect(result.get('$thread-streaming')).toEqual({
        isResolved: false,
        isUnread: false,
        isStreaming: true,
        scheduledTaskCount: 0,
        lastActivityTs: 2500,
        absoluteIndex: 10,
        lastSenderId: undefined,
        lastSenderDisplayName: undefined,
        latestReplyPreviewText: undefined,
        participantDisplayName: undefined,
        summaryText: undefined,
        rootPreviewText: undefined,
        messageCount: 0,
        tags: [],
      });
    });

    it('prefers a non-placeholder fallback root preview over a stale live root preview', async () => {
      const { buildThreadMetadataMap } = await import('./roomThreadOverviewModel');
      const rootEvent = makeRootPreviewEvent('Thinking...  ⋯');
      const room = {
        getThread: () => ({
          rootEvent,
          events: [],
        }),
        findEventById: () => undefined,
        getUnfilteredTimelineSet: () => ({
          relations: {
            getChildEventsForEvent: () => undefined,
          },
        }),
        getMember: () => null,
      };

      const result = buildThreadMetadataMap(
        room as never,
        ['$thread-1'],
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        '@alice:x',
        undefined,
        new Map([['$thread-1', 0]]),
        new Map([['$thread-1', 'Let me check all the agents right now.']])
      );

      expect(result.get('$thread-1')?.rootPreviewText).toBe(
        'Let me check all the agents right now.'
      );
    });

    it('prefers fresher cached last-activity timestamps over live overview timestamps', async () => {
      const { buildThreadMetadataMap } = await import('./roomThreadOverviewModel');
      const room = {
        getThread: () => ({
          events: [makeVisibleThreadReplyEvent('$thread-1-reply', '$thread-1', 500, '@bob:x')],
        }),
        findEventById: () => undefined,
        getMember: () => null,
      };

      const result = buildThreadMetadataMap(
        room as never,
        ['$thread-1'],
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        '@alice:x',
        undefined,
        new Map([['$thread-1', 0]]),
        undefined,
        new Map([['$thread-1', 1800]])
      );

      expect(result.get('$thread-1')?.lastActivityTs).toBe(1800);
    });

    it('falls back to the root event timestamp for zero-reply compact cards', async () => {
      const { buildThreadMetadataMap } = await import('./roomThreadOverviewModel');
      const rootEvent = makeRootPreviewEvent('Standalone message root', undefined, 1700);
      const room = {
        getThread: () => null,
        findEventById: () => rootEvent,
        getUnfilteredTimelineSet: () => ({
          relations: {
            getChildEventsForEvent: () => undefined,
          },
        }),
        getMember: () => null,
      };

      const result = buildThreadMetadataMap(
        room as never,
        ['$thread-1'],
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        '@alice:x',
        undefined,
        new Map([['$thread-1', 0]])
      );

      expect(result.get('$thread-1')).toMatchObject({
        lastActivityTs: 1700,
        rootPreviewText: 'Standalone message root',
        messageCount: 0,
      });
    });

    it('ignores hidden threaded metadata relations when deriving visible message count', async () => {
      const { buildThreadMetadataMap } = await import('./roomThreadOverviewModel');
      const rootEvent = makeRootPreviewEvent('Hidden relation root', undefined, 1700);
      const hiddenThreadTagEvent = makeHiddenThreadTagEvent('$thread-1', 1900);
      const room = {
        getThread: () => ({
          rootEvent,
          events: [hiddenThreadTagEvent],
          length: 1,
        }),
        findEventById: () => rootEvent,
        getUnfilteredTimelineSet: () => ({
          relations: {
            getChildEventsForEvent: () => undefined,
          },
        }),
        getMember: () => null,
      };

      const result = buildThreadMetadataMap(
        room as never,
        ['$thread-1'],
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        '@alice:x',
        undefined,
        new Map([['$thread-1', 0]])
      );

      expect(result.get('$thread-1')).toMatchObject({
        lastActivityTs: 1700,
        messageCount: 0,
        participantDisplayName: '@agent:x',
      });
    });

    it('prefers the room event over a stale thread root event for root preview text', async () => {
      const { buildThreadMetadataMap } = await import('./roomThreadOverviewModel');
      const staleThreadRoot = makeRootPreviewEvent('Thinking...  ⋯');
      const fresherRoomEvent = makeRootPreviewEvent(
        'Thinking...  ⋯',
        'Let me check the actual colors being generated.'
      );
      const room = {
        getThread: () => ({
          rootEvent: staleThreadRoot,
          events: [],
        }),
        findEventById: () => fresherRoomEvent,
        getUnfilteredTimelineSet: () => ({
          relations: {
            getChildEventsForEvent: () => undefined,
          },
        }),
        getMember: () => null,
      };

      const result = buildThreadMetadataMap(
        room as never,
        ['$thread-1'],
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        '@alice:x',
        undefined,
        new Map([['$thread-1', 0]])
      );

      expect(result.get('$thread-1')?.rootPreviewText).toBe(
        'Let me check the actual colors being generated.'
      );
    });

    it('prefers cached root preview text over a stale non-placeholder live root preview', async () => {
      const { buildThreadMetadataMap } = await import('./roomThreadOverviewModel');
      const rootEvent = makeRootPreviewEvent('**[Response cancelled by user]**');
      const room = {
        getThread: () => ({
          rootEvent,
          events: [],
        }),
        findEventById: () => undefined,
        getUnfilteredTimelineSet: () => ({
          relations: {
            getChildEventsForEvent: () => undefined,
          },
        }),
        getMember: () => null,
      };

      const result = buildThreadMetadataMap(
        room as never,
        ['$thread-1'],
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        '@alice:x',
        undefined,
        new Map([['$thread-1', 0]]),
        new Map([
          [
            '$thread-1',
            'Let me check the current state of the code and what Bas has changed.',
          ],
        ])
      );

      expect(result.get('$thread-1')?.rootPreviewText).toBe(
        'Let me check the current state of the code and what Bas has changed.'
      );
    });
  });

  it('buildVisibleThreadRootData excludes reply events masquerading as thread roots', async () => {
    const { buildVisibleThreadRootData } = await import('./roomThreadOverviewModel');
    const fakeReply = {
      getId: () => '$reply-event',
      getContent: () => ({ body: 'Thinking...  ⋯' }),
      threadRootId: '$actual-root',
      isThreadRoot: false,
    };
    const trueRoot = {
      getId: () => '$actual-root',
      getContent: () => ({ body: 'Real thread root' }),
      threadRootId: '$actual-root',
      isThreadRoot: true,
    };

    const result = buildVisibleThreadRootData(
      [
        { event: fakeReply as never, absoluteIndex: 0 },
        { event: trueRoot as never, absoluteIndex: 1 },
      ],
      {
        getThread: (id: string) => (id === '$actual-root' ? { id } : undefined),
      } as never,
      new Map([
        ['$reply-event', { isResolved: false, tags: null }],
        ['$actual-root', { isResolved: false, tags: null }],
      ]),
      new Map([
        ['$reply-event', 1],
        ['$actual-root', 1],
      ])
    );

    expect(result.ids).toEqual(['$actual-root']);
  });

  it('buildVisibleThreadRootData includes recent standalone zero-reply roots', async () => {
    const { buildVisibleThreadRootData } = await import('./roomThreadOverviewModel');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const recentStandaloneRoot = {
      getId: () => '$recent-root',
      getContent: () => ({ body: 'Recent standalone root' }),
      getRelation: () => undefined,
      getTs: () => 999_000,
      getType: () => 'm.room.message',
      isRedacted: () => false,
      threadRootId: '$recent-root',
      isThreadRoot: false,
    };

    try {
      const result = buildVisibleThreadRootData(
        [{ event: recentStandaloneRoot as never, absoluteIndex: 0 }],
        {
          getThread: () => undefined,
        } as never,
        new Map(),
        new Map()
      );

      expect(result.ids).toEqual(['$recent-root']);
      expect(result.indexMap.get('$recent-root')).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  // ═══ statusMode OR semantics ═════════════════════════════════════════════

  describe('matchesThreadFilterState with statusMode or', () => {
    it('OR mode: streaming OR scheduled matches either', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({
        streaming: 'include',
        scheduled: 'include',
        statusMode: 'or',
      });
      // streaming only
      expect(matchesThreadFilterState(mkMeta({ isStreaming: true, scheduledTaskCount: 0 }), state)).toBe(true);
      // scheduled only
      expect(matchesThreadFilterState(mkMeta({ isStreaming: false, scheduledTaskCount: 2 }), state)).toBe(true);
      // both
      expect(matchesThreadFilterState(mkMeta({ isStreaming: true, scheduledTaskCount: 1 }), state)).toBe(true);
      // neither
      expect(matchesThreadFilterState(mkMeta({ isStreaming: false, scheduledTaskCount: 0 }), state)).toBe(false);
    });

    it('OR mode: exclude filters are still hard rejections', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({
        streaming: 'include',
        scheduled: 'include',
        resolved: 'exclude',
        statusMode: 'or',
      });
      // streaming + resolved should be excluded
      expect(matchesThreadFilterState(mkMeta({ isStreaming: true, isResolved: true }), state)).toBe(false);
      // streaming + not resolved should pass
      expect(matchesThreadFilterState(mkMeta({ isStreaming: true, isResolved: false }), state)).toBe(true);
    });

    it('OR mode: no include filters behaves like AND (passes all non-excluded)', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({
        resolved: 'exclude',
        statusMode: 'or',
      });
      expect(matchesThreadFilterState(mkMeta({ isResolved: false }), state)).toBe(true);
      expect(matchesThreadFilterState(mkMeta({ isResolved: true }), state)).toBe(false);
    });

    it('OR mode: tags still AND with status', async () => {
      const { matchesThreadFilterState } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({
        streaming: 'include',
        statusMode: 'or',
        tags: new Map([['priority', 'include']]),
      });
      // streaming + priority → match
      expect(matchesThreadFilterState(mkMeta({ isStreaming: true, tags: ['priority'] }), state)).toBe(true);
      // streaming + no priority → no match
      expect(matchesThreadFilterState(mkMeta({ isStreaming: true, tags: [] }), state)).toBe(false);
    });
  });

  // ═══ applyPreset ═══════════════════════════════════════════════════════════

  describe('applyPreset', () => {
    it('resets all status toggles and applies preset overrides', async () => {
      const { applyPreset, FILTER_PRESETS } = await import('./roomThreadOverviewModel');
      const base = makeDefaultState({ resolved: 'include', streaming: 'exclude' });
      const needsAttention = FILTER_PRESETS.find((p) => p.id === 'needs-attention')!;
      const result = applyPreset(base, needsAttention);
      expect(result.resolved).toBe('exclude');
      expect(result.streaming).toBe('exclude');
      expect(result.scheduled).toBe('exclude');
      expect(result.unread).toBe('any');
      expect(result.idle).toBe('any');
      expect(result.statusMode).toBe('and');
    });

    it('working preset sets statusMode to or', async () => {
      const { applyPreset, FILTER_PRESETS } = await import('./roomThreadOverviewModel');
      const working = FILTER_PRESETS.find((p) => p.id === 'working')!;
      const result = applyPreset(makeDefaultState(), working);
      expect(result.streaming).toBe('include');
      expect(result.scheduled).toBe('include');
      expect(result.searchQuery).toBe('is:streaming OR is:scheduled');
      expect(result.statusMode).toBe('or');
    });

    it('all preset resets everything to default', async () => {
      const { applyPreset, FILTER_PRESETS } = await import('./roomThreadOverviewModel');
      const all = FILTER_PRESETS.find((p) => p.id === 'all')!;
      const base = makeDefaultState({ resolved: 'include', streaming: 'exclude' });
      const result = applyPreset(base, all);
      expect(result.resolved).toBe('any');
      expect(result.streaming).toBe('any');
      expect(result.scheduled).toBe('any');
      expect(result.searchQuery).toBe('');
      expect(result.statusMode).toBe('and');
    });

    it('all preset clears free-text searchQuery instead of preserving stale bar text', async () => {
      const { applyPreset, FILTER_PRESETS } = await import('./roomThreadOverviewModel');
      const all = FILTER_PRESETS.find((p) => p.id === 'all')!;
      const base = makeDefaultState({ searchQuery: 'hello' });
      const result = applyPreset(base, all);
      expect(result.searchQuery).toBe('');
    });

    it('preserves tags and sort while canonicalizing searchQuery', async () => {
      const { applyPreset, FILTER_PRESETS } = await import('./roomThreadOverviewModel');
      const base = makeDefaultState({
        tags: new Map([['priority', 'include']]),
        sortBy: 'lastReply',
        searchQuery: 'hello',
      });
      const archived = FILTER_PRESETS.find((p) => p.id === 'archived')!;
      const result = applyPreset(base, archived);
      expect(result.tags.get('priority')).toBe('include');
      expect(result.sortBy).toBe('lastReply');
      expect(result.searchQuery).toBe('is:resolved tag:priority hello');
    });
  });

  // ═══ updateThreadFilterKey resets statusMode ════════════════════════════

  describe('updateThreadFilterKey resets statusMode', () => {
    it('resets statusMode to and on manual toggle', async () => {
      const { updateThreadFilterKey } = await import('./roomThreadOverviewModel');
      const state = makeDefaultState({ statusMode: 'or', streaming: 'include' });
      const result = updateThreadFilterKey(state, 'resolved');
      expect(result.statusMode).toBe('and');
    });
  });

  // ═══ computeTagCounts ═════════════════════════════════════════════════════

  describe('computeTagCounts', () => {
    it('counts tags across threads', async () => {
      const { computeTagCounts } = await import('./roomThreadOverviewModel');
      const metadataMap = new Map([
        ['$a', mkMeta({ tags: ['resolved', 'priority'] })],
        ['$b', mkMeta({ tags: ['blocked'] })],
        ['$c', mkMeta({ tags: ['resolved'] })],
      ]);
      const counts = computeTagCounts(['$a', '$b', '$c'], metadataMap);
      expect(counts).toEqual({ resolved: 2, priority: 1, blocked: 1 });
    });

    it('returns empty object for no threads', async () => {
      const { computeTagCounts } = await import('./roomThreadOverviewModel');
      expect(computeTagCounts([], new Map())).toEqual({});
    });
  });

  // ═══ filterThreadsBySearch ═══════════════════════════════════════════════

  describe('filterThreadsBySearch', () => {
    const metadataMap = new Map([
      ['$a', mkMeta({ summaryText: 'Hello world', rootPreviewText: 'Original question' })],
      ['$b', mkMeta({ summaryText: 'Deploy pipeline', rootPreviewText: 'Build failed' })],
      ['$c', mkMeta({ summaryText: undefined, rootPreviewText: 'Hello again' })],
      ['$d', mkMeta({ summaryText: undefined, rootPreviewText: undefined })],
    ]);
    const ids = ['$a', '$b', '$c', '$d'];

    it('returns all when query is empty', async () => {
      const { filterThreadsBySearch } = await import('./roomThreadOverviewModel');
      expect(filterThreadsBySearch(ids, '', metadataMap)).toEqual(ids);
      expect(filterThreadsBySearch(ids, '   ', metadataMap)).toEqual(ids);
      expect(filterThreadsBySearch(ids, undefined, metadataMap)).toEqual(ids);
    });

    it('matches summaryText case-insensitively', async () => {
      const { filterThreadsBySearch } = await import('./roomThreadOverviewModel');
      expect(filterThreadsBySearch(ids, 'hello', metadataMap)).toEqual(['$a', '$c']);
      expect(filterThreadsBySearch(ids, 'DEPLOY', metadataMap)).toEqual(['$b']);
    });

    it('matches rootPreviewText', async () => {
      const { filterThreadsBySearch } = await import('./roomThreadOverviewModel');
      expect(filterThreadsBySearch(ids, 'Build', metadataMap)).toEqual(['$b']);
    });

    it('returns empty when nothing matches', async () => {
      const { filterThreadsBySearch } = await import('./roomThreadOverviewModel');
      expect(filterThreadsBySearch(ids, 'nonexistent', metadataMap)).toEqual([]);
    });
  });

  // ═══ hasActiveThreadFilters with searchQuery ══════════════════════════════

  describe('hasActiveThreadFilters with searchQuery', () => {
    it('returns true when searchQuery is non-empty', async () => {
      const { hasActiveThreadFilters } = await import('./roomThreadOverviewModel');
      expect(hasActiveThreadFilters(makeDefaultState({ searchQuery: 'test' }))).toBe(true);
    });

    it('returns false when searchQuery is empty', async () => {
      const { hasActiveThreadFilters } = await import('./roomThreadOverviewModel');
      expect(hasActiveThreadFilters(makeDefaultState({ searchQuery: '' }))).toBe(false);
    });
  });
});
