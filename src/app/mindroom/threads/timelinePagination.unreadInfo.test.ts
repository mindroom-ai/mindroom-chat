import { describe, expect, it } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { getRoomUnreadInfo } from './timelinePagination';

/** A room whose live timeline holds `loaded`, with the reader's receipt on `receiptEventId`. */
const makeRoom = (loaded: string[], receiptEventId: string | undefined) => {
  const timeline = {
    getEvents: () => loaded.map((id) => ({ getId: () => id })),
    getNeighbouringTimeline: () => null,
  };
  return {
    myUserId: '@reader:x',
    // As the SDK does: a receipt on an event it has not loaded reads as none.
    getEventReadUpTo: () =>
      receiptEventId && loaded.includes(receiptEventId) ? receiptEventId : null,
    getReadReceiptForUserId: () => (receiptEventId ? { eventId: receiptEventId } : null),
    getUnfilteredTimelineSet: () => ({ getLiveTimeline: () => timeline }),
    getLiveTimeline: () => timeline,
  } as unknown as Room;
};

describe('getRoomUnreadInfo', () => {
  it('points at a loaded read marker', () => {
    expect(getRoomUnreadInfo(makeRoom(['$1', '$2', '$3'], '$2'), true)).toEqual({
      readUptoEventId: '$2',
      inLiveTimeline: true,
      scrollTo: true,
    });
  });

  it('keeps a read marker on an event further back than the loaded rows', () => {
    expect(getRoomUnreadInfo(makeRoom(['$281', '$300'], '$100'))).toEqual({
      readUptoEventId: '$100',
      inLiveTimeline: false,
      scrollTo: false,
    });
  });

  it('has nothing to show when the reader read the newest event or has no receipt', () => {
    expect(getRoomUnreadInfo(makeRoom(['$1', '$2'], '$2'))).toBeUndefined();
    expect(getRoomUnreadInfo(makeRoom(['$1', '$2'], undefined))).toBeUndefined();
  });
});
