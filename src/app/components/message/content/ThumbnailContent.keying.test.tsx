import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IThumbnailContent } from '../../../../types/matrix/common';
import { ThumbnailContent } from './ThumbnailContent';

const mocks = vi.hoisted(() => ({
  downloadCachedAttachment: vi.fn(async () => new Blob(['thumbnail'], { type: 'image/png' })),
  matrixClient: {},
}));

vi.mock('../../../hooks/useMatrixClient', () => ({ useMatrixClient: () => mocks.matrixClient }));
vi.mock('../../../mindroom/messages/attachmentRepository', () => ({
  downloadCachedAttachment: mocks.downloadCachedAttachment,
}));

// A fresh object on every call, as callers build them while rendering.
const thumbnail = (iv: string): IThumbnailContent => ({
  thumbnail_info: { mimetype: 'image/png' },
  thumbnail_file: {
    url: 'mxc://example.org/thumbnail',
    v: 'v2',
    key: { alg: 'A256CTR', ext: true, key_ops: ['encrypt', 'decrypt'], kty: 'oct', k: 'key' },
    iv,
    hashes: { sha256: 'hash' },
  },
});
const owner = () => ({ roomId: '!room:example.org', eventId: '$event', revisionTs: 1 });

describe('ThumbnailContent load identity', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    mocks.downloadCachedAttachment.mockClear();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumbnail');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    renderer = undefined;
    vi.restoreAllMocks();
  });

  const render = async (iv: string) => {
    const element = (
      <ThumbnailContent info={thumbnail(iv)} owner={owner()} renderImage={() => <img alt="" />} />
    );
    await act(async () => {
      if (renderer) renderer.update(element);
      else renderer = create(element);
      await Promise.resolve();
    });
  };

  it('keeps one load across renders that rebuild the same file and owner', async () => {
    await render('iv-1');
    await render('iv-1');
    await render('iv-1');

    expect(mocks.downloadCachedAttachment).toHaveBeenCalledOnce();
  });

  it('loads again when the file changes', async () => {
    await render('iv-1');
    await render('iv-2');

    expect(mocks.downloadCachedAttachment).toHaveBeenCalledTimes(2);
  });
});
