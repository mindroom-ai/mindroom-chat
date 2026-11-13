import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCaptureClient, type CaptureChannel } from './captureChannel';
import type { CaptureAction, CaptureMessage, CaptureState } from './captureProtocol';

const makeState = (roomId: string): CaptureState => ({
  userId: '@me:x',
  roomId,
  rooms: [],
  items: [],
});

const makeChannel = () => {
  const posted: CaptureMessage[] = [];
  const listeners = new Set<(message: CaptureMessage) => void>();
  const channel: CaptureChannel = {
    post: (message) => {
      posted.push(message);
    },
    listen: (onMessage) => {
      listeners.add(onMessage);
      return () => listeners.delete(onMessage);
    },
    close: () => listeners.clear(),
  };
  const deliver = (message: CaptureMessage) => listeners.forEach((listener) => listener(message));
  return { channel, posted, deliver };
};

const reply: CaptureAction = { kind: 'reply', roomId: '!a', threadId: '$t', text: 'x' };
const sendWithImage: CaptureAction = {
  kind: 'send',
  roomId: '!a',
  text: 'x',
  images: [new File(['a'], 'a.png')],
  open: false,
};

describe('createCaptureClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const connected = (hostId = 'a') => {
    const rig = makeChannel();
    const client = createCaptureClient(rig.channel);
    client.start();
    rig.deliver({ v: 1, type: 'state', hostId, state: makeState('!a') });
    return { ...rig, client };
  };

  it('says hello, then reports absent after 1500 ms without state', () => {
    const { channel, posted } = makeChannel();
    const client = createCaptureClient(channel);
    client.start();
    expect(posted).toEqual([{ v: 1, type: 'hello' }]);
    expect(client.getSnapshot().status).toBe('connecting');
    vi.advanceTimersByTime(1499);
    expect(client.getSnapshot().status).toBe('connecting');
    vi.advanceTimersByTime(1);
    expect(client.getSnapshot().status).toBe('absent');
  });

  it('follows the first host, ignores another, and keeps snapshot identity between changes', () => {
    const { channel, deliver } = makeChannel();
    const client = createCaptureClient(channel);
    const listener = vi.fn();
    client.subscribe(listener);
    client.start();
    const before = client.getSnapshot();
    expect(client.getSnapshot()).toBe(before);
    deliver({ v: 1, type: 'state', hostId: 'a', state: makeState('!a') });
    const after = client.getSnapshot();
    expect(after).not.toBe(before);
    expect(after).toEqual({ status: 'connected', state: makeState('!a') });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot()).toBe(after);
    deliver({ v: 1, type: 'state', hostId: 'b', state: makeState('!b') });
    expect(client.getSnapshot()).toBe(after);
    expect(listener).toHaveBeenCalledTimes(1);
    deliver({ v: 1, type: 'state', hostId: 'a', state: makeState('!c') });
    expect(client.getSnapshot().state?.roomId).toBe('!c');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('repeats hello every 10 s until stopped', () => {
    const { channel, posted, deliver } = makeChannel();
    const client = createCaptureClient(channel);
    client.start();
    deliver({ v: 1, type: 'state', hostId: 'a', state: makeState('!a') });
    vi.advanceTimersByTime(10_000);
    expect(posted.filter((m) => m.type === 'hello')).toHaveLength(2);
    vi.advanceTimersByTime(10_000);
    expect(posted.filter((m) => m.type === 'hello')).toHaveLength(3);
    client.stop();
    vi.advanceTimersByTime(60_000);
    expect(posted.filter((m) => m.type === 'hello')).toHaveLength(3);
  });

  it('posts a request for the followed host and resolves with the matching response', async () => {
    const { client, posted, deliver } = connected();
    const promise = client.request(reply);
    const request = posted.find((m) => m.type === 'request');
    if (request?.type !== 'request') throw new Error('no request posted');
    expect(request.hostId).toBe('a');
    expect(request.action).toBe(reply);
    expect(request.id).toBeTruthy();
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    deliver({ v: 1, type: 'response', id: 'other', hostId: 'a', result: { ok: true } });
    deliver({ v: 1, type: 'response', id: request.id, hostId: 'b', result: { ok: true } });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    deliver({
      v: 1,
      type: 'response',
      id: request.id,
      hostId: 'a',
      result: { ok: true, threadId: '$n' },
    });
    await expect(promise).resolves.toEqual({ ok: true, threadId: '$n' });
  });

  it('gives each request a fresh id', () => {
    const { client, posted } = connected();
    void client.request(reply);
    void client.request(reply);
    const ids = posted.flatMap((m) => (m.type === 'request' ? [m.id] : []));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('times out after 20 s, or 60 s for a send with images', async () => {
    const { client } = connected();
    const plain = client.request(reply);
    const withImages = client.request(sendWithImage);
    await vi.advanceTimersByTimeAsync(19_999);
    let plainDone = false;
    void plain.then(() => {
      plainDone = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(plainDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(plain).resolves.toEqual({ ok: false, error: 'timeout' });
    let imagesDone = false;
    void withImages.then(() => {
      imagesDone = true;
    });
    await vi.advanceTimersByTimeAsync(39_999);
    expect(imagesDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(withImages).resolves.toEqual({ ok: false, error: 'timeout' });
  });

  it('resolves a request at once while not connected', async () => {
    const { channel, posted } = makeChannel();
    const client = createCaptureClient(channel);
    client.start();
    await expect(client.request(reply)).resolves.toEqual({ ok: false, error: 'timeout' });
    expect(posted.some((m) => m.type === 'request')).toBe(false);
  });

  it('becomes absent on gone and then follows any host', () => {
    const { client, deliver } = connected();
    deliver({ v: 1, type: 'gone', hostId: 'b' });
    expect(client.getSnapshot().status).toBe('connected');
    deliver({ v: 1, type: 'gone', hostId: 'a' });
    expect(client.getSnapshot().status).toBe('absent');
    deliver({ v: 1, type: 'state', hostId: 'b', state: makeState('!b') });
    expect(client.getSnapshot()).toEqual({ status: 'connected', state: makeState('!b') });
  });

  it('becomes absent after 30 s without state and then follows any host', () => {
    const { client, deliver } = connected();
    vi.advanceTimersByTime(29_999);
    expect(client.getSnapshot().status).toBe('connected');
    vi.advanceTimersByTime(1);
    expect(client.getSnapshot().status).toBe('absent');
    deliver({ v: 1, type: 'state', hostId: 'b', state: makeState('!b') });
    expect(client.getSnapshot().status).toBe('connected');
  });

  it('counts the 30 s from the latest state', () => {
    const { client, deliver } = connected();
    vi.advanceTimersByTime(20_000);
    deliver({ v: 1, type: 'state', hostId: 'a', state: makeState('!a') });
    vi.advanceTimersByTime(20_000);
    expect(client.getSnapshot().status).toBe('connected');
    vi.advanceTimersByTime(10_000);
    expect(client.getSnapshot().status).toBe('absent');
  });
});
