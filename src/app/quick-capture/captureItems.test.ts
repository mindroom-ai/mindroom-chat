import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import {
  buildCaptureItems,
  CaptureReply,
  CaptureThread,
  MAX_CAPTURE_ITEMS,
  MAX_REPLY_TEXT,
  RESOLVED_SHOWN_MS,
} from './captureItems';

const NOW = 10_000_000_000;

const thread = (threadId: string, extra: Partial<CaptureThread> = {}): CaptureThread => ({
  threadId,
  title: `Title ${threadId}`,
  reply: () => ({}),
  pinned: false,
  streaming: false,
  needsYou: false,
  unread: false,
  resolved: false,
  ts: 1000,
  ...extra,
});

const withReply = (reply: CaptureReply) => thread('a', { reply: () => reply });

const ids = (threads: CaptureThread[]): string[] =>
  buildCaptureItems(threads, NOW).map((item) => item.threadId);

describe('buildCaptureItems', () => {
  it('lists unresolved threads newest first', () => {
    expect(ids([thread('a', { ts: 1 }), thread('b', { ts: 3 }), thread('c', { ts: 2 })])).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('keeps only the first 30 unresolved threads', () => {
    const threads = Array.from({ length: 35 }, (_, index) => thread(`t${index}`, { ts: index }));
    const result = ids(threads);
    expect(result).toHaveLength(MAX_CAPTURE_ITEMS);
    expect(result[0]).toBe('t34');
    expect(result[29]).toBe('t5');
  });

  it('puts resolved threads after unresolved ones, newest resolvedTs first', () => {
    const result = ids([
      thread('r1', { resolved: true, resolvedTs: NOW - 5000, ts: 9 }),
      thread('u', { ts: 1 }),
      thread('r2', { resolved: true, resolvedTs: NOW - 1000, ts: 2 }),
    ]);
    expect(result).toEqual(['u', 'r2', 'r1']);
  });

  it('shows resolved threads for under 24 hours only', () => {
    const result = ids([
      thread('fresh', { resolved: true, resolvedTs: NOW - RESOLVED_SHOWN_MS + 1 }),
      thread('exact', { resolved: true, resolvedTs: NOW - RESOLVED_SHOWN_MS }),
      thread('none', { resolved: true }),
    ]);
    expect(result).toEqual(['fresh']);
  });

  it('does not count resolved threads against the 30 rows', () => {
    const threads = [
      ...Array.from({ length: 30 }, (_, index) => thread(`u${index}`, { ts: index })),
      thread('r', { resolved: true, resolvedTs: NOW - 1 }),
    ];
    const result = ids(threads);
    expect(result).toHaveLength(31);
    expect(result[30]).toBe('r');
  });

  it('keeps the first occurrence of a duplicated threadId', () => {
    const items = buildCaptureItems(
      [thread('a', { title: 'first', ts: 1 }), thread('a', { title: 'second', ts: 5 })],
      NOW
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('first');
  });

  it('picks the chip: working, needs-you, new, else none', () => {
    const chip = (extra: Partial<CaptureThread>): string | undefined =>
      buildCaptureItems([thread('a', extra)], NOW)[0]?.chip;
    expect(chip({ streaming: true, needsYou: true, unread: true })).toBe('working');
    expect(chip({ needsYou: true, unread: true })).toBe('needs-you');
    expect(chip({ unread: true })).toBe('new');
    expect(chip({})).toBeUndefined();
    expect(
      chip({ streaming: true, needsYou: true, unread: true, resolved: true, resolvedTs: NOW })
    ).toBeUndefined();
  });

  it('omits the chip key when there is none', () => {
    const [item] = buildCaptureItems([thread('a')], NOW);
    expect(item).toEqual({
      threadId: 'a',
      title: 'Title a',
      line: '',
      resolved: false,
      ts: 1000,
    });
    expect(item).not.toHaveProperty('chip');
  });

  it('collapses white space in the line and keeps the reply sender', () => {
    const [item] = buildCaptureItems(
      [thread('a', { reply: () => ({ replyText: 'one \n\n two\t three', replySender: 'Ada' }) })],
      NOW
    );
    expect(item?.line).toBe('one two three');
    expect(item?.replyText).toBe('one \n\n two\t three');
    expect(item?.lineSender).toBe('Ada');
  });

  it('cuts replyText to 600 characters without splitting a surrogate pair', () => {
    const plain = buildCaptureItems([withReply({ replyText: 'x'.repeat(900) })], NOW)[0];
    expect(plain?.replyText).toHaveLength(MAX_REPLY_TEXT);

    const emoji = `${'x'.repeat(MAX_REPLY_TEXT - 1)}😀tail`;
    const cut = buildCaptureItems([withReply({ replyText: emoji })], NOW)[0];
    expect(cut?.replyText).toBe('x'.repeat(MAX_REPLY_TEXT - 1));
  });

  it('gives an empty line and no replyText without a reply', () => {
    const [item] = buildCaptureItems([thread('a')], NOW);
    expect(item?.line).toBe('');
    expect(item).not.toHaveProperty('replyText');
    expect(item).not.toHaveProperty('lineSender');
  });

  it('reads the reply of the threads it keeps only', () => {
    const reply = vi.fn(() => ({ replyText: 'An answer' }));
    const threads = Array.from({ length: 31 }, (_, index) =>
      thread(`t${index}`, { ts: index, reply: index === 0 ? reply : () => ({}) })
    );
    expect(ids(threads)).not.toContain('t0');
    expect(reply).not.toHaveBeenCalled();
  });

  it('carries the reply as written where it differs, cut as the cleaned one', () => {
    const [own] = buildCaptureItems(
      [withReply({ replyText: 'Tool: 1 call. Done', copyText: '**Done**' })],
      NOW
    );
    expect(own?.copyText).toBe('**Done**');
    const [same] = buildCaptureItems([withReply({ replyText: 'Done', copyText: 'Done' })], NOW);
    expect(same).not.toHaveProperty('copyText');
    const [long] = buildCaptureItems(
      [withReply({ replyText: 'x', copyText: 'y'.repeat(900) })],
      NOW
    );
    expect(long?.copyText).toHaveLength(MAX_REPLY_TEXT);
  });

  it('marks a pinned thread, and only that one', () => {
    const items = buildCaptureItems([thread('p', { pinned: true, ts: 2000 }), thread('a')], NOW);
    expect(items.map((item) => item.pinned)).toEqual([true, undefined]);
  });
});
