import { describe, expect, it, vi } from 'vitest';
import { groupThreadSections, type ThreadSectionReader } from './threadSections';

type Item = {
  id: string;
  working?: boolean;
  resolved?: boolean;
  snoozedUntilTs?: number;
  started?: number;
  finished?: number;
  resolvedAt?: number;
  pin?: number;
  /** The order the caller had them in, which breaks ties. */
  place: number;
};

const reader = (finishedTs = (item: Item) => item.finished ?? 0): ThreadSectionReader<Item> => ({
  isWorking: (item) => item.working === true,
  isResolved: (item) => item.resolved === true,
  snoozedUntilTs: (item) => item.snoozedUntilTs,
  startedTs: (item) => item.started ?? 0,
  finishedTs,
  resolvedTs: (item) => item.resolvedAt ?? 0,
  compare: (left, right) => left.place - right.place,
  pinRank: (item) => item.pin,
});

const ids = (sections: Record<string, Item[]>) =>
  Object.fromEntries(Object.entries(sections).map(([id, items]) => [id, items.map((i) => i.id)]));

describe('groupThreadSections', () => {
  it('puts each thread in the first section that fits: Working, Resolved, Snoozed, else Idle', () => {
    const items: Item[] = [
      { id: 'working-resolved', working: true, resolved: true, place: 0 },
      { id: 'resolved-snoozed', resolved: true, snoozedUntilTs: 900, place: 1 },
      { id: 'snoozed', snoozedUntilTs: 900, place: 2 },
      { id: 'woke', snoozedUntilTs: 100, place: 3 },
    ];

    expect(ids(groupThreadSections(items, reader(), 500))).toEqual({
      working: ['working-resolved'],
      snoozed: ['snoozed'],
      idle: ['woke'],
      resolved: ['resolved-snoozed'],
    });
  });

  it('orders each section by its own time, ties in the caller order, pins first', () => {
    const items: Item[] = [
      { id: 'w-old', working: true, started: 1, place: 0 },
      { id: 'w-new', working: true, started: 2, place: 1 },
      { id: 's-late', snoozedUntilTs: 900, place: 2 },
      { id: 's-soon', snoozedUntilTs: 600, place: 3 },
      { id: 'i-old', finished: 1, place: 4 },
      { id: 'i-tie-b', finished: 5, place: 6 },
      { id: 'i-tie-a', finished: 5, place: 5 },
      { id: 'i-pinned', finished: 0, pin: 0, place: 7 },
      { id: 'r-old', resolved: true, resolvedAt: 1, place: 8 },
      { id: 'r-new', resolved: true, resolvedAt: 2, place: 9 },
    ];

    expect(ids(groupThreadSections(items, reader(), 500))).toEqual({
      working: ['w-new', 'w-old'],
      snoozed: ['s-soon', 's-late'],
      idle: ['i-pinned', 'i-tie-a', 'i-tie-b', 'i-old'],
      resolved: ['r-new', 'r-old'],
    });
  });

  it('reads when a thread finished only for Idle threads, once each', () => {
    const finishedTs = vi.fn((item: Item) => item.finished ?? 0);
    const items: Item[] = [
      { id: 'working', working: true, place: 0 },
      { id: 'idle-a', finished: 1, place: 1 },
      { id: 'idle-b', finished: 2, place: 2 },
      { id: 'resolved', resolved: true, place: 3 },
    ];

    groupThreadSections(items, reader(finishedTs), 500);

    expect(finishedTs.mock.calls.map(([item]) => item.id).sort()).toEqual(['idle-a', 'idle-b']);
  });
});
