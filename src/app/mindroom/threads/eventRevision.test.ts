import type { IEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  describeRawEventRevision,
  hasEventRevisionUpgrade,
  mergeRawEventRevisions,
} from './eventRevision';

const baseEvent = (unsigned?: Partial<IEvent>['unsigned']): Partial<IEvent> => ({
  event_id: '$event',
  sender: '@alice:example.org',
  origin_server_ts: 1,
  type: 'm.room.message',
  content: { body: 'message' },
  ...(unsigned ? { unsigned } : {}),
});

describe('event aggregation revisions', () => {
  it('does not synthesize empty unsigned data for plain same-id observations', () => {
    const current = baseEvent();
    const incoming = { ...baseEvent(), origin_server_ts: 2, content: { body: 'newer' } };

    expect(mergeRawEventRevisions(current, incoming)).toEqual(incoming);
    expect(mergeRawEventRevisions(current, incoming)).not.toHaveProperty('unsigned');
  });

  it('treats reordered annotation buckets as the same semantic snapshot', () => {
    const left = baseEvent({
      'm.relations': {
        'm.annotation': {
          chunk: [
            { type: 'm.reaction', key: 'a', count: 1 },
            { type: 'm.reaction', key: 'b', count: 2 },
          ],
        },
      },
    });
    const right = baseEvent({
      'm.relations': {
        'm.annotation': {
          chunk: [
            { type: 'm.reaction', key: 'b', count: 2 },
            { type: 'm.reaction', key: 'a', count: 1 },
          ],
        },
      },
    });

    const leftRevision = describeRawEventRevision(left);
    const rightRevision = describeRawEventRevision(right);
    expect(hasEventRevisionUpgrade(leftRevision, leftRevision)).toBe(false);
    expect(hasEventRevisionUpgrade(rightRevision, leftRevision)).toBe(false);
    expect(hasEventRevisionUpgrade(leftRevision, rightRevision)).toBe(false);
  });

  it('preserves order for opaque relation chunks', () => {
    const left = baseEvent({
      'm.relations': {
        'com.example.ordered': { chunk: ['first', 'second'] },
      },
    });
    const right = baseEvent({
      'm.relations': {
        'com.example.ordered': { chunk: ['second', 'first'] },
      },
    });

    expect(
      hasEventRevisionUpgrade(describeRawEventRevision(right), describeRawEventRevision(left))
    ).toBe(true);
    expect(
      mergeRawEventRevisions(left, right, 'authoritative').unsigned?.['m.relations']?.[
        'com.example.ordered'
      ]
    ).toEqual({ chunk: ['second', 'first'] });
  });

  it('does not report a stale replacement as divergence after redaction', () => {
    const redacted = baseEvent({
      redacted_because: {
        event_id: '$redaction',
        sender: '@mod:example.org',
        origin_server_ts: 3,
        type: 'm.room.redaction',
        content: {},
      } as IEvent,
    });
    const stale = baseEvent({
      'm.relations': {
        'm.replace': {
          event_id: '$edit',
          sender: '@alice:example.org',
          origin_server_ts: 2,
          type: 'm.room.message',
          content: {},
        },
      },
    });

    expect(
      hasEventRevisionUpgrade(describeRawEventRevision(stale), describeRawEventRevision(redacted))
    ).toBe(false);
  });

  it('lets unrelated authoritative bundles advance on a redacted target', () => {
    const redacted = baseEvent({
      redacted_because: {
        event_id: '$redaction',
        sender: '@mod:example.org',
        origin_server_ts: 3,
        type: 'm.room.redaction',
        content: {},
      } as IEvent,
    });
    const fetched = baseEvent({
      'm.relations': {
        'm.replace': {
          event_id: '$stale-edit',
          sender: '@alice:example.org',
          origin_server_ts: 2,
        },
        'm.thread': { count: 4, current_user_participated: false },
      },
    });

    expect(
      hasEventRevisionUpgrade(describeRawEventRevision(fetched), describeRawEventRevision(redacted))
    ).toBe(true);
    const merged = mergeRawEventRevisions(redacted, fetched, 'authoritative');
    const relations = merged.unsigned?.['m.relations'] as Record<string, unknown> | undefined;
    expect(relations?.['m.replace']).toBeUndefined();
    expect(relations?.['m.thread']).toEqual({ count: 4, current_user_participated: false });
  });
});
