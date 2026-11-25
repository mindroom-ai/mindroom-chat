import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadImageElement: vi.fn(),
}));

vi.mock('../dom', async () => {
  const actual = await vi.importActual<typeof import('../dom')>('../dom');
  return { ...actual, loadImageElement: mocks.loadImageElement };
});

import { resetWebpEncodeSupportForTest } from '../dom';
import { compressImage } from './compressImage';

const BALANCED = { maxLongEdge: 2048, quality: 0.84 };
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const asciiBytes = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(text, (char) => char.charCodeAt(0));

const concatBytes = (parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
};

const pngChunk = (type: string, dataLength: number): Uint8Array<ArrayBuffer> => {
  const chunk = new Uint8Array(12 + dataLength);
  new DataView(chunk.buffer).setUint32(0, dataLength, false);
  chunk.set(asciiBytes(type), 4);
  return chunk;
};

const makePng = (
  chunks: Uint8Array[],
  name = 'screenshot.png',
  lastModified = 1_700_000_000_000
): File =>
  new File([concatBytes([Uint8Array.from(PNG_SIGNATURE), ...chunks])], name, {
    type: 'image/png',
    lastModified,
  });

const makeStaticPng = (totalBytes = 64 * 1024, name = 'screenshot.png', lastModified?: number) => {
  const ihdr = pngChunk('IHDR', 13);
  const iend = pngChunk('IEND', 0);
  const idatSize = Math.max(1, totalBytes - (PNG_SIGNATURE.length + ihdr.byteLength + 12 + 12));
  return makePng([ihdr, pngChunk('IDAT', idatSize), iend], name, lastModified);
};

const makeApng = (totalBytes = 64 * 1024): File => {
  const ihdr = pngChunk('IHDR', 13);
  const actl = pngChunk('acTL', 8);
  const idatSize = Math.max(1, totalBytes - 8 - ihdr.byteLength - actl.byteLength - 24);
  return makePng([ihdr, actl, pngChunk('IDAT', idatSize), pngChunk('IEND', 0)], 'animated.png');
};

const riffChunk = (fourCC: string, payload: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
  out.set(asciiBytes(fourCC), 0);
  new DataView(out.buffer).setUint32(4, payload.byteLength, true);
  out.set(payload, 8);
  return out;
};

const makeWebp = (chunks: Uint8Array[], name = 'photo.webp'): File => {
  const body = concatBytes(chunks);
  const header = new Uint8Array(12);
  header.set(asciiBytes('RIFF'), 0);
  new DataView(header.buffer).setUint32(4, 4 + body.byteLength, true);
  header.set(asciiBytes('WEBP'), 8);
  return new File([concatBytes([header, body])], name, { type: 'image/webp' });
};

const makeStaticWebp = (mode: 'vp8' | 'vp8l' | 'vp8x-icc', totalBytes = 64 * 1024): File => {
  if (mode === 'vp8x-icc') {
    const vp8x = new Uint8Array(10);
    vp8x[0] = 0x20; // ICC profile flag; animation bit (0x02) stays 0.
    return makeWebp([
      riffChunk('VP8X', vp8x),
      riffChunk('ICCP', new Uint8Array(512)),
      riffChunk('VP8 ', new Uint8Array(Math.max(16, totalBytes - 560))),
    ]);
  }
  return makeWebp([
    riffChunk(mode === 'vp8l' ? 'VP8L' : 'VP8 ', new Uint8Array(Math.max(16, totalBytes - 20))),
  ]);
};

const makeAnimatedWebp = (mode: 'vp8x-flag' | 'anim-chunk' | 'anim-first'): File => {
  const frame = riffChunk('ANMF', new Uint8Array(64 * 1024));
  if (mode === 'anim-first') return makeWebp([riffChunk('ANIM', new Uint8Array(6)), frame]);
  const vp8x = new Uint8Array(10);
  if (mode === 'vp8x-flag') {
    vp8x[0] = 0x02;
    return makeWebp([riffChunk('VP8X', vp8x), frame]);
  }
  return makeWebp([riffChunk('VP8X', vp8x), riffChunk('ANIM', new Uint8Array(6)), frame]);
};

