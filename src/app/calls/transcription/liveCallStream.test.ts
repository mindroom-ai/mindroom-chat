import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followCallEvents } from './liveCallStream';
import { TranscriptionApiError, type CallEvent, type TranscriptionClient } from './api';

const ROOM_ID = '!room:example.org';
const READY: CallEvent = { type: 'ready', live: { call: null, lines: [], names: {} } };

/** A client whose each stream connection the test answers: events, then how it ends. */
const fakeClient = (connections: Array<{ events: CallEvent[]; end: 'close' | Error }>) => {
  const events = vi.fn(
    async (_roomId: string, onEvent: (event: CallEvent) => void, signal: AbortSignal) => {
      const next = connections.shift();
      if (!next) {
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      next.events.forEach(onEvent);
      if (next.end !== 'close') throw next.end;
      return undefined;
    }
  );
  return { client: { events } as unknown as TranscriptionClient, events };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('followCallEvents', () => {
  it('hands on the events, says when the stream is lost, and reconnects', async () => {
    const { client, events } = fakeClient([
      { events: [READY], end: new TranscriptionApiError('Bad gateway', 502) },
      { events: [READY], end: 'close' },
    ]);
    const seen: CallEvent[] = [];
    const onLost = vi.fn();
    const controller = new AbortController();
    const following = followCallEvents(
      client,
      ROOM_ID,
      controller.signal,
      (event) => seen.push(event),
      onLost
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([READY]);
    expect(onLost).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(events).toHaveBeenCalledTimes(2);
    expect(onLost).toHaveBeenCalledTimes(2);

    controller.abort();
    await expect(following).resolves.toBeUndefined();
  });

  it('stops for good when the room is not transcribed', async () => {
    const { client, events } = fakeClient([
      { events: [], end: new TranscriptionApiError('Not found', 404, 'not-found') },
    ]);
    await expect(
      followCallEvents(client, ROOM_ID, new AbortController().signal, () => undefined)
    ).resolves.toBe('not-transcribed');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toHaveBeenCalledTimes(1);
  });
});
