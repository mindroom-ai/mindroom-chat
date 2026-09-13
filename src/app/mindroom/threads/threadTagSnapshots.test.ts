import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { buildThreadTagSnapshotMap } from './threadTagSnapshots';

const ISO_1 = '2026-04-04T18:00:00.000Z';
const ISO_2 = '2026-04-04T18:05:00.000Z';

const makeTagEvent = (
  stateKey: string,
  content: Record<string, unknown>
): MatrixEvent =>
  ({
    getStateKey: () => stateKey,
    getContent: () => content,
  }) as unknown as MatrixEvent;

describe('buildThreadTagSnapshotMap', () => {
  it('projects aggregated tag state into display/resolved snapshots', () => {
    const snapshots = buildThreadTagSnapshotMap([
      makeTagEvent('$root', {
        tags: {
          resolved: { set_by: '@alice:example.org', set_at: ISO_1 },
          urgent: { set_by: '@alice:example.org', set_at: ISO_1 },
        },
      }),
      makeTagEvent(JSON.stringify(['$root', 'blocked']), {
        set_by: '@bob:example.org',
        set_at: ISO_2,
      }),
    ]);

    expect(snapshots.get('$root')).toMatchObject({
      isResolved: true,
      displayTags: ['blocked', 'urgent'],
      content: {
        tags: {
          blocked: { set_by: '@bob:example.org', set_at: ISO_2 },
          resolved: { set_by: '@alice:example.org', set_at: ISO_1 },
          urgent: { set_by: '@alice:example.org', set_at: ISO_1 },
        },
      },
    });
  });
});
