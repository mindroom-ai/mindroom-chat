import { EventTimelineSet, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { describe, expect, it, vi } from 'vitest';
import { receiptReadTs } from './receiptReadTs';

// A receipt often names an event no timeline holds (a reply's terminal edit), and every thread's
// unread state asks how far it reads.

describe('receiptReadTs', () => {
  it('never searches the room for an event no timeline holds, however many threads ask', () => {
    const threadSet = () => new EventTimelineSet(undefined, { timelineSupport: true });
    const threads = Array.from({ length: 50 }, () => {
      const timelineSet = threadSet();
      return {
        timelineSet,
        findEventById: (eventId: string) => timelineSet.findEventById(eventId),
      } as unknown as Thread;
    });
    const findEventById = vi.fn((): MatrixEvent | undefined => undefined);
    const main = threadSet();
    const room = {
      roomId: '!room:example.org',
      getUnfilteredTimelineSet: () => main,
      getThreads: () => threads,
      findEventById,
    } as unknown as Room;
    threads.forEach((thread) => expect(receiptReadTs(room, thread, '$edit', 3000)).toBe(3000));
    expect(receiptReadTs(room, room, '$edit', 3000)).toBe(3000);
    expect(findEventById).not.toHaveBeenCalled();
  });
});
