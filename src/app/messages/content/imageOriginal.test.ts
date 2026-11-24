// @vitest-environment jsdom
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadImageOriginal, loadImageOriginalForViewer } from './imageOriginal';

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

    const loaded = await loadImageOriginalForViewer(mx, {
      url: 'mxc://example.org/png-1',
      mimeType: 'image/png',
    });

    expect(loaded).toEqual({ src: 'blob:img-1' });
    expect(createdBlobs).toEqual([png]);
    expect(probe).not.toHaveBeenCalled();
    expect(mocks.decodeHeicBlob).not.toHaveBeenCalled();
  });

  it('uses the original HEIC bytes without invoking the fallback decoder when native decode succeeds', async () => {
    const heic = new Blob(['heic-native'], { type: 'image/heic' });
    const close = vi.fn();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close });
    mocks.downloadCachedAttachment.mockResolvedValue(heic);

    const loaded = await loadImageOriginalForViewer(mx, {
      url: 'mxc://example.org/heic-native',
      mimeType: 'image/heic',
    });

    expect(loaded).toEqual({ src: 'blob:img-1' });
    expect(createdBlobs).toEqual([heic]);
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.decodeHeicBlob).not.toHaveBeenCalled();
  });

  it('converts HEIC when native decode fails, keeps original bytes for download, and reuses the cached copy', async () => {
    const heic = new Blob(['heic-raw'], { type: 'image/heic' });
    const jpeg = new Blob(['jpeg-converted'], { type: 'image/jpeg' });
    globalThis.createImageBitmap = vi.fn().mockRejectedValue(new Error('unsupported'));
    mocks.downloadCachedAttachment.mockResolvedValue(heic);
    mocks.decodeHeicBlob.mockResolvedValue(jpeg);

    const timelineUrl = await loadImageOriginal(mx, {
      url: 'mxc://example.org/heic-fallback',
      mimeType: 'image/heic',
    });
    expect(timelineUrl).toBe('blob:img-1');
    expect(createdBlobs[0]).toBe(jpeg);
    expect(mocks.decodeHeicBlob).toHaveBeenCalledOnce();

    // Opening the viewer reuses the converted display blob while keeping the original HEIC for saving.
    const viewerLoaded = await loadImageOriginalForViewer(mx, {
      url: 'mxc://example.org/heic-fallback',
      mimeType: 'image/heic',
    });
    expect(viewerLoaded).toEqual({ src: 'blob:img-2', downloadBlob: heic });
    expect(createdBlobs[1]).toBe(jpeg);
    expect(mocks.decodeHeicBlob).toHaveBeenCalledOnce();
  });

  it('propagates decode errors without caching them so retry decodes again', async () => {
    const corrupt = new Blob(['not-heic'], { type: 'image/heif' });
    const recovered = new Blob(['jpeg-ok'], { type: 'image/jpeg' });
    globalThis.createImageBitmap = vi.fn().mockRejectedValue(new Error('unsupported'));
    mocks.downloadCachedAttachment.mockResolvedValue(corrupt);
    mocks.decodeHeicBlob
      .mockRejectedValueOnce(new Error('Invalid HEIF box'))
      .mockResolvedValueOnce(recovered);

    await expect(
      loadImageOriginal(mx, { url: 'mxc://example.org/heic-bad', mimeType: 'image/heif' })
    ).rejects.toThrow('Invalid HEIF box');

    const retried = await loadImageOriginal(mx, {
      url: 'mxc://example.org/heic-bad',
      mimeType: 'image/heif',
    });
    expect(retried).toBe('blob:img-1');
    expect(createdBlobs[0]).toBe(recovered);
    expect(mocks.decodeHeicBlob).toHaveBeenCalledTimes(2);
  });
});
