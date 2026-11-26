import { randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canZipOversizedFile, MAX_ZIP32_FILE_BYTES } from './mediaCompressionEligibility';
import { zipFile } from './zipFile';

type ParsedZip = {
  entryName: string;
  flags: number;
  method: number;
  dosTime: number;
  dosDate: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  inflated: Buffer;
};

const parseSingleEntryZip = (bytes: Uint8Array): ParsedZip => {
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

  // Central Directory Header matches Local File Header
  expect(view.getUint32(cdOffset, true)).toBe(0x02014b50);
  expect(view.getUint16(cdOffset + 4, true)).toBe(20);
  expect(view.getUint16(cdOffset + 6, true)).toBe(20);
  expect(view.getUint16(cdOffset + 8, true)).toBe(flags);
  expect(view.getUint16(cdOffset + 10, true)).toBe(method);
  expect(view.getUint16(cdOffset + 12, true)).toBe(dosTime);
  expect(view.getUint16(cdOffset + 14, true)).toBe(dosDate);
  expect(view.getUint32(cdOffset + 16, true)).toBe(crc32);
  expect(view.getUint32(cdOffset + 20, true)).toBe(compressedSize);
  expect(view.getUint32(cdOffset + 24, true)).toBe(uncompressedSize);
  expect(view.getUint16(cdOffset + 28, true)).toBe(nameLen);
  expect(view.getUint32(cdOffset + 42, true)).toBe(0);
  expect(new TextDecoder().decode(bytes.subarray(cdOffset + 46, cdOffset + cdSize))).toBe(
    entryName
  );

  // End of Central Directory Record
  const eocdOffset = cdOffset + cdSize;
  expect(bytes.byteLength).toBe(eocdOffset + 22);
  expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);
  expect(view.getUint16(eocdOffset + 8, true)).toBe(1);
  expect(view.getUint16(eocdOffset + 10, true)).toBe(1);
  expect(view.getUint32(eocdOffset + 12, true)).toBe(cdSize);
  expect(view.getUint32(eocdOffset + 16, true)).toBe(cdOffset);
  expect(view.getUint16(eocdOffset + 20, true)).toBe(0);

  const inflated = inflateRawSync(bytes.subarray(dataStart, cdOffset));
  return {
    entryName,
    flags,
    method,
    dosTime,
    dosDate,
    crc32,
    compressedSize,
    uncompressedSize,
    inflated,
  };
};

