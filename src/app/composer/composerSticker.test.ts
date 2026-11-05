import { describe, expect, it } from 'vitest';
import { ImagePack } from '../emoji/custom/ImagePack';
import { composeSticker, findStickerInfo } from './composerSticker';

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
