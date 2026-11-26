import { useMemo, useRef, type RefObject } from 'react';
import { atom, type createStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import type { TUploadContent } from '../matrix/matrix';
import { createRoomUploadItems } from '../matrix/send/roomInputUploadPreparation';
import { type TUploadItem, type UploadCompression, UploadStatus } from '../matrix/state/upload';
import {
  canZipOversizedFile,
  isEligibleImageForCompression,
  isEligibleVideoForCompression,
} from '../lib/media/mediaCompressionEligibility';
import {
  getImageCompressionSpec,
  getVideoCompressionSpec,
  type MediaCompressionPreset,
} from '../preferences/mediaCompression';
import { getMediaCompressionGeneration, registerMediaCompressionJob } from './mediaCompressionJobs';
import { roomUploadAtomFamily, type StagedList } from './roomInputDrafts';

const IMAGE_COMPRESSION_CONCURRENCY = 2;
const DEFAULT_META = { markedAsSpoiler: false };

export type CompressedInlineFile = {
  file: File;
  compression?: Extract<UploadCompression, { status: 'compressed' }>;
};

export type PendingVideoCompression = {
  placeholder: TUploadItem;
  start: () => void;
  cancel: () => void;
};

export type UseMediaCompressionOptions = {
  mx: MatrixClient;
  store: ReturnType<typeof createStore>;
  current: RefObject<{ room: Room; roomId: string }>;
  deferUpload: boolean;
  sendingDeferred?: boolean;
  maxUploadSize: number | undefined;
  owners: RefObject<Map<TUploadContent, string | undefined>>;
  enrolled: RefObject<TUploadItem[]>;
  getTargetAtom: (roomId: string) => StagedList;
  keepNames: (roomId: string) => void;
  syncUploadWatches: () => void;
  notify: () => void;
};

type OptsRef = RefObject<UseMediaCompressionOptions>;

const prepareItemFile = async (
  opts: UseMediaCompressionOptions,
  file: File,
  roomId: string,
  fallbackRoom: Room
): Promise<TUploadItem | undefined> => {
  if (opts.deferUpload) {
    return { file, originalFile: file, encInfo: undefined, metadata: DEFAULT_META };
  }
  const liveRoom =
    typeof opts.mx.getRoom === 'function'
      ? (opts.mx.getRoom(roomId) ?? fallbackRoom)
      : fallbackRoom;
  const [created] = await createRoomUploadItems([file], liveRoom, () => DEFAULT_META);
  return created;
};

const replaceStagedItem = (
  opts: UseMediaCompressionOptions,
  targetAtom: StagedList,
  roomId: string,
  liveItem: TUploadItem,
  replacement: TUploadItem
): void => {
  const { store, owners } = opts;
  if (replacement.file !== liveItem.file) {
    const owner = owners.current.get(liveItem.file);
    if (owners.current.delete(liveItem.file)) owners.current.set(replacement.file, owner);
  }
  const nextUploadAtom = roomUploadAtomFamily(replacement.file);
  if (replacement.prepError) {
    store.set(nextUploadAtom, { error: replacement.prepError });
  } else if (
    replacement.compression?.status !== 'compressing' &&
    replacement.compression?.status !== 'zipFailed' &&
    store.get(nextUploadAtom).status === UploadStatus.Error
  ) {
    store.set(nextUploadAtom, { status: UploadStatus.Idle });
  }
  store.set(targetAtom, { type: 'REPLACE', item: liveItem, replacement });
  if (replacement.file !== liveItem.file) roomUploadAtomFamily.remove(liveItem.file);
  opts.keepNames(roomId);
  opts.syncUploadWatches();
  opts.notify();
};

const createPendingJob = (
  optsRef: OptsRef,
  file: File,
  roomId: string,
  targetAtom: StagedList,
  initialProgress: number,
  allowUseOriginal: boolean,
  metadata: TUploadItem['metadata'] = DEFAULT_META
) => {
  const controller = new AbortController();
  const startGen = getMediaCompressionGeneration();
  const progressAtom = atom(initialProgress);
  let preferOriginal = false;
  let finished = false;
  let unregister: (() => void) | undefined;
  const finish = () => {
    finished = true;
    unregister?.();
    unregister = undefined;
  };
  const compression: Extract<UploadCompression, { status: 'compressing' }> = {
    status: 'compressing',
    progressAtom,
    canUseOriginal: allowUseOriginal,
    cancel: () => {
      preferOriginal = false;
      controller.abort();
      finish();
    },
    useOriginal: () => {
      if (!allowUseOriginal || finished) return;
      preferOriginal = true;
      controller.abort();
    },
  };
  const findLive = () =>
    getMediaCompressionGeneration() !== startGen || (controller.signal.aborted && !preferOriginal)
      ? undefined
      : optsRef.current.store.get(targetAtom).find((e) => e.compression === compression);
  const placeholder: TUploadItem = {
    file,
    originalFile: file,
    encInfo: undefined,
    metadata,
    compression,
  };
  return {
    signal: controller.signal,
    placeholder,
    cancel: compression.cancel,
    wantsOriginal: () => preferOriginal,
    setProgress: (p: number) => {
      if (!controller.signal.aborted) optsRef.current.store.set(progressAtom, p);
    },
    findLive,
    run: (work: () => Promise<void>) => {
      if (finished) return Promise.resolve();
      unregister = registerMediaCompressionJob(controller, () => {
        roomUploadAtomFamily.remove(file);
        finish();
      });
      return work()
        .catch(() => undefined)
        .finally(finish);
    },
    commit: (
      prepared: TUploadItem | undefined,
      nextCompression?: UploadCompression,
      metadata?: TUploadItem['metadata']
    ) => {
      const liveAfter = findLive();
      if (!prepared || !liveAfter) return;
      replaceStagedItem(optsRef.current, targetAtom, roomId, liveAfter, {
        ...prepared,
        metadata: metadata ?? liveAfter.metadata,
        ...(nextCompression && !prepared.prepError ? { compression: nextCompression } : {}),
      });
    },
  };
};

const runInlineImageCompression = async (
  optsRef: OptsRef,
  files: readonly File[],
  preset: MediaCompressionPreset
): Promise<CompressedInlineFile[]> => {
  const spec = getImageCompressionSpec(preset);
  const maxSize = optsRef.current.maxUploadSize;
  const eligible = spec
    ? files.flatMap((f, i) => (isEligibleImageForCompression(f, maxSize) ? [i] : []))
    : [];
  if (!spec || eligible.length === 0) return files.map((file) => ({ file }));

  // Keep image compressor behind a dynamic import so it contributes 0 bytes to the initial bundle.
  const mod = await import('../lib/media/compressImage').catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[composer] could not load image compression, using original', error);
    return undefined;
  });
  if (!mod) return files.map((file) => ({ file }));

  const entries: CompressedInlineFile[] = files.map((file) => ({ file }));
  let next = 0;
  const worker = async () => {
    while (next < eligible.length) {
      const idx = eligible[next]!;
      next += 1;
      const sourceFile = files[idx]!;
      // eslint-disable-next-line no-await-in-loop
      const res = await mod.compressImage(sourceFile, { ...spec, maxUploadSize: maxSize });
      if (res) {
        entries[idx] = {
          file: res.file,
          compression: { status: 'compressed', sourceFile, originalSize: res.originalSize },
        };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(IMAGE_COMPRESSION_CONCURRENCY, eligible.length) }, worker)
  );
  return entries;
};

