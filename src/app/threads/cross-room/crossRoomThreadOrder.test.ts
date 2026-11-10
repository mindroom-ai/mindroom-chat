import { describe, expect, it } from 'vitest';
import type { CrossRoomThreadIndexEntry } from './crossRoomThreadIndex';
import {
  compareCrossRoomThreadEntries,
  isCrossRoomThreadEntryEligible,
} from './crossRoomThreadOrder';

const entry = (key: string, overrides: Partial<CrossRoomThreadIndexEntry> = {}, replies = 1) =>
  ({
    key,
    roomName: 'Room',
    threadRootId: `$${key}`,
    lastActivityTs: 100,
    isUnread: false,
    hasAttention: false,
    isResolved: false,
    threadRecord: { status: { replyCount: replies, hasPendingSend: false } },
    ...overrides,
  }) as CrossRoomThreadIndexEntry;

describe('crossRoomThreadOrder', () => {
  it('lists threads with replies or a reply on its way', () => {
    expect(isCrossRoomThreadEntryEligible(entry('a'))).toBe(true);
    expect(isCrossRoomThreadEntryEligible(entry('b', {}, 0))).toBe(false);
  });

  it('orders by activity, then unread first', () => {
    const sorted = [
      entry('old', { lastActivityTs: 1 }),
      entry('read'),
      entry('unread', { isUnread: true }),
    ].sort(compareCrossRoomThreadEntries);
    expect(sorted.map((item) => item.key)).toEqual(['unread', 'read', 'old']);
  });
});
