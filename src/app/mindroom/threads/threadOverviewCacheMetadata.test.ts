import { describe, expect, it } from 'vitest';
import {
  applyThreadOverviewCachedMetadataUpdates,
  createEmptyThreadOverviewCachedMetadata,
  mergeCompactThreadRootBodyMaps,
} from './threadOverviewCacheMetadata';

describe('applyThreadOverviewCachedMetadataUpdates', () => {
  it('updates cached overview maps from one canonical metadata update', () => {
    const previous = createEmptyThreadOverviewCachedMetadata();
    const coverage = {
      eventCount: 3,
      relationSnapshotComplete: true,
      tailLoaded: true,
    };

    const next = applyThreadOverviewCachedMetadataUpdates(
      previous,
      [
        {
          rootId: '$thread',
          nextActivityTs: 123,
          nextPreview: 'root preview',
          nextReplyPreviewText: 'latest reply',
          nextLastSenderId: '@alice:example.org',
          nextMessageCount: 3,
          nextCacheCoverage: coverage,
        },
      ],
      { includeCompactRootBody: true }
    );

    expect(next.compactRootBodyMap.get('$thread')).toBe('root preview');
    expect(next.lastActivityTsMap.get('$thread')).toBe(123);
    expect(next.latestReplyPreviewMap.get('$thread')).toBe('latest reply');
    expect(next.lastSenderIdMap.get('$thread')).toBe('@alice:example.org');
    expect(next.messageCountMap.get('$thread')).toBe(3);
    expect(next.coverageMap.get('$thread')).toBe(coverage);
  });

  it('can skip compact root body updates for non-compact metadata refreshes', () => {
    const previous = createEmptyThreadOverviewCachedMetadata();

    const next = applyThreadOverviewCachedMetadataUpdates(
      previous,
      [{ rootId: '$thread', nextPreview: 'compact-only preview', nextActivityTs: 123 }],
      { includeCompactRootBody: false }
    );

    expect(next.compactRootBodyMap.has('$thread')).toBe(false);
    expect(next.lastActivityTsMap.get('$thread')).toBe(123);
  });

  it('keeps snapshot identity when an update does not change any map', () => {
    const previous = createEmptyThreadOverviewCachedMetadata();

    expect(
      applyThreadOverviewCachedMetadataUpdates(previous, [{ rootId: '$thread' }], {
        includeCompactRootBody: true,
      })
    ).toBe(previous);
  });
});

describe('mergeCompactThreadRootBodyMaps', () => {
  it('lets cached previews fill or replace compact root body text', () => {
    expect(
      mergeCompactThreadRootBodyMaps(
        new Map([
          ['$a', 'live a'],
          ['$b', 'live b'],
        ]),
        new Map([
          ['$b', 'cached b'],
          ['$c', 'cached c'],
        ])
      )
    ).toEqual(
      new Map([
        ['$a', 'live a'],
        ['$b', 'cached b'],
        ['$c', 'cached c'],
      ])
    );
  });
});
