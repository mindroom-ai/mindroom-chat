import { describe, expect, it } from 'vitest';
import { medianResidual, rowsThatKeptPlace } from './CompactRowKeeper';

// Park-Miller generator, seeded separately for each randomized test.
const randomFrom = (seed: number) => (limit: number) => {
  seed = (seed * 16807) % 2147483647;
  return seed % limit;
};

const shuffle = (rows: string[], random: (limit: number) => number) => {
  for (let i = rows.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
  }
  return rows;
};

// Enumerate every subset in old order and check which ones still have that order.
const bruteForceIntersection = (before: string[], after: string[]) => {
  let subsets: string[][] = [[]];
  for (const id of before) subsets = [...subsets, ...subsets.map((subset) => [...subset, id])];
  const unchanged = subsets.filter((subset) => {
    const indices = subset.map((id) => after.indexOf(id));
    return indices.every((index, i) => index > (indices[i - 1] ?? -1));
  });
  const length = Math.max(...unchanged.map((subset) => subset.length));
  const longest = unchanged.filter((subset) => subset.length === length);
  return new Set(before.filter((id) => longest.every((subset) => subset.includes(id))));
};

const ids = (prefix: string, length: number) => Array.from({ length }, (_, i) => `${prefix}${i}`);

const rows = (text: string) => (text ? text.split(' ') : []);

describe('rowsThatKeptPlace', () => {
  it.each([
    ['empty orders', '', '', ''],
    ['no survivors', 'a b', 'c d', ''],
    ['an unchanged order', 'a b c', 'a b c', 'a b c'],
    ['an exchange with a join and a departure', 'a leaving b c', 'joining b a c', 'c'],
    ['a reversal, even for the middle row', 'a b c', 'c b a', ''],
    [
      'a leading header before a card exchange',
      'section:needsYou a b',
      'section:needsYou b a',
      'section:needsYou',
    ],
    ['a header moving like a card', 'a b section:needsYou c', 'section:needsYou a b c', 'a b c'],
    [
      'a card jumping into Working',
      'working w needsYou a b c',
      'working c w needsYou a b',
      'working w needsYou a b',
    ],
    [
      'an in-view reply shifting thread-list ordinals',
      'a b c d e f g',
      'd a b c e f g',
      'a b c e f g',
    ],
    [
      'a pin moving to the front on hold release',
      'p1 p2 p3 a b c',
      'a p1 p2 p3 b c',
      'p1 p2 p3 b c',
    ],
    ['an unpin returning to ordinary order', 'p1 p2 p3 a b c', 'p1 p2 a b c p3', 'p1 p2 a b c'],
    [
      'a pin moving without membership changing',
      'p1 p2 p3 p4 p5 a',
      'p4 p1 p2 p3 p5 a',
      'p1 p2 p3 p5 a',
    ],
    ['unlock after a reply during a thread visit', 'a b c k d e', 'k a b c d e', 'a b c d e'],
    ['a Board row dropping from above the view into it', 'a b c d e f', 'b c d a e f', 'b c d e f'],
    ['a Board row arriving in view', 'a b c d', 'a b new c d', 'a b c d'],
    ['a Board row leaving in view', 'a b c d e', 'a b d e', 'a b d e'],
    ['three rows rotating above two', 'a b c d e f', 'c d e a b f', 'c d e f'],
  ])('%s', (_case, before, after, kept) => {
    expect(rowsThatKeptPlace(rows(before), rows(after))).toEqual(new Set(rows(kept)));
  });

  it('keeps the incumbents when one frozen newcomer rises above them at unlock', () => {
    const old = ids('old', 12);
    const [active, ...otherNew] = ids('new', 12);
    expect(
      rowsThatKeptPlace([...old, active!, ...otherNew], [active!, ...old, ...otherNew])
    ).toEqual(new Set([...old, ...otherNew]));
  });

  it('excludes the moved row when it alone passes at least two rows', () => {
    const random = randomFrom(451);
    for (let trial = 0; trial < 300; trial += 1) {
      const before = shuffle(ids('row', 4 + random(30)), random);
      const from = random(before.length);
      const destinations = before.map((_, i) => i).filter((i) => Math.abs(from - i) >= 2);
      const to = destinations[random(destinations.length)]!;
      const after = before.slice();
      const [mover] = after.splice(from, 1);
      after.splice(to, 0, mover!);
      expect(rowsThatKeptPlace(before, after)).toEqual(
        new Set(before.filter((id) => id !== mover))
      );
    }
  });

  it('matches the intersection of all longest subsequences for random small permutations', () => {
    const random = randomFrom(921);
    for (let trial = 0; trial < 500; trial += 1) {
      const before = shuffle(ids('row', 1 + random(8)), random);
      const after = shuffle(before.slice(), random);
      expect(rowsThatKeptPlace(before, after), JSON.stringify({ before, after })).toEqual(
        bruteForceIntersection(before, after)
      );
    }
  });
});

it('uses the median residual nearest zero when there is no landmark', () => {
  expect(medianResidual([5, 1, 2])).toBe(2);
  expect(medianResidual([12, 4])).toBe(4);
  expect(medianResidual([-12, -4])).toBe(-4);
  expect(medianResidual([-12, 4])).toBe(0);
  expect(medianResidual([])).toBe(0);
});