describe('zipFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('produces a valid PKZIP 2.0 archive that inflates back to exact multi-chunk bytes with progress', async () => {
    const payload = Buffer.from('MindRoom log line 2026-11-25 INFO ok\n'.repeat(8000), 'utf8');
    const lastModified = new Date(2026, 10, 25, 14, 32, 10).getTime();
    const file = new File([payload], 'server.log', { type: 'text/plain', lastModified });
    const progress: number[] = [];

    const result = await zipFile(file, {
      maxOutputBytes: 64 * 1024,
      onProgress: (p) => progress.push(p),
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.file.name).toBe('server.log.zip');
    expect(result.file.type).toBe('application/zip');
    expect(result.file.lastModified).toBe(lastModified);
    expect(result.originalSize).toBe(payload.byteLength);
    expect(result.compressedSize).toBe(result.file.size);
    expect(result.compressedSize).toBeLessThan(payload.byteLength);
    expect(progress.at(-1)).toBe(1);

    const parsed = parseSingleEntryZip(new Uint8Array(await result.file.arrayBuffer()));
    expect(parsed.entryName).toBe('server.log');
    expect(parsed.flags).toBe(0x0800);
    expect(parsed.method).toBe(8);
    expect(parsed.uncompressedSize).toBe(payload.byteLength);
    expect(parsed.dosDate).toBe(((2026 - 1980) << 9) | (11 << 5) | 25);
    expect(parsed.dosTime).toBe((14 << 11) | (32 << 5) | 5);
    expect(parsed.inflated.equals(payload)).toBe(true);
  });

  it('handles UTF-8 names, path sanitization, empty/dot fallbacks, CRC-32 check vector, empty input, and pre-1980 dates', async () => {
    const vectorFile = new File(['123456789'], 'dir/sub\\日本語.txt', {
      type: 'text/plain',
      lastModified: 0,
    });
    const vectorRes = await zipFile(vectorFile, { maxOutputBytes: 4096 });
    expect(vectorRes.status).toBe('ok');
    if (vectorRes.status !== 'ok') return;
    expect(vectorRes.file.name).toBe('dir_sub_日本語.txt.zip');

    const vectorZip = parseSingleEntryZip(new Uint8Array(await vectorRes.file.arrayBuffer()));
    expect(vectorZip.entryName).toBe('dir_sub_日本語.txt');
    expect(vectorZip.crc32).toBe(0xcbf43926);
    expect(vectorZip.dosDate).toBe(0x0021);
    expect(vectorZip.dosTime).toBe(0);
    expect(vectorZip.inflated.toString('utf8')).toBe('123456789');

    const emptyFile = new File([], '..', { type: 'application/octet-stream' });
    const emptyRes = await zipFile(emptyFile, { maxOutputBytes: 4096 });
    expect(emptyRes.status).toBe('ok');
    if (emptyRes.status !== 'ok') return;
    expect(emptyRes.file.name).toBe('file.zip');
    const emptyZip = parseSingleEntryZip(new Uint8Array(await emptyRes.file.arrayBuffer()));
    expect(emptyZip.entryName).toBe('file');
    expect(emptyZip.crc32).toBe(0);
    expect(emptyZip.uncompressedSize).toBe(0);
    expect(emptyZip.inflated.byteLength).toBe(0);
  });

  it('aborts early when compressed output exceeds maxOutputBytes or makes no savings on incompressible data', async () => {
    const chunks = Array.from({ length: 16 }, () => new Uint8Array(randomBytes(32 * 1024)));
    let pulled = 0;
    const makeStreamedFile = (name: string): File => {
      pulled = 0;
      const file = new File([], name, { type: 'application/octet-stream' });
      Object.defineProperty(file, 'size', { value: chunks.length * 32 * 1024 });
      let index = 0;
      file.stream = () =>
        new ReadableStream<Uint8Array<ArrayBuffer>>({
          pull(controller) {
            const next = chunks[index];
            index += 1;
            if (!next) {
              controller.close();
              return;
            }
            pulled += 1;
            controller.enqueue(new Uint8Array(next));
          },
        });
      return file;
    };

    const tooLarge = await zipFile(makeStreamedFile('random.bin'), { maxOutputBytes: 48 * 1024 });
    expect(tooLarge).toEqual({ status: 'too-large' });
    expect(pulled).toBeLessThan(chunks.length);

    const noSavings = await zipFile(makeStreamedFile('incompressible.bin'));
    expect(noSavings).toEqual({ status: 'no-savings' });
  });

  it('respects AbortSignal mid-stream and rejects files at or above the ZIP32 4 GiB limit', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const slowFile = new File([], 'slow.log', { type: 'text/plain' });
    Object.defineProperty(slowFile, 'size', { value: 256 * 1024 });
    let reads = 0;
    slowFile.stream = () =>
      new ReadableStream<Uint8Array<ArrayBuffer>>({
        pull(streamController) {
          reads += 1;
          if (reads === 1) {
            streamController.enqueue(new Uint8Array(64 * 1024));
            return;
          }
          controller.abort();
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

    const hugeFile = new File(['x'], 'huge.bin');
    Object.defineProperty(hugeFile, 'size', { value: MAX_ZIP32_FILE_BYTES });
    expect(await zipFile(hugeFile, { maxOutputBytes: 1024 })).toEqual({ status: 'error' });
  });
});

describe('canZipOversizedFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows non-archive non-empty files under ZIP32 and excludes already-compressed archives', () => {
    const sized = (name: string, type: string, size = 60 * 1024 * 1024) => {
      const f = new File(['x'], name, { type });
      Object.defineProperty(f, 'size', { value: size });
      return f;
    };

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