const createPendingVideo = (
  optsRef: OptsRef,
  rawFile: File,
  preset: MediaCompressionPreset,
  targetRoom: Room,
  roomId: string
): PendingVideoCompression | undefined => {
  const spec = getVideoCompressionSpec(preset);
  if (!spec || !isEligibleVideoForCompression(rawFile, optsRef.current.maxUploadSize)) {
    return undefined;
  }
  const targetAtom = optsRef.current.getTargetAtom(roomId);
  const job = createPendingJob(optsRef, rawFile, roomId, targetAtom, 0, true);
  return {
    placeholder: job.placeholder,
    cancel: job.cancel,
    start: () => {
      void job.run(async () => {
        // Keep video compressor behind a dynamic import so mediabunny contributes 0 bytes to initial.
        const result = job.signal.aborted
          ? undefined
          : await import('../lib/media/compressVideo')
              .then(({ compressVideo }) =>
                compressVideo(rawFile, {
                  ...spec,
                  maxUploadSize: optsRef.current.maxUploadSize,
                  signal: job.signal,
                  onProgress: job.setProgress,
                })
              )
              .catch((error: unknown) => {
                if (!job.signal.aborted) {
                  // eslint-disable-next-line no-console
                  console.warn('[composer] could not load or run video compression', error);
                }
                return undefined;
              });
        if (!job.findLive()) return;
        let usedCompressed = !job.wantsOriginal() && result !== undefined;
        let prepared = await prepareItemFile(
          optsRef.current,
          usedCompressed ? result!.file : rawFile,
          roomId,
          targetRoom
        );
        // If "Use original" was clicked while encrypting the compressed file, re-prepare rawFile.
        if (usedCompressed && job.wantsOriginal() && job.findLive()) {
          usedCompressed = false;
          prepared = await prepareItemFile(optsRef.current, rawFile, roomId, targetRoom);
        }
        const nextCompression: UploadCompression | undefined = job.wantsOriginal()
          ? { status: 'original' }
          : usedCompressed
            ? { status: 'compressed', sourceFile: rawFile, originalSize: result!.originalSize }
            : undefined;
        job.commit(prepared, nextCompression);
      });
    },
  };
};

