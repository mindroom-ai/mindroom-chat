// @vitest-environment jsdom
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HeicDecodeError,
  loadImageOriginal,
  MAX_HEIC_BYTES,
  resetHeicDecodeStateForTests,
} from './imageOriginal';

const mocks = vi.hoisted(() => ({
  downloadCachedAttachment: vi.fn(),
  decodeHeicBlob: vi.fn(),
}));

vi.mock('../../event-store/cache/attachmentRepository', () => ({
  downloadCachedAttachment: mocks.downloadCachedAttachment,
}));

vi.mock('./heicDecode', () => ({
  decodeHeicBlob: mocks.decodeHeicBlob,
}));

const mx = {} as MatrixClient;
const originalCreateImageBitmap = globalThis.createImageBitmap;

describe('imageOriginal', () => {
  let createdBlobs: Blob[];

  beforeEach(() => {
    createdBlobs = [];
    resetHeicDecodeStateForTests();
    mocks.downloadCachedAttachment.mockReset();
    mocks.decodeHeicBlob.mockReset();
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      createdBlobs.push(blob as Blob);
      return `blob:img-${createdBlobs.length}`;
    });
  });

  afterEach(() => {
    if (originalCreateImageBitmap) globalThis.createImageBitmap = originalCreateImageBitmap;
    else Reflect.deleteProperty(globalThis, 'createImageBitmap');
  });

  it('returns the original blob directly for non-HEIC images without probing or decoding', async () => {
    const png = new Blob(['png-bytes'], { type: 'image/png' });
    const probe = vi.fn();
    globalThis.createImageBitmap = probe;
    mocks.downloadCachedAttachment.mockResolvedValue(png);

    const loaded = await loadImageOriginal(mx, {
      url: 'mxc://example.org/png-1',
      mimeType: 'image/png',
    });

    expect(loaded).toEqual({ src: 'blob:img-1' });
    expect(createdBlobs).toEqual([png]);
    expect(probe).not.toHaveBeenCalled();
    expect(mocks.decodeHeicBlob).not.toHaveBeenCalled();
  });

  it('probes native HEIC once per session and skips the fallback decoder when supported', async () => {
    const first = new Blob(['heic-1'], { type: 'image/heic' });
    const second = new Blob(['heic-2'], { type: 'image/heic' });
    const close = vi.fn();
    const probe = vi.fn().mockResolvedValue({ close });
    globalThis.createImageBitmap = probe;
    mocks.downloadCachedAttachment.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    expect(await loadImageOriginal(mx, { url: 'mxc://ex/h1', mimeType: 'image/heic' })).toEqual({
      src: 'blob:img-1',
    });
    expect(await loadImageOriginal(mx, { url: 'mxc://ex/h2', mimeType: 'image/heic' })).toEqual({
      src: 'blob:img-2',
    });

    expect(createdBlobs).toEqual([first, second]);
    expect(probe).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.decodeHeicBlob).not.toHaveBeenCalled();
  });

  it('converts HEIC when native decode fails, keeps original bytes, and reuses the cached copy', async () => {
    const heic = new Blob(['heic-raw'], { type: 'image/heic' });
    const jpeg = new Blob(['jpeg-converted'], { type: 'image/jpeg' });
    globalThis.createImageBitmap = vi.fn().mockRejectedValue(new Error('unsupported'));
    mocks.downloadCachedAttachment.mockResolvedValue(heic);
    mocks.decodeHeicBlob.mockResolvedValue(jpeg);

    const timeline = await loadImageOriginal(mx, {
      url: 'mxc://ex/h-fallback',
      mimeType: 'image/heic',
    });
    expect(timeline).toEqual({ src: 'blob:img-1', downloadBlob: heic });
    expect(createdBlobs[0]).toBe(jpeg);

    const viewer = await loadImageOriginal(mx, {
      url: 'mxc://ex/h-fallback',
      mimeType: 'image/heic',
    });
    expect(viewer).toEqual({ src: 'blob:img-2', downloadBlob: heic });
    expect(mocks.decodeHeicBlob).toHaveBeenCalledOnce();
  });

  it('throws HeicDecodeError with originalBlob on decode failure and evicts failed cache entries', async () => {
    const corrupt = new Blob(['not-heic'], { type: 'image/heif' });
    const recovered = new Blob(['jpeg-ok'], { type: 'image/jpeg' });
    globalThis.createImageBitmap = vi.fn().mockRejectedValue(new Error('unsupported'));
    mocks.downloadCachedAttachment.mockResolvedValue(corrupt);
    mocks.decodeHeicBlob
      .mockRejectedValueOnce(new Error('Invalid HEIF box'))
      .mockResolvedValueOnce(recovered);

    let caught: unknown;
    try {
      await loadImageOriginal(mx, { url: 'mxc://ex/h-bad', mimeType: 'image/heif' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HeicDecodeError);
    expect((caught as HeicDecodeError).originalBlob).toBe(corrupt);

    const retried = await loadImageOriginal(mx, {
      url: 'mxc://ex/h-bad',
      mimeType: 'image/heif',
    });
    expect(retried).toEqual({ src: 'blob:img-1', downloadBlob: corrupt });
    expect(mocks.decodeHeicBlob).toHaveBeenCalledTimes(2);
  });

  it('throws HeicDecodeError when over the byte budget and leaves plain network errors untouched', async () => {
    mocks.downloadCachedAttachment.mockRejectedValueOnce(
      new Error(`Attachment exceeds the ${MAX_HEIC_BYTES} byte limit`)
    );
    await expect(
      loadImageOriginal(mx, { url: 'mxc://ex/huge', mimeType: 'image/heic' })
    ).rejects.toBeInstanceOf(HeicDecodeError);

    mocks.downloadCachedAttachment.mockRejectedValueOnce(new Error('offline'));
    let networkErr: unknown;
    try {
      await loadImageOriginal(mx, { url: 'mxc://ex/net', mimeType: 'image/heic' });
    } catch (error) {
      networkErr = error;
    }
    expect(networkErr).toBeInstanceOf(Error);
    expect(networkErr).not.toBeInstanceOf(HeicDecodeError);
    expect(mocks.decodeHeicBlob).not.toHaveBeenCalled();
  });
});
