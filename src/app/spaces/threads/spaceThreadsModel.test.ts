import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { StateEvent } from '../../matrix/types/room';
import { MINDROOM_THREAD_TAGS_EVENT } from '../../event-store/threads/threadTags';
import { MINDROOM_SCHEDULED_TASK_EVENT } from '../../matrix/protocol/scheduledTaskContract';
import { MINDROOM_ACTIVE_RUNS_EVENT } from '../../matrix/protocol/activeRunsContract';
import {
  createDefaultThreadFilterState,
  type ThreadFilterState,
} from '../../event-store/threads/roomThreadOverviewModel';
import { QUIET_AFTER_MS } from '../../event-store/threads/threadWorkflow';
import {
  getCrossRoomThreadIndexKey,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import {
  buildSpaceRoomFilterGroups,
  buildSwitchableSpaceItems,
  collectSpaceThreadEntries,
  filterAndSortSpaceThreads,
  getRoomAccentColor,
  pruneSpaceRoomSelection,
  resolveComposerTargetRoom,
  toggleSpaceRoomGroupSelection,
  toggleSpaceRoomSelection,
} from './spaceThreadsModel';
import { makeSpaceThreadEntry, SPACE_THREADS_TEST_NOW as NOW } from './spaceThreads.test.shared';

const ROOM_A = '!alpha:example.org';
const ROOM_B = '!beta:example.org';
const ROOM_OUTSIDE = '!outside:example.org';

const roomsById = new Map([
  [ROOM_A, { name: 'Engineering' }],
  [ROOM_B, { name: 'Design' }],
]);

const runFilter = (
  entries: CrossRoomThreadIndexEntry[],
  overrides: {
    selectedRoomIds?: ReadonlySet<string>;
    filterState?: Partial<ThreadFilterState>;
    simpleMode?: boolean;
    hasMindroomAgents?: boolean;
    groupSections?: boolean;
    sectionOrder?: readonly ("needsYou" | "working" | "later" | "quiet" | "done")[];
    pinnedKeys?: readonly string[];
  } = {}
) =>
  filterAndSortSpaceThreads({
    entries,
    roomsById,
    selectedRoomIds: overrides.selectedRoomIds,
    filterState: { ...createDefaultThreadFilterState(), ...overrides.filterState },
    simpleMode: overrides.simpleMode ?? false,
    snoozeNow: NOW,
    hasMindroomAgents: overrides.hasMindroomAgents ?? true,
    groupSections: overrides.groupSections ?? false,
    sectionOrder: overrides.sectionOrder,
    pinnedKeys: overrides.pinnedKeys,
  });

const rootIdsOf = (result: ReturnType<typeof runFilter>) =>
  result.orderedKeys.map((key) => result.entryByKey.get(key)?.threadRootId);

const makeEvent = (id: string, body: string, sender = '@alice:example.org') => ({
  getId: () => id,
  getType: () => 'm.room.message',
  getContent: () => ({ msgtype: 'm.text', body }),
  getSender: () => sender,
  getTs: () => NOW,
  getRelation: () => undefined,
  getUnsigned: () => ({}),
  replacingEvent: () => null,
  isRedacted: () => false,
});

const makeFakeRoom = (roomId: string, name: string, events: unknown[], space = false): Room =>
  ({
    roomId,
    name,
    isSpaceRoom: () => space,
    getType: () => (space ? 'm.space' : undefined),
    getLiveTimeline: () => ({
      getEvents: () => events,
      getState: () => ({
        getStateEvents: (type: string) =>
          type === (StateEvent.RoomCreate as string)
            ? { getContent: () => (space ? { type: 'm.space' } : {}) }
            : null,
      }),
    }),
    getThread: () => undefined,
    findEventById: () => undefined,
    getUnfilteredTimelineSet: () => undefined,
    currentState: { getStateEvents: () => [] },
  }) as unknown as Room;

describe('spaceThreadsModel', () => {
  it('keeps 0-reply roots, counts rooms, and supports 1-room downselect', () => {
    const entries = [
      makeSpaceThreadEntry({
        roomId: ROOM_A,
        threadRootId: '$a1',
        replyCount: 0,
        lastActivityTs: NOW - 10,
      }),
      makeSpaceThreadEntry({
        roomId: ROOM_A,
        threadRootId: '$a2',
        replyCount: 3,
        lastActivityTs: NOW - 30,
      }),
      makeSpaceThreadEntry({
        roomId: ROOM_B,
        threadRootId: '$b1',
        replyCount: 2,
        lastActivityTs: NOW - 20,
      }),
    ];

    const all = runFilter(entries);
    expect(rootIdsOf(all)).toEqual(['$a1', '$b1', '$a2']);
    expect(all.scopedTotalCount).toBe(3);
    expect(all.scopedRecords.size).toBe(3);
    expect(all.effectiveFilterState.rooms).toBeUndefined();
    expect(all.roomCounts.get(ROOM_A)).toBe(2);
    expect(all.roomCounts.get(ROOM_B)).toBe(1);
    expect(all.roomCounts.has(ROOM_OUTSIDE)).toBe(false);

    const onlyB = runFilter(entries, { selectedRoomIds: new Set([ROOM_B]) });
    expect(rootIdsOf(onlyB)).toEqual(['$b1']);
    expect(onlyB.scopedTotalCount).toBe(1);
    expect(onlyB.scopedRecords.size).toBe(1);
    expect(onlyB.effectiveFilterState.rooms).toEqual([ROOM_B]);
    expect(onlyB.roomCounts.get(ROOM_A)).toBe(2);
  });

  it('filters by workflow tab, tags, forMe, people, and search across text and room name', () => {
    const entries = [
      makeSpaceThreadEntry({
        roomId: ROOM_A,
        threadRootId: '$needs',
        summaryText: 'Fix CI pipeline',
        tags: ['urgent'],
        isForUser: true,
        rootSenderId: '@alice:example.org',
        participantIds: ['@alice:example.org'],
        lastActivityTs: NOW - 5,
      }),
      makeSpaceThreadEntry({
        roomId: ROOM_A,
        threadRootId: '$working',
        summaryText: 'Generate release notes',
        isStreaming: true,
        tags: ['release'],
        rootSenderId: '@bob:example.org',
        participantIds: ['@bob:example.org'],
        lastActivityTs: NOW - 15,
      }),
      makeSpaceThreadEntry({
        roomId: ROOM_B,
        threadRootId: '$later',
        summaryText: 'Logo review',
        snoozedUntilTs: NOW + 60_000,
        rootSenderId: '@carol:example.org',
        participantIds: ['@carol:example.org'],
        lastActivityTs: NOW - 25,
      }),
      makeSpaceThreadEntry({
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
    expect(baseline.tagCounts).toEqual({ urgent: 2, release: 1 });

    expect(rootIdsOf(runFilter(entries, { filterState: { tab: 'working' } }))).toEqual([
      '$working',
    ]);
    expect(
      rootIdsOf(runFilter(entries, { filterState: { tags: new Map([['urgent', 'include']]) } }))
    ).toEqual(['$needs', '$done']);
    expect(rootIdsOf(runFilter(entries, { filterState: { forMe: true } }))).toEqual(['$needs']);
    expect(
      rootIdsOf(runFilter(entries, { filterState: { people: ['@bob:example.org'] } }))
    ).toEqual(['$working']);
    // Search matches room name + thread text together.
    expect(rootIdsOf(runFilter(entries, { filterState: { freeText: 'design logo' } }))).toEqual([
      '$later',
    ]);
    expect(
      rootIdsOf(runFilter(entries, { filterState: { resolved: 'include', freeText: 'icon' } }))
    ).toEqual(['$done']);
  });

  it('groups via buildCompactThreadSections (including Quiet) and orders Later by soonest return time', () => {
    const entries = [
      makeSpaceThreadEntry({
        roomId: ROOM_A,
        threadRootId: '$done',
        isResolved: true,
        lastActivityTs: NOW,
      }),
      makeSpaceThreadEntry({
        roomId: ROOM_A,
        threadRootId: '$laterFar',
        snoozedUntilTs: NOW + 120_000,
        lastActivityTs: NOW - 1,
      }),
      makeSpaceThreadEntry({
        roomId: ROOM_B,
        threadRootId: '$laterSoon',
        snoozedUntilTs: NOW + 30_000,
        lastActivityTs: NOW - 50,
      }),
      makeSpaceThreadEntry({
        roomId: ROOM_B,
        threadRootId: '$working',
        isStreaming: true,
        lastActivityTs: NOW - 2,
      }),
      makeSpaceThreadEntry({
        roomId: ROOM_A,
        threadRootId: '$needs',
        replyCount: 0,
        lastActivityTs: NOW - 3,
      }),
      makeSpaceThreadEntry({
        roomId: ROOM_B,
        threadRootId: '$quiet',
        replyCount: 0,
        lastActivityTs: NOW - QUIET_AFTER_MS - 1_000,
      }),
    ];

    const grouped = runFilter(entries, { groupSections: true });
    expect(grouped.sections.map((section) => section.id)).toEqual([
      'needsYou',
      'working',
      'later',
      'quiet',
      'done',
    ]);
    const reordered = runFilter(entries, {
      groupSections: true,
      sectionOrder: ['done', 'working', 'later'],
    });
    expect(reordered.sections.map((section) => section.id)).toEqual([
      'done',
      'working',
      'later',
      'needsYou',
      'quiet',
    ]);
    expect(
      grouped.sections[2]?.rootIds.map((key) => grouped.entryByKey.get(key)?.threadRootId)
    ).toEqual(['$laterSoon', '$laterFar']);
    expect(
      grouped.sections[3]?.rootIds.map((key) => grouped.entryByKey.get(key)?.threadRootId)
    ).toEqual(['$quiet']);
    expect(grouped.nextQuietWakeTs).toBe(NOW - 3 + QUIET_AFTER_MS);
  });

  it('keeps a pinned >5-day-old unresolved thread in needsYou instead of folding it into quiet', () => {
    const staleTs = NOW - QUIET_AFTER_MS - 60_000;
    const entries = [
      makeSpaceThreadEntry({
        roomId: ROOM_A,
        threadRootId: '$recent',
        replyCount: 0,
        lastActivityTs: NOW - 1_000,
      }),
      makeSpaceThreadEntry({
        roomId: ROOM_B,
        threadRootId: '$pinnedOld',
        replyCount: 0,
        lastActivityTs: staleTs,
      }),
      makeSpaceThreadEntry({
        roomId: ROOM_A,
        threadRootId: '$unpinnedOld',
        replyCount: 0,
        lastActivityTs: staleTs,
      }),
    ];

    const grouped = runFilter(entries, {
      groupSections: true,
      pinnedKeys: [getCrossRoomThreadIndexKey(ROOM_B, '$pinnedOld')],
    });
    expect(grouped.sections.map((section) => section.id)).toEqual(['needsYou', 'quiet']);
    expect(
      grouped.sections[0]?.rootIds.map((key) => grouped.entryByKey.get(key)?.threadRootId)
    ).toEqual(['$pinnedOld', '$recent']);
    expect(
      grouped.sections[1]?.rootIds.map((key) => grouped.entryByKey.get(key)?.threadRootId)
    ).toEqual(['$unpinnedOld']);
  });

  it('sorts ascending across multiple surviving entries and respects simple-mode projection', () => {
    const entries = [
      makeSpaceThreadEntry({ roomId: ROOM_A, threadRootId: '$newer', lastActivityTs: NOW - 50 }),
      makeSpaceThreadEntry({ roomId: ROOM_B, threadRootId: '$older', lastActivityTs: NOW - 200 }),
      makeSpaceThreadEntry({
        roomId: ROOM_B,
        threadRootId: '$resolved',
        lastActivityTs: NOW,
        isResolved: true,
      }),
    ];

    const asc = runFilter(entries, {
      simpleMode: true,
      filterState: { sortDirection: 'asc', tab: 'done', resolved: 'exclude' },
    });
    // Simple mode drops the workflow tab and keeps resolved=exclude and ascending sortDirection.
    expect(rootIdsOf(asc)).toEqual(['$older', '$newer']);
    expect(asc.effectiveFilterState.tab).toBeUndefined();
  });

  it('prunes and toggles room selection without ever yielding 0 active rooms', () => {
    const rooms = [ROOM_A, ROOM_B, '!gamma:example.org'];

    // Pruning drops departed rooms and normalizes empty or full sets back to All (undefined).
    expect(
      pruneSpaceRoomSelection(new Set([ROOM_B, '!gone:example.org']), [ROOM_A, ROOM_B])
    ).toEqual(new Set([ROOM_B]));
    expect(
      pruneSpaceRoomSelection(new Set(['!gone:example.org']), [ROOM_A, ROOM_B])
    ).toBeUndefined();
    expect(pruneSpaceRoomSelection(new Set([ROOM_A, ROOM_B]), [ROOM_A, ROOM_B])).toBeUndefined();

    // From All (undefined), toggling Room A downselects to Room A.
    const onlyA = toggleSpaceRoomSelection(undefined, ROOM_A, rooms);
    expect([...(onlyA ?? [])]).toEqual([ROOM_A]);

    // Toggling Room B adds it to the selection.
    const aAndB = toggleSpaceRoomSelection(onlyA, ROOM_B, rooms);
    expect([...(aAndB ?? [])]).toEqual([ROOM_A, ROOM_B]);

    // Selecting the remaining room normalizes back to All (undefined).
    expect(toggleSpaceRoomSelection(aAndB, '!gamma:example.org', rooms)).toBeUndefined();

    // Unchecking Room A leaves Room B; unchecking the last room resets to All (never 0 rooms).
    const onlyB = toggleSpaceRoomSelection(aAndB, ROOM_A, rooms);
    expect([...(onlyB ?? [])]).toEqual([ROOM_B]);
    expect(toggleSpaceRoomSelection(onlyB, ROOM_B, rooms)).toBeUndefined();

    // Unknown room IDs keep the current selection intact, and 1-room spaces stay undefined.
    expect([...(toggleSpaceRoomSelection(onlyB, '!unknown:example.org', rooms) ?? [])]).toEqual([
      ROOM_B,
    ]);
    expect(toggleSpaceRoomSelection(undefined, ROOM_A, [ROOM_A])).toBeUndefined();
  });

  it('enforces resolveComposerTargetRoom draft-safety invariant and fallback order', () => {
    const sendable = [ROOM_A, ROOM_B];

    // Draft safety: filtering down to ROOM_B NEVER silently retargets an in-progress draft in ROOM_A.
    expect(
      resolveComposerTargetRoom({
        activeRoomIds: [ROOM_B],
        sendableRoomIds: sendable,
        currentTargetRoomId: ROOM_A,
        hasDraft: true,
      })
    ).toEqual({ targetRoomId: ROOM_A, destinationRoomIds: [ROOM_A, ROOM_B] });

    // Without a draft, downselecting to 1 sendable room auto-selects it.
    expect(
      resolveComposerTargetRoom({
        activeRoomIds: [ROOM_B],
        sendableRoomIds: sendable,
        currentTargetRoomId: ROOM_A,
        hasDraft: false,
      })
    ).toEqual({ targetRoomId: ROOM_B, destinationRoomIds: [ROOM_B] });

    // If the drafted room is no longer sendable, fall back cleanly to an active sendable room.
    expect(
      resolveComposerTargetRoom({
        activeRoomIds: [ROOM_B],
        sendableRoomIds: [ROOM_B],
        currentTargetRoomId: ROOM_A,
        hasDraft: true,
      })
    ).toEqual({ targetRoomId: ROOM_B, destinationRoomIds: [ROOM_B] });

    // Multi-room active view preserves explicit currentTarget when still active and sendable.
    expect(
      resolveComposerTargetRoom({
        activeRoomIds: [ROOM_A, ROOM_B],
        sendableRoomIds: sendable,
        currentTargetRoomId: ROOM_B,
        hasDraft: false,
      })
    ).toEqual({ targetRoomId: ROOM_B, destinationRoomIds: [ROOM_A, ROOM_B] });

    // Filtering to a read-only room falls back to sendable rooms and honors explicit selection among them.
    expect(
      resolveComposerTargetRoom({
        activeRoomIds: ['!readonly:example.org'],
        sendableRoomIds: sendable,
        hasDraft: false,
      })
    ).toEqual({ targetRoomId: ROOM_A, destinationRoomIds: [ROOM_A, ROOM_B] });
    expect(
      resolveComposerTargetRoom({
        activeRoomIds: ['!readonly:example.org'],
        sendableRoomIds: sendable,
        currentTargetRoomId: ROOM_B,
        hasDraft: false,
      })
    ).toEqual({ targetRoomId: ROOM_B, destinationRoomIds: [ROOM_A, ROOM_B] });

    expect(
      resolveComposerTargetRoom({
        activeRoomIds: [ROOM_A],
        sendableRoomIds: [],
        hasDraft: false,
      })
    ).toEqual({ targetRoomId: undefined, destinationRoomIds: [] });
  });

  it('returns deterministic accent colors, scopes to space rooms, and merges 0-reply live roots once', () => {
    expect(getRoomAccentColor(ROOM_A)).toBe(getRoomAccentColor(ROOM_A));
    expect(getRoomAccentColor(ROOM_A)).toMatch(/^#[0-9a-f]{6}$/i);

    const indexedEntry = makeSpaceThreadEntry({ roomId: ROOM_A, threadRootId: '$existing' });
    const outsideEntry = makeSpaceThreadEntry({ roomId: ROOM_OUTSIDE, threadRootId: '$x1' });
    const fakeRoom = makeFakeRoom(ROOM_A, 'Engineering', [
      makeEvent('$existing', 'Already indexed'),
      makeEvent('$fresh', 'Brand new'),
    ]);

    const merged = collectSpaceThreadEntries(
      new Map([
        [indexedEntry.key, indexedEntry],
        [outsideEntry.key, outsideEntry],
      ]),
      [fakeRoom],
      '@alice:example.org'
    );
    expect(merged.map((e) => e.threadRootId)).toEqual(['$existing', '$fresh']);
  });

  it('reads tag, scheduled, and active-run state once per room for standalone roots and preserves metadata', () => {
    const now = Date.now();
    const agentId = '@mindroom_bot:example.org';
    const userId = '@alice:example.org';
    const liveStateEvents = vi.fn((type: string, stateKey?: string): unknown => {
      if (stateKey !== undefined) return null;
      return type === MINDROOM_THREAD_TAGS_EVENT
        ? [
            {
              getSender: () => userId,
              getStateKey: () => '$s1',
              getTs: () => NOW,
              isRedacted: () => false,
              getContent: () => ({ tags: { urgent: { set_by: userId, set_at: NOW } } }),
            },
          ]
        : [];
    });
    const currentStateEvents = vi.fn((type: string, stateKey?: string): unknown => {
      if (stateKey !== undefined) return null;
      if (type === MINDROOM_SCHEDULED_TASK_EVENT) {
        return [
          {
            getSender: () => agentId,
            getStateKey: () => 'task-1',
            getContent: () => ({
              status: 'pending',
              thread_id: '$s2',
              execute_at: '2099-01-01T00:00:00Z',
            }),
          },
        ];
      }
      if (type === MINDROOM_ACTIVE_RUNS_EVENT) {
        return [
          {
            getSender: () => agentId,
            getStateKey: () => agentId,
            getTs: () => now,
            isRedacted: () => false,
            getContent: () => ({ version: 1, updated_at: now, threads: [{ thread_id: '$s3' }] }),
          },
        ];
      }
      return [];
    });
    const makeStatefulRoom = (
      roomId: string,
      events: unknown[],
      liveSpy: typeof liveStateEvents,
      currentSpy: typeof currentStateEvents
    ): Room =>
      ({
        roomId,
        name: roomId,
        myUserId: userId,
        getMember: () => null,
        getLiveTimeline: () => ({
          getEvents: () => events,
          getState: () => ({ getStateEvents: liveSpy }),
        }),
        getThread: () => undefined,
        findEventById: () => undefined,
        getUnfilteredTimelineSet: () => undefined,
        currentState: { getStateEvents: currentSpy },
      }) as unknown as Room;

    const standaloneEvents = ['$s0', '$s1', '$s2', '$s3', '$s4'].map((id) => makeEvent(id, id));
    const roomWithStandalones = makeStatefulRoom(
      ROOM_A,
      standaloneEvents,
      liveStateEvents,
      currentStateEvents
    );
    const idleLiveSpy = vi.fn(() => []);
    const idleCurrentSpy = vi.fn(() => []);
    const alreadyIndexed = makeSpaceThreadEntry({ roomId: ROOM_B, threadRootId: '$indexed' });
    const roomWithoutStandalones = makeStatefulRoom(
      ROOM_B,
      [makeEvent('$indexed', 'Already indexed')],
      idleLiveSpy,
      idleCurrentSpy
    );

    const collected = collectSpaceThreadEntries(
      new Map([[alreadyIndexed.key, alreadyIndexed]]),
      [roomWithStandalones, roomWithoutStandalones],
      userId
    );
    const byId = new Map(collected.map((entry) => [entry.threadRootId, entry]));

    expect(
      liveStateEvents.mock.calls.filter(([t]) => t === MINDROOM_THREAD_TAGS_EVENT)
    ).toHaveLength(1);
    expect(
      currentStateEvents.mock.calls.filter(([t]) => t === MINDROOM_SCHEDULED_TASK_EVENT)
    ).toHaveLength(1);
    expect(
      currentStateEvents.mock.calls.filter(([t]) => t === MINDROOM_ACTIVE_RUNS_EVENT)
    ).toHaveLength(1);
    expect(idleLiveSpy).not.toHaveBeenCalled();
    expect(idleCurrentSpy).not.toHaveBeenCalled();

    expect(byId.get('$s0')?.tags).toEqual([]);
    expect(byId.get('$s0')?.threadRecord.status.scheduledTaskCount).toBe(0);
    expect(byId.get('$s0')?.threadRecord.status.isStreaming).toBe(false);
    expect(byId.get('$s1')?.tags).toEqual(['urgent']);
    expect(byId.get('$s2')?.threadRecord.status.scheduledTaskCount).toBe(1);
    expect(byId.get('$s2')?.hasAttention).toBe(true);
    expect(byId.get('$s3')?.threadRecord.status.isStreaming).toBe(true);
    expect(byId.get('$s3')?.hasAttention).toBe(true);
  });

  it('filters out ignored users from indexed entries and standalone live roots', () => {
    const allowedIndexed = makeSpaceThreadEntry({
      roomId: ROOM_A,
      threadRootId: '$ok-indexed',
      rootSenderId: '@alice:example.org',
    });
    const blockedIndexed = makeSpaceThreadEntry({
      roomId: ROOM_A,
      threadRootId: '$blocked-indexed',
      rootSenderId: '@spam:example.org',
    });
    const fakeRoom = makeFakeRoom(ROOM_A, 'Engineering', [
      makeEvent('$ok-root', 'Visible root', '@alice:example.org'),
      makeEvent('$blocked-root', 'Blocked root', '@spam:example.org'),
    ]);

    const merged = collectSpaceThreadEntries(
      new Map([
        [allowedIndexed.key, allowedIndexed],
        [blockedIndexed.key, blockedIndexed],
      ]),
      [fakeRoom],
      '@alice:example.org',
      new Set(['@spam:example.org'])
    );
    expect(merged.map((e) => e.threadRootId)).toEqual(['$ok-indexed', '$ok-root']);
  });

  it('builds cycle-safe switchable space items in rail order with nested subspace depths', () => {
    const spaces = [
      makeFakeRoom('!s1:example.org', 'Engineering', [], true),
      makeFakeRoom('!sub-z:example.org', 'Zeta', [], true),
      makeFakeRoom('!sub-a:example.org', 'Alpha', [], true),
      makeFakeRoom('!grand:example.org', 'Grand', [], true),
      makeFakeRoom('!s2:example.org', 'Design', [], true),
      makeFakeRoom('!cyc-a:example.org', 'Cycle A', [], true),
      makeFakeRoom('!cyc-b:example.org', 'Cycle B', [], true),
      makeFakeRoom(ROOM_A, 'Regular Room', [], false),
    ];
    const byId = new Map(spaces.map((r) => [r.roomId, r]));
    const mx = { getRoom: (id: string) => byId.get(id) ?? null } as unknown as MatrixClient;
    const roomToParents = new Map<string, Set<string>>([
      ['!sub-z:example.org', new Set(['!s1:example.org'])],
      ['!sub-a:example.org', new Set(['!s1:example.org'])],
      ['!grand:example.org', new Set(['!sub-a:example.org'])],
      ['!cyc-a:example.org', new Set(['!cyc-b:example.org'])],
      ['!cyc-b:example.org', new Set(['!cyc-a:example.org'])],
    ]);

    const items = buildSwitchableSpaceItems(
      mx,
      ['!s1:example.org', '!s2:example.org'],
      spaces.map((r) => r.roomId),
      roomToParents
    );
    expect(items.map((item) => [item.spaceId, item.depth])).toEqual([
      ['!s1:example.org', 0],
      ['!sub-a:example.org', 1],
      ['!grand:example.org', 2],
      ['!sub-z:example.org', 1],
      ['!s2:example.org', 0],
      ['!cyc-a:example.org', 0],
      ['!cyc-b:example.org', 1],
    ]);
  });

  it('groups visible rooms by nested subspaces including empty organizers and omits flat/100% groups', () => {
    const rootId = '!root:example.org';
    const orgId = '!org:example.org';
    const subAId = '!sub-a:example.org';
    const subBId = '!sub-b:example.org';
    const rRoot = makeFakeRoom('!r-root:example.org', 'General', []);
    const rA = makeFakeRoom('!r-a:example.org', 'API', []);
    const rB = makeFakeRoom('!r-b:example.org', 'CI', []);
    const allObjects = [
      makeFakeRoom(rootId, 'Workspace', [], true),
      makeFakeRoom(orgId, 'Platform', [], true),
      makeFakeRoom(subAId, 'Backend', [], true),
      makeFakeRoom(subBId, 'Infra', [], true),
      rRoot,
      rA,
      rB,
    ];
    const byId = new Map(allObjects.map((r) => [r.roomId, r]));
    const mx = { getRoom: (id: string) => byId.get(id) ?? null } as unknown as MatrixClient;
    const roomCatalog = new Map([
      [rRoot.roomId, { room: rRoot, name: rRoot.name }],
      [rA.roomId, { room: rA, name: rA.name }],
      [rB.roomId, { room: rB, name: rB.name }],
    ]);

    // Flat space with no subspaces returns undefined.
    const flatParents = new Map<string, Set<string>>([
      [rRoot.roomId, new Set([rootId])],
      [rA.roomId, new Set([rootId])],
    ]);
    expect(
      buildSpaceRoomFilterGroups({
        mx,
        spaceId: rootId,
        roomsById: roomCatalog,
        orderedRoomIds: [rRoot.roomId, rA.roomId],
        joinedRoomIds: [rootId, rRoot.roomId, rA.roomId],
        directs: new Set(),
        roomToParents: flatParents,
        chatRooms: new Set(),
      })
    ).toBeUndefined();

    // Root room + empty organizer subspace wrapping Backend and Infra.
    const nestedParents = new Map<string, Set<string>>([
      [rRoot.roomId, new Set([rootId])],
      [orgId, new Set([rootId])],
      [subAId, new Set([orgId])],
      [subBId, new Set([orgId])],
      [rA.roomId, new Set([subAId])],
      [rB.roomId, new Set([subBId])],
    ]);
    const grouped = buildSpaceRoomFilterGroups({
      mx,
      spaceId: rootId,
      roomsById: roomCatalog,
      orderedRoomIds: [rRoot.roomId, rA.roomId, rB.roomId],
      joinedRoomIds: allObjects.map((r) => r.roomId),
      directs: new Set(),
      roomToParents: nestedParents,
      chatRooms: new Set(),
    });
    expect(grouped?.rootRoomIds).toEqual([rRoot.roomId]);
    expect(
      grouped?.subspaces.map((g) => ({
        spaceId: g.spaceId,
        depth: g.depth,
        directRoomIds: g.directRoomIds,
        subtreeRoomIds: g.subtreeRoomIds,
      }))
    ).toEqual([
      { spaceId: orgId, depth: 1, directRoomIds: [], subtreeRoomIds: [rA.roomId, rB.roomId] },
      { spaceId: subAId, depth: 2, directRoomIds: [rA.roomId], subtreeRoomIds: [rA.roomId] },
      { spaceId: subBId, depth: 2, directRoomIds: [rB.roomId], subtreeRoomIds: [rB.roomId] },
    ]);

    // Lone subspace wrapping 100% of visible rooms is skipped as a no-op.
    const loneParents = new Map<string, Set<string>>([
      [subAId, new Set([rootId])],
      [rA.roomId, new Set([subAId])],
      [rB.roomId, new Set([subAId])],
    ]);
    expect(
      buildSpaceRoomFilterGroups({
        mx,
        spaceId: rootId,
        roomsById: roomCatalog,
        orderedRoomIds: [rA.roomId, rB.roomId],
        joinedRoomIds: [rootId, subAId, rA.roomId, rB.roomId],
        directs: new Set(),
        roomToParents: loneParents,
        chatRooms: new Set(),
      })
    ).toBeUndefined();
  });

  it('toggles subspace room groups across unchecked, partial, checked, and full-selection states', () => {
    const all = ['!r1', '!r2', '!r3', '!r4'];
    const group = ['!r3', '!r4'];

    // Unchecked -> checked.
    const checked = toggleSpaceRoomGroupSelection(undefined, group, all);
    expect([...(checked ?? [])].sort()).toEqual(['!r3', '!r4']);

    // Checked -> unchecked (resets to undefined = all rooms).
    expect(toggleSpaceRoomGroupSelection(checked, group, all)).toBeUndefined();

    // Partial/indeterminate -> all checked.
    const fromPartial = toggleSpaceRoomGroupSelection(new Set(['!r3']), group, all);
    expect([...(fromPartial ?? [])].sort()).toEqual(['!r3', '!r4']);

    // Completing all rooms resets to undefined.
    expect(
      toggleSpaceRoomGroupSelection(new Set(['!r1', '!r2', '!r3']), group, all)
    ).toBeUndefined();
  });
});
