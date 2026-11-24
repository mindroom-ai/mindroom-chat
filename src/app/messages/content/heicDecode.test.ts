import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeHeicBlob } from './heicDecode';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
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
const makeBlob = (tag: number) => new Blob([new Uint8Array([tag])], { type: 'image/heic' });

describe('heicDecode', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.Worker = OriginalWorker;
  });

  it('serializes LIFO, drops aborted queued jobs, and terminates workers on finish or timeout', async () => {
    vi.useFakeTimers();
    const abortMiddle = new AbortController();
    const order: string[] = [];

    const first = decodeHeicBlob(makeBlob(1)).then(() => order.push('first'));
    const middle = decodeHeicBlob(makeBlob(2), abortMiddle.signal);
    const stalled = decodeHeicBlob(makeBlob(3)).catch((error: unknown) => error);
    const newest = decodeHeicBlob(makeBlob(4)).then(() => order.push('newest'));

    await vi.advanceTimersByTimeAsync(0);
    abortMiddle.abort();
    await expect(middle).rejects.toThrow(/aborted/i);

    FakeWorker.instances[0]!.reply(new Blob(['1'], { type: 'image/jpeg' }));
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(new Uint8Array(FakeWorker.instances[1]!.posted[0]!)[0]).toBe(4);
    FakeWorker.instances[1]!.reply(new Blob(['4'], { type: 'image/jpeg' }));
    await newest;
    expect(order).toEqual(['first', 'newest']);

    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWorker.instances).toHaveLength(3);
    expect(new Uint8Array(FakeWorker.instances[2]!.posted[0]!)[0]).toBe(3);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await stalled).toMatchObject({ message: expect.stringMatching(/timed out/i) });
    expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
  });
});
