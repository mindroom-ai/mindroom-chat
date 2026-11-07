import type { IEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { mergeRawEventRevisions, stripRedactedRelationsFromRawEvent } from './eventRevision';

// A root's thread summary counts the thread's replies up to and including its latest one.

const reply = (eventId: string, ts: number): Partial<IEvent> => ({
  event_id: eventId,
  sender: '@alice:example.org',
  origin_server_ts: ts,
  type: 'm.room.message',
  content: { msgtype: 'm.text', body: eventId },
});

const root = (count: number, latest?: Partial<IEvent>): Partial<IEvent> => ({
  event_id: '$root',
  sender: '@alice:example.org',
  origin_server_ts: 1,
  type: 'm.room.message',
  content: { msgtype: 'm.text', body: 'Launch checklist' },
  unsigned: {
    'm.relations': { 'm.thread': { count, ...(latest ? { latest_event: latest } : {}) } },
  },
});

const threadSummary = (event: Partial<IEvent>) => event.unsigned?.['m.relations']?.['m.thread'];

describe('thread summaries and redacted replies', () => {
  it('takes a redacted latest reply out of the count with it', () => {
    const stripped = stripRedactedRelationsFromRawEvent(
      root(4, reply('$late', 400)),
      new Set(['$late'])
    );
    expect(threadSummary(stripped)).toEqual({ count: 3 });

    // The reply is no longer named, so stripping again counts nothing more.
    expect(threadSummary(stripRedactedRelationsFromRawEvent(stripped, new Set(['$late'])))).toEqual(
      { count: 3 }
    );
  });

  it('keeps the count of a copy read since when the copy from before the redaction merges in', () => {
    // The event cache held the root from when its latest reply existed; the server's copy since
    // counts the three replies left, up to the one before it.
    const before = stripRedactedRelationsFromRawEvent(
      root(4, reply('$late', 400)),
      new Set(['$late'])
    );
    const since = root(3, reply('$support', 300));

    [mergeRawEventRevisions(since, before), mergeRawEventRevisions(before, since)].forEach(
      (merged) =>
        expect(threadSummary(merged)).toMatchObject({
          count: 3,
          latest_event: { event_id: '$support' },
        })
    );
  });
});