const restoreOriginalItem = async (optsRef: OptsRef, item: TUploadItem): Promise<void> => {
  const opts = optsRef.current;
  if (opts.sendingDeferred || opts.enrolled.current.some((e) => e.file === item.file)) return;
  if (item.compression?.status === 'compressing') {
    item.compression.useOriginal();
    return;
  }
  if (item.compression?.status !== 'compressed' || item.compression.canUseOriginal === false) {
    return;
  }

  const { roomId, room } = opts.current.current;
  const targetAtom = opts.getTargetAtom(roomId);
  const liveBefore = opts.store.get(targetAtom).find((e) => e.file === item.file);
  if (
    !liveBefore ||
    liveBefore.compression?.status !== 'compressed' ||
    liveBefore.compression.canUseOriginal === false
  ) {
    return;
  }

  const currentUpload = opts.store.get(roomUploadAtomFamily(liveBefore.file));
  if (currentUpload.status === UploadStatus.Loading) {
    opts.mx.cancelUpload(currentUpload.promise);
    opts.store.set(roomUploadAtomFamily(liveBefore.file), { status: UploadStatus.Idle });
  }

  const { sourceFile } = liveBefore.compression;
  const job = createPendingJob(
    optsRef,
    sourceFile,
    roomId,
    targetAtom,
    1,
    false,
    liveBefore.metadata
  );
  // Synchronously stage a brief preparing placeholder so Send stays disabled during re-encryption.
  replaceStagedItem(opts, targetAtom, roomId, liveBefore, job.placeholder);
  await job.run(async () => {
    const prepared = await prepareItemFile(optsRef.current, sourceFile, roomId, room);
    job.commit(prepared, { status: 'original' });
  });
};

