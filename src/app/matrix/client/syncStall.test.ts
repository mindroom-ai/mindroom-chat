// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncStallWatch, SYNC_STALL_MARGIN_MS } from './syncStall';

const BASE_URL = 'https://matrix.example';
const syncUrl = (timeout: number) =>
  new URL(`${BASE_URL}/_matrix/client/v3/sync?filter=1&timeout=${timeout}&since=s1`);
const SEND_URL = `${BASE_URL}/_matrix/client/v3/rooms/!a/send/m.room.message/1`;

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
};

/** A fetch whose answers the test gives, one request at a time. */
const controlledFetch = () => {
  const answers: Array<(response: Response) => void> = [];
  const failures: Array<(error: unknown) => void> = [];
  const baseFetch = vi.fn(
    () =>
      new Promise<Response>((resolve, reject) => {
        answers.push(resolve);
        failures.push(reject);
      })
  );
  return {
    baseFetch,
    answer: (status = 200) => answers.shift()?.(new Response('{}', { status })),
    fail: () => failures.shift()?.(new DOMException('The operation was aborted.', 'AbortError')),
  };
};

const watch = () => {
  const network = controlledFetch();
  const stall = createSyncStallWatch(network.baseFetch as unknown as typeof fetch);
  const listener = vi.fn();
  stall.subscribe(listener);
  const request = (url: URL | string, init?: RequestInit) =>
    stall.fetchFn(url, init).catch(() => undefined);
  return { ...network, stall, listener, request };
};

describe('sync stall watch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('reports a stall when a long poll stays unanswered past its timeout and the margin', async () => {
    const { stall, listener, request } = watch();
    const pending = request(syncUrl(30_000));

    await vi.advanceTimersByTimeAsync(30_000 + SYNC_STALL_MARGIN_MS - 1);
    expect(stall.isStalled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(stall.isStalled()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    void pending;
  });

  it('ends the stall with the next successful /sync answer, not with an error answer', async () => {
    const { stall, answer, request } = watch();
    const first = request(syncUrl(0));
    await vi.advanceTimersByTimeAsync(SYNC_STALL_MARGIN_MS);
    expect(stall.isStalled()).toBe(true);

    answer(502);
    await first;
    expect(stall.isStalled()).toBe(true);

    const second = request(syncUrl(0));
    answer();
    await second;
    expect(stall.isStalled()).toBe(false);
  });

  it('keeps a long poll answered by its timeout from counting as a stall', async () => {
    const { stall, answer, listener, request } = watch();
    const poll = request(syncUrl(30_000));
    await vi.advanceTimersByTimeAsync(30_000);
    answer();
    await poll;
    await vi.advanceTimersByTimeAsync(SYNC_STALL_MARGIN_MS * 2);
    expect(stall.isStalled()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps a stall reported when the SDK gives up on the request', async () => {
    const { stall, fail, request } = watch();
    const poll = request(syncUrl(30_000));
    await vi.advanceTimersByTimeAsync(30_000 + SYNC_STALL_MARGIN_MS);
    fail();
    await poll;
    expect(stall.isStalled()).toBe(true);
  });

  it('ignores requests other than /sync', async () => {
    const { stall, request } = watch();
    void request(SEND_URL, { method: 'PUT' });
    void request(`${BASE_URL}/_matrix/client/v3/rooms/!a/messages?dir=b`);
    await vi.advanceTimersByTimeAsync(SYNC_STALL_MARGIN_MS * 10);
    expect(stall.isStalled()).toBe(false);
  });

  it('waits again once a hidden page is shown, so a frozen page does not count as a stall', async () => {
    const { stall, request } = watch();
    void request(syncUrl(30_000));
    await vi.advanceTimersByTimeAsync(10_000);
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(30_000 + SYNC_STALL_MARGIN_MS);
    expect(stall.isStalled()).toBe(false);

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(30_000 + SYNC_STALL_MARGIN_MS);
    expect(stall.isStalled()).toBe(true);
  });
});
