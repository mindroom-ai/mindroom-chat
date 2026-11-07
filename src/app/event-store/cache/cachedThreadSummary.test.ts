import { describe, expect, it } from 'vitest';
import { withNewestCachedReplies } from './cachedThreadSummary';

const inThread = { 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } };
const placeholder = {
  event_id: '$reply',
  sender: '@agent:example.org',
  type: 'm.room.message',
  origin_server_ts: 1000,
  content: { msgtype: 'm.text', body: 'Thinking...', ...inThread },
};
const title = {
  event_id: '$title',
  sender: '@agent:example.org',
  type: 'm.room.message',
  origin_server_ts: 3000,
  content: {
    msgtype: 'm.notice',
    body: 'Release notes',
    'io.mindroom.thread_summary': { version: 1, summary: 'Release notes' },
    ...inThread,
  },
};
// The root as a thread list read it while the reply was its placeholder.
const listedRoot = {
  event_id: '$root',
  origin_server_ts: 500,
  unsigned: {
    'm.relations': {
      'm.thread': {
        count: 1,
        latest_event: placeholder,
        'io.mindroom.latest_reply': placeholder,
        'io.mindroom.title': title,
      },
    },
  },
};
const summary = (root: ReturnType<typeof withNewestCachedReplies>) =>
  root.unsigned?.['m.relations']?.['m.thread'] as Record<string, unknown>;

describe('withNewestCachedReplies', () => {
  it("drops the server's MindRoom previews once the cache rewrites the summary", () => {
    // The cache holds the title sent after the root was listed: the summary now names it, and the
    // placeholder the server bundled as the latest reply no longer describes that summary.
    const restored = summary(withNewestCachedReplies(listedRoot, [title]));
    expect(restored.latest_event).toBe(title);
    expect(restored.count).toBe(2);
    expect(restored).not.toHaveProperty('io.mindroom.latest_reply');
    expect(restored).not.toHaveProperty('io.mindroom.title');
    // Nothing newer in the cache: the server's summary stays as it was.
    expect(withNewestCachedReplies(listedRoot, [])).toBe(listedRoot);
  });
});
