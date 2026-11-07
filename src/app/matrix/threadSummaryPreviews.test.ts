import { describe, expect, it } from 'vitest';
import type { IEvent } from 'matrix-js-sdk';
import {
  collectEmbeddedRelationEventIds,
  stripRedactedRelationsFromRawEvent,
} from './eventRevision';

const inThread = { 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } };
const event = (id: string, body: string, unsigned?: Record<string, unknown>): Partial<IEvent> => ({
  event_id: id,
  type: 'm.room.message',
  sender: '@alice:example.org',
  origin_server_ts: 1,
  content: { msgtype: 'm.text', body, ...inThread },
  ...(unsigned ? { unsigned } : {}),
});
const edit = event('$reply-edit', '* reply v2');
const reply = event('$reply', 'reply v1', { 'm.relations': { 'm.replace': edit } });
const title = event('$title', 'title');
const rootWith = (thread: Record<string, unknown>): Partial<IEvent> =>
  event('$root', 'root', { 'm.relations': { 'm.thread': thread } });
const threadOf = (root: Partial<IEvent>) =>
  (root.unsigned?.['m.relations'] as Record<string, unknown>)['m.thread'];

describe("MindRoom's previews beside a thread summary", () => {
  it('lose the copy of a redacted reply, and the redacted edit of a kept one', () => {
    const root = rootWith({
      count: 2,
      latest_event: title,
      'io.mindroom.title': title,
      'io.mindroom.latest_reply': reply,
    });

    expect(threadOf(stripRedactedRelationsFromRawEvent(root, new Set(['$reply'])))).toEqual({
      count: 2,
      latest_event: title,
      'io.mindroom.title': title,
    });
    expect(threadOf(stripRedactedRelationsFromRawEvent(root, new Set(['$reply-edit'])))).toEqual({
      count: 2,
      latest_event: title,
      'io.mindroom.title': title,
      'io.mindroom.latest_reply': { ...reply, unsigned: {} },
    });
    expect(stripRedactedRelationsFromRawEvent(root, new Set(['$other']))).toBe(root);
  });

  it('count as embedded relations, so a later save checks them for redactions', () => {
    const root = rootWith({ count: 1, 'io.mindroom.latest_reply': reply });

    expect(collectEmbeddedRelationEventIds([root])).toEqual(new Set(['$reply', '$reply-edit']));
  });
});
