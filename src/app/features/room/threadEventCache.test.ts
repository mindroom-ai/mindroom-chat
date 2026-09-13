import { describe, expect, it } from 'vitest';
import {
  filterPageableCachedThreadEvents,
  getThreadCursorAnchor,
  mergeThreadCacheFlag,
  normalizeCachedThreadEvents,
} from './threadEventCache';

describe('normalizeCachedThreadEvents', () => {
  it('sorts events chronologically and deduplicates by event id', () => {
    expect(
      normalizeCachedThreadEvents([
        { event_id: '$b', origin_server_ts: 200 },
        { event_id: '$a', origin_server_ts: 100 },
        { event_id: '$b', origin_server_ts: 200, content: { body: 'latest' } },
      ])
    ).toEqual([
      { event_id: '$a', origin_server_ts: 100 },
      { event_id: '$b', origin_server_ts: 200, content: { body: 'latest' } },
    ]);
  });

  it('includes the root event when it is missing from cached replies', () => {
    expect(
      normalizeCachedThreadEvents([{ event_id: '$reply', origin_server_ts: 200 }], {
        event_id: '$root',
        origin_server_ts: 100,
      })
    ).toEqual([
      { event_id: '$root', origin_server_ts: 100 },
      { event_id: '$reply', origin_server_ts: 200 },
    ]);
  });

  it('drops events without usable ids', () => {
    expect(
      normalizeCachedThreadEvents([
        { origin_server_ts: 100 },
        { event_id: '', origin_server_ts: 200 },
        { event_id: '$ok', origin_server_ts: 300 },
      ])
    ).toEqual([{ event_id: '$ok', origin_server_ts: 300 }]);
  });

  it('uses event id as a stable tie-breaker for same-timestamp replies', () => {
    expect(
      normalizeCachedThreadEvents([
        { event_id: '$c', origin_server_ts: 200 },
        { event_id: '$a', origin_server_ts: 200 },
        { event_id: '$b', origin_server_ts: 200 },
      ])
    ).toEqual([
      { event_id: '$a', origin_server_ts: 200 },
      { event_id: '$b', origin_server_ts: 200 },
      { event_id: '$c', origin_server_ts: 200 },
    ]);
  });

  it('deduplicates local echo and confirmed cached thread events by transaction id', () => {
    expect(
      normalizeCachedThreadEvents([
        { event_id: '~local-txn', origin_server_ts: 200, txn_id: 'txn-1' },
        {
          event_id: '$remote-txn',
          origin_server_ts: 200,
          unsigned: { transaction_id: 'txn-1' },
        },
      ])
    ).toEqual([
      {
        event_id: '$remote-txn',
        origin_server_ts: 200,
        unsigned: { transaction_id: 'txn-1' },
      },
    ]);
  });

  it('excludes local echo replies from normalized output', () => {
    expect(
      normalizeCachedThreadEvents([
        { event_id: '~!local-only', origin_server_ts: 100 },
      ])
    ).toEqual([]);
  });

  it('excludes local echo replies but keeps confirmed events on cold reload', () => {
    expect(
      normalizeCachedThreadEvents([
        { event_id: '~!local-echo', origin_server_ts: 100 },
        { event_id: '$confirmed', origin_server_ts: 200 },
      ])
    ).toEqual([{ event_id: '$confirmed', origin_server_ts: 200 }]);
  });

  it('excludes local echo rootEvent but keeps confirmed replies', () => {
    expect(
      normalizeCachedThreadEvents(
        [{ event_id: '$reply', origin_server_ts: 200 }],
        { event_id: '~!local-root', origin_server_ts: 100 }
      )
    ).toEqual([{ event_id: '$reply', origin_server_ts: 200 }]);
  });

  it('deduplicates identical cached remote events when one copy still includes the transaction id', () => {
    expect(
      normalizeCachedThreadEvents([
        {
          event_id: '$remote',
          origin_server_ts: 200,
          unsigned: { transaction_id: 'txn-2' },
        },
        { event_id: '$remote', origin_server_ts: 200 },
      ])
    ).toEqual([{ event_id: '$remote', origin_server_ts: 200 }]);
  });
});

describe('filterPageableCachedThreadEvents', () => {
  it('excludes the thread root from pageable cached replies', () => {
    expect(
      filterPageableCachedThreadEvents(
        [
          { event_id: '$root', origin_server_ts: 100 },
          { event_id: '$reply-1', origin_server_ts: 200 },
          { event_id: '$reply-2', origin_server_ts: 300 },
        ],
        '$root'
      )
    ).toEqual([
      { event_id: '$reply-1', origin_server_ts: 200 },
      { event_id: '$reply-2', origin_server_ts: 300 },
    ]);
  });
});

describe('getThreadCursorAnchor', () => {
  it('returns an event id and normalized timestamp anchor', () => {
    expect(
      getThreadCursorAnchor({
        event_id: '$reply',
        origin_server_ts: 123,
      })
    ).toEqual({
      eventId: '$reply',
      ts: 123,
    });
  });

  it('returns undefined for invalid events', () => {
    expect(getThreadCursorAnchor(undefined)).toBeUndefined();
    expect(getThreadCursorAnchor({ origin_server_ts: 10 })).toBeUndefined();
  });

  it('normalizes missing timestamps to zero for pagination anchors', () => {
    expect(
      getThreadCursorAnchor({
        event_id: '$reply',
      })
    ).toEqual({
      eventId: '$reply',
      ts: 0,
    });
  });
});

describe('mergeThreadCacheFlag', () => {
  it('preserves true when there is no explicit replacement flag', () => {
    expect(mergeThreadCacheFlag(true, undefined)).toBe(true);
    expect(mergeThreadCacheFlag(undefined, undefined)).toBeUndefined();
  });

  it('lets explicit false clear a previously true cache flag', () => {
    expect(mergeThreadCacheFlag(true, false)).toBe(false);
    expect(mergeThreadCacheFlag(false, false)).toBe(false);
    expect(mergeThreadCacheFlag(undefined, false)).toBe(false);
  });
});
