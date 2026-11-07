import { describe, expect, it } from 'vitest';
import { planRoomLedgerFold, type RoomLedgerAnchor, type RoomLedgerRow } from './roomScrollLedger';

const row = (key: string, size = key.startsWith('$tall') ? 300 : 100, measured = true) =>
  ({ key, size, measured } satisfies RoomLedgerRow);
const layout = (keys: string[]) => keys.map((key) => row(key));
const anchorAt = (rows: RoomLedgerRow[], key: string): RoomLedgerAnchor => ({
  index: rows.findIndex((candidate) => candidate.key === key),
  rows,
});

describe('planRoomLedgerFold', () => {
  const rows = layout(['$a', '$b', '$c', '$d', '$e']);

  it('folds rows that land above the reader', () => {
    expect(planRoomLedgerFold(anchorAt(rows, '$c'), [row('$new'), ...rows])).toBe(100);
    expect(planRoomLedgerFold(anchorAt(rows, '$c'), [row('$tall'), row('$new'), ...rows])).toBe(
      400
    );
  });

  it('folds a thread that moves above the reader from below', () => {
    const next = layout(['$e', '$a', '$b', '$c', '$d']);
    expect(planRoomLedgerFold(anchorAt(rows, '$c'), next)).toBe(100);
  });

  it('takes back the height of rows that leave the space above the reader', () => {
    const next = layout(['$a', '$c', '$d', '$e']);
    expect(planRoomLedgerFold(anchorAt(rows, '$c'), next)).toBe(-100);
  });

  it("holds by the next row when the reader's own row moves to the top", () => {
    const next = layout(['$c', '$a', '$b', '$d', '$e']);
    expect(planRoomLedgerFold(anchorAt(rows, '$c'), next)).toBe(0);
  });

  it('folds the new estimate of an unmeasured row above the reader, not a measured one', () => {
    const estimated = [row('$a', 100, false), ...rows.slice(1)];
    // $a gets a thread badge: 31 px more in its estimate.
    const badged = [row('$a', 131, false), ...rows.slice(1)];
    expect(planRoomLedgerFold(anchorAt(estimated, '$c'), badged)).toBe(31);
    // Measured meanwhile: virtual-core corrects the scroll for it itself.
    expect(planRoomLedgerFold(anchorAt(estimated, '$c'), [row('$a', 131), ...rows.slice(1)])).toBe(
      0
    );
  });

  it('folds nothing for rows that change below the reader, or without an anchor', () => {
    const next = layout(['$a', '$b', '$c', '$x', '$e']);
    expect(planRoomLedgerFold(anchorAt(rows, '$c'), next)).toBe(0);
    expect(planRoomLedgerFold(undefined, [row('$new'), ...rows])).toBe(0);
  });
});
