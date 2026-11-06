import { MatrixEvent } from 'matrix-js-sdk';
import { DecryptionError } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';
import { describe, expect, it, vi } from 'vitest';
import { getEditedEvent, getLatestMessageContent } from './room';

// Regression (L5-F009): the SDK puts an edit the server bundles with a reply on the reply before it
// decrypts the edit, and the reply's content then reads as empty: the first agent reply in a new
// encrypted room showed "Unsupported message" until a reload. A reply whose newest edit cannot
// be read yet shows the newest content it can read.

const ROOM = '!room:example.org';
const AGENT = '@mindroom_helper:example.org';

const reply = (): MatrixEvent =>
  new MatrixEvent({
    type: 'm.room.message',
    event_id: '$reply',
    room_id: ROOM,
    sender: AGENT,
    origin_server_ts: 1,
    content: { msgtype: 'm.text', body: 'Thinking...', 'io.mindroom.stream_status': 'streaming' },
  });

const editContent = (body: string) => ({
  msgtype: 'm.text',
  body: `* ${body}`,
  'm.new_content': { msgtype: 'm.text', body, 'io.mindroom.stream_status': 'streaming' },
  'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
});

const plainEdit = (id: string, ts: number, body: string): MatrixEvent =>
  new MatrixEvent({
    type: 'm.room.message',
    event_id: id,
    room_id: ROOM,
    sender: AGENT,
    origin_server_ts: ts,
    content: editContent(body),
  });

/** An edit as an encrypted room delivers it: only its relation is in the clear. */
const encryptedEdit = (id: string, ts: number): MatrixEvent =>
  new MatrixEvent({
    type: 'm.room.encrypted',
    event_id: id,
    room_id: ROOM,
    sender: AGENT,
    origin_server_ts: ts,
    content: {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'opaque',
      'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
    },
  });

/** A crypto backend whose key for the edit arrives on the second attempt. */
const keyArrivesLater = (body: string) => ({
  decryptEvent: vi
    .fn()
    .mockRejectedValueOnce(
      new DecryptionError(DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID, 'no key yet')
    )
    .mockResolvedValueOnce({ clearEvent: { type: 'm.room.message', content: editContent(body) } }),
});

/** A timeline set whose relations hold the given edits of the reply. */
const relationsOf = (edits: MatrixEvent[]) => ({
  relations: {
    getChildEventsForEvent: () => ({ getRelations: () => edits }),
  },
});

const shownBody = (target: MatrixEvent, edits: MatrixEvent[] = []) =>
  getLatestMessageContent(target, getEditedEvent('$reply', target, relationsOf(edits) as never))
    .body;

describe('a reply whose newest edit cannot be decrypted yet', () => {
  it('shows what it said before, then the edit once its key arrives', async () => {
    const target = reply();
    const edit = encryptedEdit('$edit', 2);
    const crypto = keyArrivesLater('word1 word2');
    // The SDK applies a bundled edit before it decrypts it.
    target.makeReplaced(edit);
    await edit.attemptDecryption(crypto as never);
    expect(edit.isDecryptionFailure()).toBe(true);
    expect(shownBody(target)).toBe('Thinking...');

    await edit.attemptDecryption(crypto as never, { isRetry: true });
    expect(shownBody(target)).toBe('word1 word2');
  });

  it('shows the newest edit it can read', async () => {
    const target = reply();
    const readable = plainEdit('$first', 2, 'word1');
    const unreadable = encryptedEdit('$second', 3);
    target.makeReplaced(unreadable);
    await unreadable.attemptDecryption(keyArrivesLater('word1 word2') as never);
    expect(shownBody(target, [readable, unreadable])).toBe('word1');
  });
});
