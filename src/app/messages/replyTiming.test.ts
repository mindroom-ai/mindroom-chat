import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { STREAM_IDLE_LIMIT_MS } from '../matrix/client/streamingReplies';
import { getEditedEvent } from '../matrix/room';
import { getReplyTimeParts, getReplyTiming } from './replyTiming';

const at = (day: number, hour: number, minute: number, second = 0) =>
  new Date(2026, 2, day, hour, minute, second).getTime();

const START = at(5, 10, 4, 12);

const edit = (ts: number, status?: string) => ({
  getTs: () => ts,
  getContent: () => ({
    'm.new_content': status ? { body: 'Done', 'io.mindroom.stream_status': status } : { body: 'x' },
  }),
});

describe('getReplyTiming', () => {
  it('finishes a reply at the edit that ended its stream', () => {
    const finish = edit(at(5, 10, 11, 24), 'completed');
    expect(getReplyTiming(START, finish.getContent(), finish)).toEqual({
      startTs: START,
      endTs: at(5, 10, 11, 24),
      streaming: false,
    });
  });

  it('finishes a reply at its finishing edit when a later edit by hand borrows its status', () => {
    const message = (eventId: string, ts: number, content: Record<string, unknown>) =>
      new MatrixEvent({
        event_id: eventId,
        origin_server_ts: ts,
        room_id: '!room:example.org',
        sender: '@mindroom_helper:example.org',
        type: 'm.room.message',
        content,
      });
    const replace = (eventId: string, ts: number, newContent: Record<string, unknown>) =>
      message(eventId, ts, {
        msgtype: 'm.text',
        body: '* edit',
        'm.new_content': { msgtype: 'm.text', ...newContent },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
      });
    const reply = message('$reply', START, { msgtype: 'm.text', body: '…' });
    const finish = replace('$finish', at(5, 10, 11, 24), {
      body: 'Done',
      'io.mindroom.stream_status': 'completed',
    });
    const byHand = replace('$by-hand', at(7, 9, 30), { body: 'Done, and corrected' });
    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({ getRelations: () => [finish, byHand] }),
      },
    } as never;

    const shown = getEditedEvent('$reply', reply, timelineSet);
    expect(shown).toBe(byHand);
    const content = shown!.getContent()['m.new_content'] as Record<string, unknown>;
    expect(getReplyTiming(START, content, shown)?.endTs).toBe(at(5, 10, 11, 24));
  });

  it('streams while the reply says it streams', () => {
    const progress = edit(at(5, 10, 5), 'streaming');
    expect(getReplyTiming(START, progress.getContent(), progress)).toEqual({
      startTs: START,
      streaming: true,
      revisionTs: at(5, 10, 5),
    });
    expect(getReplyTiming(START, { body: '…', 'io.mindroom.stream_status': 'pending' })).toEqual({
      startTs: START,
      streaming: true,
      revisionTs: START,
    });
  });

  it('knows no finish for a message that never streamed', () => {
    expect(getReplyTiming(START, { body: 'Hello' })).toBeUndefined();
    const humanEdit = edit(at(5, 10, 6));
    expect(getReplyTiming(START, humanEdit.getContent(), humanEdit)).toBeUndefined();
  });

  it('knows no finish for a reply whose finishing edit is not loaded', () => {
    expect(
      getReplyTiming(START, { body: 'Done', 'io.mindroom.stream_status': 'completed' })
    ).toBeUndefined();
  });
});

describe('getReplyTimeParts', () => {
  const options = { hour24Clock: true, language: 'en' };

  it('shows the finish time and the duration', () => {
    const timing = { startTs: START, endTs: at(5, 10, 11, 24), streaming: false };
    expect(getReplyTimeParts(timing, at(5, 12, 0), options)).toEqual({
      end: '10:11',
      short: '7m',
      tail: '\u00a012s',
    });
  });

  it('drops the finish time when it reads like the start', () => {
    const timing = { startTs: at(5, 10, 2, 1), endTs: at(5, 10, 2, 5), streaming: false };
    expect(getReplyTimeParts(timing, at(5, 12, 0), options)).toEqual({
      end: undefined,
      short: '4s',
      tail: '',
    });
  });

  it('keeps the finish time of a reply that ends on the next day in the same minute', () => {
    const timing = { startTs: at(4, 23, 58), endTs: at(5, 23, 58, 30), streaming: false };
    expect(getReplyTimeParts(timing, at(6, 9, 0), options)?.end).toBe('23:58');
  });

  it('gives only the time of a finish on the next day', () => {
    const timing = { startTs: at(4, 23, 58, 0), endTs: at(5, 0, 14, 3), streaming: false };
    expect(getReplyTimeParts(timing, at(5, 9, 0), options)).toEqual({
      end: '00:14',
      short: '16m',
      tail: '\u00a03s',
    });
  });

  it('runs a streaming reply up to now', () => {
    const timing = { startTs: START, streaming: true, revisionTs: START };
    expect(getReplyTimeParts(timing, START + 134_000, options)).toEqual({
      end: 'now',
      short: '2m',
      tail: '\u00a014s',
    });
  });

  it('still runs a streaming reply whose newest revision is as old as the idle limit', () => {
    const timing = { startTs: START, streaming: true, revisionTs: START + 60_000 };
    const now = START + 60_000 + STREAM_IDLE_LIMIT_MS;
    expect(getReplyTimeParts(timing, now, options)?.end).toBe('now');
  });

  it('gives no parts for a streaming reply whose newest revision is older than the idle limit', () => {
    const timing = { startTs: START, streaming: true, revisionTs: START + 60_000 };
    const now = START + 60_000 + STREAM_IDLE_LIMIT_MS + 1;
    expect(getReplyTimeParts(timing, now, options)).toBeUndefined();
  });
});
