import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeResolvedThreadRoom } from '../../test/utils/resolvedThreadRoom';
import { ImagePack } from '../emoji/custom/ImagePack';
import { resetPendingThreadTagsForTests } from '../event-store/threads/threadTagPending';
import {
  buildPerTagStateKey,
  MINDROOM_THREAD_TAGS_EVENT,
  RESOLVED_TAG,
} from '../event-store/threads/threadTags';
import { composeSticker, findStickerInfo, sendComposerSticker } from './composerSticker';

const sticker = { mxc: 'mxc://example.org/wave', label: 'Wave', info: { w: 128, h: 128 } };

describe('composeSticker', () => {
  it('sends a room sticker without a relation', () => {
    expect(composeSticker({ threadingEnabled: true }, sticker)).toEqual({
      threadRootId: null,
      content: { body: 'Wave', url: 'mxc://example.org/wave', info: { w: 128, h: 128 } },
    });
  });

  it('places a sticker in the open thread, falling back to the thread root as its reply', () => {
    const { threadRootId, content } = composeSticker(
      { threadId: '$root', threadingEnabled: true },
      sticker
    );
    expect(threadRootId).toBe('$root');
    expect(content).toMatchObject({
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: '$root',
        is_falling_back: true,
        'm.in_reply_to': { event_id: '$root' },
      },
    });
  });

  it('replies without a thread in a classic room', () => {
    const { threadRootId, content } = composeSticker(
      {
        threadingEnabled: false,
        replyDraft: { userId: '@a:example.org', eventId: '$message', body: 'Hi' },
      },
      sticker
    );
    expect(threadRootId).toBeNull();
    expect(content).toMatchObject({
      'm.relates_to': { 'm.in_reply_to': { event_id: '$message' } },
    });
  });
});

describe('findStickerInfo', () => {
  it('reads the info the sticker pack lists for the image', () => {
    const pack = new ImagePack(
      'pack',
      {
        pack: { usage: ['sticker'] },
        images: { wave: { url: 'mxc://example.org/wave', info: { w: 96, h: 64 } } },
      },
      undefined
    );
    expect(findStickerInfo([pack], 'mxc://example.org/wave')).toEqual({ w: 96, h: 64 });
    expect(findStickerInfo([pack], 'mxc://example.org/other')).toEqual({});
  });
});

describe('sendComposerSticker', () => {
  afterEach(() => resetPendingThreadTagsForTests());

  it('reopens a resolved thread after sticker send succeeds, skipping failed or non-thread sends', async () => {
    const { room } = makeResolvedThreadRoom();
    const mx = {
      getUserId: () => '@alice:example.org',
      getSafeUserId: () => '@alice:example.org',
      getAccountData: () => undefined,
      getRoom: () => room,
      sendEvent: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ event_id: '$sticker' }),
      sendStateEvent: vi.fn(async () => ({ event_id: '$tag' })),
    };

    await expect(
      sendComposerSticker(
        mx as never,
        { room, roomId: room.roomId, threadId: '$root', threadingEnabled: true },
        sticker,
        []
      )
    ).rejects.toThrow('offline');
    await sendComposerSticker(
      mx as never,
      { room, roomId: room.roomId, threadId: '$root', threadingEnabled: false },
      sticker,
      []
    );
    expect(mx.sendStateEvent).not.toHaveBeenCalled();

    await sendComposerSticker(
      mx as never,
      { room, roomId: room.roomId, threadId: '$root', threadingEnabled: true },
      sticker,
      []
    );
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      room.roomId,
      MINDROOM_THREAD_TAGS_EVENT,
      {},
      buildPerTagStateKey('$root', RESOLVED_TAG)
    );
  });
});
