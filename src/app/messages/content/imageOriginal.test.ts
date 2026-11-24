import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HeicDecodeError,
  loadImageOriginal,
  MAX_HEIC_BYTES,
  resetHeicDecodeStateForTests,
} from './imageOriginal';

const mocks = vi.hoisted(() => ({ downloadCachedAttachment: vi.fn(), decodeHeicBlob: vi.fn() }));
vi.mock('../../event-store/cache/attachmentRepository', () => ({
  downloadCachedAttachment: mocks.downloadCachedAttachment,
}));
vi.mock('./heicDecode', () => ({ decodeHeicBlob: mocks.decodeHeicBlob }));

const mx = {} as MatrixClient;
const originalCreateImageBitmap = globalThis.createImageBitmap;
const load = (url: string, mimeType = 'image/heic', signal?: AbortSignal) =>
  loadImageOriginal(mx, { url, mimeType, signal });

const makeHeicBlob = (brand = 'heic'): Blob => {
  const bytes = new Uint8Array(20);
  bytes[3] = 20;
  bytes.set([...'ftyp', ...brand].map((ch) => ch.charCodeAt(0)), 4);
  bytes.set([...'mif1'].map((ch) => ch.charCodeAt(0)), 16);
  return new Blob([bytes], { type: 'image/heic' });
};

describe('imageOriginal', () => {
  let createdBlobs: Blob[];
  let probe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createdBlobs = [];
    probe = vi.fn().mockRejectedValue(new Error('unsupported'));
    globalThis.createImageBitmap = probe as unknown as typeof createImageBitmap;
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

  it('skips probing for non-HEIC and caches native support only for real HEIF containers', async () => {
    mocks.downloadCachedAttachment.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));
    expect(await load('mxc://ex/png', 'image/png')).toEqual({ src: 'blob:img-1' });
    expect(probe).not.toHaveBeenCalled();

    const close = vi.fn();
    probe.mockResolvedValue({ close });
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/heic' });
    const signal = new AbortController().signal;
    mocks.downloadCachedAttachment
      .mockResolvedValueOnce(jpeg)
      .mockResolvedValueOnce(makeHeicBlob('heic'))
      .mockResolvedValueOnce(makeHeicBlob('mif1'));

    await load('mxc://ex/jpg');
    await load('mxc://ex/h1');
    await load('mxc://ex/h2', 'image/heic', signal);

    // Mislabeled JPEG did not cache native support; h1 did, so h2 skipped probing while keeping cap+signal.
    expect(probe).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
    expect(mocks.decodeHeicBlob).not.toHaveBeenCalled();
    expect(mocks.downloadCachedAttachment).toHaveBeenLastCalledWith(
      mx,
      expect.objectContaining({ mxcUri: 'mxc://ex/h2' }),
      { signal, maxBytes: MAX_HEIC_BYTES }
    );
  });

  it('caches only completed conversions so one abort cannot cancel another consumer', async () => {
    const heic = makeHeicBlob();
    const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });
    mocks.downloadCachedAttachment.mockResolvedValue(heic);
    mocks.decodeHeicBlob.mockImplementation(
      (_blob: Blob, sig?: AbortSignal) =>
        new Promise<Blob>((resolve, reject) =>
          sig
            ? sig.addEventListener(
                'abort',
                () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
                { once: true }
              )
            : resolve(jpeg)
        )
    );

    const tileAbort = new AbortController();
    const tile = load('mxc://ex/shared', 'image/heic', tileAbort.signal);
    await vi.waitFor(() => expect(mocks.decodeHeicBlob).toHaveBeenCalledTimes(1));
    const viewer = load('mxc://ex/shared');
    tileAbort.abort();
    await expect(tile).rejects.toThrow(/aborted/i);
    expect(await viewer).toEqual({ src: 'blob:img-1', downloadBlob: heic });
    expect(createdBlobs[0]).toBe(jpeg);

    expect(await load('mxc://ex/shared')).toEqual({ src: 'blob:img-2', downloadBlob: heic });
    expect(mocks.decodeHeicBlob).toHaveBeenCalledTimes(2);
  });

  it('wraps decode/budget errors in HeicDecodeError without caching and preserves network errors', async () => {
    const corrupt = makeHeicBlob();
    mocks.downloadCachedAttachment.mockResolvedValueOnce(corrupt);
    mocks.decodeHeicBlob.mockRejectedValueOnce(new Error('Invalid HEIF box'));
    const decodeErr = await load('mxc://ex/bad', 'image/heif').catch((e: unknown) => e);
    expect(decodeErr).toBeInstanceOf(HeicDecodeError);
    expect((decodeErr as HeicDecodeError).message).toBe('Invalid HEIF box');
    expect((decodeErr as HeicDecodeError).originalBlob).toBe(corrupt);

    mocks.downloadCachedAttachment.mockRejectedValueOnce(
      new Error(`Attachment exceeds the ${MAX_HEIC_BYTES} byte limit`)
    );
    await expect(load('mxc://ex/huge')).rejects.toBeInstanceOf(HeicDecodeError);

    mocks.downloadCachedAttachment.mockRejectedValueOnce(new Error('offline'));
    const netErr = await load('mxc://ex/net').catch((e: unknown) => e);
    expect(netErr).toBeInstanceOf(Error);
    expect(netErr).not.toBeInstanceOf(HeicDecodeError);
  });
});
