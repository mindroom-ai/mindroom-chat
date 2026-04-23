import { MsgType } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageEvent } from '../../../types/matrix/room';
import {
  clearThreadMediaPreloadCache,
  getThreadMediaPreloadDescriptor,
} from './threadMediaPreloadUtils';

describe('getThreadMediaPreloadDescriptor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts image descriptors for image messages and stickers', () => {
    expect(
      getThreadMediaPreloadDescriptor(MessageEvent.RoomMessage, {
        body: 'Diagram',
        info: { mimetype: 'image/png' },
        msgtype: MsgType.Image,
        url: 'mxc://mindroom/image',
      })
    ).toEqual({
      encInfo: undefined,
      key: 'image:mxc://mindroom/image',
      kind: 'image',
      mimeType: 'image/png',
      mxcUrl: 'mxc://mindroom/image',
    });

    expect(
      getThreadMediaPreloadDescriptor(MessageEvent.Sticker, {
        body: 'Sticker',
        file: {
          iv: 'iv',
          key: { k: 'key' },
          hashes: { sha256: 'hash' },
          url: 'mxc://mindroom/sticker',
          v: 'v2',
        },
        info: { mimetype: 'image/webp' },
      })
    ).toMatchObject({
      key: 'image:mxc://mindroom/sticker',
      kind: 'image',
      mimeType: 'image/webp',
      mxcUrl: 'mxc://mindroom/sticker',
    });
  });

  it('extracts video thumbnail descriptors only when thumbnail metadata is complete', () => {
    expect(
      getThreadMediaPreloadDescriptor(MessageEvent.RoomMessage, {
        info: {
          h: 720,
          mimetype: 'video/mp4',
          thumbnail_info: { mimetype: 'image/jpeg' },
          thumbnail_url: 'mxc://mindroom/thumb',
          w: 1280,
        },
        msgtype: MsgType.Video,
        url: 'mxc://mindroom/video',
      })
    ).toEqual({
      encInfo: undefined,
      key: 'video-thumbnail:mxc://mindroom/thumb',
      kind: 'video-thumbnail',
      mimeType: 'image/jpeg',
      mxcUrl: 'mxc://mindroom/thumb',
    });

    expect(
      getThreadMediaPreloadDescriptor(MessageEvent.RoomMessage, {
        info: {
          thumbnail_url: 'mxc://mindroom/thumb',
        },
        msgtype: MsgType.Video,
        url: 'mxc://mindroom/video',
      })
    ).toBeUndefined();
  });

  it('ignores media that was never auto-preloaded', () => {
    expect(
      getThreadMediaPreloadDescriptor(MessageEvent.RoomMessage, {
        info: { mimetype: 'audio/mpeg' },
        msgtype: MsgType.Audio,
        url: 'mxc://mindroom/audio',
      })
    ).toBeUndefined();

    expect(
      getThreadMediaPreloadDescriptor(MessageEvent.RoomMessage, {
        info: { mimetype: 'application/pdf' },
        msgtype: MsgType.File,
        url: 'mxc://mindroom/file',
      })
    ).toBeUndefined();
  });
});

describe('clearThreadMediaPreloadCache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('revokes cached blob urls but leaves plain http urls alone', () => {
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    const cache = new Map<string, string>([
      ['blob', 'blob:cached-image'],
      ['http', 'https://example.com/image.png'],
    ]);

    clearThreadMediaPreloadCache(cache);

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cached-image');
    expect(cache.size).toBe(0);
  });
});
