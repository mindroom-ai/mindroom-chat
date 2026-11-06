import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { Reply } from './Reply';

vi.mock('./Reply.css', () => ({ Reply: '', ReplyContent: '' }));
vi.mock('../content/FallbackContent', () => ({
  MessageBadEncryptedContent: () => null,
  MessageDeletedContent: () => null,
  MessageFailedContent: () => null,
}));
vi.mock('../html/react-custom-html-parser', () => ({}));
vi.mock('../../event-store/cache/useRoomEvent', () => ({
  // The quoted event as the room has it; nothing is fetched.
  useRoomEvent: (_room: Room, _id: string, getLocal: () => MatrixEvent) => getLocal(),
}));
vi.mock('../ThreadIndicator', () => ({
  ThreadIndicator: () => null,
}));

const SENDER = '@bob:server';

/** An encrypted edit of `$quoted` that could not be decrypted, as a missing key leaves it. */
const undecryptableEdit = async () => {
  const edit = new MatrixEvent({
    event_id: '$edit',
    room_id: '!room:server',
    sender: SENDER,
    type: 'm.room.encrypted',
    origin_server_ts: 2,
    content: {
      ciphertext: 'unreadable',
      'm.relates_to': { rel_type: 'm.replace', event_id: '$quoted' },
    },
  });
  await edit.attemptDecryption({
    decryptEvent: async () => {
      throw new Error('missing key');
    },
  } as never);
  return edit;
};

it('quotes the last readable version when the newest edit could not be decrypted', async () => {
  const quoted = new MatrixEvent({
    event_id: '$quoted',
    room_id: '!room:server',
    sender: SENDER,
    type: 'm.room.message',
    origin_server_ts: 1,
    content: { msgtype: 'm.text', body: 'First words' },
  });
  // The SDK applies the newest edit whatever its decryption gave.
  quoted.makeReplaced(await undecryptableEdit());
  const room = { findEventById: () => quoted, getMember: () => null } as unknown as Room;

  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Reply room={room} replyEventId="$quoted" />);
  });

  expect(JSON.stringify(renderer.toJSON())).toContain('First words');
  act(() => renderer.unmount());
});