const compressItemToZip = async (optsRef: OptsRef, item: TUploadItem): Promise<void> => {
  const opts = optsRef.current;
  if (opts.sendingDeferred || opts.enrolled.current.some((e) => e.file === item.file)) return;

  const { roomId, room } = opts.current.current;
  const targetAtom = opts.getTargetAtom(roomId);
  const liveBefore = opts.store.get(targetAtom).find((e) => e.file === item.file);
  if (
    !liveBefore ||
    liveBefore.prepError ||
    liveBefore.metadata.mindroomPasteAttachment !== undefined ||
    liveBefore.compression?.status === 'compressing' ||
    liveBefore.compression?.status === 'zipFailed'
  ) {
    return;
  }

  const rawFile = liveBefore.originalFile;
  if (!canZipOversizedFile(rawFile)) return;

  const priorUpload = opts.store.get(roomUploadAtomFamily(liveBefore.file));
  if (priorUpload.status === UploadStatus.Loading || priorUpload.status === UploadStatus.Success) {
    return;
  }
  const priorError = priorUpload.status === UploadStatus.Error ? priorUpload.error : undefined;
  const maxOutputBytes =
    opts.maxUploadSize !== undefined && liveBefore.file.size > opts.maxUploadSize
      ? opts.maxUploadSize
      : undefined;

  const job = createPendingJob(optsRef, rawFile, roomId, targetAtom, 0, false, liveBefore.metadata);
  if (priorError && liveBefore.file === job.placeholder.file) {
    opts.store.set(roomUploadAtomFamily(job.placeholder.file), { status: UploadStatus.Idle });
  }
  replaceStagedItem(opts, targetAtom, roomId, liveBefore, job.placeholder);

  await job.run(async () => {
    // Keep ZIP writer behind a dynamic import so it contributes 0 bytes to the initial bundle.
    const result = job.signal.aborted
      ? ({ status: 'aborted' } as const)
      : await import('../lib/media/zipFile')
          .then(({ zipFile }) =>
            zipFile(rawFile, {
              maxOutputBytes,
              signal: job.signal,
              onProgress: job.setProgress,
            })
          )
          .catch((error: unknown) => {
            if (!job.signal.aborted) {
              // eslint-disable-next-line no-console
              console.warn('[composer] could not load or run zip compression', error);
            }
            return { status: job.signal.aborted ? ('aborted' as const) : ('error' as const) };
          });

    if (result.status === 'aborted' || !job.findLive()) return;

    if (result.status !== 'ok') {
      const liveAfter = job.findLive();
      if (!liveAfter) return;
      if (priorError) {
        optsRef.current.store.set(roomUploadAtomFamily(liveBefore.file), { error: priorError });
      }
      replaceStagedItem(optsRef.current, targetAtom, roomId, liveAfter, {
        ...liveBefore,
        metadata: liveAfter.metadata,
        compression: { status: 'zipFailed', reason: result.status },
      });
      return;
    }

    const prepared = await prepareItemFile(optsRef.current, result.file, roomId, room);
    const liveAfter = job.findLive();
    if (!liveAfter) return;
    job.commit(
      prepared,
      {
        status: 'compressed',
        sourceFile: rawFile,
        originalSize: rawFile.size,
        canUseOriginal: false,
      },
      { ...liveAfter.metadata, markedAsSpoiler: false }
    );
  });
};

/**
 * Manages client-side image, video, and oversized-file `.zip` compression for staged composer
 * attachments, plus per-item "Use original" override.
 */
export const useMediaCompression = (options: UseMediaCompressionOptions) => {
  const optsRef = useRef(options);
  optsRef.current = options;

  return useMemo(
    () => ({
      compressInlineImages: (files: readonly File[], preset: MediaCompressionPreset) =>
        runInlineImageCompression(optsRef, files, preset),
      createPendingVideo: (file: File, preset: MediaCompressionPreset, room: Room, id: string) =>
        createPendingVideo(optsRef, file, preset, room, id),
      useOriginal: (item: TUploadItem) => restoreOriginalItem(optsRef, item),
      compressToZip: (item: TUploadItem) => compressItemToZip(optsRef, item),
    }),
    []
  );
};
