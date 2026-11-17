import { MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateCachedLongText } from '../../event-store/cache/attachmentRepository';
import {
  createThreadFirstPaintGate,
  hydrateThreadTailLongTexts,
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

const room = {
  getThread: () => null,
  getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
} as unknown as Room;

describe('hydrateThreadTailLongTexts', () => {
  it('loads the long texts of the last ten rows only', async () => {
    const events = Array.from({ length: 14 }, (_, index) =>
      reply(index, index === 1 || index === 12)
    );
    await hydrateThreadTailLongTexts({} as MatrixClient, room, '$root', events);
    expect(vi.mocked(hydrateCachedLongText)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(hydrateCachedLongText).mock.calls[0]?.[1].mxcUri).toBe(
      'mxc://example.org/long-12'
    );
  });
});

describe('createThreadFirstPaintGate', () => {
  afterEach(() => vi.useRealTimers());

  it('releases once the work before the first paint is done', async () => {
    const onRelease = vi.fn();
    const gate = createThreadFirstPaintGate(true, onRelease);
    let finish!: () => void;
    gate.ready(() => new Promise<void>((resolve) => (finish = resolve)));
    await Promise.resolve();
    expect(onRelease).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(onRelease).toHaveBeenCalledTimes(1));
    gate.ready(async () => undefined);
    await Promise.resolve();
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('releases at the cap when that work hangs, and never once cancelled or not held', () => {
    vi.useFakeTimers();
    const held = vi.fn();
    createThreadFirstPaintGate(true, held).ready(() => new Promise(() => undefined));
    vi.advanceTimersByTime(THREAD_FIRST_PAINT_CAP_MS);
    expect(held).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    createThreadFirstPaintGate(true, cancelled).cancel();
    const open = vi.fn();
    const gate = createThreadFirstPaintGate(false, open);
    gate.ready(async () => undefined);
    vi.advanceTimersByTime(THREAD_FIRST_PAINT_CAP_MS);
    expect(cancelled).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(gate.held).toBe(false);
  });
});
