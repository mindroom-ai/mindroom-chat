/**
 * Streams a single File through native `CompressionStream('deflate-raw')` and wraps the
 * compressed bytes in a valid PKZIP 2.0 archive (`<name>.zip`) without buffering the uncompressed
 * source in memory.
 */

export type ZipFileOptions = {
  /** Maximum allowed total `.zip` archive size in bytes (for example `maxUploadSize`). */
  maxOutputBytes?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

export type ZipFileResult =
  | { status: 'ok'; file: File; originalSize: number; compressedSize: number }
  | { status: 'too-large' | 'no-savings' | 'aborted' | 'error' };

type StopReason = 'too-large' | 'no-savings' | 'aborted' | 'error';

const MAX_ZIP32_BYTES = 0xffffffff;
const PROGRESS_THROTTLE_MS = 100;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

const updateCrc32 = (crc: number, chunk: Uint8Array): number => {
  let c = crc;
  for (let i = 0; i < chunk.byteLength; i += 1)
    c = CRC32_TABLE[(c ^ chunk[i]!) & 0xff]! ^ (c >>> 8);
  return c;
};

const sanitizeEntryName = (name: string): string => {
  const cleaned = name.replace(/[/\\]/g, '_').replace(/^\.+$/, '');
  return cleaned.length > 0 ? cleaned : 'file';
};

const toDosDateTime = (lastModified: number): { dosTime: number; dosDate: number } => {
  const date = new Date(Number.isFinite(lastModified) ? lastModified : Date.now());
  const year = date.getFullYear();
  if (year < 1980) return { dosTime: 0, dosDate: 0x0021 };
  if (year > 2107) return { dosTime: 0xbf7d, dosDate: 0xff9f };
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

/** Compresses `file` into a single-entry PKZIP 2.0 `.zip` file using `deflate-raw`. */
export const zipFile = async (file: File, options: ZipFileOptions = {}): Promise<ZipFileResult> => {
  const { maxOutputBytes, signal, onProgress } = options;
  if (signal?.aborted) return { status: 'aborted' };
  if (typeof CompressionStream !== 'function' || file.size >= MAX_ZIP32_BYTES) {
    return { status: 'error' };
  }

  const entryName = sanitizeEntryName(file.name);
  const nameBytes = new TextEncoder().encode(entryName);
  if (nameBytes.byteLength > 0xffff) return { status: 'error' };

  const localHeaderSize = LOCAL_HEADER_SIZE + nameBytes.byteLength;
  const centralHeaderSize = CENTRAL_HEADER_SIZE + nameBytes.byteLength;
  const overhead = localHeaderSize + centralHeaderSize + EOCD_SIZE;
  const maxZip32Compressed = MAX_ZIP32_BYTES - 1 - localHeaderSize;

  let maxAllowedCompressed: number;
  let breachReason: 'too-large' | 'no-savings';
  if (maxOutputBytes !== undefined) {
    if (Number.isNaN(maxOutputBytes) || maxOutputBytes < overhead) return { status: 'too-large' };
    maxAllowedCompressed = maxOutputBytes - overhead;
    breachReason = 'too-large';
  } else {
    if (file.size <= overhead) return { status: 'no-savings' };
    maxAllowedCompressed = file.size - 1 - overhead;
    breachReason = 'no-savings';
  }

  let stream: CompressionStream;
  try {
    stream = new CompressionStream('deflate-raw');
  } catch {
    return { status: 'error' };
  }

  const sourceReader = file.stream().getReader();
  const writer = stream.writable.getWriter();
  const compressedReader = stream.readable.getReader();

  let stopReason: StopReason | undefined;
  const stop = (reason: StopReason) => {
    if (stopReason) return;
    stopReason = reason;
    void sourceReader.cancel().catch(() => undefined);
    void writer.abort().catch(() => undefined);
    void compressedReader.cancel().catch(() => undefined);
  };
  const shouldStop = (): boolean => {
    if (stopReason) return true;
    if (signal?.aborted) {
      stop('aborted');
      return true;
    }
    return false;
  };

  const onAbort = () => stop('aborted');
  signal?.addEventListener('abort', onAbort, { once: true });

  let lastProgressAt = -Infinity;
  let lastEmitted = -1;
  const emitProgress = (raw: number, force = false) => {
    if (!onProgress || stopReason || signal?.aborted) return;
    const clamped = Math.min(1, Math.max(0, raw));
    const now = Date.now();
    if (
      (!force && now - lastProgressAt < PROGRESS_THROTTLE_MS) ||
      (force && clamped === lastEmitted)
    ) {
      return;
    }
    lastProgressAt = now;
    lastEmitted = clamped;
    onProgress(clamped);
  };

  let crc = 0xffffffff;
  let bytesRead = 0;
  let compressedBytes = 0;
  const compressedChunks: Uint8Array<ArrayBuffer>[] = [];

  const pumpInput = async (): Promise<void> => {
    try {
      while (!shouldStop()) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await sourceReader.read();
        if (done || shouldStop()) break;
        if (!value || value.byteLength === 0) continue;
        bytesRead += value.byteLength;
        if (bytesRead >= MAX_ZIP32_BYTES) {
          stop('error');
          return;
        }
        crc = updateCrc32(crc, value);
        if (file.size > 0) emitProgress(bytesRead / file.size);
        // eslint-disable-next-line no-await-in-loop
        await writer.ready;
        if (shouldStop()) return;
        // eslint-disable-next-line no-await-in-loop
        await writer.write(value);
      }
      if (!stopReason) await writer.close();
    } catch {
      if (!stopReason) stop(signal?.aborted ? 'aborted' : 'error');
    }
  };

  const collectOutput = async (): Promise<void> => {
    try {
      while (!shouldStop()) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await compressedReader.read();
        if (done || shouldStop()) break;
        if (!value || value.byteLength === 0) continue;
        compressedBytes += value.byteLength;
        if (compressedBytes > maxZip32Compressed) {
          stop('error');
          return;
        }
        if (compressedBytes > maxAllowedCompressed) {
          stop(breachReason);
          return;
        }
        compressedChunks.push(value);
      }
    } catch {
      if (!stopReason) stop(signal?.aborted ? 'aborted' : 'error');
    }
  };

  try {
    await Promise.all([pumpInput(), collectOutput()]);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  if (stopReason) return { status: stopReason };
  if (signal?.aborted) return { status: 'aborted' };

  const totalBytes = overhead + compressedBytes;
  if (maxOutputBytes !== undefined && totalBytes > maxOutputBytes) return { status: 'too-large' };
  if (maxOutputBytes === undefined && totalBytes >= bytesRead) return { status: 'no-savings' };

  emitProgress(1, true);
  const crc32 = (crc ^ 0xffffffff) >>> 0;
  const { dosTime, dosDate } = toDosDateTime(file.lastModified);

  const buildHeader = (central: boolean): Uint8Array<ArrayBuffer> => {
    const buf = new Uint8Array(new ArrayBuffer(central ? centralHeaderSize : localHeaderSize));
    const view = new DataView(buf.buffer);
    view.setUint32(0, central ? 0x02014b50 : 0x04034b50, true);
    let o = 4;
    if (central) {
      view.setUint16(o, 20, true);
      o += 2;
    }
    view.setUint16(o, 20, true); // PKZIP 2.0
    view.setUint16(o + 2, 0x0800, true); // UTF-8 filename flag
    view.setUint16(o + 4, 8, true); // Deflate
    view.setUint16(o + 6, dosTime, true);
    view.setUint16(o + 8, dosDate, true);
    view.setUint32(o + 10, crc32, true);
    view.setUint32(o + 14, compressedBytes, true);
    view.setUint32(o + 18, bytesRead, true);
    view.setUint16(o + 22, nameBytes.byteLength, true);
    buf.set(nameBytes, central ? CENTRAL_HEADER_SIZE : LOCAL_HEADER_SIZE);
    return buf;
  };

  const eocd = new Uint8Array(new ArrayBuffer(EOCD_SIZE));
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, 1, true);
  eocdView.setUint16(10, 1, true);
  eocdView.setUint32(12, centralHeaderSize, true);
  eocdView.setUint32(16, localHeaderSize + compressedBytes, true);

  const zippedFile = new File(
    [buildHeader(false), ...compressedChunks, buildHeader(true), eocd],
    `${entryName}.zip`,
    { type: 'application/zip', lastModified: file.lastModified }
  );
  return {
    status: 'ok',
    file: zippedFile,
    originalSize: bytesRead,
    compressedSize: zippedFile.size,
  };
};
