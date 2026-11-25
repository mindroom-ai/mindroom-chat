import { useCallback, useRef, type RefObject } from 'react';
import { atom, type createStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { getMimeTypeBase } from '../lib/mimeTypes';
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
  type VideoCompressionSpec,
} from '../preferences/mediaCompression';
import type { StagedList } from './roomInputDrafts';

const IMAGE_COMPRESSION_CONCURRENCY = 2;
const MIN_IMAGE_COMPRESS_BYTES = 32 * 1024;
const MIN_VIDEO_COMPRESS_BYTES = 1024 * 1024;

const SKIPPED_IMAGE_MIMES = new Set([
  'image/svg+xml',
  'image/gif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/apng',
]);

// Plain module-level Set (never a Jotai atom) so account switches can abort active jobs
// without introducing untracked account state.
const activeControllers = new Set<AbortController>();
let abortGeneration = 0;

/** Aborts and clears every in-flight media compression job (called on session switch/logout). */
export const abortAllMediaCompressions = (): void => {
  abortGeneration += 1;
  const controllers = [...activeControllers];
  activeControllers.clear();
  controllers.forEach((controller) => controller.abort());
};

// Keep both compressors behind dynamic imports so they contribute 0 bytes to the initial bundle.
const loadCompressImage = () => import('../lib/media/compressImage');
const loadCompressVideo = () => import('../lib/media/compressVideo');

const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      // eslint-disable-next-line no-await-in-loop
      results[index] = await worker(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
  return results;
};

const isEligibleImageFile = (file: File, maxUploadSize: number | undefined): boolean => {
  const mime = getMimeTypeBase(file.type);
  if (!mime.startsWith('image/') || SKIPPED_IMAGE_MIMES.has(mime)) return false;
  const exceedsMaxUploadSize = maxUploadSize !== undefined && file.size > maxUploadSize;
  return file.size >= MIN_IMAGE_COMPRESS_BYTES || exceedsMaxUploadSize;
};

const getEligibleVideoSpec = (
  file: File,
  preset: MediaCompressionPreset,
  maxUploadSize: number | undefined
): VideoCompressionSpec | undefined => {
  const spec = getVideoCompressionSpec(preset);
  if (!spec) return undefined;
  if (!getMimeTypeBase(file.type).startsWith('video/')) return undefined;
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    return undefined;
  }
  const exceedsMaxUploadSize = maxUploadSize !== undefined && file.size > maxUploadSize;
  if (file.size < MIN_VIDEO_COMPRESS_BYTES && !exceedsMaxUploadSize) return undefined;
  return spec;
};

const getLiveRoom = (mx: MatrixClient, roomId: string, fallback: Room): Room =>
  typeof mx.getRoom === 'function' ? (mx.getRoom(roomId) ?? fallback) : fallback;

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
  syncEnrolled?: () => void;
  notify: () => void;
};

/**
 * Manages client-side image and video compression for staged composer attachments:
 * inline image compression (concurrency 2), async video transcoding with progress,
 * per-item "Use original" override, and waiting for active compressions on Send.
 */
