import type { MatrixClient } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMatrixMemoryGauges } from './memoryGauges';

const gauges = vi.hoisted(() => new Map<string, () => number | undefined>());

vi.mock('../../diagnostics/memorySampler', () => ({
  registerMemoryGauge: (name: string, read: () => number | undefined) => {
    gauges.set(name, read);
    return () => gauges.delete(name);
  },
}));

const events = (count: number) => ({ getEvents: () => new Array<unknown>(count) });

const room = (liveEvents: number, threadEvents: number[]) => ({
  getLiveTimeline: () => events(liveEvents),
  getThreads: () => threadEvents.map((count) => ({ liveTimeline: events(count) })),
});

describe('matrix memory gauges', () => {
  beforeEach(() => gauges.clear());

  it('counts rooms, live events, threads and thread events, and unregisters', () => {
    const mx = {
      getRooms: () => [room(10, [3, 4]), room(5, []), room(1, [7])],
    } as unknown as MatrixClient;

    const unregister = registerMatrixMemoryGauges(mx);

    expect(Object.fromEntries([...gauges].map(([name, read]) => [name, read()]))).toEqual({
      rooms: 3,
      room_live_events: 16,
      threads: 3,
      thread_events: 14,
    });
    unregister();
    expect(gauges.size).toBe(0);
  });
});
