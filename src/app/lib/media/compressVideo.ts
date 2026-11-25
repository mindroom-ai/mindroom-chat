import {
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  MATROSKA,
  MP4,
  Mp4OutputFormat,
  Output,
  QTFF,
  WEBM,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';
import { getFileNameWithoutExt, getMimeTypeBase } from '../mimeTypes';

export type CompressVideoOptions = {
  maxLongEdge: number;
  maxFps: number;
  videoBitrate: number;
  maxUploadSize?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

export type CompressedVideoResult = {
  file: File;
  originalSize: number;
  compressedSize: number;
};

const MIN_COMPRESS_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const SAVINGS_RATIO_THRESHOLD = 0.95;
const PROGRESS_THROTTLE_MS = 100;
const FRAME_RATE_PROBE_PACKETS = 120;
const FPS_CAP_TOLERANCE = 1.01;
const INPUT_FORMATS = [MP4, QTFF, WEBM, MATROSKA];
const MP4_PASSTHROUGH_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus']);

let queueTail: Promise<void> = Promise.resolve();

const toEvenDimension = (value: number): number => Math.max(2, Math.round(value / 2) * 2);

const clampProgress = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const enqueueVideoCompression = async <T>(
  signal: AbortSignal | undefined,
  task: () => Promise<T | undefined>
): Promise<T | undefined> => {
  if (signal?.aborted) return undefined;

  const previous = queueTail;
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  queueTail = current;

  if (signal) {
    let onAbort: (() => void) | undefined;
    const abortedWhileQueued = await new Promise<boolean>((resolve) => {
      if (signal.aborted) {
        resolve(true);
        return;
      }
      onAbort = () => resolve(true);
      signal.addEventListener('abort', onAbort, { once: true });
      void previous.then(() => resolve(false));
    });
    if (onAbort) signal.removeEventListener('abort', onAbort);

    if (abortedWhileQueued || signal.aborted) {
      // Wait for the previous job before releasing our slot so later waiters cannot overlap it.
      void previous.finally(release);
      return undefined;
    }
  } else {
    await previous;
  }

  try {
    return await task();
  } finally {
    release();
  }
};

const probeSourceFps = async (videoTrack: InputVideoTrack): Promise<number | undefined> => {
  try {
    const stats = await videoTrack.computePacketStats(FRAME_RATE_PROBE_PACKETS);
    if (
      stats.packetCount >= 2 &&
      Number.isFinite(stats.averagePacketRate) &&
      stats.averagePacketRate > 0
    ) {
      return stats.averagePacketRate;
    }
  } catch {
    // Unknown source fps: omit frameRate so mediabunny preserves original timing without upsampling.
  }
  return undefined;
};

const probeDurationSeconds = async (input: Input): Promise<number | undefined> => {
  try {
    const duration = await input.getDurationFromMetadata();
    if (duration !== null && Number.isFinite(duration) && duration > 0) {
      return duration;
    }
  } catch {
    // Duration metadata may be absent (e.g. MediaRecorder WebM); rely on write and output caps.
  }
  return undefined;
};

const runVideoCompression = async (
  file: File,
  options: CompressVideoOptions,
  targetBitrate: number
): Promise<CompressedVideoResult | undefined> => {
  if (options.signal?.aborted) return undefined;

  const input = new Input({
    formats: INPUT_FORMATS,
    source: new BlobSource(file),
  });

  let conversion: Conversion | undefined;
  let unsubscribeWrite: (() => void) | undefined;
  let onAbort: (() => void) | undefined;
  let exceededOutputCap = false;

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack || !(await videoTrack.canDecode())) return undefined;
    if (options.signal?.aborted) return undefined;

    const displayWidth = await videoTrack.getDisplayWidth();
    const displayHeight = await videoTrack.getDisplayHeight();
    if (
      !Number.isFinite(displayWidth) ||
      !Number.isFinite(displayHeight) ||
      displayWidth <= 0 ||
      displayHeight <= 0
    ) {
      return undefined;
    }

    const durationSeconds = await probeDurationSeconds(input);
    if (durationSeconds !== undefined && (durationSeconds * targetBitrate) / 8 > MAX_OUTPUT_BYTES) {
      return undefined;
    }

    const scale = Math.min(1, options.maxLongEdge / Math.max(displayWidth, displayHeight));
    const targetWidth = toEvenDimension(displayWidth * scale);
    const targetHeight = toEvenDimension(displayHeight * scale);

    const sourceFps = await probeSourceFps(videoTrack);
    const audioTracks = await input.getAudioTracks();
    const audioTrackCodecs = new Map<InputAudioTrack, string | null>();
    let hasIncompatibleAudio = false;
    for (const audioTrack of audioTracks) {
      const codec = await audioTrack.getCodec();
      audioTrackCodecs.set(audioTrack, codec);
      if (!codec || !MP4_PASSTHROUGH_AUDIO_CODECS.has(codec)) {
        hasIncompatibleAudio = true;
      }
    }

    if (options.signal?.aborted) return undefined;

    const videoOptions: ConversionVideoOptions = {
      codec: 'avc',
      bitrate: targetBitrate,
      width: targetWidth,
      height: targetHeight,
      fit: 'contain',
    };
    if (sourceFps !== undefined && sourceFps > options.maxFps * FPS_CAP_TOLERANCE) {
      videoOptions.frameRate = options.maxFps;
    }

    // Leave MP4-compatible audio (aac/mp3/opus) as packet passthrough so AudioEncoder is never
    // required on iOS WKWebView or Linux Chrome. Only request AAC transcoding for other codecs.
    const audioOption: ((track: InputAudioTrack) => ConversionAudioOptions) | undefined =
      hasIncompatibleAudio
        ? (track) => {
            const codec = audioTrackCodecs.get(track);
            return codec && MP4_PASSTHROUGH_AUDIO_CODECS.has(codec) ? {} : { codec: 'aac' };
          }
        : undefined;

    const target = new BufferTarget();
    const outputByteCap = Math.min(MAX_OUTPUT_BYTES, file.size);
    unsubscribeWrite = target.on('write', ({ end }) => {
      if (!exceededOutputCap && end > outputByteCap) {
        exceededOutputCap = true;
        void conversion?.cancel().catch(() => undefined);
      }
    });

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    });

    if (options.signal) {
      onAbort = () => {
        void conversion?.cancel().catch(() => undefined);
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    conversion = await Conversion.init({
      input,
      output,
      video: videoOptions,
      audio: audioOption,
      showWarnings: false,
    });

    const inputAudioTrackSet = new Set<unknown>(audioTracks);
    const hasDiscardedRequiredTrack = conversion.discardedTracks.some(
      (discarded) =>
        discarded.reason !== 'discarded_by_user' &&
        (discarded.track === videoTrack ||
          discarded.track.type === 'audio' ||
          inputAudioTrackSet.has(discarded.track))
    );

    if (options.signal?.aborted || !conversion.isValid || hasDiscardedRequiredTrack) {
      await conversion.cancel();
      return undefined;
    }

    let lastProgressEmitAt = -Infinity;
    let lastEmittedProgress = -1;
    const emitProgress = (rawProgress: number, force = false): void => {
      if (!options.onProgress || options.signal?.aborted) return;
      const clamped = clampProgress(rawProgress);
      const now = Date.now();
      if (!force && now - lastProgressEmitAt < PROGRESS_THROTTLE_MS) return;
      if (force && clamped === lastEmittedProgress) return;
      lastProgressEmitAt = now;
      lastEmittedProgress = clamped;
      options.onProgress(clamped);
    };

    if (options.onProgress) {
      conversion.onProgress = (progress) => {
        emitProgress(progress);
      };
    }

    await conversion.execute();

    if (options.signal?.aborted || exceededOutputCap) return undefined;

    emitProgress(1, true);

    const buffer = target.buffer;
    if (!buffer) return undefined;

    const compressedSize = buffer.byteLength;
    if (compressedSize <= 0 || compressedSize > MAX_OUTPUT_BYTES) return undefined;

    const savesEnough = compressedSize < file.size * SAVINGS_RATIO_THRESHOLD;
    const fixesOversize =
      options.maxUploadSize !== undefined &&
      file.size > options.maxUploadSize &&
      compressedSize <= options.maxUploadSize;
    if (!savesEnough && !fixesOversize) return undefined;

    const baseName = getFileNameWithoutExt(file.name) || 'video';
    const outputFile = new File([buffer], `${baseName}.mp4`, {
      type: 'video/mp4',
      lastModified: file.lastModified,
    });

    return {
      file: outputFile,
      originalSize: file.size,
      compressedSize: outputFile.size,
    };
  } catch (error) {
    if (options.signal?.aborted || exceededOutputCap) return undefined;
    console.warn('[compressVideo] Failed to compress video, using original:', error);
    return undefined;
  } finally {
    unsubscribeWrite?.();
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
    input.dispose();
  }
};

