// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finalReply, sentEventId } from './live-ask.mjs';

const state = /** @type {any} */ ({
  userId: '@tester:matrix.localhost',
  lobby: { roomId: '!lobby' },
});
const helper = '@mindroom_helper:matrix.localhost';
/** @param {string} id @param {string} sender @param {Record<string, any>} content */
const event = (id, sender, content, ts = 2000) => ({
  event_id: id,
  sender,
  type: 'm.room.message',
  origin_server_ts: ts,
  content,
});
const root = event('$root', state.userId, { body: 'What is 17*23?' });
const reply = event('$reply', helper, {
  body: 'Thinking...',
  'io.mindroom.stream_status': 'pending',
  'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
});
/** @param {number} n @param {string} status */
const edit = (n, status) =>
  event(`$edit${n}`, helper, {
    body: `* part ${n}`,
    'm.new_content': { body: `part ${n}`, 'io.mindroom.stream_status': status },
    'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
  });

/**
 * A homeserver's relation and message endpoints over `events` (oldest first), as the script calls
 * them; it records the paths.
 * @param {any[]} events
 */
const fakeHomeserver = (events) => {
  /** @type {string[]} */
  const paths = [];
  /** @param {string} path */
  const get = async (path) => {
    paths.push(path);
    const url = new URL(path, 'http://hs');
    const limit = Number(url.searchParams.get('limit'));
    const backwards = url.searchParams.get('dir') === 'b';
    const relation = url.pathname.match(/\/relations\/([^/]+)\/([^/]+)$/);
    const matching = relation
      ? events.filter(
          (e) =>
            e.content['m.relates_to']?.event_id === decodeURIComponent(relation[1] ?? '') &&
            e.content['m.relates_to']?.rel_type === relation[2]
        )
      : events;
    const ordered = backwards ? [...matching].reverse() : matching;
    return { chunk: ordered.slice(0, limit) };
  };
  return { get, paths };
};

test('a reply with hundreds of streaming edits resolves from its newest edit alone', async () => {
  const edits = Array.from({ length: 250 }, (_, n) => edit(n, n < 249 ? 'streaming' : 'completed'));
  const { get, paths } = fakeHomeserver([root, reply, ...edits]);
  assert.deepEqual(await finalReply(state, '$root', get), {
    eventId: '$reply',
    sender: helper,
    body: 'part 249',
    status: 'completed',
  });
  // The thread and the reply's newest edit: two requests, not a page of the room.
  assert.equal(paths.length, 2);
});

test('a reply whose newest edit still streams is not final', async () => {
  const { get } = fakeHomeserver([root, reply, edit(0, 'streaming')]);
  assert.equal(await finalReply(state, '$root', get), undefined);
});

test('an agent message without a stream status, such as a title notice, is no reply', async () => {
  const notice = event('$notice', helper, {
    body: 'Calculating',
    'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
  });
  const { get } = fakeHomeserver([root, notice]);
  assert.equal(await finalReply(state, '$root', get), undefined);
});

test('the sent message is the tester’s own with this text, sent since the ask began', async () => {
  const { get } = fakeHomeserver([root, reply]);
  assert.equal(await sentEventId(state, 'What is 17*23?', 1000, get), '$root');
  assert.equal(await sentEventId(state, 'What is 17*23?', 3000, get), undefined);
  assert.equal(await sentEventId(state, 'Another question', 1000, get), undefined);
});
