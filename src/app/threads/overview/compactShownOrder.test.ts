import { describe, expect, it } from 'vitest';
import { COMPACT_THREAD_SECTION_ORDER, type CompactThreadSection } from './compactThreadSections';
import { stationaryRows, step } from './compactShownOrder';

const FLAT = 'flat';
const flat = (rootIds: string[]) => [{ id: FLAT, rootIds }];

const flatStep = (shown: string[], live: string[]) => step(flat(shown), flat(live), true, [FLAT]);

describe('step for a flat list', () => {
  it('follows the live order while nothing holds it', () => {
    const live = flat(['$c', '$a', '$b']);
    expect(step(flat(['$a', '$b', '$c']), live, false, [FLAT])).toBe(live);
  });

  it('keeps the shown order while held and drops threads that leave', () => {
    // $d got a reply and $b was resolved away; $e is new and leads the newest-first order.
    const held = flatStep(['$a', '$b', '$c', '$d'], ['$e', '$d', '$a', '$c']);
    expect(held).toEqual(flat(['$e', '$a', '$c', '$d']));
    const live = flat(['$c', '$e', '$d', '$a']);
    expect(step(held, live, true, [FLAT])).toEqual(held);
    expect(step(held, live, false, [FLAT])).toBe(live);
  });

  it('puts new threads at the top of a newest-first list, in their live order', () => {
    expect(flatStep(['$c', '$b', '$a'], ['$e', '$d', '$c', '$b', '$a'])).toEqual(
      flat(['$e', '$d', '$c', '$b', '$a'])
    );
  });

  it('puts new threads at the bottom even if their live predecessor moved up', () => {
    expect(flatStep(['$a', '$b'], ['$b', '$a', '$x'])).toEqual(flat(['$a', '$b', '$x']));
  });

  it('puts a new thread after the thread the live order puts before it', () => {
    expect(flatStep(['$a', '$b', '$c'], ['$a', '$b', '$x', '$c'])).toEqual(
      flat(['$a', '$b', '$x', '$c'])
    );
  });
});

describe('step in sections', () => {
  it('keeps emptied headers until released and takes new headers in section order', () => {
    const shown: CompactThreadSection[] = [{ id: 'working', rootIds: ['$gone'] }];
    const live: CompactThreadSection[] = [
      { id: 'needsYou', rootIds: ['$new'] },
      { id: 'later', rootIds: ['$later'] },
    ];
    expect(step(shown, live, true, COMPACT_THREAD_SECTION_ORDER)).toEqual([
      live[0],
      { id: 'working', rootIds: [] },
      live[1],
    ]);
    expect(step(shown, live, false, COMPACT_THREAD_SECTION_ORDER)).toBe(live);
  });

  it('keeps survivors in their shown section even if they are absent from that live section', () => {
    const shown: CompactThreadSection[] = [
      { id: 'working', rootIds: ['$a', '$b'] },
      { id: 'done', rootIds: ['$done'] },
    ];
    const live: CompactThreadSection[] = [
      { id: 'needsYou', rootIds: ['$new', '$a'] },
      { id: 'working', rootIds: ['$b'] },
      { id: 'done', rootIds: ['$done'] },
    ];
    expect(step(shown, live, true, COMPACT_THREAD_SECTION_ORDER)).toEqual([
      { id: 'needsYou', rootIds: ['$new'] },
      ...shown,
    ]);
  });
});

const randomLists = <Id extends string>(groupOrder: readonly Id[], keepEmpty = false) => {
  let seed = 0xa3a52f73;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const list = (shown: boolean) => {
    const groups = groupOrder.map((id) => ({ id, rootIds: [] as string[] }));
    const roots = Array.from({ length: 12 }, (_unused, index) => `$${index}`).filter(
      () => random() < 0.6
    );
    for (let index = roots.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [roots[index], roots[other]] = [roots[other]!, roots[index]!];
    }
    roots.forEach((rootId) => groups[Math.floor(random() * groups.length)]!.rootIds.push(rootId));
    return groups.filter(
      ({ rootIds }) => keepEmpty || rootIds.length > 0 || (shown && random() < 0.5)
    );
  };
  return Array.from({ length: 250 }, () => ({ shown: list(true), live: list(false) }));
};

const properties = <Id extends string>(groupOrder: readonly Id[], keepEmpty = false) => {
  const lists = randomLists(groupOrder, keepEmpty);
  it('is idempotent', () => {
    for (const { shown, live } of lists) {
      const held = step(shown, live, true, groupOrder);
      expect(step(held, live, true, groupOrder)).toEqual(held);
    }
  });

  it('keeps survivors in order in their shown group, with the same membership as live', () => {
    for (const { shown, live } of lists) {
      const held = step(shown, live, true, groupOrder);
      const liveIds = live.flatMap(({ rootIds }) => rootIds);
      const shownIds = new Set(shown.flatMap(({ rootIds }) => rootIds));
      expect(held.flatMap(({ rootIds }) => rootIds).sort()).toEqual([...liveIds].sort());
      shown.forEach(({ id, rootIds }) => {
        const kept = held.find((group) => group.id === id);
        expect(kept?.rootIds.filter((rootId) => shownIds.has(rootId))).toEqual(
          rootIds.filter((rootId) => liveIds.includes(rootId))
        );
      });
    }
  });

  it('keeps every shown group, even when empty, and follows the fixed group order', () => {
    for (const { shown, live } of lists) {
      const heldIds = step(shown, live, true, groupOrder).map(({ id }) => id);
      for (const { id } of shown) expect(heldIds).toContain(id);
      expect(heldIds).toEqual(groupOrder.filter((id) => heldIds.includes(id)));
    }
  });
};

describe('flat order properties', () => properties([FLAT], true));
describe('section order properties', () => properties(COMPACT_THREAD_SECTION_ORDER));

describe('stationaryRows', () => {
  it('breaks a tie in favor of the lower old index', () => {
    expect(stationaryRows(['$a', '$b'], ['$b', '$a'])).toEqual(new Set(['$a']));
  });

  it('excludes a transfer even if the card stays in the same relative order', () => {
    const sectionOf = (id: string) => (id.startsWith('#') ? id : undefined);
    const rows = stationaryRows(['#open', '$a', '#done'], ['#open', '#done', '$a'], sectionOf);
    expect(rows).toEqual(new Set(['#open', '#done']));
  });
});
