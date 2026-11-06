import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { DecryptionError } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import {
  getLocalizedThreadMessagePreviewText,
  getReplyPreviewText,
  getThreadMessagePreviewText,
} from './threadMessagePreview';
import {
  getThreadPrimarySummaryText,
  resolveThreadPresentationSnapshot,
} from './threadPresentation';

// Regression (L5-F010): a new device that has not unlocked the key backup yet listed the threads
// of an encrypted room by the SDK's error text, "** Unable to decrypt: DecryptionError: ... **".
// The SDK leaves that text as the body of an event it cannot decrypt (msgtype m.bad.encrypted);
// a preview shows a short translated placeholder instead.

const SDK_ERROR =
  'DecryptionError: This message was sent before this device logged in, and key backup is not working.';

const t = ((key: string) => `translated:${key}`) as unknown as TFunction;
const room = {
  getMember: () => null,
  getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
} as unknown as Room;

/** An encrypted event whose decryption failed, as the SDK leaves it. */
const undecryptable = async (eventId: string): Promise<MatrixEvent> => {
  const event = new MatrixEvent({
    type: 'm.room.encrypted',
    event_id: eventId,
    room_id: '!room:example.org',
    sender: '@someone:example.org',
    origin_server_ts: 1,
    content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'opaque' },
  });
  const crypto = {
    decryptEvent: vi
      .fn()
      .mockRejectedValue(
        new DecryptionError(DecryptionFailureCode.HISTORICAL_MESSAGE_NO_KEY_BACKUP, SDK_ERROR)
      ),
  };
  await event.attemptDecryption(crypto as never);
  return event;
};

describe('the preview of a message the client cannot decrypt', () => {
  it('is a translated placeholder, not the SDK error text', async () => {
    const content = (await undecryptable('$failed')).getContent();
    expect(getThreadMessagePreviewText(content)).not.toMatch(/Unable to decrypt|DecryptionError/);
    expect(getLocalizedThreadMessagePreviewText(content, t)).toBe(
      'translated:sharedUi.threadPreviews.encrypted'
    );
    expect(getReplyPreviewText(room, content, t)).toBe(
      'translated:sharedUi.threadPreviews.encrypted'
    );
  });

  it('titles a thread whose root it cannot decrypt with the placeholder', async () => {
    const root = await undecryptable('$root');
    const presentation = resolveThreadPresentationSnapshot({
      room,
      threadRootId: '$root',
      rootEvent: root,
      visibleReplyEvents: [],
    });
    expect(getThreadPrimarySummaryText(presentation, t)).toBe(
      'translated:sharedUi.threadPreviews.encrypted'
    );
  });
});
