import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { MatrixClient, Room } from 'matrix-js-sdk';
import {
  applyThreadOverviewCachedMetadataUpdates,
  createEmptyThreadOverviewCachedMetadata,
  mergeCompactThreadRootBodyMaps,
  useThreadOverviewCachedMetadata,
  type ThreadOverviewCachedMetadataController,
} from './threadOverviewCacheMetadata';

const mx = new MatrixClient({ baseUrl: 'https://server', userId: '@alice:server' });
const makeRoom = (roomId: string) => new Room(roomId, mx, '@alice:server');

describe('useThreadOverviewCachedMetadata', () => {
  it('publishes one initial snapshot and clears metadata and attempts only on room changes', async () => {
    const firstRoom = makeRoom('!first:server');
    const snapshots: ThreadOverviewCachedMetadataController[] = [];
    const Harness = ({ room }: { room: Room }) => {
      snapshots.push(useThreadOverviewCachedMetadata(room));
      return null;
    };
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Harness, { room: firstRoom }));
    });
    const first = snapshots.at(-1)!;
    expect(new Set(snapshots.map((snapshot) => snapshot.coverageMap)).size).toBe(1);
    await act(async () => {
      first.applyUpdate({ rootId: '$root', nextPreview: 'cached first room', nextActivityTs: 42 });
      first.compactRootPreviewAttemptCountsRef.current.set('$root', 1);
    });
    const populated = snapshots.at(-1)!;
    await act(async () => {
      renderer.update(React.createElement(Harness, { room: firstRoom }));
    });
    expect(snapshots.at(-1)).toBe(populated);
    expect(populated.compactRootBodyMap.get('$root')).toBe('cached first room');
    expect(populated.compactRootPreviewAttemptCountsRef.current.get('$root')).toBe(1);
    await act(async () => {
      renderer.update(React.createElement(Harness, { room: makeRoom('!second:server') }));
    });
    const next = snapshots.at(-1)!;
    expect(next.compactRootBodyMap.size).toBe(0);
    expect(next.lastActivityTsMap.size).toBe(0);
    expect(next.compactRootPreviewAttemptCountsRef.current.size).toBe(0);
    await act(async () => renderer.unmount());
  });

  it('starts a room mounted again from what its last mount read, as on the way back from a thread', async () => {
    // Opening a thread unmounts the room's list. The cache's metadata (a reply the SDK has not
    // applied yet, a newer activity time) must not drop out for the first renders after going
    // back, or the cards sort without it and trade places again once the cache is read.
    const room = makeRoom('!back:server');
    let shown: ThreadOverviewCachedMetadataController | undefined;
    const Harness = () => {
      shown = useThreadOverviewCachedMetadata(room);
      return null;
    };
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    await act(async () => {
      shown?.applyUpdate({ rootId: '$root', nextActivityTs: 42, nextReplyPreviewText: 'reply' });
    });
    await act(async () => renderer.unmount());

    let first: ThreadOverviewCachedMetadataController | undefined;
    const Again = () => {
      const metadata = useThreadOverviewCachedMetadata(room);
      first ??= metadata;
      return null;
    };
    await act(async () => {
      renderer = create(React.createElement(Again));
    });
    expect(first?.lastActivityTsMap.get('$root')).toBe(42);
    expect(first?.latestReplyPreviewMap.get('$root')).toBe('reply');
    // A room the list never showed starts empty.
    const otherRoom = makeRoom('!other:server');
    let other: ThreadOverviewCachedMetadataController | undefined;
    const Other = () => {
      other = useThreadOverviewCachedMetadata(otherRoom);
      return null;
    };
    await act(async () => {
      renderer.update(React.createElement(Other));
    });
    expect(other?.lastActivityTsMap.size).toBe(0);
    await act(async () => renderer.unmount());
  });
});

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
          nextPreviewSourceTs: 122,
          nextReplyPreviewText: 'latest reply',
          nextLastSenderId: '@alice:example.org',
          nextMessageCount: 3,
          nextCacheCoverage: coverage,
        },
      ],
      { includeCompactRootBody: true }
    );

    expect(next.compactRootBodyMap.get('$thread')).toBe('root preview');
    expect(next.compactRootSourceTsMap.get('$thread')).toBe(122);
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
  it('lets cached previews fill gaps without replacing newer live text', () => {
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
        ['$b', 'live b'],
        ['$c', 'cached c'],
      ])
    );
  });

  it('uses source revisions to select a newer cached edit over healthy stale live text', () => {
    expect(
      mergeCompactThreadRootBodyMaps(
        new Map([['$thread', 'live v1']]),
        new Map([['$thread', 'cached v2']]),
        new Map([['$thread', 100]]),
        new Map([['$thread', 200]])
      ).get('$thread')
    ).toBe('cached v2');
  });

  it('upgrades back to live when a later SDK edit arrives', () => {
    expect(
      mergeCompactThreadRootBodyMaps(
        new Map([['$thread', 'live v3']]),
        new Map([['$thread', 'cached v2']]),
        new Map([['$thread', 300]]),
        new Map([['$thread', 200]])
      ).get('$thread')
    ).toBe('live v3');
  });

  it('lets a complete cached body heal a newer truncated live placeholder', () => {
    expect(
      mergeCompactThreadRootBodyMaps(
        new Map([['$thread', 'Thinking...  ⋯']]),
        new Map([['$thread', 'cached complete']]),
        new Map([['$thread', 300]]),
        new Map([['$thread', 200]])
      ).get('$thread')
    ).toBe('cached complete');
  });

  it('does not replace complete live text with a newer cached placeholder', () => {
    expect(
      mergeCompactThreadRootBodyMaps(
        new Map([['$thread', 'live complete']]),
        new Map([['$thread', 'Thinking...  ⋯']]),
        new Map([['$thread', 200]]),
        new Map([['$thread', 300]])
      ).get('$thread')
    ).toBe('live complete');
  });
});
