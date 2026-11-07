import { createClient, MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { getPinContent } from './pinContent';

const ROOM_ID = '!terminal:example.org';
const SENDER = '@coordinator:example.org';

const reply = () =>
  new MatrixEvent({
    event_id: '$reply',
    room_id: ROOM_ID,
    sender: SENDER,
    origin_server_ts: 1,
    type: 'm.room.message',
    content: { msgtype: 'm.text', body: 'Straddle carrier 12 has a hydraulic leak.' },
  });

/** The sender's edit of `$reply`, still encrypted. */
const encryptedEdit = () =>
  new MatrixEvent({
    event_id: '$edit',
    room_id: ROOM_ID,
    sender: SENDER,
    origin_server_ts: 2,
    type: 'm.room.encrypted',
    content: {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'sealed',
      'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
    },
  });

const editContent = (body: string) => ({
  msgtype: 'm.text',
  body: `* ${body}`,
  'm.new_content': { msgtype: 'm.text', body },
  'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
});

const decryptAs = (body: string) =>
  ({
    decryptEvent: vi.fn().mockResolvedValue({
      clearEvent: { type: 'm.room.message', content: editContent(body) },
    }),
  } as unknown as Parameters<MatrixEvent['attemptDecryption']>[0]);

describe('getPinContent', () => {
  it('is the message itself without an edit', () => {
    expect(getPinContent(reply())).toEqual({
      content: { msgtype: 'm.text', body: 'Straddle carrier 12 has a hydraulic leak.' },
      edited: false,
    });
  });

  it('is the message as sent while its newest edit is not decrypted, not an empty message', () => {
    const event = reply();
    event.makeReplaced(encryptedEdit());
    // The SDK reads the edit's missing new content as an empty message.
    expect(event.getContent()).toEqual({});
    expect(getPinContent(event)).toEqual({
      content: { msgtype: 'm.text', body: 'Straddle carrier 12 has a hydraulic leak.' },
      edited: false,
    });
  });

  it('is the edit once it is decrypted', async () => {
    const event = reply();
    const edit = encryptedEdit();
    event.makeReplaced(edit);
    await edit.attemptDecryption(decryptAs('Straddle carrier 12 is back in service.'));
    expect(getPinContent(event)).toEqual({
      content: { msgtype: 'm.text', body: 'Straddle carrier 12 is back in service.' },
      edited: true,
    });
  });

  it('keeps its sender’s text when the server bundles another member’s edit with it', () => {
    const event = createClient({ baseUrl: 'https://example.org', userId: SENDER }).getEventMapper()(
      {
        ...reply().event,
        unsigned: {
          'm.relations': {
            'm.replace': {
              event_id: '$foreign-edit',
              room_id: ROOM_ID,
              sender: '@visitor:example.org',
              origin_server_ts: 2,
              type: 'm.room.message',
              content: editContent('Straddle carrier 12 is cleared to drive.'),
            },
          },
        },
      }
    );
    expect(getPinContent(event)).toEqual({
      content: { msgtype: 'm.text', body: 'Straddle carrier 12 has a hydraulic leak.' },
      edited: false,
    });
  });
});
