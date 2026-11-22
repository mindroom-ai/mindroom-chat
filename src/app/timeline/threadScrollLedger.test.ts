import { describe, expect, it, vi } from 'vitest';
import {
  planThreadLedgerRender,
  type ThreadLedgerAnchor,
  type ThreadLedgerEvent,
} from './threadScrollLedger';

const event = (eventId: string): ThreadLedgerEvent => ({ getId: () => eventId });
const events = (...ids: string[]) => ids.map(event);
const indexMap = (list: readonly ThreadLedgerEvent[]) =>
  new Map(list.map((item, index) => [item.getId()!, index]));

const anchorOn = (
  list: readonly ThreadLedgerEvent[],
  eventId: string,
  priceRow: ThreadLedgerAnchor['priceRow'] = () => 10
): ThreadLedgerAnchor => ({
  threadId: '$root',
  eventId,
  index: list.findIndex((item) => item.getId() === eventId),
  events: list,
  priceRow,
});

const plan = (
  anchor: ThreadLedgerAnchor | undefined,
  threadEvents: readonly ThreadLedgerEvent[],
  priceRow: (eventId: string, index: number) => number = () => 10,
  pricing?: unknown
) =>
  planThreadLedgerRender({
    anchor,
    eventIndexMap: indexMap(threadEvents),
    priceRow,
    pricing,
    threadEvents,
    threadId: '$root',
  });

/** Prices a fork's parent rows `$p0` and `$p1`; the root's price would show if it were folded. */
const parentPrice = (eventId: string) => {
  if (eventId === '$p0') return 40;
  return eventId === '$p1' ? 50 : 999;
};

describe('planThreadLedgerRender', () => {
  it('folds nothing without a committed anchor or for the anchored list itself', () => {
    const list = events('$root', '$a', '$b');
    expect(plan(undefined, list)).toEqual({ foldPx: 0 });
    expect(plan(anchorOn(list, '$b'), list)).toEqual({ foldPx: 0 });
  });

  it('folds rows that land above the reader, whoever added them', () => {
    const previous = events('$root', '$a', '$reader', '$c');
    const next = events('$root', '$old1', '$old2', '$a', '$reader', '$c');
    const priceRow = (eventId: string) => (eventId === '$old1' ? 30 : 50);

    expect(plan(anchorOn(previous, '$reader', priceRow), next, priceRow)).toEqual({ foldPx: 80 });
  });

  it('leaves rows that land below the reader, such as new replies and edits', () => {
    const previous = events('$root', '$a', '$reader');
    const next = events('$root', '$a', '$reader', '$edit', '$new');
    const priceRow = vi.fn(() => 10);

    expect(plan(anchorOn(previous, '$reader'), next, priceRow)).toEqual({ foldPx: 0 });
    expect(priceRow.mock.calls.map(([eventId]) => eventId)).toEqual(['$a']);
  });

  it('folds the price change of an unmeasured row that stays above the reader', () => {
    // A page of older replies completes the turn `$step` is in: it folds away with it.
    const previous = events('$root', '$step', '$reader');
    const next = events('$root', '$person', '$break', '$step', '$reader');
    const previousPrice = (eventId: string) => (eventId === '$step' ? 190 : 0);
    const price = (eventId: string) => ({ $person: 30, $break: 42 }[eventId] ?? 0);

    expect(plan(anchorOn(previous, '$reader', previousPrice), next, price)).toEqual({
      foldPx: 30 + 42 - 190,
    });
  });

  it('folds a price change above the reader in the same rows', () => {
    const list = events('$root', '$a', '$b', '$reader');
    const anchor = { ...anchorOn(list, '$reader', () => 190), pricing: 'shown' };

    expect(plan(anchor, list, () => 190, 'shown')).toEqual({ foldPx: 0 });
    expect(plan(anchor, list, (eventId) => (eventId === '$b' ? 0 : 190), 'hidden')).toEqual({
      foldPx: -190,
    });
  });

  it('keeps the root in place when the reader is looking at it', () => {
    const previous = events('$root', '$a');
    const next = events('$root', '$old', '$a');

    expect(plan(anchorOn(previous, '$root'), next)).toEqual({ foldPx: 0 });
  });

  it('prices a removed row above the reader with the list it was committed in', () => {
    const previous = events('$root', '$gone', '$a', '$reader');
    const next = events('$root', '$a', '$reader');
    const previousPrice = vi.fn((_eventId: string, index: number) => (index === 1 ? 70 : 0));

    expect(plan(anchorOn(previous, '$reader', previousPrice), next, () => 0)).toEqual({
      foldPx: -70,
    });
    expect(previousPrice).toHaveBeenCalledWith('$gone', 1);
  });

  it('anchors on the nearest surviving row above a reader row that left', () => {
    const previous = events('$root', '$a', '$reader');
    const next = events('$root', '$old', '$a', '$replacement');

    expect(plan(anchorOn(previous, '$reader'), next)).toEqual({
      foldPx: 10,
      probe: 'threadPrependFoldAnchorFallback',
    });
    expect(plan(anchorOn(previous, '$reader'), events('$root', '$other'))).toEqual({
      foldPx: 0,
      probe: 'threadPrependFoldAnchorLost',
    });
  });

  it("folds a fork's parent rows that land above its root, but not the root", () => {
    const previous = events('$root', '$a', '$reader');
    const next = events('$p0', '$p1', '$root', '$a', '$reader');
    const priceRow = (eventId: string) => (eventId === '$a' ? 10 : parentPrice(eventId));

    expect(plan(anchorOn(previous, '$reader'), next, priceRow)).toEqual({ foldPx: 90 });
  });

  it("takes a fork's parent rows' height away when they leave, but not the root's", () => {
    const previous = events('$p0', '$p1', '$root', '$a', '$reader');
    const next = events('$root', '$a', '$reader');
    expect(plan(anchorOn(previous, '$reader', parentPrice), next, parentPrice)).toEqual({
      foldPx: -90,
    });
  });

  it("anchors on a fork's parent row above the root when the reader's rows left", () => {
    const previous = events('$p0', '$p1', '$root', '$gone', '$reader');
    const next = events('$new', '$p0', '$p1', '$root', '$other');

    expect(plan(anchorOn(previous, '$reader'), next)).toEqual({
      foldPx: 10,
      probe: 'threadPrependFoldAnchorFallback',
    });
  });

  it('ignores an anchor from another thread', () => {
    const previous = events('$root', '$a', '$reader');
    const next = events('$root', '$old', '$a', '$reader');

    expect(plan({ ...anchorOn(previous, '$reader'), threadId: '$other' }, next)).toEqual({
      foldPx: 0,
    });
  });
});
