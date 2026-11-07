import { describe, expect, it } from 'vitest';
import {
  planRoomLedgerRender,
  type RoomLedgerAnchor,
  type RoomLedgerKey,
} from './roomScrollLedger';

const size = (key: RoomLedgerKey) => (String(key).startsWith('$tall') ? 300 : 100);
const measuredRows = { price: size, measured: () => true };
const anchorAt = (keys: string[], key: string): RoomLedgerAnchor => ({
  key,
  index: keys.indexOf(key),
  keys,
  sizes: keys.map(size),
});

describe('planRoomLedgerRender', () => {
  const rows = ['$a', '$b', '$c', '$d', '$e'];

  it('folds rows that land above the reader', () => {
    expect(planRoomLedgerRender(anchorAt(rows, '$c'), ['$new', ...rows], measuredRows)).toBe(100);
    expect(
      planRoomLedgerRender(anchorAt(rows, '$c'), ['$tall', '$new', ...rows], measuredRows)
    ).toBe(400);
  });

  it('folds a thread that moves above the reader from below', () => {
    const next = ['$e', '$a', '$b', '$c', '$d'];
    expect(planRoomLedgerRender(anchorAt(rows, '$c'), next, measuredRows)).toBe(100);
  });

  it('takes back the height of rows that leave the space above the reader', () => {
    const next = ['$a', '$c', '$d', '$e'];
    expect(planRoomLedgerRender(anchorAt(rows, '$c'), next, measuredRows)).toBe(-100);
  });

  it("holds by the next row when the reader's own row moves to the top", () => {
    const next = ['$c', '$a', '$b', '$d', '$e'];
    expect(planRoomLedgerRender(anchorAt(rows, '$c'), next, measuredRows)).toBe(0);
  });

  it('folds the new estimate of an unmeasured row above the reader, not a measured one', () => {
    // $a gets a thread badge: 31 px more in its estimate.
    const price = (key: RoomLedgerKey) => (key === '$a' ? 131 : 100);
    expect(planRoomLedgerRender(anchorAt(rows, '$c'), rows, { price, measured: () => false })).toBe(
      31
    );
    // Measured, virtual-core corrects the scroll for it itself.
    expect(planRoomLedgerRender(anchorAt(rows, '$c'), rows, { price, measured: () => true })).toBe(
      0
    );
  });

  it('folds nothing for rows that change below the reader, or without an anchor', () => {
    const next = ['$a', '$b', '$c', '$x', '$e'];
    expect(planRoomLedgerRender(anchorAt(rows, '$c'), next, measuredRows)).toBe(0);
    expect(planRoomLedgerRender(undefined, ['$new', ...rows], measuredRows)).toBe(0);
  });
});
