// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeHeicBlob } from './heicDecode';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  posted: ArrayBuffer[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(buffer: ArrayBuffer): void {
    this.posted.push(buffer);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(blob: Blob): void {
    this.onmessage?.({ data: { blob } } as MessageEvent);
  }
}

const OriginalWorker = globalThis.Worker;
const makeBlob = (tag: number): Blob => {
  const bytes = new Uint8Array([tag]);
  const blob = new Blob([bytes], { type: 'image/heic' });
  blob.arrayBuffer = async () => bytes.buffer.slice(0);
  return blob;
};

describe('heicDecode', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.Worker = OriginalWorker;
  });

  it('serializes decodes LIFO, drops aborted queued jobs, and terminates each worker', async () => {
    const abortMiddle = new AbortController();
    const order: string[] = [];

    const first = decodeHeicBlob(makeBlob(1)).then(() => order.push('first'));
    const middle = decodeHeicBlob(makeBlob(2), abortMiddle.signal);
    const newest = decodeHeicBlob(makeBlob(3)).then(() => order.push('newest'));

    // First job owns the only active worker; middle is dropped before it ever spawns one.
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    abortMiddle.abort();
    await expect(middle).rejects.toThrow(/aborted/i);

    const w1 = FakeWorker.instances[0]!;
    w1.reply(new Blob(['1'], { type: 'image/jpeg' }));
    await first;
    expect(w1.terminated).toBe(true);

    // LIFO picks newest (tag 3) next; middle never spawned a worker.
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const w2 = FakeWorker.instances[1]!;
    expect(new Uint8Array(w2.posted[0]!)[0]).toBe(3);
    w2.reply(new Blob(['3'], { type: 'image/jpeg' }));
    await newest;
    expect(w2.terminated).toBe(true);
    expect(order).toEqual(['first', 'newest']);
  });

  it('terminates a stalled worker after the 20 s watchdog', async () => {
    vi.useFakeTimers();
    const promise = decodeHeicBlob(makeBlob(9));
    // Attach rejection handler before advancing timers to avoid unhandled rejection notices.
    const caught = promise.catch((error: unknown) => error);
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));

    vi.advanceTimersByTime(20_000);
    const error = await caught;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/timed out/i);
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });
});
