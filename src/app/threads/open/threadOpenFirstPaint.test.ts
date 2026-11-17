import { MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateCachedLongText } from '../../event-store/cache/attachmentRepository';
import { clearLongTextHydrationCache, type LongTextSource } from '../../matrix/protocol/longText';
import {
  createThreadFirstPaintGate,
  getTailLongTextSources,
  THREAD_FIRST_PAINT_CAP_MS,
} from './threadOpenFirstPaint';

vi.mock('../../event-store/cache/attachmentRepository', () => ({
  hydrateCachedLongText: vi.fn(async () => ({})),
}));

const reply = (index: number, longText = false) =>
  new MatrixEvent({
    event_id: `$reply-${index}`,
    room_id: '!room:example.org',
    sender: '@mindroom_dev:example.org',
    origin_server_ts: index,
    type: 'm.room.message',
    content: {
      body: `Reply ${index}`,
      msgtype: 'm.text',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      ...(longText
        ? {
            url: `mxc://example.org/long-${index}`,
            info: { mimetype: 'application/json' },
            'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
          }
        : {}),
    },
  });

const source = (name: string): LongTextSource => ({
  previewContent: { body: name },
  mxcUri: `mxc://example.org/${name}`,
  isV2ContentJson: true,
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<Record<string, unknown>>((done) => {
    resolve = () => done({});
  });
  return { promise, resolve };
};

const flush = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.mocked(hydrateCachedLongText).mockReset().mockResolvedValue({});
  clearLongTextHydrationCache();
});
afterEach(() => vi.useRealTimers());

describe('getTailLongTextSources', () => {
  it('reads the long texts of the last ten rows only', () => {
    const rows = Array.from({ length: 14 }, (_, index) =>
      reply(index, index === 1 || index === 12)
    );
    expect(getTailLongTextSources(rows, undefined).map((tail) => tail.mxcUri)).toEqual([
      'mxc://example.org/long-12',
    ]);
  });
});

describe('createThreadFirstPaintGate', () => {
  it('stays held while a long text that replaced the tail mid-load is still cold', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(hydrateCachedLongText)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    let tail = [source('a')];
    const onRelease = vi.fn();
    const gate = createThreadFirstPaintGate({
      held: true,
      mx: {} as MatrixClient,
      readTail: () => tail,
      onRelease,
    });
    gate.ready();
    // The row is edited, or a live long reply arrives, while A loads.
    tail = [source('b')];
    gate.ready();
    first.resolve();
    await flush();
    expect(onRelease).not.toHaveBeenCalled();
    expect(vi.mocked(hydrateCachedLongText).mock.calls.map(([, next]) => next.mxcUri)).toEqual([
      'mxc://example.org/a',
      'mxc://example.org/b',
    ]);
    second.resolve();
    await vi.waitFor(() => expect(onRelease).toHaveBeenCalledTimes(1));
    gate.cancel();
  });

  it('lets a sidecar that fails to load through once tried, without loading it again', async () => {
    const onRelease = vi.fn();
    createThreadFirstPaintGate({
      held: true,
      mx: {} as MatrixClient,
      readTail: () => [source('broken')],
      onRelease,
    }).ready();
    await vi.waitFor(() => expect(onRelease).toHaveBeenCalledTimes(1));
    expect(hydrateCachedLongText).toHaveBeenCalledTimes(1);
  });

  it('releases at the cap from the open while a sidecar hangs, and never once cancelled or not held', () => {
    vi.useFakeTimers();
    vi.mocked(hydrateCachedLongText).mockReturnValue(new Promise(() => undefined));
    const held = vi.fn();
    const options = { mx: {} as MatrixClient, readTail: () => [source('slow')] };
    const gate = createThreadFirstPaintGate({ ...options, held: true, onRelease: held });
    vi.advanceTimersByTime(THREAD_FIRST_PAINT_CAP_MS - 100);
    gate.ready();
    vi.advanceTimersByTime(100);
    expect(held).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    createThreadFirstPaintGate({ ...options, held: true, onRelease: cancelled }).cancel();
    const open = vi.fn();
    const notHeld = createThreadFirstPaintGate({ ...options, held: false, onRelease: open });
    notHeld.ready();
    vi.advanceTimersByTime(THREAD_FIRST_PAINT_CAP_MS);
    expect(cancelled).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(notHeld.held).toBe(false);
    expect(hydrateCachedLongText).toHaveBeenCalledTimes(1);
  });
});
