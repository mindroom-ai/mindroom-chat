import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { atom, type createStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import {
  isEligibleImageForCompression,
  isEligibleVideoForCompression,
} from '../lib/media/mediaCompressionEligibility';
import type { TUploadContent } from '../matrix/matrix';
import { createRoomUploadItems } from '../matrix/send/roomInputUploadPreparation';
import {
  isUploadItemReady,
  UploadStatus,
  type TUploadAtom,
  type TUploadItem,
  type UploadCompression,
} from '../matrix/state/upload';
import {
  getImageCompressionSpec,
  getVideoCompressionSpec,
  type MediaCompressionPreset,
} from '../preferences/mediaCompression';
import { getMediaCompressionGeneration, registerMediaCompressionJob } from './mediaCompressionJobs';
import type { StagedList } from './roomInputDrafts';

const IMAGE_COMPRESSION_CONCURRENCY = 2;
const DEFAULT_META = { markedAsSpoiler: false };

export type CompressedInlineFile = {
  file: File;
  compression?: Extract<UploadCompression, { status: 'compressed' }>;
};

export type PendingVideoCompression = {
  placeholder: TUploadItem;
  start: () => void;
  discard: () => void;
};

type UploadAtomFamily = {
  (file: TUploadContent): TUploadAtom;
  remove: (file: TUploadContent) => void;
};

export type UseMediaCompressionOptions = {
  mx: MatrixClient;
  store: ReturnType<typeof createStore>;
  current: RefObject<{ room: Room; roomId: string }>;
  deferUpload: boolean;
  maxUploadSize: number | undefined;
  owners: RefObject<Map<TUploadContent, string | undefined>>;
  enrolled: RefObject<TUploadItem[]>;
  getTargetAtom: (roomId: string) => StagedList;
  uploadAtomFamily: UploadAtomFamily;
  keepNames: (roomId: string) => void;
  syncUploadWatches: () => void;
  replaceEnrolled?: (oldFile: TUploadContent, replacement: TUploadItem) => void;
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
  const { store, owners, enrolled, uploadAtomFamily } = opts;
  if (replacement.file !== liveItem.file) {
    const owner = owners.current.get(liveItem.file);
    if (owners.current.delete(liveItem.file)) owners.current.set(replacement.file, owner);
  }
  const nextUploadAtom = uploadAtomFamily(replacement.file);
  if (replacement.prepError) {
    store.set(nextUploadAtom, { error: replacement.prepError });
  } else if (
    replacement.compression?.status !== 'compressing' &&
    store.get(nextUploadAtom).status === UploadStatus.Error
  ) {
    store.set(nextUploadAtom, { status: UploadStatus.Idle });
  }
  store.set(targetAtom, { type: 'REPLACE', item: liveItem, replacement });
  if (opts.replaceEnrolled) opts.replaceEnrolled(liveItem.file, replacement);
  else enrolled.current = enrolled.current.map((e) => (e.file === liveItem.file ? replacement : e));
  if (replacement.file !== liveItem.file) uploadAtomFamily.remove(liveItem.file);
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
  let preferOriginal = false;
  let started = false;
  let finished = false;
  let unregister: (() => void) | undefined;
  let resolveDone!: (item: TUploadItem | undefined) => void;
  const done = new Promise<TUploadItem | undefined>((r) => {
    resolveDone = r;
  });
  const settle = (item: TUploadItem | undefined) => {
    if (finished) return;
    finished = true;
    unregister?.();
    unregister = undefined;
    resolveDone(item);
  };
  const progressAtom = atom(initialProgress);
  const compression: Extract<UploadCompression, { status: 'compressing' }> = {
    status: 'compressing',
    progressAtom,
    cancel: () => {
      preferOriginal = false;
      controller.abort();
      settle(undefined);
    },
    useOriginal: () => {
      if (!allowUseOriginal || finished) return;
      preferOriginal = true;
      controller.abort();
    },
    done,
  };
  const findLive = () => {
    const opts = optsRef.current;
    const stale =
      getMediaCompressionGeneration() !== startGen ||
      (controller.signal.aborted && !preferOriginal) ||
      opts.getTargetAtom(roomId) !== targetAtom;
    return stale
      ? undefined
      : opts.store.get(targetAtom).find((e) => e.compression === compression);
  };
  const placeholder: TUploadItem = {
    file,
    originalFile: file,
    encInfo: undefined,
    metadata,
    compression,
  };
  return {
    signal: controller.signal,
    compression,
    placeholder,
    setProgress: (p: number) => {
      if (!controller.signal.aborted) optsRef.current.store.set(progressAtom, p);
    },
    findLive,
    wantsOriginal: () => preferOriginal,
    discard: () => {
      if (!started) compression.cancel();
    },
    run: (work: () => Promise<void>) => {
      if (started || finished) return Promise.resolve();
      started = true;
      unregister = registerMediaCompressionJob(controller, () => {
        optsRef.current.uploadAtomFamily.remove(file);
        settle(undefined);
      });
      return work().catch(() => settle(undefined));
    },
    commit: (prepared: TUploadItem | undefined, nextCompression?: UploadCompression) => {
      const liveAfter = findLive();
      if (!prepared || !liveAfter) return settle(undefined);
      const replacement: TUploadItem = {
        ...prepared,
        metadata: liveAfter.metadata,
        ...(nextCompression && !prepared.prepError ? { compression: nextCompression } : {}),
      };
      replaceStagedItem(optsRef.current, targetAtom, roomId, liveAfter, replacement);
      settle(replacement);
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
  const run = async () => {
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
    Array.from({ length: Math.min(IMAGE_COMPRESSION_CONCURRENCY, eligible.length) }, run)
  );
  return entries;
};

const createVideoCompressionJob = (
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
    discard: job.discard,
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

        if (!job.findLive()) return job.commit(undefined);
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

const restoreOriginalItem = async (
  optsRef: OptsRef,
  waitingCountRef: RefObject<number>,
  item: TUploadItem
): Promise<void> => {
  const opts = optsRef.current;
  if (waitingCountRef.current > 0 || opts.enrolled.current.some((e) => e.file === item.file)) {
    return;
  }
  if (item.compression?.status === 'compressing') {
    item.compression.useOriginal();
    await item.compression.done;
    return;
  }
  if (item.compression?.status !== 'compressed') return;

  const { roomId, room } = opts.current.current;
  const targetAtom = opts.getTargetAtom(roomId);
  const liveBefore = opts.store.get(targetAtom).find((e) => e.file === item.file);
  if (!liveBefore || liveBefore.compression?.status !== 'compressed') return;

  const currentUpload = opts.store.get(opts.uploadAtomFamily(liveBefore.file));
  if (currentUpload.status === UploadStatus.Loading) {
    opts.mx.cancelUpload(currentUpload.promise);
    opts.store.set(opts.uploadAtomFamily(liveBefore.file), { status: UploadStatus.Idle });
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
  // Synchronously replace so pressing Send during encryption awaits `done` and sends the original.
  replaceStagedItem(opts, targetAtom, roomId, liveBefore, job.placeholder);
  await job.run(async () => {
    const prepared = await prepareItemFile(optsRef.current, sourceFile, roomId, room);
    job.commit(prepared, { status: 'original' });
  });
};

/**
 * Manages client-side image and video compression for staged composer attachments:
 * inline image compression (concurrency 2), async video transcoding with progress,
 * per-item "Use original" override, and waiting for active compressions on Send.
 */
export const useMediaCompression = (options: UseMediaCompressionOptions) => {
  const optsRef = useRef(options);
  optsRef.current = options;
  const mountedRef = useRef(true);
  const waitingCountRef = useRef(0);
  const [waitingForCompression, setWaitingForCompression] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const methods = useMemo(
    () => ({
      compressInlineImages: (files: readonly File[], preset: MediaCompressionPreset) =>
        runInlineImageCompression(optsRef, files, preset),
      prepareVideoCompression: (
        file: File,
        preset: MediaCompressionPreset,
        room: Room,
        id: string
      ) => createVideoCompressionJob(optsRef, file, preset, room, id),
      useOriginal: (item: TUploadItem) => restoreOriginalItem(optsRef, waitingCountRef, item),
      waitForCompression: async (
        items: readonly TUploadItem[],
        targetRoomId: string = optsRef.current.current.current.roomId
      ): Promise<TUploadItem[]> => {
        const { getTargetAtom, store } = optsRef.current;
        const targetAtom = getTargetAtom(targetRoomId);
        const hasCompressing = items.some((item) => item.compression?.status === 'compressing');
        if (hasCompressing) {
          waitingCountRef.current += 1;
          if (mountedRef.current) setWaitingForCompression(true);
        }
        try {
          const resolved = await Promise.all(
            items.map((i) => (i.compression?.status === 'compressing' ? i.compression.done : i))
          );
          if (optsRef.current.getTargetAtom(targetRoomId) !== targetAtom) return [];
          const liveByFile = new Map(store.get(targetAtom).map((e) => [e.file, e]));
          return resolved.flatMap((i) => {
            const live = i && liveByFile.get(i.file);
            return live && isUploadItemReady(live) ? [live] : [];
          });
        } finally {
          if (hasCompressing) {
            waitingCountRef.current -= 1;
            if (mountedRef.current) setWaitingForCompression(waitingCountRef.current > 0);
          }
        }
      },
    }),
    []
  );

  return { ...methods, waitingForCompression };
};
