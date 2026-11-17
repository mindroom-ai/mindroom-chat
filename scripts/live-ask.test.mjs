// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finalReply } from './live-ask.mjs';

const state = /** @type {any} */ ({ userId: '@tester:matrix.localhost' });
const helper = '@mindroom_helper:matrix.localhost';
const thread = { rel_type: 'm.thread', event_id: '$root' };
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
  'm.relates_to': thread,
});
/** @param {string} id @param {string} body @param {string} status */
const edit = (id, body, status) =>
  event(id, helper, {
    body: `* ${body}`,
    'm.new_content': { body, 'io.mindroom.stream_status': status },
    'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
  });

test('a reply is final once its latest edit has a finished stream status', () => {
  const streaming = [edit('$e1', '17 ×', 'streaming'), reply, root];
  assert.equal(finalReply(streaming, state, 'What is 17*23?', 1000), undefined);
  const done = [edit('$e2', '17 × 23 = 391.', 'completed'), ...streaming];
  assert.deepEqual(finalReply(done, state, 'What is 17*23?', 1000), {
    eventId: '$reply',
    sender: helper,
    body: '17 × 23 = 391.',
    status: 'completed',
  });
});

test('only the thread of this message, sent since the ask began, counts', () => {
  const done = [edit('$e2', '391', 'completed'), reply, root];
  assert.equal(finalReply(done, state, 'Another question', 1000), undefined);
  assert.equal(finalReply(done, state, 'What is 17*23?', 3000), undefined);
});

test('an agent message without a stream status, such as a title notice, is no reply', () => {
  const notice = event('$notice', helper, { body: 'Calculating', 'm.relates_to': thread });
  assert.equal(finalReply([notice, root], state, 'What is 17*23?', 1000), undefined);
});
