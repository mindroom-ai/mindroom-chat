import { expect, it } from 'vitest';
import { holdCompactThreadSections, type CompactThreadSection } from './compactThreadSections';
import { holdOrder } from './useHeldThreadOrder';

const groups = ['needsYou', 'working', 'later', 'done'] as const;
const examples = (check: (shown: string[], live: string[], group: () => number) => void) => {
  let state = 725;
  const next = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  for (let i = 0; i < 256; i += 1) {
    const ids = Array.from({ length: 4 + Math.floor(next() * 50) }, (_, j) => `card-${j}`);
    const sample = () =>
      ids
        .map((key) => ({ key, rank: next() }))
        .filter(() => next() < 0.7)
        .sort((a, b) => a.rank - b.rank)
        .map(({ key }) => key);
    check(sample(), sample(), () => Math.floor(next() * groups.length));
  }
};

it('holds flat survivors, admits exactly the live membership and is idempotent', () => {
  examples((shown, live) => {
    const held = holdOrder(shown, live);
    expect(held.filter((id) => shown.includes(id))).toEqual(
      shown.filter((id) => live.includes(id))
    );
    expect([...held].sort()).toEqual([...live].sort());
    expect(holdOrder(held, live)).toEqual(held);
    const first = live.findIndex((id) => shown.includes(id));
    const last = live.findLastIndex((id) => shown.includes(id));
    if (first === -1) expect(held).toEqual(live);
    else {
      expect(held.slice(0, first)).toEqual(live.slice(0, first));
      expect(held.slice(held.length - (live.length - last - 1))).toEqual(live.slice(last + 1));
      for (let j = first + 1; j < last; j += 1) {
        if (!shown.includes(live[j]!)) expect(held[held.indexOf(live[j]!) - 1]).toBe(live[j - 1]);
      }
    }
  });
});

it('keeps survivors in their old sections and puts joins in their live sections', () => {
  examples((shown, live, group) => {
    const sections = (ids: string[]): CompactThreadSection[] => {
      const result = groups.map((id) => ({ id, rootIds: [] as string[] }));
      ids.forEach((id) => result[group()]!.rootIds.push(id));
      return result.filter(({ rootIds }) => rootIds.length);
    };
    const previous = sections(shown);
    const target = sections(live);
    const held = holdCompactThreadSections(target, previous);
    expect(held.flatMap(({ rootIds }) => rootIds).sort()).toEqual([...live].sort());
    for (const { id, rootIds } of held) {
      expect(rootIds.filter((key) => shown.includes(key))).toEqual(
        (previous.find((section) => section.id === id)?.rootIds ?? []).filter((key) =>
          live.includes(key)
        )
      );
      const joins = rootIds.filter((key) => !shown.includes(key));
      expect(
        joins.every((key) => target.find((section) => section.id === id)?.rootIds.includes(key))
      ).toBe(true);
    }
    expect(holdCompactThreadSections(target, held)).toEqual(held);
  });
});

// Main lets a survivor whose live group changed anchor a join in its old group.
it.fails('a section join with no live predecessor there leads its section', () => {
  examples((shown, live) => {
    const [mover, stay] = shown.filter((id) => live.includes(id));
    const join = live.find((id) => !shown.includes(id));
    if (!mover || !stay || !join) return;
    const held = holdCompactThreadSections(
      [
        { id: 'needsYou', rootIds: [mover] },
        { id: 'working', rootIds: [join, stay] },
      ],
      [{ id: 'working', rootIds: [stay, mover] }]
    );
    expect(held[0]?.rootIds).toEqual([join, stay, mover]);
  });
});
