import { MatrixEvent, type Room } from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { describe, expect, it, vi } from 'vitest';
import { receiptReadTs } from './receiptReadTs';

// A receipt often names an event no timeline holds (a reply's terminal edit), and every thread's
// unread state asks how far it reads.

describe('receiptReadTs', () => {
  it('searches the room once for an event it does not hold, however many threads ask', () => {
    const findEventById = vi.fn((): MatrixEvent | undefined => undefined);
    const room = { roomId: '!room:example.org', findEventById } as unknown as Room;
    const thread = () => ({ findEventById: () => undefined } as unknown as Thread);
    for (let i = 0; i < 50; i += 1) expect(receiptReadTs(room, thread(), '$edit', 3000)).toBe(3000);
    expect(receiptReadTs(room, room, '$edit', 3000)).toBe(3000);
    expect(findEventById).toHaveBeenCalledTimes(1);
  });
});
