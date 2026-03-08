import { describe, expect, it } from 'vitest';
import {
  getThreadCursorAnchor,
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
});