/**
 * Compresses a video client-side to H.264 MP4 via WebCodecs (`mediabunny`), keeping MP4-compatible
 * audio as packet passthrough and serializing transcodes one at a time. Returns `undefined` when
 * skipped, aborted, invalid, over the memory cap, failed, or rejected by the savings guard.
 */
export const compressVideo = async (
  file: File,
  options: CompressVideoOptions
): Promise<CompressedVideoResult | undefined> => {
  const mime = getMimeTypeBase(file.type);
  if (!mime.startsWith('video/')) return undefined;

  const targetBitrate = Math.round(options.videoBitrate);
  if (
    file.size <= 0 ||
    !Number.isFinite(options.maxLongEdge) ||
    options.maxLongEdge <= 0 ||
    !Number.isFinite(options.maxFps) ||
    options.maxFps <= 0 ||
    !Number.isFinite(targetBitrate) ||
    targetBitrate <= 0
  ) {
    return undefined;
  }

  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    return undefined;
  }

  const exceedsMaxUploadSize =
    options.maxUploadSize !== undefined && file.size > options.maxUploadSize;
  if (file.size < MIN_COMPRESS_BYTES && !exceedsMaxUploadSize) {
    return undefined;
  }

  if (options.signal?.aborted) return undefined;

  return enqueueVideoCompression(options.signal, () =>
    runVideoCompression(file, options, targetBitrate)
  );
};
