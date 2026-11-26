import { randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canZipOversizedFile, MAX_ZIP32_FILE_BYTES } from './mediaCompressionEligibility';
import { zipFile, type ZipFileResult } from './zipFile';

const withSize = (file: File, size: number): File => {
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

const parseZipResult = async (result: ZipFileResult) => {
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`);
  const bytes = new Uint8Array(await result.file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Local File Header
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  expect(view.getUint16(4, true)).toBe(20);
  const flags = view.getUint16(6, true);
  const method = view.getUint16(8, true);
  const dosTime = view.getUint16(10, true);
  const dosDate = view.getUint16(12, true);
  const crc32 = view.getUint32(14, true);
  const compressedSize = view.getUint32(18, true);
  const uncompressedSize = view.getUint32(22, true);
  const nameLen = view.getUint16(26, true);
  expect(view.getUint16(28, true)).toBe(0);

  const entryName = new TextDecoder().decode(bytes.subarray(30, 30 + nameLen));
  const dataStart = 30 + nameLen;
  const cdOffset = dataStart + compressedSize;
  const cdSize = 46 + nameLen;

  // Central Directory Header matches Local File Header fields & filename verbatim
  expect(view.getUint32(cdOffset, true)).toBe(0x02014b50);
  expect(view.getUint16(cdOffset + 4, true)).toBe(20);
  expect(bytes.subarray(cdOffset + 6, cdOffset + 30)).toEqual(bytes.subarray(4, 28));
  expect(view.getUint32(cdOffset + 42, true)).toBe(0);
  expect(bytes.subarray(cdOffset + 46, cdOffset + cdSize)).toEqual(bytes.subarray(30, dataStart));

  // End of Central Directory Record
  const eocdOffset = cdOffset + cdSize;
  expect(bytes.byteLength).toBe(eocdOffset + 22);
  expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);
  expect(view.getUint16(eocdOffset + 8, true)).toBe(1);
  expect(view.getUint16(eocdOffset + 10, true)).toBe(1);
  expect(view.getUint32(eocdOffset + 12, true)).toBe(cdSize);
  expect(view.getUint32(eocdOffset + 16, true)).toBe(cdOffset);
  expect(view.getUint16(eocdOffset + 20, true)).toBe(0);

  return {
    file: result.file,
    originalSize: result.originalSize,
    compressedSize: result.compressedSize,
    entryName,
    flags,
    method,
    dosTime,
    dosDate,
    crc32,
    uncompressedSize,
    inflated: inflateRawSync(bytes.subarray(dataStart, cdOffset)),
  };
};

describe('zipFile', () => {
  it('produces a valid PKZIP 2.0 archive that inflates back to exact multi-chunk bytes with progress', async () => {
    const payload = Buffer.from('MindRoom log line 2026-11-25 INFO ok\n'.repeat(8000), 'utf8');
    const lastModified = new Date(2026, 10, 25, 14, 32, 10).getTime();
    const file = new File([payload], 'server.log', { type: 'text/plain', lastModified });
    const progress: number[] = [];

    const parsed = await parseZipResult(
      await zipFile(file, { maxOutputBytes: 64 * 1024, onProgress: (p) => progress.push(p) })
    );
    expect(parsed.file.name).toBe('server.log.zip');
    expect(parsed.file.type).toBe('application/zip');
    expect(parsed.file.lastModified).toBe(lastModified);
    expect(parsed.originalSize).toBe(payload.byteLength);
    expect(parsed.compressedSize).toBe(parsed.file.size);
    expect(parsed.compressedSize).toBeLessThan(payload.byteLength);
    expect(progress.at(-1)).toBe(1);
    expect(parsed.entryName).toBe('server.log');
    expect(parsed.flags).toBe(0x0800);
    expect(parsed.method).toBe(8);
    expect(parsed.uncompressedSize).toBe(payload.byteLength);
    expect(parsed.dosDate).toBe(((2026 - 1980) << 9) | (11 << 5) | 25);
    expect(parsed.dosTime).toBe((14 << 11) | (32 << 5) | 5);
    expect(parsed.inflated.equals(payload)).toBe(true);
  });

  it('handles UTF-8 names, path sanitization, empty/dot fallbacks, CRC-32 check vector, empty input, and pre-1980 dates', async () => {
    const vector = await parseZipResult(
      await zipFile(new File(['123456789'], 'dir/sub\\日本語.txt', { lastModified: 0 }), {
        maxOutputBytes: 4096,
      })
    );
    expect(vector.file.name).toBe('dir_sub_日本語.txt.zip');
    expect(vector.entryName).toBe('dir_sub_日本語.txt');
    expect(vector.crc32).toBe(0xcbf43926);
    expect(vector.dosDate).toBe(0x0021);
    expect(vector.dosTime).toBe(0);
    expect(vector.inflated.toString('utf8')).toBe('123456789');

    const empty = await parseZipResult(await zipFile(new File([], '..'), { maxOutputBytes: 4096 }));
    expect(empty.file.name).toBe('file.zip');
    expect(empty.entryName).toBe('file');
    expect(empty.crc32).toBe(0);
    expect(empty.uncompressedSize).toBe(0);
    expect(empty.inflated.byteLength).toBe(0);
  });

  it('aborts early when compressed output exceeds maxOutputBytes or makes no savings on incompressible data', async () => {
    const chunks = Array.from({ length: 16 }, () => new Uint8Array(randomBytes(32 * 1024)));
    let pulled = 0;
    const makeStreamedFile = (name: string): File => {
      pulled = 0;
      let index = 0;
      const file = withSize(new File([], name), chunks.length * 32 * 1024);
      file.stream = () =>
        new ReadableStream<Uint8Array<ArrayBuffer>>({
          pull(controller) {
            const next = chunks[index++];
            if (!next) return controller.close();
            pulled += 1;
            controller.enqueue(new Uint8Array(next));
          },
        });
      return file;
    };

    expect(await zipFile(makeStreamedFile('random.bin'), { maxOutputBytes: 48 * 1024 })).toEqual({
      status: 'too-large',
    });
    expect(pulled).toBeLessThan(chunks.length);
    expect(await zipFile(makeStreamedFile('incompressible.bin'))).toEqual({ status: 'no-savings' });
  });

  it('respects AbortSignal mid-stream and rejects files at or above the ZIP32 4 GiB limit', async () => {
    const controller = new AbortController();
    let cancelled = false;
    let reads = 0;
    const slowFile = withSize(new File([], 'slow.log'), 256 * 1024);
    slowFile.stream = () =>
      new ReadableStream<Uint8Array<ArrayBuffer>>({
        pull(streamController) {
          if (++reads === 1) streamController.enqueue(new Uint8Array(64 * 1024));
          else controller.abort();
        },
        cancel() {
          cancelled = true;
        },
      });

    expect(await zipFile(slowFile, { signal: controller.signal })).toEqual({ status: 'aborted' });
    expect(cancelled).toBe(true);

    const preAborted = new AbortController();
    preAborted.abort();
    expect(await zipFile(new File(['abc'], 'a.txt'), { signal: preAborted.signal })).toEqual({
      status: 'aborted',
    });
    expect(
      await zipFile(withSize(new File(['x'], 'huge.bin'), MAX_ZIP32_FILE_BYTES), {
        maxOutputBytes: 1024,
      })
    ).toEqual({ status: 'error' });
  });
});

describe('canZipOversizedFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows non-archive non-empty files under ZIP32 and excludes already-compressed archives', () => {
    const sized = (name: string, type: string, size = 60 * 1024 * 1024) =>
      withSize(new File(['x'], name, { type }), size);

    expect(canZipOversizedFile(sized('app.log', 'text/plain'))).toBe(true);
    expect(canZipOversizedFile(sized('backup.tar', 'application/x-tar'))).toBe(true);
    expect(canZipOversizedFile(sized('empty.txt', 'text/plain', 0))).toBe(false);
    expect(canZipOversizedFile(sized('huge.bin', '', MAX_ZIP32_FILE_BYTES))).toBe(false);
    for (const ext of ['zip', 'gz', 'gzip', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar', 'lz4', 'br']) {
      expect(
        canZipOversizedFile(sized(`bundle.${ext.toUpperCase()}`, 'application/octet-stream'))
      ).toBe(false);
    }
    expect(canZipOversizedFile(sized('blob', 'application/zip'))).toBe(false);
    expect(canZipOversizedFile(sized('blob', 'application/x-gzip; charset=binary'))).toBe(false);

    vi.stubGlobal('CompressionStream', undefined);
    expect(canZipOversizedFile(sized('app.log', 'text/plain'))).toBe(false);
  });
});
