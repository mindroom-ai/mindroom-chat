import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { resolveThreadPresentationSnapshot } from './threadPresentation';

// Regression (P2-e2ee-F005): a WebKit card in an encrypted room read "Helper: #slow follow up in
// thread": the tester's question, the cached preview of the thread's last reply, under the name of
// the helper, whose newer events the device had loaded but could not show yet. A cached preview
// keeps the sender it was cached with.

const ROOM = '!room:example.org';
const TESTER = '@tester:example.org';
const HELPER = '@mindroom_helper:example.org';

const room = { roomId: ROOM, getMember: () => null } as unknown as Room;

const inThread = (eventId: string, sender: string, content: Record<string, unknown>) =>
  new MatrixEvent({
    type: 'm.room.message',
    event_id: eventId,
    room_id: ROOM,
    sender,
    origin_server_ts: 2,
    content: { ...content, 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } },
  });

const undecrypted = new MatrixEvent({
  type: 'm.room.encrypted',
  event_id: '$reply',
  room_id: ROOM,
  sender: HELPER,
  origin_server_ts: 3,
  content: {
    algorithm: 'm.megolm.v1.aes-sha2',
    ciphertext: 'opaque',
    'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
  },
});

const titleNotice = inThread('$title', HELPER, {
  msgtype: 'm.notice',
  body: 'Release notes',
  'io.mindroom.thread_summary': { version: 1, summary: 'Release notes' },
});

describe("a thread card's cached reply preview", () => {
  it.each([
    ['a reply still encrypted', undecrypted],
    ['a title notice', titleNotice],
  ])('keeps its own sender when the newest loaded event is %s', (_name, newest) => {
    const snapshot = resolveThreadPresentationSnapshot({
      room,
      threadRootId: '$root',
      visibleReplyEvents: [newest],
      fallbackLatestReplyPreviewText: '#slow follow up in thread',
      fallbackLastSenderId: TESTER,
    });
    expect(snapshot.latestReplyPreviewText).toBe('#slow follow up in thread');
    expect(snapshot.lastSenderId).toBe(TESTER);
  });

  it('names the sender of a loaded reply it shows', () => {
    const snapshot = resolveThreadPresentationSnapshot({
      room,
      threadRootId: '$root',
      visibleReplyEvents: [inThread('$answer', HELPER, { msgtype: 'm.text', body: 'word1 word2' })],
      fallbackLatestReplyPreviewText: '#slow follow up in thread',
      fallbackLastSenderId: TESTER,
    });
    expect(snapshot.latestReplyPreviewText).toBe('word1 word2');
    expect(snapshot.lastSenderId).toBe(HELPER);
  });
});
