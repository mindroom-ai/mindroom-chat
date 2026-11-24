import { describe, expect, it } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import {
  createDefaultThreadFilterState,
  type ThreadFilterState,
} from '../../event-store/threads/roomThreadOverviewModel';
import {
  getCrossRoomThreadIndexKey,
  normalizeThreadSearchText,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import {
  collectSpaceThreadEntries,
  filterAndSortSpaceThreads,
  getRoomAccentColor,
  resolveActiveSpaceRoomIds,
  resolveComposerTargetRoom,
  selectOnlySpaceRoom,
  toggleSpaceRoomSelection,
} from './spaceThreadsModel';

const ROOM_A = '!alpha:example.org';
const ROOM_B = '!beta:example.org';
const ROOM_OUTSIDE = '!outside:example.org';
const NOW = 1_700_000_000_000;

type EntryOpts = Partial<CrossRoomThreadIndexEntry> & {
  roomId: string;
  threadRootId: string;
  replyCount?: number;
  isStreaming?: boolean;
  scheduledTaskCount?: number;
  nextScheduledTs?: number;
  participantIds?: string[];
};

const makeEntry = (opts: EntryOpts): CrossRoomThreadIndexEntry => {
  const {
    roomId,
    threadRootId,
    replyCount = 1,
    isStreaming = false,
    scheduledTaskCount = 0,
  } = opts;
  const participantIds = opts.participantIds ?? ['@alice:example.org'];
  const isResolved = opts.isResolved ?? false;
  const isUnread = opts.isUnread ?? false;
  const lastActivityTs = opts.lastActivityTs ?? NOW;
  const tags = opts.tags ?? [];
  const summaryText = opts.summaryText ?? `Summary ${threadRootId}`;
  const rootPreviewText = opts.rootPreviewText ?? `Root ${threadRootId}`;
  return {
    key: getCrossRoomThreadIndexKey(roomId, threadRootId),
    roomId,
    roomName: opts.roomName ?? roomId,
    threadRootId,
    indexedEventIds: [threadRootId],
    threadRecord: {
      roomId,
      threadRootId,
      rootEventId: threadRootId,
      absoluteIndex: 0,
      presentation: {
        summaryInfo: undefined,
        summaryText,
        primarySummaryText: summaryText,
        recentThreadSummaryText: summaryText,
        rootPreviewText,
        latestReplyPreviewText: undefined,
        lastSenderId: participantIds[0],
        lastSenderDisplayName: undefined,
        messageCount: replyCount,
        participantIds,
        replyParticipantIds: participantIds,
        peopleIds: participantIds,
      },
      status: {
        isKnownThreadRoot: true,
        replyCount,
        lastActivityTs,
        isUnread,
        isResolved,
        snoozedUntilTs: opts.snoozedUntilTs,
        isStreaming,
        scheduledTaskCount,
        nextScheduledTs: opts.nextScheduledTs,
        tags,
      },
      cache: { eventCount: replyCount + 1, relationSnapshotComplete: true, tailLoaded: true },
    },
    rootSenderId: opts.rootSenderId ?? '@alice:example.org',
    lastActivityTs,
    isUnread,
    isResolved,
    snoozedUntilTs: opts.snoozedUntilTs,
    hasAttention: !isResolved && (isUnread || isStreaming || scheduledTaskCount > 0),
    isInvolved: opts.isInvolved ?? true,
    isForUser: opts.isForUser ?? false,
    summaryText,
    rootPreviewText,
    searchableText:
      opts.searchableText ?? normalizeThreadSearchText(`${rootPreviewText} ${summaryText}`),
    tags,
    generation: 1,
  };
};

const roomNames = new Map([
  [ROOM_A, 'Engineering'],
  [ROOM_B, 'Design'],
]);

const runFilter = (
  entries: CrossRoomThreadIndexEntry[],
  overrides: {
    selectedRoomIds?: ReadonlySet<string>;
    filterState?: Partial<ThreadFilterState>;
    searchQuery?: string;
    simpleMode?: boolean;
    hasMindroomAgents?: boolean;
    groupSections?: boolean;
  } = {}
) =>
  filterAndSortSpaceThreads({
    entries,
    spaceRoomIds: new Set([ROOM_A, ROOM_B]),
    selectedRoomIds: overrides.selectedRoomIds,
    filterState: { ...createDefaultThreadFilterState(), ...overrides.filterState },
    searchQuery: overrides.searchQuery,
    simpleMode: overrides.simpleMode ?? false,
    snoozeNow: NOW,
    hasMindroomAgents: overrides.hasMindroomAgents ?? true,
    roomNameById: roomNames,
    groupSections: overrides.groupSections ?? false,
  });

describe('spaceThreadsModel', () => {
  it('scopes to space rooms, keeps 0-reply roots, counts rooms, and supports 1-room downselect', () => {
    const entries = [
      makeEntry({ roomId: ROOM_A, threadRootId: '$a1', replyCount: 0, lastActivityTs: NOW - 10 }),
      makeEntry({ roomId: ROOM_A, threadRootId: '$a2', replyCount: 3, lastActivityTs: NOW - 30 }),
      makeEntry({ roomId: ROOM_B, threadRootId: '$b1', replyCount: 2, lastActivityTs: NOW - 20 }),
      makeEntry({ roomId: ROOM_OUTSIDE, threadRootId: '$x1', replyCount: 4, lastActivityTs: NOW }),
    ];

    const all = runFilter(entries);
    expect(all.entries.map((e) => e.threadRootId)).toEqual(['$a1', '$b1', '$a2']);
    expect(all.scopedTotalCount).toBe(3);
    expect(all.roomCounts.get(ROOM_A)).toBe(2);
    expect(all.roomCounts.get(ROOM_B)).toBe(1);
    expect(all.roomCounts.has(ROOM_OUTSIDE)).toBe(false);

    const onlyB = runFilter(entries, { selectedRoomIds: new Set([ROOM_B]) });
    expect(onlyB.entries.map((e) => e.threadRootId)).toEqual(['$b1']);
    expect(onlyB.scopedTotalCount).toBe(1);
    expect(onlyB.roomCounts.get(ROOM_A)).toBe(2);
  });

  it('filters by workflow tab, tags, forMe, people, and search across text and room name', () => {
    const entries = [
      makeEntry({
        roomId: ROOM_A,
        threadRootId: '$needs',
        summaryText: 'Fix CI pipeline',
        tags: ['urgent'],
        isForUser: true,
        rootSenderId: '@alice:example.org',
        participantIds: ['@alice:example.org'],
        lastActivityTs: NOW - 5,
      }),
      makeEntry({
        roomId: ROOM_A,
        threadRootId: '$working',
        summaryText: 'Generate release notes',
        isStreaming: true,
        tags: ['release'],
        rootSenderId: '@bob:example.org',
        participantIds: ['@bob:example.org'],
        lastActivityTs: NOW - 15,
      }),
      makeEntry({
        roomId: ROOM_B,
        threadRootId: '$later',
        summaryText: 'Logo review',
        snoozedUntilTs: NOW + 60_000,
        rootSenderId: '@carol:example.org',
        participantIds: ['@carol:example.org'],
        lastActivityTs: NOW - 25,
      }),
      makeEntry({
        roomId: ROOM_B,
        threadRootId: '$done',
        summaryText: 'Icon export',
        isResolved: true,
        tags: ['urgent'],
        rootSenderId: '@alice:example.org',
        participantIds: ['@alice:example.org'],
        lastActivityTs: NOW - 35,
      }),
    ];

    const baseline = runFilter(entries);
    expect(baseline.bucketCounts).toEqual({
      needsYou: 1,
      working: 1,
      later: 1,
      done: 1,
      all: 4,
    });
    expect(baseline.availableTags).toEqual(['release', 'urgent']);
    expect(baseline.tagCounts).toEqual({ urgent: 2, release: 1 });

    expect(
      runFilter(entries, { filterState: { tab: 'working' } }).entries.map((e) => e.threadRootId)
    ).toEqual(['$working']);
    expect(
      runFilter(entries, { filterState: { tags: new Map([['urgent', 'include']]) } }).entries.map(
        (e) => e.threadRootId
      )
    ).toEqual(['$needs', '$done']);
    expect(
      runFilter(entries, { filterState: { forMe: true } }).entries.map((e) => e.threadRootId)
    ).toEqual(['$needs']);
    expect(
      runFilter(entries, { filterState: { people: ['@bob:example.org'] } }).entries.map(
        (e) => e.threadRootId
      )
    ).toEqual(['$working']);
    // Search matches room name + thread text together.
    expect(
      runFilter(entries, { searchQuery: 'design logo' }).entries.map((e) => e.threadRootId)
    ).toEqual(['$later']);
    expect(
      runFilter(entries, { searchQuery: 'is:resolved icon' }).entries.map((e) => e.threadRootId)
    ).toEqual(['$done']);
  });

  it('groups into COMPACT_THREAD_SECTION_ORDER and orders Later by soonest return time', () => {
    const entries = [
      makeEntry({ roomId: ROOM_A, threadRootId: '$done', isResolved: true, lastActivityTs: NOW }),
      makeEntry({
        roomId: ROOM_A,
        threadRootId: '$laterFar',
        snoozedUntilTs: NOW + 120_000,
        lastActivityTs: NOW - 1,
      }),
      makeEntry({
        roomId: ROOM_B,
        threadRootId: '$laterSoon',
        snoozedUntilTs: NOW + 30_000,
        lastActivityTs: NOW - 50,
      }),
      makeEntry({
        roomId: ROOM_B,
        threadRootId: '$working',
        isStreaming: true,
        lastActivityTs: NOW - 2,
      }),
      makeEntry({ roomId: ROOM_A, threadRootId: '$needs', lastActivityTs: NOW - 3 }),
    ];

    const grouped = runFilter(entries, { groupSections: true });
    expect(grouped.sections.map((section) => section.id)).toEqual([
      'needsYou',
      'working',
      'later',
      'done',
    ]);
    expect(grouped.sections[2]?.entries.map((e) => e.threadRootId)).toEqual([
      '$laterSoon',
      '$laterFar',
    ]);
  });

  it('sorts ascending and respects simple-mode projection', () => {
    const entries = [
      makeEntry({ roomId: ROOM_A, threadRootId: '$old', lastActivityTs: NOW - 100 }),
      makeEntry({ roomId: ROOM_B, threadRootId: '$new', lastActivityTs: NOW, isResolved: true }),
    ];

    const asc = runFilter(entries, {
      simpleMode: true,
      filterState: { sortDirection: 'asc', tab: 'done', resolved: 'exclude' },
    });
    // Simple mode drops the workflow tab and keeps resolved=exclude and sortDirection.
    expect(asc.entries.map((e) => e.threadRootId)).toEqual(['$old']);
    expect(asc.effectiveFilterState.tab).toBeUndefined();
  });

  it('toggles room selection without ever yielding 0 active rooms', () => {
    const rooms = [ROOM_A, ROOM_B, '!gamma:example.org'];
    expect(resolveActiveSpaceRoomIds(rooms, undefined)).toEqual(rooms);

    // From All, toggling Room A excludes Room A.
    const withoutA = toggleSpaceRoomSelection(undefined, ROOM_A, rooms);
    expect([...(withoutA ?? [])]).toEqual([ROOM_B, '!gamma:example.org']);

    // Re-adding Room A normalizes back to All (undefined).
    expect(toggleSpaceRoomSelection(withoutA, ROOM_A, rooms)).toBeUndefined();

    // Downselecting to 1 room then unchecking that last room resets to All (never 0 rooms).
    const onlyB = selectOnlySpaceRoom(ROOM_B, rooms);
    expect([...(onlyB ?? [])]).toEqual([ROOM_B]);
    expect(toggleSpaceRoomSelection(onlyB, ROOM_B, rooms)).toBeUndefined();
  });

  it('enforces resolveComposerTargetRoom draft-safety invariant and fallback order', () => {
    const sendable = [ROOM_A, ROOM_B];

    // Draft safety: filtering down to ROOM_B NEVER silently retargets an in-progress draft in ROOM_A.
    expect(
      resolveComposerTargetRoom({
        activeRoomIds: [ROOM_B],
        sendableRoomIds: sendable,
        currentTargetRoomId: ROOM_A,
        lastTargetRoomId: ROOM_A,
        hasDraft: true,
      })
    ).toBe(ROOM_A);

    // Without a draft, downselecting to 1 sendable room auto-selects it.
    expect(
      resolveComposerTargetRoom({
        activeRoomIds: [ROOM_B],
        sendableRoomIds: sendable,
        currentTargetRoomId: ROOM_A,
        lastTargetRoomId: ROOM_A,
        hasDraft: false,
      })
    ).toBe(ROOM_B);

    // If the drafted room is no longer sendable, fall back cleanly to an active sendable room.
    expect(
      resolveComposerTargetRoom({
        activeRoomIds: [ROOM_B],
        sendableRoomIds: [ROOM_B],
        currentTargetRoomId: ROOM_A,
        hasDraft: true,
      })
    ).toBe(ROOM_B);

    // Multi-room active view prefers currentTarget -> lastTarget -> first active sendable -> first sendable.
    expect(
      resolveComposerTargetRoom({
        activeRoomIds: [ROOM_A, ROOM_B],
        sendableRoomIds: sendable,
        lastTargetRoomId: ROOM_B,
        hasDraft: false,
      })
    ).toBe(ROOM_B);

    // Filtering to a read-only room falls back to first sendable room in the Space.
    expect(
      resolveComposerTargetRoom({
        activeRoomIds: ['!readonly:example.org'],
        sendableRoomIds: sendable,
        hasDraft: false,
      })
    ).toBe(ROOM_A);

    expect(
      resolveComposerTargetRoom({
        activeRoomIds: [ROOM_A],
        sendableRoomIds: [],
        hasDraft: false,
      })
    ).toBeUndefined();
  });

  it('returns deterministic accent colors and merges 0-reply live timeline roots once', () => {
    expect(getRoomAccentColor(ROOM_A)).toBe(getRoomAccentColor(ROOM_A));
    expect(getRoomAccentColor(ROOM_A)).toMatch(/^#[0-9a-f]{6}$/i);

    const indexedEntry = makeEntry({ roomId: ROOM_A, threadRootId: '$existing' });
    const makeEvent = (id: string, body: string) => ({
      getId: () => id,
      getType: () => 'm.room.message',
      getContent: () => ({ msgtype: 'm.text', body }),
      getSender: () => '@alice:example.org',
      getTs: () => NOW,
      getRelation: () => undefined,
      getUnsigned: () => ({}),
      replacingEvent: () => null,
      isRedacted: () => false,
    });
    const fakeRoom = {
      roomId: ROOM_A,
      name: 'Engineering',
      getLiveTimeline: () => ({
        getEvents: () => [
          makeEvent('$existing', 'Already indexed'),
          makeEvent('$fresh', 'Brand new'),
        ],
        getState: () => undefined,
      }),
      getThread: () => undefined,
      findEventById: () => undefined,
      getUnfilteredTimelineSet: () => undefined,
      currentState: { getStateEvents: () => [] },
    } as unknown as Room;

    const merged = collectSpaceThreadEntries(
      new Map([[indexedEntry.key, indexedEntry]]),
      [fakeRoom],
      new Set([ROOM_A]),
      '@alice:example.org'
    );
    expect(merged.map((e) => e.threadRootId)).toEqual(['$existing', '$fresh']);
  });
});
