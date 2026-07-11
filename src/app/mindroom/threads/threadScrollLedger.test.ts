import { describe, expect, it, vi } from 'vitest';
import {
  planThreadLedgerRender,
  type ThreadLedgerEvent,
  type ThreadVirtualPrependCapture,
} from './threadScrollLedger';

const event = (eventId: string): ThreadLedgerEvent => ({ getId: () => eventId });

const capture = (
  foldedEvents: unknown,
  overrides: Partial<ThreadVirtualPrependCapture> = {}
): ThreadVirtualPrependCapture => ({
  threadId: '$root',
  anchorEventId: '$anchor',
  anchorSeq: 7,
  abovePrices: new Map([['$old', 40]]),
  foldedEvents,
  ...overrides,
});

describe('planThreadLedgerRender', () => {
  it('is a no-op for an unchanged event list', () => {
    const events = [event('$root'), event('$old'), event('$anchor')];
    const currentCapture = capture(events);

    expect(
      planThreadLedgerRender({
        capture: currentCapture,
        eventIndexMap: new Map([
          ['$old', 1],
          ['$anchor', 2],
        ]),
        paginatingBack: false,
        pendingAnchorSeq: 7,
        priceRow: vi.fn(),
        threadEvents: events,
        threadId: '$root',
      })
    ).toEqual({
      clearPendingAnchor: false,
      foldPx: 0,
      nextCapture: currentCapture,
    });
  });

  it('plans an inserted-row fold without mutating the capture', () => {
    const previousEvents = [event('$root'), event('$old'), event('$anchor')];
    const currentCapture = capture(previousEvents);
    const events = [event('$root'), event('$new'), event('$old'), event('$anchor')];

    const plan = planThreadLedgerRender({
      capture: currentCapture,
      eventIndexMap: new Map([
        ['$new', 1],
        ['$old', 2],
        ['$anchor', 3],
      ]),
      paginatingBack: true,
      pendingAnchorSeq: 7,
      priceRow: (_eventId, index) => index * 10,
      threadEvents: events,
      threadId: '$root',
    });

    expect(plan.foldPx).toBe(10);
    expect(plan.clearPendingAnchor).toBe(false);
    expect(plan.nextCapture?.foldedEvents).toBe(events);
    expect(currentCapture.foldedEvents).toBe(previousEvents);
    expect(currentCapture.abovePrices).toEqual(new Map([['$old', 40]]));
  });

  it('consumes the pagination anchor once inserted rows commit', () => {
    const events = [event('$root'), event('$new'), event('$old'), event('$anchor')];
    const plan = planThreadLedgerRender({
      capture: capture([]),
      eventIndexMap: new Map([
        ['$new', 1],
        ['$old', 2],
        ['$anchor', 3],
      ]),
      paginatingBack: false,
      pendingAnchorSeq: 7,
      priceRow: () => 25,
      threadEvents: events,
      threadId: '$root',
    });

    expect(plan).toMatchObject({
      clearPendingAnchor: true,
      foldPx: 25,
      nextCapture: undefined,
    });
  });

  it('falls back to the nearest surviving baseline row', () => {
    const events = [event('$root'), event('$old')];
    const plan = planThreadLedgerRender({
      capture: capture([], { anchorEventId: '$missing' }),
      eventIndexMap: new Map([['$old', 1]]),
      paginatingBack: true,
      pendingAnchorSeq: 7,
      priceRow: () => 40,
      threadEvents: events,
      threadId: '$root',
    });

    expect(plan.probe).toBe('threadPrependFoldAnchorFallback');
    expect(plan.nextCapture?.anchorEventId).toBe('$old');
  });

  it('drops stale captures for another thread or pagination generation', () => {
    const currentCapture = capture([]);
    const common = {
      capture: currentCapture,
      eventIndexMap: new Map<string, number>(),
      paginatingBack: false,
      priceRow: vi.fn(),
      threadEvents: [] as ThreadLedgerEvent[],
    };

    expect(
      planThreadLedgerRender({ ...common, pendingAnchorSeq: 7, threadId: '$other' }).nextCapture
    ).toBeUndefined();
    expect(
      planThreadLedgerRender({ ...common, pendingAnchorSeq: 8, threadId: '$root' }).nextCapture
    ).toBeUndefined();
  });
});