const makeJpeg = (
  totalBytes = 64 * 1024,
  name = 'photo.final.jpeg',
  lastModified = 1_700_000_500
) => new File([new Uint8Array(totalBytes)], name, { type: 'image/jpeg', lastModified });

type MockCanvas = {
  width: number;
  height: number;
  ctx: {
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: ImageSmoothingQuality;
    drawImage: ReturnType<typeof vi.fn>;
    getImageData: ReturnType<typeof vi.fn>;
  };
  recordedDrawSizes: Array<{ width: number; height: number }>;
  getContext: ReturnType<typeof vi.fn>;
  toDataURL: ReturnType<typeof vi.fn>;
  toBlob: ReturnType<typeof vi.fn>;
};

type DomHarnessOptions = {
  supportsWebp?: boolean;
  hasAlphaPixel?: boolean;
  nullContext?: boolean;
  toBlob?: (mimeType: string, quality?: number) => Blob | null;
};

describe('compressImage', () => {
  const originalDocument = globalThis.document;
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;

  const installCanvasDom = (options: DomHarnessOptions = {}) => {
    const canvases: MockCanvas[] = [];
    const supportsWebp = options.supportsWebp ?? true;

    const createCanvas = (): MockCanvas => {
      const recordedDrawSizes: Array<{ width: number; height: number }> = [];
      const ctx = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low' as ImageSmoothingQuality,
        drawImage: vi.fn((_src: unknown, _x: number, _y: number, width: number, height: number) => {
          recordedDrawSizes.push({ width, height });
        }),
        getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => {
          const data = new Uint8ClampedArray(width * height * 4).fill(255);
          if (options.hasAlphaPixel) data[7] = 128;
          return { data, width, height };
        }),
      };
      const canvas: MockCanvas = {
        width: 0,
        height: 0,
        ctx,
        recordedDrawSizes,
        getContext: vi.fn(() => (options.nullContext ? null : ctx)),
        toDataURL: vi.fn((type?: string) =>
          type === 'image/webp' && supportsWebp
            ? 'data:image/webp;base64,AA=='
            : 'data:image/png;base64,AA=='
        ),
        toBlob: vi.fn((cb: BlobCallback, mimeType?: string, quality?: number) => {
          const type = mimeType ?? 'image/png';
          cb(
            options.toBlob
              ? options.toBlob(type, quality)
              : new Blob([new Uint8Array(10_000)], { type })
          );
        }),
      };
      canvases.push(canvas);
      return canvas;
    };

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: vi.fn(() => createCanvas()) },
    });

    return {
      canvases,
      lastWorkCanvas: (): MockCanvas => {
        const work = canvases.filter((c) => c.recordedDrawSizes.length > 0).at(-1);
        if (!work) throw new Error('Expected a canvas with drawImage called');
        return work;
      },
    };
  };

  beforeEach(() => {
    resetWebpEncodeSupportForTest();
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-image');
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetWebpEncodeSupportForTest();
    vi.restoreAllMocks();
    mocks.loadImageElement.mockReset();
    if (originalDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document');
    } else {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
    }
  });

  it('resizes a large static PNG, encodes WebP with updated ext, and cleans up resources', async () => {
    const dom = installCanvasDom({ supportsWebp: true });
    mocks.loadImageElement.mockResolvedValue({ naturalWidth: 4000, naturalHeight: 3000 });
    const source = makeStaticPng(80 * 1024, 'Screen Shot.png', 1_712_345_678_000);

    const result = await compressImage(source, BALANCED);

    expect(result).toBeDefined();
    expect(result?.file.name).toBe('Screen Shot.webp');
    expect(result?.file.type).toBe('image/webp');
    expect(result?.file.lastModified).toBe(1_712_345_678_000);
    expect(result?.originalSize).toBe(source.size);
    expect(result?.compressedSize).toBe(10_000);

    const canvas = dom.lastWorkCanvas();
    expect(canvas.recordedDrawSizes).toEqual([{ width: 2048, height: 1536 }]);
    expect(canvas.ctx.imageSmoothingEnabled).toBe(true);
    expect(canvas.ctx.imageSmoothingQuality).toBe('high');
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.84);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test-image');
  });

  it('never upscales smaller images, scales portraits by height, and handles extensionless names', async () => {
    const dom = installCanvasDom({ supportsWebp: true });

    mocks.loadImageElement.mockResolvedValueOnce({ naturalWidth: 800, naturalHeight: 600 });
    const small = await compressImage(makeStaticPng(60 * 1024, 'clipboard'), BALANCED);
    expect(small?.file.name).toBe('clipboard.webp');
    expect(dom.lastWorkCanvas().recordedDrawSizes).toEqual([{ width: 800, height: 600 }]);

    mocks.loadImageElement.mockResolvedValueOnce({ naturalWidth: 1500, naturalHeight: 3000 });
    const portrait = await compressImage(makeJpeg(60 * 1024, 'portrait.final.jpeg'), {
      maxLongEdge: 1280,
      quality: 0.72,
    });
    expect(portrait?.file.name).toBe('portrait.final.webp');
    expect(dom.lastWorkCanvas().recordedDrawSizes).toEqual([{ width: 640, height: 1280 }]);
  });

  it('compresses static WebP variants (VP8, VP8L, and extended VP8X with ICC)', async () => {
    installCanvasDom({ supportsWebp: true });
    mocks.loadImageElement.mockResolvedValue({ naturalWidth: 2560, naturalHeight: 1440 });

    for (const mode of ['vp8', 'vp8l', 'vp8x-icc'] as const) {
      const result = await compressImage(makeStaticWebp(mode), BALANCED);
      expect(result?.file.type).toBe('image/webp');
      expect(result?.file.name).toBe('photo.webp');
    }
  });

  it('falls back to JPEG for opaque images and PNG for transparent images when WebP is unsupported', async () => {
    const opaqueDom = installCanvasDom({ supportsWebp: false, hasAlphaPixel: false });
    mocks.loadImageElement.mockResolvedValue({ naturalWidth: 2000, naturalHeight: 1000 });

    const pngResult = await compressImage(makeStaticPng(80 * 1024, 'opaque.png'), BALANCED);
    expect(pngResult?.file.type).toBe('image/jpeg');
    expect(pngResult?.file.name).toBe('opaque.jpg');
    expect(opaqueDom.lastWorkCanvas().ctx.getImageData).toHaveBeenCalledWith(0, 0, 2000, 1000);
    expect(opaqueDom.lastWorkCanvas().toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/jpeg',
      0.84
    );

    const jpegResult = await compressImage(makeJpeg(80 * 1024, 'camera.jpeg'), BALANCED);
    expect(jpegResult?.file.type).toBe('image/jpeg');
    expect(jpegResult?.file.name).toBe('camera.jpg');
    expect(opaqueDom.lastWorkCanvas().ctx.getImageData).not.toHaveBeenCalled();

    resetWebpEncodeSupportForTest();
    const alphaDom = installCanvasDom({ supportsWebp: false, hasAlphaPixel: true });
    const alphaResult = await compressImage(makeStaticPng(80 * 1024, 'shadow.png'), BALANCED);
    expect(alphaResult?.file.type).toBe('image/png');
    expect(alphaResult?.file.name).toBe('shadow.png');
    expect(alphaDom.lastWorkCanvas().toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/png',
      undefined
    );
  });

  it('recovers when WebKit silently returns image/png for an image/webp toBlob request', async () => {
    const dom = installCanvasDom({
      supportsWebp: true,
      hasAlphaPixel: false,
      toBlob: (mimeType) =>
        mimeType === 'image/webp'
          ? new Blob([new Uint8Array(90_000)], { type: 'image/png' })
          : new Blob([new Uint8Array(12_000)], { type: mimeType }),
    });
    mocks.loadImageElement.mockResolvedValue({ naturalWidth: 2000, naturalHeight: 1500 });

    const result = await compressImage(makeStaticPng(80 * 1024, 'retina.png'), BALANCED);

    expect(result?.file.type).toBe('image/jpeg');
    expect(result?.file.name).toBe('retina.jpg');
    expect(result?.compressedSize).toBe(12_000);
    expect(dom.lastWorkCanvas().toBlob).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      'image/webp',
      0.84
    );
    expect(dom.lastWorkCanvas().toBlob).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      'image/jpeg',
      0.84
    );
  });

  it('skips APNG, animated WebP, and malformed PNG/WebP headers without decoding', async () => {
    installCanvasDom({ supportsWebp: true });

    const truncatedWebpBytes = new Uint8Array(40 * 1024);
    truncatedWebpBytes.set(asciiBytes('RIFF'), 0);
    new DataView(truncatedWebpBytes.buffer).setUint32(4, truncatedWebpBytes.byteLength - 8, true);
    truncatedWebpBytes.set(asciiBytes('WEBP'), 8);
    truncatedWebpBytes.set(asciiBytes('VP8 '), 12);
    new DataView(truncatedWebpBytes.buffer).setUint32(16, 100 * 1024, true);

    const skippedFiles = [
      makeApng(),
      new File([new Uint8Array(64 * 1024)], 'explicit.apng', { type: 'image/apng' }),
      makeAnimatedWebp('vp8x-flag'),
      makeAnimatedWebp('anim-chunk'),
      makeAnimatedWebp('anim-first'),
      new File([new Uint8Array(40 * 1024)], 'bad-sig.png', { type: 'image/png' }),
      makePng(
        [pngChunk('IHDR', 13), pngChunk('IEND', 0), new Uint8Array(40 * 1024)],
        'no-idat.png'
      ),
      makePng([pngChunk('IDAT', 40 * 1024), pngChunk('IEND', 0)], 'missing-ihdr.png'),
      makePng(
        [pngChunk('IHDR', 13), pngChunk('tEXt', 70 * 1024), pngChunk('IDAT', 1024)],
        'huge-meta.png'
      ),
      makePng(
        [
          Uint8Array.from([0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]),
          new Uint8Array(40 * 1024),
        ],
        'corrupt.png'
      ),
      new File([new Uint8Array(40 * 1024)], 'bad-magic.webp', { type: 'image/webp' }),
      makeWebp([riffChunk('JUNK', new Uint8Array(40 * 1024))], 'junk.webp'),
      makeWebp(
        [riffChunk('VP8X', new Uint8Array(6)), riffChunk('VP8 ', new Uint8Array(40 * 1024))],
        'bad-vp8x.webp'
      ),
      new File([truncatedWebpBytes], 'truncated.webp', { type: 'image/webp' }),
    ];

    for (const file of skippedFiles) {
      expect(await compressImage(file, BALANCED)).toBeUndefined();
    }
    expect(createObjectURLSpy).not.toHaveBeenCalled();
    expect(mocks.loadImageElement).not.toHaveBeenCalled();
  });

  it('skips unsupported MIME types and files under 32 KiB unless exceeding maxUploadSize', async () => {
    installCanvasDom({ supportsWebp: true });
    mocks.loadImageElement.mockResolvedValue({ naturalWidth: 500, naturalHeight: 500 });

    const skipped = [
      new File([new Uint8Array(64 * 1024)], 'doc.pdf', { type: 'application/pdf' }),
      new File([new Uint8Array(64 * 1024)], 'clip.mp4', { type: 'video/mp4' }),
      new File([new Uint8Array(64 * 1024)], 'unknown.bin', { type: '' }),
      new File([new Uint8Array(64 * 1024)], 'anim.gif', { type: 'image/gif' }),
      new File([new Uint8Array(64 * 1024)], 'vector.svg', { type: 'image/svg+xml' }),
      new File([new Uint8Array(64 * 1024)], 'favicon.ico', { type: 'image/x-icon' }),
      new File([new Uint8Array(64 * 1024)], 'favicon2.ico', { type: 'image/vnd.microsoft.icon' }),
      new File([new Uint8Array(64 * 1024)], 'animated.avif', { type: 'image/avif' }),
      new File([new Uint8Array(64 * 1024)], 'burst.heics', { type: 'image/heic-sequence' }),
      new File([new Uint8Array(64 * 1024)], 'burst.heifs', { type: 'image/heif-sequence' }),
      makeStaticPng(32 * 1024 - 1, 'tiny.png'),
    ];
    for (const file of skipped) {
      expect(await compressImage(file, BALANCED)).toBeUndefined();
    }
    expect(createObjectURLSpy).not.toHaveBeenCalled();

    const result = await compressImage(makeStaticPng(20 * 1024, 'tiny-over-limit.png'), {
      ...BALANCED,
      maxUploadSize: 15 * 1024,
    });
    expect(result?.file.name).toBe('tiny-over-limit.webp');
    expect(result?.compressedSize).toBe(10_000);
  });

  it('enforces the 5% savings guard and honors the maxUploadSize override', async () => {
    let encodedBytes = 95_000;
    installCanvasDom({
      supportsWebp: true,
      toBlob: (mimeType) => new Blob([new Uint8Array(encodedBytes)], { type: mimeType }),
    });
    mocks.loadImageElement.mockResolvedValue({ naturalWidth: 1600, naturalHeight: 1200 });
    const source = makeJpeg(100_000, 'tight.jpg');

    // Exact 95% boundary and 96% are rejected without maxUploadSize.
    expect(await compressImage(source, BALANCED)).toBeUndefined();
    encodedBytes = 96_000;
    expect(await compressImage(source, BALANCED)).toBeUndefined();

    // 98% brings an oversized 100 KB file under 99 KB maxUploadSize -> kept.
    encodedBytes = 98_000;
    const rescued = await compressImage(source, { ...BALANCED, maxUploadSize: 99_000 });
    expect(rescued?.compressedSize).toBe(98_000);

    // 98% still exceeds 97 KB maxUploadSize -> rejected; 0-byte blob -> rejected.
    expect(await compressImage(source, { ...BALANCED, maxUploadSize: 97_000 })).toBeUndefined();
    encodedBytes = 0;
    expect(await compressImage(source, BALANCED)).toBeUndefined();
  });

  it('revokes object URL and zeroes canvas dimensions on decode, context, and encode errors', async () => {
    const dom = installCanvasDom({
      supportsWebp: true,
      toBlob: () => {
        throw new Error('canvas encode error');
      },
    });
    const source = makeJpeg(64 * 1024, 'photo.heic');

    mocks.loadImageElement.mockRejectedValueOnce(new Error('Could not load image'));
    expect(await compressImage(source, BALANCED)).toBeUndefined();
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);

    mocks.loadImageElement.mockResolvedValueOnce({ naturalWidth: 1600, naturalHeight: 1200 });
    expect(await compressImage(source, BALANCED)).toBeUndefined();
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(2);
    expect(dom.lastWorkCanvas().width).toBe(0);
    expect(dom.lastWorkCanvas().height).toBe(0);

    const nullCtxDom = installCanvasDom({ nullContext: true });
    mocks.loadImageElement.mockResolvedValueOnce({ naturalWidth: 1600, naturalHeight: 1200 });
    expect(await compressImage(source, BALANCED)).toBeUndefined();
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(3);
    expect(nullCtxDom.canvases.at(-1)?.width).toBe(0);
    expect(nullCtxDom.canvases.at(-1)?.height).toBe(0);
  });
});
