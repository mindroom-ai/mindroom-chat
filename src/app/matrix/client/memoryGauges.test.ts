import type { MatrixClient } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMatrixMemoryGauges } from './memoryGauges';

type Group = () => Readonly<Record<string, number | undefined>>;
const groups = vi.hoisted(() => new Map<string, Group>());

vi.mock('../../diagnostics/memorySampler', () => ({
  registerMemoryGauges: (name: string, read: Group) => {
    groups.set(name, read);
    return () => groups.delete(name);
  },
}));

const events = (count: number) => ({ getEvents: () => new Array<unknown>(count) });

const room = (liveEvents: number, threadEvents: number[]) => ({
  getLiveTimeline: vi.fn(() => events(liveEvents)),
  getThreads: vi.fn(() => threadEvents.map((count) => ({ liveTimeline: events(count) }))),
});

describe('matrix memory gauges', () => {
  beforeEach(() => groups.clear());

  it('counts rooms, live events, threads and thread events in one pass, and unregisters', () => {
    const rooms = [room(10, [3, 4]), room(5, []), room(1, [7])];
    const getRooms = vi.fn(() => rooms);
    const mx = { getRooms } as unknown as MatrixClient;

    const unregister = registerMatrixMemoryGauges(mx);

    expect(groups.get('matrix')?.()).toEqual({
      rooms: 3,
      room_live_events: 16,
      threads: 3,
      thread_events: 14,
    });
    expect(getRooms).toHaveBeenCalledOnce();
    rooms.forEach((entry) => {
      expect(entry.getThreads).toHaveBeenCalledOnce();
      expect(entry.getLiveTimeline).toHaveBeenCalledOnce();
    });
    unregister();
    expect(groups.size).toBe(0);
  });
});
