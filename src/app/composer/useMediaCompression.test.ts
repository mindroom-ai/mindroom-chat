import React, { useRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixError, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { TUploadContent } from '../matrix/matrix';
import { isUploadItemReady, UploadStatus, type TUploadItem } from '../matrix/state/upload';
import * as uploadPreparation from '../matrix/send/roomInputUploadPreparation';
import { abortAllMediaCompressions } from './mediaCompressionJobs';
import { composerUploadItemsAtom, roomUploadAtomFamily } from './roomInputDrafts';
import { useMediaCompression, type UseMediaCompressionOptions } from './useMediaCompression';

const mockCompressImage = vi.hoisted(() => vi.fn());
const mockCompressVideo = vi.hoisted(() => vi.fn());
const mockZipFile = vi.hoisted(() => vi.fn());

vi.mock('../lib/media/compressImage', () => ({
  compressImage: (...args: unknown[]) => mockCompressImage(...args),
}));

vi.mock('../lib/media/compressVideo', () => ({
  compressVideo: (...args: unknown[]) => mockCompressVideo(...args),
}));

vi.mock('../lib/media/zipFile', () => ({
  zipFile: (...args: unknown[]) => mockZipFile(...args),
}));

const ROOM_ID = '!media:example.org';

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makeSizedFile = (name: string, type: string, size: number): File => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

const makeRoom = (roomId: string, encrypted: boolean): Room =>
  ({
    roomId,
    hasEncryptionStateEvent: () => encrypted,
  }) as unknown as Room;

const renderHook = (
  params: {
    room?: Room;
    deferUpload?: boolean;
    sendingDeferred?: boolean;
    maxUploadSize?: number | undefined;
    mx?: MatrixClient;
    store?: ReturnType<typeof createStore>;
    view?: string;
  } = {}
) => {
  const {
    room = makeRoom(ROOM_ID, false),
    deferUpload = false,
    sendingDeferred = false,
    mx,
    store = createStore(),
    view,
  } = params;
  const maxUploadSize = 'maxUploadSize' in params ? params.maxUploadSize : 50 * 1024 * 1024;
  const matrixClient =
    mx ??
    ({
      cancelUpload: vi.fn(),
      getRoom: (id: string) => (id === room.roomId ? room : undefined),
    } as unknown as MatrixClient);
  const keepNames = vi.fn();
  const syncUploadWatches = vi.fn();
  const notify = vi.fn();
  const ownersRef = { current: new Map<TUploadContent, string | undefined>() };
  const enrolledRef = { current: [] as TUploadItem[] };
  const getTargetAtom = (targetRoomId: string) => composerUploadItemsAtom(targetRoomId, view);
  let api!: ReturnType<typeof useMediaCompression>;

  const Harness = ({
    activeRoom,
    deferred,
    limit,
  }: {
    activeRoom: Room;
    deferred: boolean;
    limit: number | undefined;
  }) => {
    const current = useRef({ room: activeRoom, roomId: activeRoom.roomId });
    current.current = { room: activeRoom, roomId: activeRoom.roomId };
    const options: UseMediaCompressionOptions = {
      mx: matrixClient,
      store,
      current,
      deferUpload: deferred,
      sendingDeferred,
      maxUploadSize: limit,
      owners: ownersRef,
      enrolled: enrolledRef,
      getTargetAtom,
      keepNames,
      syncUploadWatches,
      notify,
    };
    api = useMediaCompression(options);
    return null;
  };

  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      React.createElement(
        Provider,
        { store },
        React.createElement(Harness, {
          activeRoom: room,
          deferred: deferUpload,
          limit: maxUploadSize,
        })
      )
    );
  });

  return {
    store,
    mx: matrixClient,
    ownersRef,
    enrolledRef,
    getTargetAtom,
    keepNames,
    syncUploadWatches,
    notify,
    get api() {
      return api;
    },
    unmount: () => act(() => renderer.unmount()),
  };
};

