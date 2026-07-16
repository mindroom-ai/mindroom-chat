import { describe, expect, it } from 'vitest';
import type { CrossRoomThreadIndexEntry } from '../cross-room-threads/crossRoomThreadIndex';
import { buildSidebarThreadEntries } from './recentThreadsPanelUtils';

const makeEntry = ({
  key,
  lastActivityTs,
  isInvolved = true,
}: {
  key: string;
  lastActivityTs: number;
  isInvolved?: boolean;
}): CrossRoomThreadIndexEntry =>
  ({
    key,
    lastActivityTs,
    isInvolved,
    isUnread: false,
    hasAttention: false,
    isResolved: false,
    roomName: key,
    threadRootId: key,
  }) as CrossRoomThreadIndexEntry;

describe('buildSidebarThreadEntries', () => {
  it('keeps pins first in saved order and sorts the rest by last activity', () => {
    const oldestPinned = makeEntry({ key: 'pinned-old', lastActivityTs: 1 });
    const newestPinned = makeEntry({ key: 'pinned-new', lastActivityTs: 10 });
    const older = makeEntry({ key: 'older', lastActivityTs: 20 });
    const newer = makeEntry({ key: 'newer', lastActivityTs: 30 });

    expect(
      buildSidebarThreadEntries(
        [oldestPinned, newer, newestPinned, older],
        ['pinned-old', 'pinned-new'],
      ).map((entry) => entry.key),
    ).toEqual(['pinned-old', 'pinned-new', 'newer', 'older']);
  });

  it('hides uninvolved threads unless they were explicitly pinned', () => {
    const hidden = makeEntry({ key: 'hidden', lastActivityTs: 30, isInvolved: false });
    const pinned = makeEntry({ key: 'pinned', lastActivityTs: 10, isInvolved: false });
    const involved = makeEntry({ key: 'involved', lastActivityTs: 20 });

    expect(
      buildSidebarThreadEntries([hidden, involved, pinned], ['pinned']).map((entry) => entry.key),
    ).toEqual(['pinned', 'involved']);
  });

  it('caps the compact sidebar list after sorting', () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      makeEntry({ key: `${index}`, lastActivityTs: index }),
    );

    expect(buildSidebarThreadEntries(entries, [], 2).map((entry) => entry.key)).toEqual(['4', '3']);
  });
});
