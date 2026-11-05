import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  createDefaultThreadFilterState,
  deserializeThreadFilterState,
  FILTER_PRESETS,
  hasActiveThreadFilters,
  serializeThreadFilterState,
  simplifyThreadFilterState,
} from './roomThreadOverviewModel';
import { filterThreadRecordRootIds } from './threadRecordOverview';
import {
  buildThreadPeopleActivity,
  collectThreadPeopleIds,
  matchesThreadPeopleFilter,
  matchesThreadPersonSearch,
  toggleThreadPerson,
} from './threadPeopleFilter';
import type { ThreadRecord } from './types';

const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';
const CAROL = '@carol:example.org';
const AGENT = '@mindroom_helper:example.org';

const record = (
  threadRootId: string,
  peopleIds: string[] | undefined,
  lastActivityTs = 0,
  presentation: Partial<ThreadRecord['presentation']> = {}
): ThreadRecord =>
  ({
    roomId: '!room:example.org',
    threadRootId,
    absoluteIndex: 0,
    presentation: {
      participantIds: [],
      replyParticipantIds: [],
      lastSenderId: undefined,
      peopleIds,
      ...presentation,
    },
    status: { isResolved: false, isStreaming: false, isUnread: false, tags: [], lastActivityTs },
  } as unknown as ThreadRecord);

describe('who took part in a thread', () => {
  it("lists the root's sender and every replier once", () => {
    expect(collectThreadPeopleIds(ALICE, [AGENT, undefined, BOB, AGENT, ALICE])).toEqual([
      ALICE,
      AGENT,
      BOB,
    ]);
    expect(collectThreadPeopleIds(undefined, [])).toEqual([]);
  });

  it('falls back to the participant avatars and last sender for records without the full list', () => {
    const partial = record('$t', undefined, 0, {
      participantIds: [AGENT, ALICE],
      lastSenderId: BOB,
    });
    expect(matchesThreadPeopleFilter(partial, [BOB])).toBe(true);
    expect(matchesThreadPeopleFilter(partial, [ALICE])).toBe(true);
    expect(matchesThreadPeopleFilter(partial, [CAROL])).toBe(false);
  });
});

describe('the People filter', () => {
  const threads = new Map([
    ['$1', record('$1', [ALICE, AGENT])],
    ['$2', record('$2', [BOB, AGENT])],
    ['$3', record('$3', [CAROL])],
    ['$4', record('$4', [ALICE, BOB])],
  ]);
  const ids = [...threads.keys()];
  const withPeople = (people: string[]) => ({ ...createDefaultThreadFilterState(), people });

  it('keeps a thread when any chosen person took part (OR)', () => {
    expect(filterThreadRecordRootIds(ids, withPeople([ALICE]), threads)).toEqual(['$1', '$4']);
    expect(filterThreadRecordRootIds(ids, withPeople([ALICE, CAROL]), threads)).toEqual([
      '$1',
      '$3',
      '$4',
    ]);
    expect(filterThreadRecordRootIds(ids, withPeople([AGENT]), threads)).toEqual(['$1', '$2']);
  });

  it('keeps every thread without a choice', () => {
    expect(filterThreadRecordRootIds(ids, withPeople([]), threads)).toEqual(ids);
    expect(filterThreadRecordRootIds(ids, createDefaultThreadFilterState(), threads)).toEqual(ids);
  });

  it('applies together with the other filters', () => {
    const resolved = new Map(threads);
    resolved.set('$4', {
      ...record('$4', [ALICE, BOB]),
      status: { ...record('$4', []).status, isResolved: true },
    });
    expect(
      filterThreadRecordRootIds(ids, { ...withPeople([ALICE]), resolved: 'exclude' }, resolved)
    ).toEqual(['$1']);
  });

  it('counts as an active filter, persists per room and clears with the All preset', () => {
    const state = withPeople([BOB, ALICE]);
    expect(hasActiveThreadFilters(state)).toBe(true);
    expect(hasActiveThreadFilters(withPeople([]))).toBe(false);

    const stored = serializeThreadFilterState(state);
    expect(stored.people).toEqual([ALICE, BOB]);
    expect(deserializeThreadFilterState(JSON.parse(JSON.stringify(stored))).people).toEqual([
      ALICE,
      BOB,
    ]);
    // A filter without people stores as before.
    expect(serializeThreadFilterState(createDefaultThreadFilterState())).not.toHaveProperty(
      'people'
    );
    expect(deserializeThreadFilterState({ ...stored, people: [ALICE, 7] }).people).toEqual([ALICE]);

    const all = FILTER_PRESETS.find((preset) => preset.id === 'all');
    if (!all) throw new Error('no All preset');
    expect(hasActiveThreadFilters(applyPreset(state, all))).toBe(false);
  });

  it('is not part of the simple filters', () => {
    expect(simplifyThreadFilterState(withPeople([ALICE])).people).toBeUndefined();
  });

  it('checks and unchecks one person', () => {
    expect(toggleThreadPerson(undefined, BOB)).toEqual([BOB]);
    expect(toggleThreadPerson([BOB], ALICE)).toEqual([ALICE, BOB]);
    expect(toggleThreadPerson([ALICE, BOB], ALICE)).toEqual([BOB]);
  });
});

describe('the People picker list', () => {
  it('lists everyone who took part, most threads first, then the most recent', () => {
    const activity = buildThreadPeopleActivity([
      record('$1', [ALICE, AGENT], 100),
      record('$2', [BOB, AGENT], 300),
      record('$3', [CAROL], 500),
      record('$4', [ALICE], 200),
    ]);
    expect(activity.map((person) => [person.userId, person.threadCount])).toEqual([
      [AGENT, 2],
      [ALICE, 2],
      [CAROL, 1],
      [BOB, 1],
    ]);
    expect(activity[0]?.lastActivityTs).toBe(300);
  });

  it('searches display names and Matrix IDs', () => {
    const alice = { userId: ALICE, displayName: 'Alice Liddell' };
    expect(matchesThreadPersonSearch(alice, 'lidd')).toBe(true);
    expect(matchesThreadPersonSearch(alice, 'ALICE:EXAMPLE')).toBe(true);
    expect(matchesThreadPersonSearch(alice, '  ')).toBe(true);
    expect(matchesThreadPersonSearch(alice, 'bob')).toBe(false);
  });
});
