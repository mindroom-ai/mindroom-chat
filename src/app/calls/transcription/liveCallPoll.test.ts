import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollLiveCall } from './liveCallPoll';
import {
  TranscriptionApiError,
  type LiveCall,
  type TranscriptCall,
  type TranscriptionClient,
  type TranscriptLine,
} from './api';

const ROOM_ID = '!room:example.org';

const call = (id: string): TranscriptCall => ({
  id,
  roomId: ROOM_ID,
  rowEventId: null,
  startedAt: '2026-11-07T09:29:00Z',
  endedAt: null,
  members: ['@ann:example.org'],
  pausedBy: null,
});

const line = (id: string, callId: string): TranscriptLine => ({
  id,
  callId,
  userId: '@ann:example.org',
  saidAt: '2026-11-07T09:29:30Z',
  seconds: 1,
  kind: 'speech',
  text: id,
});

const read = (callId: string | null, lineIds: string[] = []): LiveCall => ({
  call: callId ? call(callId) : null,
  lines: callId ? lineIds.map((id) => line(id, callId)) : [],
  names: {},
});

/** A client whose reads the test answers in turn; each answer is a read or a failure. */
const fakeClient = (answers: Array<LiveCall | Error>) => {
  const live = vi.fn(async (_roomId: string, _after?: string) => {
    const answer = answers.shift() ?? read(null);
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { client: { live } as unknown as TranscriptionClient, live };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pollLiveCall', () => {
  it('reads every interval, asking for the lines after the last one read, and reports failures', async () => {
    const { client, live } = fakeClient([
      read('call-1', ['line-1', 'line-2']),
      read('call-1'),
      new TranscriptionApiError('Bad gateway', 502),
      read('call-1', ['line-3']),
    ]);
    const reads: LiveCall[] = [];
    const onFailure = vi.fn();
    const stop = new AbortController();
    const polling = pollLiveCall(
      client,
      ROOM_ID,
      2_000,
      stop.signal,
      (answer) => reads.push(answer),
      onFailure
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(live).toHaveBeenCalledTimes(1);
    expect(reads).toEqual([read('call-1', ['line-1', 'line-2'])]);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(live).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(live.mock.calls.map(([, after]) => after)).toEqual([
      undefined,
      'line-2',
      'line-2',
      'line-2',
    ]);
    expect(onFailure).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(live.mock.calls[4]?.[1]).toBe('line-3');

    stop.abort();
    await expect(polling).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(live).toHaveBeenCalledTimes(5);
  });

  it('starts after the line it is given, as reads that start again do', async () => {
    const { client, live } = fakeClient([read('call-1', ['line-4']), read('call-1')]);
    const stop = new AbortController();
    void pollLiveCall(client, ROOM_ID, 2_000, stop.signal, () => undefined, undefined, 'line-3');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(live.mock.calls.map(([, after]) => after)).toEqual(['line-3', 'line-4']);
    stop.abort();
  });

  it('gives a read up after 10 seconds, reports it as a failure, and goes on reading', async () => {
    const live = vi.fn(
      (_roomId: string, _after?: string, signal?: AbortSignal): Promise<LiveCall> =>
        live.mock.calls.length > 1
          ? Promise.resolve(read('call-1'))
          : new Promise((_resolve, reject) => {
              signal?.addEventListener('abort', () =>
                reject(new TranscriptionApiError('Cancelled', 0))
              );
            })
    );
    const onFailure = vi.fn();
    const reads: LiveCall[] = [];
    const stop = new AbortController();
    const polling = pollLiveCall(
      { live } as unknown as TranscriptionClient,
      ROOM_ID,
      2_000,
      stop.signal,
      (answer) => reads.push(answer),
      onFailure
    );
    await vi.advanceTimersByTimeAsync(9_999);
    expect(onFailure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ status: 0 }));

    await vi.advanceTimersByTimeAsync(2_000);
    expect(live).toHaveBeenCalledTimes(2);
    expect(reads).toEqual([read('call-1')]);
    stop.abort();
    await expect(polling).resolves.toBeUndefined();
  });

  it('stops for good when the room is not transcribed', async () => {
    const { client, live } = fakeClient([new TranscriptionApiError('Not found', 404, 'not-found')]);
    await expect(
      pollLiveCall(client, ROOM_ID, 2_000, new AbortController().signal, () => undefined)
    ).resolves.toBe('not-transcribed');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(live).toHaveBeenCalledTimes(1);
  });
});
