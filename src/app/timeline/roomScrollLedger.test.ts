import { describe, expect, it } from 'vitest';
import { planRoomLedgerRender, type RoomLedgerAnchor } from './roomScrollLedger';

const price = (key: string | number | bigint) => (String(key).startsWith('$tall') ? 300 : 100);
const anchorAt = (keys: string[], key: string): RoomLedgerAnchor => ({
  key,
  index: keys.indexOf(key),
  keys,
  priceRow: price,
});

describe('planRoomLedgerRender', () => {
  const rows = ['$a', '$b', '$c', '$d', '$e'];

  const fold = (foldPx: number, addedPx = foldPx) => ({ foldPx, addedPx });

  it('folds rows that land above the reader, which bring their own height', () => {
    expect(planRoomLedgerRender(anchorAt(rows, '$c'), ['$new', ...rows], price)).toEqual(fold(100));
    expect(planRoomLedgerRender(anchorAt(rows, '$c'), ['$tall', '$new', ...rows], price)).toEqual(
      fold(400)
    );
  });

  it('folds a thread that moves above the reader from below, which brings no height', () => {
    expect(
      planRoomLedgerRender(anchorAt(rows, '$c'), ['$e', '$a', '$b', '$c', '$d'], price)
    ).toEqual(fold(100, 0));
  });

  it('takes back the height of rows that leave the space above the reader', () => {
    expect(planRoomLedgerRender(anchorAt(rows, '$c'), ['$a', '$c', '$d', '$e'], price)).toEqual(
      fold(-100)
    );
    // A row that moves below the reader leaves its height in the list.
    expect(
      planRoomLedgerRender(anchorAt(rows, '$c'), ['$a', '$c', '$d', '$b', '$e'], price)
    ).toEqual(fold(-100, 0));
  });

  it('holds by the next row when the reader’s own row moves to the top', () => {
    expect(
      planRoomLedgerRender(anchorAt(rows, '$c'), ['$c', '$a', '$b', '$d', '$e'], price)
    ).toEqual(fold(0));
  });

  it('folds nothing for rows that change below the reader, or without an anchor', () => {
    expect(
      planRoomLedgerRender(anchorAt(rows, '$c'), ['$a', '$b', '$c', '$x', '$e'], price)
    ).toEqual(fold(0));
    expect(planRoomLedgerRender(undefined, ['$new', ...rows], price)).toEqual(fold(0));
  });
});
