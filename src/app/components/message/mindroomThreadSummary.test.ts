import { describe, expect, it } from 'vitest';
import {
  isMindroomThreadSummaryEvent,
  findLatestThreadSummaryEvent,
  getThreadSummaryPreviewText,
  buildThreadSummaryMap,
} from './mindroomThreadSummary';

const makeEvent = (content: Record<string, unknown>) => ({
  getContent: () => content,
  getType: () => 'm.room.message',
  getId: () => undefined as string | undefined,
  threadRootId: undefined as string | undefined,
});

const makeSummaryEvent = (body: string, extra?: Record<string, unknown>) =>
  makeEvent({
    msgtype: 'm.notice',
    body,
    'io.mindroom.thread_summary': true,
    ...extra,
  });

const makeThreadEvent = (
  id: string,
  threadRootId: string,
  content: Record<string, unknown>
) => ({
  ...makeEvent(content),
  getId: () => id,
  threadRootId,
});

describe('isMindroomThreadSummaryEvent', () => {
  it('returns true for m.notice with thread_summary metadata', () => {
    expect(isMindroomThreadSummaryEvent(makeSummaryEvent('Summary text'))).toBe(true);
  });

  it('returns false for m.text messages', () => {
    expect(
      isMindroomThreadSummaryEvent(
        makeEvent({ msgtype: 'm.text', body: 'hi', 'io.mindroom.thread_summary': true })
      )
    ).toBe(false);
  });

  it('returns false when thread_summary metadata is absent', () => {
    expect(
      isMindroomThreadSummaryEvent(makeEvent({ msgtype: 'm.notice', body: 'hi' }))
    ).toBe(false);
  });

  it('returns false for empty content', () => {
    expect(isMindroomThreadSummaryEvent(makeEvent({}))).toBe(false);
  });
});

describe('findLatestThreadSummaryEvent', () => {
  it('returns the last summary event in an array', () => {
    const events = [
      makeEvent({ msgtype: 'm.text', body: 'user msg' }),
      makeSummaryEvent('First summary'),
      makeEvent({ msgtype: 'm.text', body: 'another msg' }),
      makeSummaryEvent('Latest summary'),
      makeEvent({ msgtype: 'm.text', body: 'final msg' }),
    ];
    const result = findLatestThreadSummaryEvent(events);
    expect(result).toBe(events[3]);
    expect(getThreadSummaryPreviewText(result!)).toBe('Latest summary');
  });

  it('returns undefined when no summary events exist', () => {
    const events = [
      makeEvent({ msgtype: 'm.text', body: 'user msg' }),
      makeEvent({ msgtype: 'm.notice', body: 'regular notice' }),
    ];
    expect(findLatestThreadSummaryEvent(events)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    expect(findLatestThreadSummaryEvent([])).toBeUndefined();
  });
});

describe('getThreadSummaryPreviewText', () => {
  it('extracts body from summary event', () => {
    expect(getThreadSummaryPreviewText(makeSummaryEvent('Hello world'))).toBe('Hello world');
  });

  it('prefers m.new_content body for edited summaries', () => {
    const event = makeSummaryEvent('Original body', {
      'm.new_content': { body: 'Edited body', msgtype: 'm.notice' },
    });
    expect(getThreadSummaryPreviewText(event)).toBe('Edited body');
  });

  it('falls back to top-level body when m.new_content has no body', () => {
    const event = makeSummaryEvent('Fallback body', {
      'm.new_content': { msgtype: 'm.notice' },
    });
    expect(getThreadSummaryPreviewText(event)).toBe('Fallback body');
  });

  it('returns undefined for empty body', () => {
    const event = makeEvent({
      msgtype: 'm.notice',
      body: '',
      'io.mindroom.thread_summary': true,
    });
    expect(getThreadSummaryPreviewText(event)).toBeUndefined();
  });

  it('returns undefined when body is not a string', () => {
    const event = makeEvent({
      msgtype: 'm.notice',
      body: 42,
      'io.mindroom.thread_summary': true,
    });
    expect(getThreadSummaryPreviewText(event)).toBeUndefined();
  });
});

describe('buildThreadSummaryMap', () => {
  it('maps thread root IDs to their latest summary text', () => {
    const events = [
      makeThreadEvent('evt-1', 'root-1', {
        msgtype: 'm.notice',
        body: 'Old summary',
        'io.mindroom.thread_summary': true,
      }),
      makeThreadEvent('evt-2', 'root-1', { msgtype: 'm.text', body: 'user reply' }),
      makeThreadEvent('evt-3', 'root-1', {
        msgtype: 'm.notice',
        body: 'Latest summary',
        'io.mindroom.thread_summary': true,
      }),
    ];
    const map = buildThreadSummaryMap(events);
    expect(map.get('root-1')?.summaryText).toBe('Latest summary');
    expect(map.size).toBe(1);
  });

  it('handles multiple threads independently', () => {
    const events = [
      makeThreadEvent('evt-1', 'root-1', {
        msgtype: 'm.notice',
        body: 'Summary for thread 1',
        'io.mindroom.thread_summary': true,
      }),
      makeThreadEvent('evt-2', 'root-2', {
        msgtype: 'm.notice',
        body: 'Summary for thread 2',
        'io.mindroom.thread_summary': true,
      }),
    ];
    const map = buildThreadSummaryMap(events);
    expect(map.get('root-1')?.summaryText).toBe('Summary for thread 1');
    expect(map.get('root-2')?.summaryText).toBe('Summary for thread 2');
  });

  it('skips thread root events (eventId === threadRootId)', () => {
    const events = [
      makeThreadEvent('root-1', 'root-1', {
        msgtype: 'm.notice',
        body: 'Should be skipped',
        'io.mindroom.thread_summary': true,
      }),
    ];
    const map = buildThreadSummaryMap(events);
    expect(map.size).toBe(0);
  });

  it('returns empty map when no summary events', () => {
    const events = [
      makeThreadEvent('evt-1', 'root-1', { msgtype: 'm.text', body: 'hello' }),
    ];
    const map = buildThreadSummaryMap(events);
    expect(map.size).toBe(0);
  });

  it('uses m.new_content for edited summaries', () => {
    const events = [
      makeThreadEvent('evt-1', 'root-1', {
        msgtype: 'm.notice',
        body: 'Original',
        'io.mindroom.thread_summary': true,
        'm.new_content': { body: 'Edited summary', msgtype: 'm.notice' },
      }),
    ];
    const map = buildThreadSummaryMap(events);
    expect(map.get('root-1')?.summaryText).toBe('Edited summary');
  });
});