describe('useMediaCompression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('VideoEncoder', class {});
    vi.stubGlobal('VideoDecoder', class {});
  });

  afterEach(() => {
    abortAllMediaCompressions();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('compresses eligible inline images with concurrency 2, preserving order and passing maxUploadSize', async () => {
    const harness = renderHook({ maxUploadSize: 10 * 1024 * 1024 });
    const img1 = makeSizedFile('a.png', 'image/png', 100 * 1024);
    const pdf = makeSizedFile('doc.pdf', 'application/pdf', 200 * 1024);
    const img2 = makeSizedFile('b.png', 'image/png', 120 * 1024);
    const img3 = makeSizedFile('c.jpg', 'image/jpeg', 140 * 1024);
    const gif = makeSizedFile('anim.gif', 'image/gif', 150 * 1024);
    const tiny = makeSizedFile('tiny.png', 'image/png', 4 * 1024);

    let inFlight = 0;
    let maxInFlight = 0;
    const gates = [createDeferred<void>(), createDeferred<void>(), createDeferred<void>()];
    let callIndex = 0;

    mockCompressImage.mockImplementation(async (file: File) => {
      const idx = callIndex;
      callIndex += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gates[idx]!.promise;
      inFlight -= 1;
      if (file === img2) return undefined;
      const out = makeSizedFile(`${file.name}.webp`, 'image/webp', 20 * 1024);
      return { file: out, originalSize: file.size, compressedSize: out.size };
    });

    const promise = harness.api.compressInlineImages(
      [img1, pdf, img2, img3, gif, tiny],
      'balanced'
    );

    await vi.waitFor(() => expect(mockCompressImage).toHaveBeenCalledTimes(2));
    expect(maxInFlight).toBe(2);
    expect(mockCompressImage).toHaveBeenNthCalledWith(
      1,
      img1,
      expect.objectContaining({ maxLongEdge: 2048, quality: 0.84, maxUploadSize: 10 * 1024 * 1024 })
    );

    gates[0]!.resolve();
    await vi.waitFor(() => expect(mockCompressImage).toHaveBeenCalledTimes(3));
    expect(maxInFlight).toBe(2);

    gates[1]!.resolve();
    gates[2]!.resolve();
    const entries = await promise;

    expect(entries).toHaveLength(6);
    expect(entries[0]!.file.name).toBe('a.png.webp');
    expect(entries[0]!.compression).toEqual({
      status: 'compressed',
      sourceFile: img1,
      originalSize: img1.size,
    });
    expect(entries[1]).toEqual({ file: pdf });
    expect(entries[2]).toEqual({ file: img2 });
    expect(entries[3]!.file.name).toBe('c.jpg.webp');
    expect(entries[4]).toEqual({ file: gif });
    expect(entries[5]).toEqual({ file: tiny });

    // Preset off skips compression completely.
    mockCompressImage.mockClear();
    const offEntries = await harness.api.compressInlineImages([img1], 'off');
    expect(offEntries).toEqual([{ file: img1 }]);
    expect(mockCompressImage).not.toHaveBeenCalled();
  });

  it('stages video placeholder, streams progress, preserves spoiler edits, encrypts, and drops stale upload atom', async () => {
    const encRoom = makeRoom(ROOM_ID, true);
    const harness = renderHook({ room: encRoom });
    const targetAtom = harness.getTargetAtom(ROOM_ID);
    const rawVideo = makeSizedFile('recording.mov', 'video/quicktime', 4 * 1024 * 1024);
    const compressedVideo = makeSizedFile('recording.mp4', 'video/mp4', 800 * 1024);
    const encryptedBlob = makeSizedFile('recording.mp4', 'application/octet-stream', 800 * 1024);

    const videoGate = createDeferred<{
      file: File;
      originalSize: number;
      compressedSize: number;
    }>();
    let capturedOnProgress: ((p: number) => void) | undefined;

    mockCompressVideo.mockImplementation(
      async (_file: File, opts: { onProgress?: (p: number) => void }) => {
        capturedOnProgress = opts.onProgress;
        return videoGate.promise;
      }
    );

    const prepSpy = vi
      .spyOn(uploadPreparation, 'createRoomUploadItems')
      .mockImplementation(async (files, _room, getMetadata) =>
        files.map((file, idx) => ({
          file: encryptedBlob,
          originalFile: file,
          encInfo: { v: 'v2' } as never,
          metadata: getMetadata ? getMetadata(file, idx) : { markedAsSpoiler: false },
        }))
      );

    const job = harness.api.createPendingVideo(rawVideo, 'balanced', encRoom, ROOM_ID);
    expect(job).toBeDefined();
    const { placeholder, start } = job!;
    expect(placeholder.compression?.status).toBe('compressing');

    harness.ownersRef.current.set(placeholder.file, 'draft-key-1');
    harness.store.set(targetAtom, { type: 'PUT', item: placeholder });
    // Create an upload atom entry for the raw placeholder so we can assert it gets removed.
    harness.store.set(roomUploadAtomFamily(rawVideo), { status: UploadStatus.Idle });
    const removeSpy = vi.spyOn(roomUploadAtomFamily, 'remove');

    start();
    await vi.waitFor(() => expect(mockCompressVideo).toHaveBeenCalledTimes(1));

    // Progress updates stream into progressAtom without replacing the staged item.
    capturedOnProgress?.(0.45);
    expect(
      placeholder.compression?.status === 'compressing'
        ? harness.store.get(placeholder.compression.progressAtom)
        : -1
    ).toBe(0.45);

    // User toggles spoiler while compression is in flight.
    const spoilerEdited: TUploadItem = {
      ...placeholder,
      metadata: { markedAsSpoiler: true },
    };
    harness.store.set(targetAtom, {
      type: 'REPLACE',
      item: placeholder,
      replacement: spoilerEdited,
    });

    videoGate.resolve({
      file: compressedVideo,
      originalSize: rawVideo.size,
      compressedSize: compressedVideo.size,
    });

    await vi.waitFor(() =>
      expect(harness.store.get(targetAtom)[0]?.compression?.status).toBe('compressed')
    );
    const replacement = harness.store.get(targetAtom)[0];

    expect(prepSpy).toHaveBeenCalledWith([compressedVideo], encRoom, expect.any(Function));
    expect(replacement).toMatchObject({
      file: encryptedBlob,
      originalFile: compressedVideo,
      encInfo: { v: 'v2' },
      metadata: { markedAsSpoiler: true },
      compression: {
        status: 'compressed',
        sourceFile: rawVideo,
        originalSize: rawVideo.size,
      },
    });
    expect(harness.store.get(targetAtom)).toEqual([replacement]);
    expect(harness.ownersRef.current.has(rawVideo)).toBe(false);
    expect(harness.ownersRef.current.get(encryptedBlob)).toBe('draft-key-1');
    expect(removeSpy).toHaveBeenCalledWith(rawVideo);
  });

  it('skips video compression when WebCodecs is missing, preset is off, or below 1 MiB floor', () => {
    const room = makeRoom(ROOM_ID, false);
    const harness = renderHook({ room, maxUploadSize: 50 * 1024 * 1024 });
    const smallVideo = makeSizedFile('short.mp4', 'video/mp4', 500 * 1024);
    const bigVideo = makeSizedFile('long.mp4', 'video/mp4', 2 * 1024 * 1024);

    expect(harness.api.createPendingVideo(smallVideo, 'balanced', room, ROOM_ID)).toBeUndefined();
    expect(harness.api.createPendingVideo(bigVideo, 'off', room, ROOM_ID)).toBeUndefined();

    // Small video over maxUploadSize IS eligible.
    const smallLimitHarness = renderHook({ room, maxUploadSize: 200 * 1024 });
    const oversizedJob = smallLimitHarness.api.createPendingVideo(
      smallVideo,
      'balanced',
      room,
      ROOM_ID
    );
    expect(oversizedJob).toBeDefined();
    oversizedJob?.cancel();

    // Missing WebCodecs skips video compression.
    vi.stubGlobal('VideoEncoder', undefined);
    expect(harness.api.createPendingVideo(bigVideo, 'balanced', room, ROOM_ID)).toBeUndefined();
  });

  it('aborts transcode and discards output when canceled mid-compression', async () => {
    const room = makeRoom(ROOM_ID, false);
    const harness = renderHook({ room });
    const targetAtom = harness.getTargetAtom(ROOM_ID);
    const rawVideo = makeSizedFile('clip.mov', 'video/quicktime', 3 * 1024 * 1024);
    let capturedSignal: AbortSignal | undefined;
    const gate = createDeferred<undefined>();

    mockCompressVideo.mockImplementation(async (_file: File, opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal;
      return gate.promise;
    });

    const job = harness.api.createPendingVideo(rawVideo, 'balanced', room, ROOM_ID)!;
    harness.store.set(targetAtom, { type: 'PUT', item: job.placeholder });
    job.start();
    await vi.waitFor(() => expect(mockCompressVideo).toHaveBeenCalledTimes(1));

    // User removes item mid-compression.
    harness.store.set(targetAtom, { type: 'DELETE', item: job.placeholder });
    if (job.placeholder.compression?.status === 'compressing') {
      job.placeholder.compression.cancel();
    }
    expect(capturedSignal?.aborted).toBe(true);

    gate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.store.get(targetAtom)).toEqual([]);
  });

  it('supports Use original mid-compression and post-compression (including E2EE re-encryption), ignoring enrolled items', async () => {
    const encRoom = makeRoom(ROOM_ID, true);
    const harness = renderHook({ room: encRoom });
    const targetAtom = harness.getTargetAtom(ROOM_ID);
    const rawVideo = makeSizedFile('screen.mov', 'video/quicktime', 5 * 1024 * 1024);
    const encOriginalVideo = makeSizedFile(
      'screen.mov',
      'application/octet-stream',
      5 * 1024 * 1024
    );

    let capturedSignal: AbortSignal | undefined;
    mockCompressVideo.mockImplementation(async (_file: File, opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal;
      await new Promise<void>((resolve) => {
        opts.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return undefined;
    });

    const prepSpy = vi
      .spyOn(uploadPreparation, 'createRoomUploadItems')
      .mockImplementation(async (files, _room, getMetadata) =>
        files.map((file, idx) => ({
          file:
            file === rawVideo
              ? encOriginalVideo
              : makeSizedFile('enc.bin', 'application/octet-stream', file.size),
          originalFile: file,
          encInfo: { v: 'v2' } as never,
          metadata: getMetadata ? getMetadata(file, idx) : { markedAsSpoiler: false },
        }))
      );

    // 1. Mid-compression "Use original" aborts transcode and encrypts rawVideo.
    const job = harness.api.createPendingVideo(rawVideo, 'balanced', encRoom, ROOM_ID)!;
    harness.store.set(targetAtom, { type: 'PUT', item: job.placeholder });
    job.start();
    await vi.waitFor(() => expect(mockCompressVideo).toHaveBeenCalledTimes(1));

    await harness.api.useOriginal(job.placeholder);
    expect(capturedSignal?.aborted).toBe(true);
    await vi.waitFor(() =>
      expect(harness.store.get(targetAtom)[0]?.compression?.status).toBe('original')
    );
    expect(harness.store.get(targetAtom)).toEqual([
      expect.objectContaining({
        file: encOriginalVideo,
        originalFile: rawVideo,
        encInfo: { v: 'v2' },
        compression: { status: 'original' },
      }),
    ]);

    // 2. Post-compression "Use original" cancels in-flight upload, encrypts sourceFile, preserves spoiler.
    const sourceImg = makeSizedFile('shot.png', 'image/png', 500 * 1024);
    const compressedImg = makeSizedFile('shot.webp', 'image/webp', 80 * 1024);
    const encCompressedImg = makeSizedFile('shot.webp', 'application/octet-stream', 80 * 1024);
    const compressedItem: TUploadItem = {
      file: encCompressedImg,
      originalFile: compressedImg,
      encInfo: { v: 'v2' } as never,
      metadata: { markedAsSpoiler: true },
      compression: { status: 'compressed', sourceFile: sourceImg, originalSize: sourceImg.size },
    };
    harness.store.set(targetAtom, { type: 'PUT', item: compressedItem });
    const inflightPromise = new Promise<{ content_uri: string }>(() => {});
    harness.store.set(roomUploadAtomFamily(encCompressedImg), { promise: inflightPromise });

    // Enrolled items ignore Use original completely.
    harness.enrolledRef.current = [compressedItem];
    await harness.api.useOriginal(compressedItem);
    expect(harness.mx.cancelUpload).not.toHaveBeenCalled();
    expect(harness.store.get(targetAtom)).toContain(compressedItem);

    // Once un-enrolled, Use original cancels upload and swaps in encrypted sourceFile.
    harness.enrolledRef.current = [];
    prepSpy.mockClear();
    await harness.api.useOriginal(compressedItem);
    expect(harness.mx.cancelUpload).toHaveBeenCalledWith(inflightPromise);
    expect(prepSpy).toHaveBeenCalledWith([sourceImg], encRoom, expect.any(Function));
    const swapped = harness.store.get(targetAtom).find((item) => item.originalFile === sourceImg);
    expect(swapped).toMatchObject({
      originalFile: sourceImg,
      encInfo: { v: 'v2' },
      metadata: { markedAsSpoiler: true },
      compression: { status: 'original' },
    });
  });

  it('supports remount-safe compression.useOriginal() after navigating away and back', async () => {
    const encRoom = makeRoom(ROOM_ID, true);
    const sharedStore = createStore();
    const first = renderHook({ room: encRoom, store: sharedStore });
    const targetAtom = first.getTargetAtom(ROOM_ID);
    const rawVideo = makeSizedFile('remount.mov', 'video/quicktime', 5 * 1024 * 1024);
    const encOriginal = makeSizedFile('remount.mov', 'application/octet-stream', 5 * 1024 * 1024);

    let capturedSignal: AbortSignal | undefined;
    mockCompressVideo.mockImplementationOnce(
      async (_file: File, opts: { signal?: AbortSignal }) => {
        capturedSignal = opts.signal;
        await new Promise<void>((resolve) => {
          opts.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return undefined;
      }
    );
    vi.spyOn(uploadPreparation, 'createRoomUploadItems').mockResolvedValueOnce([
      {
        file: encOriginal,
        originalFile: rawVideo,
        encInfo: { v: 'v2' } as never,
        metadata: { markedAsSpoiler: false },
      },
    ]);

    const job = first.api.createPendingVideo(rawVideo, 'balanced', encRoom, ROOM_ID)!;
    sharedStore.set(targetAtom, { type: 'PUT', item: job.placeholder });
    job.start();
    await vi.waitFor(() => expect(mockCompressVideo).toHaveBeenCalledTimes(1));

    // Unmount original composer and mount a fresh composer for the same room.
    first.unmount();
    const remounted = renderHook({ room: encRoom, store: sharedStore, mx: first.mx });

    const stagedPlaceholder = sharedStore.get(targetAtom)[0]!;
    await remounted.api.useOriginal(stagedPlaceholder);
    expect(capturedSignal?.aborted).toBe(true);
    await vi.waitFor(() =>
      expect(sharedStore.get(targetAtom)[0]?.compression?.status).toBe('original')
    );
    expect(sharedStore.get(targetAtom)).toEqual([
      expect.objectContaining({
        file: encOriginal,
        originalFile: rawVideo,
        encInfo: { v: 'v2' },
        compression: { status: 'original' },
      }),
    ]);
    remounted.unmount();
  });

  it('synchronously swaps to compressing placeholder on Use original during E2EE re-encryption and ignores sendingDeferred items', async () => {
    const encRoom = makeRoom(ROOM_ID, true);
    const harness = renderHook({ room: encRoom });
    const targetAtom = harness.getTargetAtom(ROOM_ID);

    const sourceImg = makeSizedFile('photo.png', 'image/png', 500 * 1024);
    const compressedImg = makeSizedFile('photo.webp', 'image/webp', 80 * 1024);
    const encCompressedImg = makeSizedFile('photo.webp', 'application/octet-stream', 80 * 1024);
    const encOriginalImg = makeSizedFile('photo.png', 'application/octet-stream', 500 * 1024);
    const compressedItem: TUploadItem = {
      file: encCompressedImg,
      originalFile: compressedImg,
      encInfo: { v: 'v2' } as never,
      metadata: { markedAsSpoiler: true },
      compression: { status: 'compressed', sourceFile: sourceImg, originalSize: sourceImg.size },
    };

    harness.store.set(targetAtom, { type: 'PUT', item: [compressedItem] });
    const inflightPromise = new Promise<{ content_uri: string }>(() => {});
    harness.store.set(roomUploadAtomFamily(encCompressedImg), { promise: inflightPromise });
    const removeSpy = vi.spyOn(roomUploadAtomFamily, 'remove');

    // sendingDeferred blocks Use original completely.
    const deferredHarness = renderHook({
      room: encRoom,
      store: harness.store,
      sendingDeferred: true,
    });
    await deferredHarness.api.useOriginal(compressedItem);
    expect(harness.store.get(targetAtom)[0]).toBe(compressedItem);
    deferredHarness.unmount();

    const encryptGate = createDeferred<TUploadItem[]>();
    vi.spyOn(uploadPreparation, 'createRoomUploadItems').mockReturnValueOnce(encryptGate.promise);

    // Click Use original: synchronously cancels upload, evicts old key, and installs preparing placeholder.
    const restorePromise = harness.api.useOriginal(compressedItem);
    expect(harness.mx.cancelUpload).toHaveBeenCalledWith(inflightPromise);
    expect(removeSpy).toHaveBeenCalledWith(encCompressedImg);

    const stagedNow = harness.store.get(targetAtom);
    expect(stagedNow[0]?.file).toBe(sourceImg);
    expect(stagedNow[0]?.compression?.status).toBe('compressing');
    expect(isUploadItemReady(stagedNow[0]!)).toBe(false);

    // Encryption finishes: placeholder is replaced with encrypted original and stale key is evicted.
    await act(async () => {
      encryptGate.resolve([
        {
          file: encOriginalImg,
          originalFile: sourceImg,
          encInfo: { v: 'v2' } as never,
          metadata: { markedAsSpoiler: false },
        },
      ]);
      await restorePromise;
    });
    expect(harness.store.get(targetAtom)[0]).toMatchObject({
      file: encOriginalImg,
      originalFile: sourceImg,
      encInfo: { v: 'v2' },
      metadata: { markedAsSpoiler: true },
      compression: { status: 'original' },
    });
    expect(isUploadItemReady(harness.store.get(targetAtom)[0]!)).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith(sourceImg);
  });

  it('aborts active compressions and evicts placeholder upload atoms via abortAllMediaCompressions on session switch', async () => {
    const room = makeRoom(ROOM_ID, false);
    const harness = renderHook({ room });
    const targetAtom = harness.getTargetAtom(ROOM_ID);
    const rawVideo = makeSizedFile('session.mov', 'video/quicktime', 4 * 1024 * 1024);
    let capturedSignal: AbortSignal | undefined;
    const gate = createDeferred<{
      file: File;
      originalSize: number;
      compressedSize: number;
    }>();
    mockCompressVideo.mockImplementationOnce(
      async (_file: File, opts: { signal?: AbortSignal }) => {
        capturedSignal = opts.signal;
        return gate.promise;
      }
    );

    const job = harness.api.createPendingVideo(rawVideo, 'balanced', room, ROOM_ID)!;
    harness.store.set(targetAtom, { type: 'PUT', item: job.placeholder });
    harness.store.set(roomUploadAtomFamily(rawVideo), { status: UploadStatus.Idle });
    const removeSpy = vi.spyOn(roomUploadAtomFamily, 'remove');
    job.start();
    await vi.waitFor(() => expect(mockCompressVideo).toHaveBeenCalledTimes(1));

    abortAllMediaCompressions();
    expect(capturedSignal?.aborted).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith(rawVideo);

    // Late results never mutate the store after session switch.
    gate.resolve({
      file: makeSizedFile('session.mp4', 'video/mp4', 900 * 1024),
      originalSize: rawVideo.size,
      compressedSize: 900 * 1024,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.store.get(targetAtom)).toEqual([job.placeholder]);
  });

  it('zips an oversized file in an encrypted room, clears spoiler, disables Use original, and starts Idle', async () => {
    const room = makeRoom(ROOM_ID, true);
    const harness = renderHook({ room, maxUploadSize: 50 * 1024 * 1024 });
    const targetAtom = harness.getTargetAtom(ROOM_ID);
    const rawFile = makeSizedFile('report.bmp', 'image/bmp', 62 * 1024 * 1024);
    const origEncFile = makeSizedFile('report.bmp', 'application/octet-stream', 62 * 1024 * 1024);
    const zippedFile = makeSizedFile('report.bmp.zip', 'application/zip', 4 * 1024 * 1024);
    const encZipFile = makeSizedFile('report.bmp.zip', 'application/octet-stream', 4 * 1024 * 1024);
    const pasteMeta = { id: 'p1', chars: 5000, fileName: 'report.bmp' };
    const staged: TUploadItem = {
      file: origEncFile,
      originalFile: rawFile,
      encInfo: { v: 'v2' } as never,
      metadata: { markedAsSpoiler: true, mindroomPasteAttachment: pasteMeta },
    };
    harness.store.set(targetAtom, { type: 'PUT', item: staged });

    const gate = createDeferred<{
      status: 'ok';
      file: File;
      originalSize: number;
      compressedSize: number;
    }>();
    let capturedProgress: ((p: number) => void) | undefined;
    mockZipFile.mockImplementationOnce(
      async (_file: File, opts: { maxOutputBytes?: number; onProgress?: (p: number) => void }) => {
        expect(opts.maxOutputBytes).toBe(50 * 1024 * 1024);
        capturedProgress = opts.onProgress;
        return gate.promise;
      }
    );
    const prepareSpy = vi.spyOn(uploadPreparation, 'createRoomUploadItems').mockResolvedValueOnce([
      {
        file: encZipFile,
        originalFile: zippedFile,
        encInfo: { v: 'v2' } as never,
        metadata: { markedAsSpoiler: false },
      },
    ]);

    const promise = harness.api.compressToZip(staged);
    const during = harness.store.get(targetAtom)[0]!;
    expect(during.compression?.status).toBe('compressing');
    expect(during.compression?.status === 'compressing' && during.compression.canUseOriginal).toBe(
      false
    );
    expect(isUploadItemReady(during)).toBe(false);

    await vi.waitFor(() => expect(capturedProgress).toBeDefined());
    capturedProgress!(0.6);
    expect(
      during.compression?.status === 'compressing'
        ? harness.store.get(during.compression.progressAtom)
        : -1
    ).toBe(0.6);

    gate.resolve({
      status: 'ok',
      file: zippedFile,
      originalSize: rawFile.size,
      compressedSize: zippedFile.size,
    });
    await promise;

    expect(prepareSpy).toHaveBeenCalledWith([zippedFile], room, expect.any(Function));
    const committed = harness.store.get(targetAtom)[0]!;
    expect(committed).toMatchObject({
      file: encZipFile,
      originalFile: zippedFile,
      encInfo: { v: 'v2' },
      metadata: { markedAsSpoiler: false, mindroomPasteAttachment: pasteMeta },
      compression: {
        status: 'compressed',
        sourceFile: rawFile,
        originalSize: rawFile.size,
        canUseOriginal: false,
      },
    });
    expect(harness.store.get(roomUploadAtomFamily(encZipFile)).status).toBe(UploadStatus.Idle);

    // Restoring original is blocked when canUseOriginal is false.
    await harness.api.useOriginal(committed);
    expect(harness.store.get(targetAtom)[0]).toBe(committed);
  });

  it('zips an oversized deferred Home Ask file without encrypting it', async () => {
    const room = makeRoom(ROOM_ID, true);
    const harness = renderHook({ room, deferUpload: true, maxUploadSize: 10 * 1024 * 1024 });
    const targetAtom = harness.getTargetAtom(ROOM_ID);
    const rawFile = makeSizedFile('dump.sql', 'application/sql', 20 * 1024 * 1024);
    const zippedFile = makeSizedFile('dump.sql.zip', 'application/zip', 2 * 1024 * 1024);
    const staged: TUploadItem = {
      file: rawFile,
      originalFile: rawFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    harness.store.set(targetAtom, { type: 'PUT', item: staged });
    const prepareSpy = vi.spyOn(uploadPreparation, 'createRoomUploadItems');
    mockZipFile.mockResolvedValueOnce({
      status: 'ok',
      file: zippedFile,
      originalSize: rawFile.size,
      compressedSize: zippedFile.size,
    });

    await harness.api.compressToZip(staged);

    expect(prepareSpy).not.toHaveBeenCalled();
    expect(harness.store.get(targetAtom)[0]).toMatchObject({
      file: zippedFile,
      originalFile: zippedFile,
      encInfo: undefined,
      compression: {
        status: 'compressed',
        sourceFile: rawFile,
        originalSize: rawFile.size,
        canUseOriginal: false,
      },
    });
  });

  it('restores original item with zipFailed and preserves server 413 UploadStatus.Error in encrypted and unencrypted rooms', async () => {
    for (const encrypted of [false, true]) {
      const room = makeRoom(ROOM_ID, encrypted);
      const harness = renderHook({ room, maxUploadSize: undefined });
      const targetAtom = harness.getTargetAtom(ROOM_ID);
      const rawFile = makeSizedFile('blob.bin', 'application/octet-stream', 60 * 1024 * 1024);
      const encFile = encrypted
        ? makeSizedFile('blob.bin', 'application/octet-stream', 60 * 1024 * 1024)
        : rawFile;
      const err413 = new MatrixError({ errcode: 'M_TOO_LARGE', error: 'too big' }, 413);
      const staged: TUploadItem = {
        file: encFile,
        originalFile: rawFile,
        encInfo: encrypted ? ({ v: 'v2' } as never) : undefined,
        metadata: { markedAsSpoiler: true },
      };
      harness.store.set(targetAtom, { type: 'PUT', item: staged });
      harness.store.set(roomUploadAtomFamily(encFile), { error: err413 });
      mockZipFile.mockResolvedValueOnce({ status: 'no-savings' });

      // eslint-disable-next-line no-await-in-loop
      await harness.api.compressToZip(staged);

      const restored = harness.store.get(targetAtom)[0]!;
      expect(restored).toMatchObject({
        file: encFile,
        originalFile: rawFile,
        encInfo: staged.encInfo,
        metadata: { markedAsSpoiler: true },
        compression: { status: 'zipFailed', reason: 'no-savings' },
      });
      expect(isUploadItemReady(restored)).toBe(false);
      expect(harness.store.get(roomUploadAtomFamily(encFile))).toEqual({
        file: encFile,
        status: UploadStatus.Error,
        error: err413,
      });
    }
  });

  it('aborts in-flight zip cleanly on cancel or account switch without restoring the item', async () => {
    const room = makeRoom(ROOM_ID, false);
    const harness = renderHook({ room, maxUploadSize: 10 * 1024 * 1024 });
    const targetAtom = harness.getTargetAtom(ROOM_ID);
    const rawFile = makeSizedFile('huge.log', 'text/plain', 30 * 1024 * 1024);
    const staged: TUploadItem = {
      file: rawFile,
      originalFile: rawFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    harness.store.set(targetAtom, { type: 'PUT', item: staged });

    let capturedSignal: AbortSignal | undefined;
    const gate = createDeferred<{ status: 'aborted' }>();
    mockZipFile.mockImplementationOnce(async (_file: File, opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal;
      return gate.promise;
    });

    const promise = harness.api.compressToZip(staged);
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    const placeholder = harness.store.get(targetAtom)[0]!;
    if (placeholder.compression?.status === 'compressing') placeholder.compression.cancel();
    harness.store.set(targetAtom, { type: 'DELETE', item: placeholder });
    expect(capturedSignal?.aborted).toBe(true);
    gate.resolve({ status: 'aborted' });
    await promise;
    expect(harness.store.get(targetAtom)).toEqual([]);
  });
});