export const useMediaCompression = ({
  mx,
  store,
  current,
  deferUpload,
  maxUploadSize,
  owners,
  enrolled,
  getTargetAtom,
  uploadAtomFamily,
  keepNames,
  syncUploadWatches,
  syncEnrolled,
  notify,
}: UseMediaCompressionOptions) => {
  const deferUploadRef = useRef(deferUpload);
  deferUploadRef.current = deferUpload;
  const maxUploadSizeRef = useRef(maxUploadSize);
  maxUploadSizeRef.current = maxUploadSize;

  const pendingVideoJobs = useRef(new Map<UploadCompression, () => void>());
  const restoringOriginal = useRef(new Set<TUploadContent>());
  const replacedFiles = useRef(new WeakMap<TUploadContent, TUploadContent>());

  const replaceStagedItem = useCallback(
    ({
      targetAtom,
      targetRoomId,
      liveItem,
      replacement,
    }: {
      targetAtom: StagedList;
      targetRoomId: string;
      liveItem: TUploadItem;
      replacement: TUploadItem;
    }) => {
      if (replacement.file !== liveItem.file) {
        const hasOwner = owners.current.has(liveItem.file);
        const owner = owners.current.get(liveItem.file);
        owners.current.delete(liveItem.file);
        if (hasOwner) owners.current.set(replacement.file, owner);
      }

      if (replacement.prepError) {
        store.set(uploadAtomFamily(replacement.file), { error: replacement.prepError });
      } else if (store.get(uploadAtomFamily(replacement.file)).status === UploadStatus.Error) {
        store.set(uploadAtomFamily(replacement.file), { status: UploadStatus.Idle });
      }

      store.set(targetAtom, { type: 'REPLACE', item: liveItem, replacement });

      let enrollmentChanged = false;
      enrolled.current = enrolled.current.map((entry) => {
        if (entry.file !== liveItem.file) return entry;
        enrollmentChanged = true;
        return replacement;
      });
      if (enrollmentChanged) syncEnrolled?.();

      if (replacement.file !== liveItem.file) {
        uploadAtomFamily.remove(liveItem.file);
      }

      keepNames(targetRoomId);
      syncUploadWatches();
      notify();
    },
    [enrolled, keepNames, notify, owners, store, syncEnrolled, syncUploadWatches, uploadAtomFamily]
  );

  const canCompressImage = useCallback(
    (file: File, preset: MediaCompressionPreset): boolean =>
      getImageCompressionSpec(preset) !== undefined &&
      isEligibleImageFile(file, maxUploadSizeRef.current),
    []
  );

  const compressInlineImages = useCallback(
    async (
      files: readonly File[],
      preset: MediaCompressionPreset
    ): Promise<CompressedInlineFile[]> => {
      const spec = getImageCompressionSpec(preset);
      const maxSize = maxUploadSizeRef.current;
      if (!spec || files.length === 0) {
        return files.map((file) => ({ file }));
      }

      const eligibleIndices: number[] = [];
      files.forEach((file, index) => {
        if (isEligibleImageFile(file, maxSize)) eligibleIndices.push(index);
      });
      if (eligibleIndices.length === 0) {
        return files.map((file) => ({ file }));
      }

      let compressImageFn: (typeof import('../lib/media/compressImage'))['compressImage'];
      try {
        ({ compressImage: compressImageFn } = await loadCompressImage());
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[composer] could not load image compression, using original', error);
        return files.map((file) => ({ file }));
      }

      const entries: CompressedInlineFile[] = files.map((file) => ({ file }));
      await mapWithConcurrency(eligibleIndices, IMAGE_COMPRESSION_CONCURRENCY, async (index) => {
        const rawFile = files[index]!;
        const result = await compressImageFn(rawFile, { ...spec, maxUploadSize: maxSize });
        if (!result) return;
        entries[index] = {
          file: result.file,
          compression: {
            status: 'compressed',
            sourceFile: rawFile,
            originalSize: result.originalSize,
          },
        };
      });
      return entries;
    },
    []
  );

  const prepareVideoCompression = useCallback(
    (
      rawFile: File,
      preset: MediaCompressionPreset,
      targetRoom: Room,
      targetRoomId: string
    ): PendingVideoCompression | undefined => {
      const spec = getEligibleVideoSpec(rawFile, preset, maxUploadSizeRef.current);
      if (!spec) return undefined;

      const progressAtom = atom(0);
      const controller = new AbortController();
      const startGeneration = abortGeneration;
      let preferOriginal = false;
      let started = false;
      let finished = false;
      let resolveDone!: (item: TUploadItem | undefined) => void;
      const done = new Promise<TUploadItem | undefined>((resolve) => {
        resolveDone = resolve;
      });

      const settleDone = (item: TUploadItem | undefined) => {
        if (finished) return;
        finished = true;
        activeControllers.delete(controller);
        pendingVideoJobs.current.delete(compression);
        resolveDone(item);
      };

      const cancel = () => {
        if (finished) return;
        controller.abort();
        if (!started) settleDone(undefined);
      };

      const compression: Extract<UploadCompression, { status: 'compressing' }> = {
        status: 'compressing',
        progressAtom,
        cancel,
        done,
      };

      const placeholder: TUploadItem = {
        file: rawFile,
        originalFile: rawFile,
        encInfo: undefined,
        metadata: { markedAsSpoiler: false },
        compression,
      };

      pendingVideoJobs.current.set(compression, () => {
        preferOriginal = true;
        controller.abort();
      });

      const discard = () => {
        if (started) return;
        cancel();
      };

      const start = () => {
        if (started || finished) return;
        started = true;
        const targetAtom = getTargetAtom(targetRoomId);
        activeControllers.add(controller);

        void (async () => {
          try {
            let result: Awaited<
              ReturnType<(typeof import('../lib/media/compressVideo'))['compressVideo']>
            >;
            try {
              if (!controller.signal.aborted) {
                const { compressVideo } = await loadCompressVideo();
                if (!controller.signal.aborted) {
                  result = await compressVideo(rawFile, {
                    ...spec,
                    maxUploadSize: maxUploadSizeRef.current,
                    signal: controller.signal,
                    onProgress: (progress) => {
                      if (!controller.signal.aborted) {
                        store.set(progressAtom, progress);
                      }
                    },
                  });
                }
              }
            } catch (error) {
              if (!controller.signal.aborted) {
                // eslint-disable-next-line no-console
                console.warn('[composer] could not load or run video compression', error);
              }
            }

            if (abortGeneration !== startGeneration) {
              settleDone(undefined);
              return;
            }
            if (controller.signal.aborted && !preferOriginal) {
              settleDone(undefined);
              return;
            }
            if (getTargetAtom(targetRoomId) !== targetAtom) {
              settleDone(undefined);
              return;
            }

            const findLive = () =>
              store.get(targetAtom).find((entry) => entry.compression === compression);
            const liveBefore = findLive();
            if (!liveBefore) {
              settleDone(undefined);
              return;
            }

            const prepareFile = async (
              effectiveFile: File,
              metadata: TUploadItem['metadata']
            ): Promise<TUploadItem | undefined> => {
              if (deferUploadRef.current) {
                return {
                  file: effectiveFile,
                  originalFile: effectiveFile,
                  encInfo: undefined,
                  metadata,
                };
              }
              const liveRoom = getLiveRoom(mx, targetRoomId, targetRoom);
              const [created] = await createRoomUploadItems(
                [effectiveFile],
                liveRoom,
                () => metadata
              );
              return created;
            };

            let usedCompressed = !preferOriginal && result !== undefined;
            let prepared = await prepareFile(
              usedCompressed ? result!.file : rawFile,
              liveBefore.metadata
            );

            // If "Use original" was clicked during encryption of the compressed file, re-prepare rawFile.
            if (
              usedCompressed &&
              preferOriginal &&
              abortGeneration === startGeneration &&
              getTargetAtom(targetRoomId) === targetAtom
            ) {
              const liveNow = findLive();
              if (liveNow) {
                usedCompressed = false;
                prepared = await prepareFile(rawFile, liveNow.metadata);
              }
            }

            if (
              abortGeneration !== startGeneration ||
              (controller.signal.aborted && !preferOriginal) ||
              getTargetAtom(targetRoomId) !== targetAtom
            ) {
              settleDone(undefined);
              return;
            }

            const liveAfter = findLive();
            if (!prepared || !liveAfter) {
              settleDone(undefined);
              return;
            }

            const nextCompression: UploadCompression | undefined = preferOriginal
              ? { status: 'original' }
              : usedCompressed
                ? {
                    status: 'compressed',
                    sourceFile: rawFile,
                    originalSize: result!.originalSize,
                  }
                : undefined;

            const replacement: TUploadItem = {
              ...prepared,
              metadata: liveAfter.metadata,
              ...(nextCompression && !prepared.prepError ? { compression: nextCompression } : {}),
            };

            replaceStagedItem({
              targetAtom,
              targetRoomId,
              liveItem: liveAfter,
              replacement,
            });
            settleDone(replacement);
          } catch {
            settleDone(undefined);
          }
        })();
      };

      return { placeholder, start, discard };
    },
    [getTargetAtom, mx, replaceStagedItem, store]
  );

  const useOriginal = useCallback(
    async (item: TUploadItem): Promise<void> => {
      if (item.compression?.status === 'compressing') {
        const requestOriginal = pendingVideoJobs.current.get(item.compression);
        if (!requestOriginal) return;
        requestOriginal();
        await item.compression.done;
        return;
      }

      if (item.compression?.status !== 'compressed') return;
      if (enrolled.current.some((entry) => entry.file === item.file)) return;
      if (restoringOriginal.current.has(item.file)) return;

      const startGeneration = abortGeneration;
      const { roomId: targetRoomId, room: targetRoom } = current.current;
      const targetAtom = getTargetAtom(targetRoomId);
      const liveBefore = store.get(targetAtom).find((entry) => entry.file === item.file);
      if (!liveBefore || liveBefore.compression?.status !== 'compressed') return;

      const { sourceFile } = liveBefore.compression;
      restoringOriginal.current.add(liveBefore.file);
      try {
        const currentUpload = store.get(uploadAtomFamily(liveBefore.file));
        if (currentUpload.status === UploadStatus.Loading) {
          mx.cancelUpload(currentUpload.promise);
          store.set(uploadAtomFamily(liveBefore.file), { status: UploadStatus.Idle });
        }

        let prepared: TUploadItem | undefined;
        if (deferUploadRef.current) {
          prepared = {
            file: sourceFile,
            originalFile: sourceFile,
            encInfo: undefined,
            metadata: liveBefore.metadata,
          };
        } else {
          const liveRoom = getLiveRoom(mx, targetRoomId, targetRoom);
          const [created] = await createRoomUploadItems(
            [sourceFile],
            liveRoom,
            () => liveBefore.metadata
          );
          prepared = created;
        }

        if (abortGeneration !== startGeneration || getTargetAtom(targetRoomId) !== targetAtom) {
          return;
        }
        if (enrolled.current.some((entry) => entry.file === liveBefore.file)) return;

        const liveAfter = store.get(targetAtom).find((entry) => entry.file === liveBefore.file);
        if (!prepared || !liveAfter) return;

        const replacement: TUploadItem = {
          ...prepared,
          metadata: liveAfter.metadata,
          ...(prepared.prepError ? {} : { compression: { status: 'original' as const } }),
        };

        if (replacement.file !== liveAfter.file) {
          replacedFiles.current.set(liveAfter.file, replacement.file);
        }

        replaceStagedItem({
          targetAtom,
          targetRoomId,
          liveItem: liveAfter,
          replacement,
        });
      } finally {
        restoringOriginal.current.delete(liveBefore.file);
      }
    },
    [current, enrolled, getTargetAtom, mx, replaceStagedItem, store, uploadAtomFamily]
  );

  const waitForCompression = useCallback(
    async (
      items: readonly TUploadItem[],
      targetRoomId: string = current.current.roomId
    ): Promise<TUploadItem[]> => {
      const targetAtom = getTargetAtom(targetRoomId);
      const resolved = await Promise.all(
        items.map((item) =>
          item.compression?.status === 'compressing' ? item.compression.done : Promise.resolve(item)
        )
      );
      if (getTargetAtom(targetRoomId) !== targetAtom) return [];

      const liveByFile = new Map(store.get(targetAtom).map((entry) => [entry.file, entry]));
      const followReplacement = (file: TUploadContent): TUploadContent => {
        let currentFile = file;
        const seen = new Set<TUploadContent>();
        while (replacedFiles.current.has(currentFile) && !seen.has(currentFile)) {
          seen.add(currentFile);
          currentFile = replacedFiles.current.get(currentFile)!;
        }
        return currentFile;
      };

      const ready: TUploadItem[] = [];
      for (const item of resolved) {
        if (!item) continue;
        const live = liveByFile.get(followReplacement(item.file));
        if (live && isUploadItemReady(live)) {
          ready.push(live);
        }
      }
      return ready;
    },
    [current, getTargetAtom, store]
  );

  return {
    canCompressImage,
    compressInlineImages,
    prepareVideoCompression,
    useOriginal,
    waitForCompression,
  };
};
