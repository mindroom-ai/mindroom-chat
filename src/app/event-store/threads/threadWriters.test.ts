import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import {
  collectThreadWriterIds,
  getThreadWriters,
  mergeThreadWriterIds,
  readRawThreadReplies,
  recordThreadWriters,
  THREAD_WRITERS_PUBLISH_DELAY_MS,
} from './threadWriters';

const ROOT = '$root';
const ADA = '@ada:example.org';
const BEN = '@ben:example.org';
const CY = '@cy:example.org';

let counter = 0;
const reply = (sender: string, rootId = ROOT, extra: Record<string, unknown> = {}) =>
  new MatrixEvent({
    event_id: `$reply-${(counter += 1)}`,
    type: 'm.room.message',
    sender,
    room_id: '!room:example.org',
    origin_server_ts: counter,
    content: {
      msgtype: 'm.text',
      body: 'text',
      'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
      ...extra,
    },
  });

const fakeRoom = () => ({ roomId: '!room:example.org' } as Room);

describe('collectThreadWriterIds', () => {
  it('names each replier once, newest first, for the asked thread only', () => {
    const events = [reply(ADA), reply(BEN), reply(ADA), reply(CY, '$other'), reply(BEN)];
    expect(collectThreadWriterIds(events, ROOT)).toEqual([BEN, ADA]);
    expect(collectThreadWriterIds(events, '$other')).toEqual([CY]);
  });

  it('leaves out edits, which are not replies', () => {
    const edit = new MatrixEvent({
      event_id: '$edit',
      type: 'm.room.message',
      sender: CY,
      room_id: '!room:example.org',
      origin_server_ts: 99,
      content: {
        body: '* text',
        'm.new_content': { body: 'text' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$reply-1' },
      },
    });
    expect(collectThreadWriterIds([reply(ADA), edit], ROOT)).toEqual([ADA]);
  });
});

describe('readRawThreadReplies', () => {
  const raw = (
    id: string,
    sender: string,
    ts: number,
    extra: { rootId?: string; type?: string; redacted?: boolean } = {}
  ) => ({
    event_id: id,
    sender,
    origin_server_ts: ts,
    type: extra.type ?? 'm.room.encrypted',
    content: { 'm.relates_to': { rel_type: 'm.thread', event_id: extra.rootId ?? ROOT } },
    unsigned: extra.redacted ? { redacted_because: {} } : {},
  });

  it('counts the visible replies and names their senders newest first', () => {
    const events = [
      { event_id: ROOT, sender: CY, origin_server_ts: 0, type: 'm.room.message', content: {} },
      raw('$1', ADA, 1),
      raw('$3', ADA, 3),
      raw('$2', BEN, 2),
      raw('$4', CY, 4, { redacted: true }),
      raw('$5', CY, 5, { rootId: '$other' }),
      raw('$6', CY, 6, { type: 'm.reaction' }),
    ];
    expect(readRawThreadReplies(events, ROOT)).toEqual({ replyCount: 3, writerIds: [ADA, BEN] });
  });
});

describe('recordThreadWriters', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes a run of reads once, after the delay', () => {
    const room = fakeRoom();
    recordThreadWriters(room, ROOT, [BEN, ADA], false);
    recordThreadWriters(room, '$two', [CY], true);
    expect(getThreadWriters(room).size).toBe(0);
    vi.advanceTimersByTime(THREAD_WRITERS_PUBLISH_DELAY_MS);
    const writers = getThreadWriters(room);
    expect(writers.get(ROOT)).toEqual({ senderIds: [BEN, ADA], complete: false });
    expect(writers.get('$two')).toEqual({ senderIds: [CY], complete: true });
  });

  it('adds the writers of a part, and lets every reply replace them', () => {
    const room = fakeRoom();
    recordThreadWriters(room, ROOT, [ADA], false);
    recordThreadWriters(room, ROOT, [BEN], false);
    vi.advanceTimersByTime(THREAD_WRITERS_PUBLISH_DELAY_MS);
    expect(getThreadWriters(room).get(ROOT)).toEqual({ senderIds: [BEN, ADA], complete: false });

    // A whole thread is the truth: a writer whose reply is gone drops out.
    recordThreadWriters(room, ROOT, [BEN, CY], true);
    vi.advanceTimersByTime(THREAD_WRITERS_PUBLISH_DELAY_MS);
    expect(getThreadWriters(room).get(ROOT)).toEqual({ senderIds: [BEN, CY], complete: true });

    // A later part (new replies) keeps it complete and puts its writers first.
    recordThreadWriters(room, ROOT, [ADA], false);
    vi.advanceTimersByTime(THREAD_WRITERS_PUBLISH_DELAY_MS);
    expect(getThreadWriters(room).get(ROOT)).toEqual({
      senderIds: [ADA, BEN, CY],
      complete: true,
    });
  });

  it('publishes nothing when a read changes nothing', () => {
    const room = fakeRoom();
    recordThreadWriters(room, ROOT, [ADA], true);
    vi.advanceTimersByTime(THREAD_WRITERS_PUBLISH_DELAY_MS);
    const before = getThreadWriters(room);
    recordThreadWriters(room, ROOT, [ADA], true);
    vi.advanceTimersByTime(THREAD_WRITERS_PUBLISH_DELAY_MS);
    expect(getThreadWriters(room)).toBe(before);
  });

  it('keeps each room apart', () => {
    const first = fakeRoom();
    const second = fakeRoom();
    recordThreadWriters(first, ROOT, [ADA], true);
    vi.advanceTimersByTime(THREAD_WRITERS_PUBLISH_DELAY_MS);
    expect(getThreadWriters(second).size).toBe(0);
  });
});

describe('mergeThreadWriterIds', () => {
  it('puts the loaded writers first, then the other known ones', () => {
    const merged = mergeThreadWriterIds(
      new Map([
        [ROOT, [CY]],
        ['$loaded-only', [ADA]],
      ]),
      new Map([
        [ROOT, { senderIds: [BEN, CY, ADA], complete: true }],
        ['$read-only', { senderIds: [BEN], complete: false }],
      ])
    );
    expect(merged.get(ROOT)).toEqual([CY, BEN, ADA]);
    expect(merged.get('$loaded-only')).toEqual([ADA]);
    expect(merged.get('$read-only')).toEqual([BEN]);
  });
});
