import { RoomEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventAttachmentOwner } from '../../../matrix/protocol/eventAttachments';
import {
  getAudioContentSourceIdentity,
  stopVoiceAudioPlayback,
  VoiceAudioPlaybackController,
  voiceAudioPlayback,
  type AudioContentSource,
} from './voiceAudioPlayback';

const mocks = vi.hoisted(() => ({
  downloadCachedAttachment: vi.fn(),
}));

vi.mock('../../../event-store/cache/attachmentRepository', () => ({
  downloadCachedAttachment: mocks.downloadCachedAttachment,
}));

class FakeAudioElement extends EventTarget {
  public preload = '';
  public hidden = false;
  public currentTime = 0;
  public duration = Number.NaN;
  public readyState = 0;
  public paused = true;
  public playbackRate = 1;
  public preservesPitch = false;
  public webkitPreservesPitch = false;
  public mozPreservesPitch = false;
  public volume = 1;
  public muted = false;
  private srcAttr: string | null = null;
  public playCalls = 0;
  public pauseCalls = 0;
  public loadCalls = 0;
  public playImpl?: () => Promise<void> | void;

  public get src(): string {
    return this.srcAttr ?? '';
  }

  public set src(value: string) {
    this.srcAttr = value;
  }

  public getAttribute(name: string): string | null {
    return name === 'src' ? this.srcAttr : null;
  }

  public removeAttribute(name: string): void {
    if (name === 'src') this.srcAttr = null;
  }

  public play(): Promise<void> {
    this.playCalls += 1;
    if (this.playImpl) {
      const result = this.playImpl();
      return result instanceof Promise ? result : Promise.resolve();
    }
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  }

  public pause(): void {
    this.pauseCalls += 1;
    const wasPlaying = !this.paused;
    this.paused = true;
    if (wasPlaying) this.dispatchEvent(new Event('pause'));
  }

  public load(): void {
    this.loadCalls += 1;
    this.paused = true;
    this.readyState = 0;
    this.currentTime = 0;
  }
}

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const mx = {} as MatrixClient;

const sourceA: AudioContentSource = {
  mimeType: 'audio/ogg',
  url: 'mxc://example.org/voice-a',
  owner: { roomId: '!room:example.org', eventId: '$a', revisionTs: 1000 },
};

const sourceB: AudioContentSource = {
  mimeType: 'audio/ogg',
  url: 'mxc://example.org/voice-b',
  owner: { roomId: '!room:example.org', eventId: '$b', revisionTs: 2000 },
};

const defaultOptions = { duration: 10, rate: 1 as const, volume: 1 };

describe('VoiceAudioPlaybackController', () => {
  let fakeAudio: FakeAudioElement;
  let createAudioFactory: ReturnType<typeof vi.fn<() => HTMLAudioElement>>;
  let controller: VoiceAudioPlaybackController;
  let nextBlobId: number;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeAudio = new FakeAudioElement();
    createAudioFactory = vi.fn(() => fakeAudio as unknown as HTMLAudioElement);
    controller = new VoiceAudioPlaybackController(createAudioFactory);
    nextBlobId = 1;
    createObjectURL = vi.fn(() => {
      const url = `blob:voice-${nextBlobId}`;
      nextBlobId += 1;
      return url;
    });
    revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    mocks.downloadCachedAttachment.mockReset();
    mocks.downloadCachedAttachment.mockImplementation(async () => new Blob(['audio']));
  });

  afterEach(() => {
    controller.reset();
    stopVoiceAudioPlayback();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not create an audio element until playback or seek starts and safely stops in Node', () => {
    expect(createAudioFactory).not.toHaveBeenCalled();
    controller.setPlaybackRate(1.5);
    controller.setVolume(0.5);
    controller.stop();
    expect(createAudioFactory).not.toHaveBeenCalled();

    // Singleton works cleanly without DOM in Node.
    expect(voiceAudioPlayback.getSnapshot(getAudioContentSourceIdentity(sourceA)).status).toBe(
      'idle'
    );
    expect(() => stopVoiceAudioPlayback()).not.toThrow();
  });

  it('loads once, survives consumer unsubscribe/resubscribe while playing, and notifies only the active identity', async () => {
    const idA = getAudioContentSourceIdentity(sourceA);
    const idB = getAudioContentSourceIdentity(sourceB);
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const unsubA = controller.subscribe(idA, listenerA);
    const unsubB = controller.subscribe(idB, listenerB);
    const idleB = controller.getSnapshot(idB);

    controller.togglePlay(mx, sourceA, defaultOptions);
    expect(createAudioFactory).toHaveBeenCalledOnce();
    expect(controller.getSnapshot(idA).status).toBe('loading');
    expect(mocks.downloadCachedAttachment).toHaveBeenCalledOnce();

    // Duplicate togglePlay while loading does not start a second download.
    controller.togglePlay(mx, sourceA, defaultOptions);
    expect(mocks.downloadCachedAttachment).toHaveBeenCalledOnce();

    await flushMicrotasks();

    expect(fakeAudio.src).toBe('blob:voice-1');
    expect(fakeAudio.paused).toBe(false);
    expect(controller.getSnapshot(idA)).toMatchObject({
      status: 'ready',
      playing: true,
      engaged: true,
      src: 'blob:voice-1',
    });

    // Simulate virtualized row unmount: unsubscribing must NOT pause or revoke the blob URL.
    unsubA();
    expect(fakeAudio.paused).toBe(false);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    // Playback advances while no UI row is mounted.
    fakeAudio.duration = 12;
    fakeAudio.readyState = 1;
    fakeAudio.currentTime = 4.5;
    fakeAudio.dispatchEvent(new Event('loadedmetadata'));
    fakeAudio.currentTime = 6.2;
    fakeAudio.dispatchEvent(new Event('timeupdate'));

    // Unrelated identity never re-rendered and keeps the exact same frozen snapshot reference.
    expect(listenerB).not.toHaveBeenCalled();
    expect(controller.getSnapshot(idB)).toBe(idleB);

    // Simulate remount when user scrolls back.
    const remountListener = vi.fn();
    const unsubRemount = controller.subscribe(idA, remountListener);
    expect(controller.getSnapshot(idA)).toMatchObject({
      status: 'ready',
      playing: true,
      engaged: true,
      currentTime: 6.2,
      browserDuration: 12,
      src: 'blob:voice-1',
    });
    expect(controller.getLiveProgress(idA, 10)).toBeCloseTo(6.2 / 12);

    unsubRemount();
    unsubB();
  });

  it('switches tracks cleanly, revokes the previous blob URL once, and aborts in-flight downloads without leaking', async () => {
    const idA = getAudioContentSourceIdentity(sourceA);
    const idB = getAudioContentSourceIdentity(sourceB);

    // 1. Switch from ready/playing A to B.
    controller.togglePlay(mx, sourceA, defaultOptions);
    await flushMicrotasks();
    expect(fakeAudio.src).toBe('blob:voice-1');

    const listenerA = vi.fn();
    controller.subscribe(idA, listenerA);

    controller.togglePlay(mx, sourceB, defaultOptions);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:voice-1');
    expect(controller.getSnapshot(idA).status).toBe('idle');
    expect(listenerA).toHaveBeenCalled();
    await flushMicrotasks();
    expect(fakeAudio.src).toBe('blob:voice-2');
    expect(controller.getSnapshot(idB)).toMatchObject({ status: 'ready', playing: true });

    // 2. Switch while A's download is still in flight; abort signal fires and late resolution leaks no blob URL.
    const deferredA = createDeferred<Blob>();
    let capturedSignal: AbortSignal | undefined;
    mocks.downloadCachedAttachment.mockImplementationOnce(
      (_client: unknown, _src: unknown, options?: { signal?: AbortSignal }) => {
        capturedSignal = options?.signal;
        return deferredA.promise;
      }
    );
    controller.togglePlay(mx, sourceA, defaultOptions);
    expect(capturedSignal?.aborted).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:voice-2');

    const createCallsBeforeSwitch = createObjectURL.mock.calls.length;
    controller.togglePlay(mx, sourceB, defaultOptions);
    expect(capturedSignal?.aborted).toBe(true);
    await flushMicrotasks();
    expect(createObjectURL).toHaveBeenCalledTimes(createCallsBeforeSwitch + 1);

    // Late resolution of aborted download A must be ignored without creating a blob URL.
    deferredA.resolve(new Blob(['stale-a']));
    await flushMicrotasks();
    expect(createObjectURL).toHaveBeenCalledTimes(createCallsBeforeSwitch + 1);
    expect(controller.getSnapshot(idB).status).toBe('ready');
    expect(controller.getSnapshot(idA).status).toBe('idle');
  });

  it('applies pendingSeek on loadedmetadata without auto-playing, seeks immediately once ready, and plays if toggled while loading-from-seek', async () => {
    const idA = getAudioContentSourceIdentity(sourceA);
    const idB = getAudioContentSourceIdentity(sourceB);

    // Seek before load: loads with autoPlay = false and applies pendingSeek on loadedmetadata.
    controller.seek(mx, sourceA, 0.5, { duration: 10, rate: 1, volume: 1 });
    expect(controller.getSnapshot(idA)).toMatchObject({
      status: 'loading',
      playing: false,
      engaged: true,
      currentTime: 5,
    });
    expect(controller.getLiveProgress(idA, 10)).toBe(0.5);

    await flushMicrotasks();
    expect(fakeAudio.playCalls).toBe(0);
    expect(fakeAudio.currentTime).toBe(0);

    // Update pendingSeek while readyState < HAVE_METADATA.
    controller.seek(mx, sourceA, 0.75, { duration: 10, rate: 1, volume: 1 });
    expect(fakeAudio.currentTime).toBe(0);

    fakeAudio.duration = 8;
    fakeAudio.readyState = 1;
    fakeAudio.dispatchEvent(new Event('loadedmetadata'));
    expect(fakeAudio.currentTime).toBe(6);
    expect(fakeAudio.paused).toBe(true);
    expect(controller.getSnapshot(idA)).toMatchObject({
      currentTime: 6,
      browserDuration: 8,
      playing: false,
    });

    // Seek after metadata is ready updates audio.currentTime immediately.
    controller.seek(mx, sourceA, 0.25, { duration: 10, rate: 1, volume: 1 });
    expect(fakeAudio.currentTime).toBe(2);
    expect(controller.getSnapshot(idA).currentTime).toBe(2);

    // Play clicked while loading-from-seek sets autoPlay without duplicating the download.
    const deferredB = createDeferred<Blob>();
    mocks.downloadCachedAttachment.mockImplementationOnce(() => deferredB.promise);
    const callsBefore = mocks.downloadCachedAttachment.mock.calls.length;

    controller.seek(mx, sourceB, 0.5, { duration: 12, rate: 1, volume: 1 });
    controller.togglePlay(mx, sourceB, { duration: 12, rate: 1, volume: 1 });
    expect(mocks.downloadCachedAttachment).toHaveBeenCalledTimes(callsBefore + 1);

    deferredB.resolve(new Blob(['audio-b']));
    await flushMicrotasks();
    expect(fakeAudio.playCalls).toBe(1);
    fakeAudio.duration = 12;
    fakeAudio.readyState = 1;
    fakeAudio.dispatchEvent(new Event('loadedmetadata'));
    expect(fakeAudio.currentTime).toBe(6);
    expect(controller.getSnapshot(idB)).toMatchObject({ playing: true, currentTime: 6 });
  });

  it('applies playback rate and volume immediately, even with no subscribers, and reapplies on loadedmetadata and play', async () => {
    controller.togglePlay(mx, sourceA, { duration: 10, rate: 1.5, volume: 0.6 });
    await flushMicrotasks();

    expect(fakeAudio.playbackRate).toBe(1.5);
    expect(fakeAudio.preservesPitch).toBe(true);
    expect(fakeAudio.volume).toBe(0.6);
    expect(fakeAudio.muted).toBe(false);

    // Update settings while no UI subscriber is attached.
    controller.setPlaybackRate(2);
    controller.setVolume(0);
    expect(fakeAudio.playbackRate).toBe(2);
    expect(fakeAudio.volume).toBe(0);
    expect(fakeAudio.muted).toBe(true);

    // Browser resets properties before loadedmetadata/play; handlers reapply them.
    fakeAudio.playbackRate = 1;
    fakeAudio.volume = 1;
    fakeAudio.muted = false;
    fakeAudio.dispatchEvent(new Event('loadedmetadata'));
    expect(fakeAudio.playbackRate).toBe(2);
    expect(fakeAudio.volume).toBe(0);
    expect(fakeAudio.muted).toBe(true);

    fakeAudio.playbackRate = 1;
    fakeAudio.volume = 1;
    fakeAudio.dispatchEvent(new Event('play'));
    expect(fakeAudio.playbackRate).toBe(2);
    expect(fakeAudio.volume).toBe(0);
    expect(fakeAudio.muted).toBe(true);
  });

  it('handles download failure with retry, audio error only when src is active, and play() rejections cleanly', async () => {
    const idA = getAudioContentSourceIdentity(sourceA);

    // 1. Download failure sets error state and allows retry.
    mocks.downloadCachedAttachment.mockRejectedValueOnce(new Error('offline'));
    controller.togglePlay(mx, sourceA, defaultOptions);
    await flushMicrotasks();
    expect(controller.getSnapshot(idA)).toMatchObject({
      status: 'error',
      playing: false,
      playbackFailed: false,
    });

    // Retry succeeds.
    controller.togglePlay(mx, sourceA, defaultOptions);
    await flushMicrotasks();
    expect(controller.getSnapshot(idA)).toMatchObject({ status: 'ready', playing: true });

    // 2. NotAllowedError rejection reverts playing without marking playbackFailed.
    controller.togglePlay(mx, sourceA, defaultOptions); // pause
    fakeAudio.playImpl = () =>
      Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError'));
    controller.togglePlay(mx, sourceA, defaultOptions);
    await flushMicrotasks();
    expect(controller.getSnapshot(idA)).toMatchObject({
      status: 'ready',
      playing: false,
      buffering: false,
      playbackFailed: false,
    });

    // 3. AbortError rejection is ignored cleanly.
    fakeAudio.playImpl = () => {
      fakeAudio.paused = false;
      fakeAudio.dispatchEvent(new Event('play'));
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    };
    controller.togglePlay(mx, sourceA, defaultOptions);
    await flushMicrotasks();
    expect(controller.getSnapshot(idA).playbackFailed).toBe(false);

    // 4. Media error with active src marks playbackFailed.
    fakeAudio.dispatchEvent(new Event('error'));
    expect(controller.getSnapshot(idA)).toMatchObject({
      playing: false,
      buffering: false,
      playbackFailed: true,
    });

    // 5. Clearing src and receiving spurious error/loadstart/waiting does NOT affect state.
    controller.stop();
    expect(fakeAudio.getAttribute('src')).toBeNull();
    fakeAudio.dispatchEvent(new Event('error'));
    fakeAudio.dispatchEvent(new Event('loadstart'));
    fakeAudio.dispatchEvent(new Event('waiting'));
    expect(controller.getSnapshot(idA)).toMatchObject({
      status: 'idle',
      buffering: false,
      playbackFailed: false,
    });
  });

  it('throttles timeupdate notifications while emitting immediate lifecycle events and supports stopIfActive / stop', async () => {
    vi.useFakeTimers();
    const idA = getAudioContentSourceIdentity(sourceA);
    const idB = getAudioContentSourceIdentity(sourceB);

    controller.togglePlay(mx, sourceA, defaultOptions);
    await flushMicrotasks();

    const listener = vi.fn();
    controller.subscribe(idA, listener);

    fakeAudio.currentTime = 1;
    fakeAudio.dispatchEvent(new Event('timeupdate'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot(idA).currentTime).toBe(1);

    // Rapid updates within 200ms coalesce to one trailing emit.
    fakeAudio.currentTime = 1.5;
    fakeAudio.dispatchEvent(new Event('timeupdate'));
    fakeAudio.currentTime = 2;
    fakeAudio.dispatchEvent(new Event('timeupdate'));
    expect(listener).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot(idA).currentTime).toBe(2);

    // Pause emits immediately with exact audio.currentTime.
    fakeAudio.currentTime = 2.7;
    fakeAudio.pause();
    expect(controller.getSnapshot(idA)).toMatchObject({ playing: false, currentTime: 2.7 });

    // stopIfActive ignores unrelated identities and stops only the active identity.
    controller.stopIfActive(idB);
    expect(controller.getSnapshot(idA).status).toBe('ready');
    expect(revokeObjectURL).not.toHaveBeenCalled();

    controller.stopIfActive(idA);
    expect(controller.getSnapshot(idA).status).toBe('idle');
    expect(controller.getSnapshot(idA).currentTime).toBe(0);
    expect(fakeAudio.getAttribute('src')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:voice-1');
  });

  it('stops playback, revokes blob URL, removes listener, and forgets position when the active event or revision is redacted', async () => {
    const redactionListeners = new Set<(event: MatrixEvent) => void>();
    const room = {
      on: vi.fn((event: RoomEvent, listener: (ev: MatrixEvent) => void) => {
        if (event === RoomEvent.Redaction) redactionListeners.add(listener);
      }),
      removeListener: vi.fn((event: RoomEvent, listener: (ev: MatrixEvent) => void) => {
        if (event === RoomEvent.Redaction) redactionListeners.delete(listener);
      }),
    };
    const roomMx = { getRoom: vi.fn(() => room) } as unknown as MatrixClient;
    const emitRedaction = (event: {
      event?: { redacts?: string };
      content?: { redacts?: string };
    }) => {
      const matrixEvent = {
        event: event.event ?? {},
        getContent: () => event.content ?? {},
      } as unknown as MatrixEvent;
      [...redactionListeners].forEach((listener) => listener(matrixEvent));
    };

    const editedSource: AudioContentSource = {
      ...sourceA,
      owner: {
        roomId: '!room:example.org',
        eventId: '$a',
        revisionTs: 1000,
        revisionId: '$a-edit',
      },
    };
    const idEdited = getAudioContentSourceIdentity(editedSource);

    // 1. Top-level event.redacts matching owner.eventId.
    controller.togglePlay(roomMx, editedSource, defaultOptions);
    await flushMicrotasks();
    fakeAudio.duration = 12;
    fakeAudio.readyState = 1;
    fakeAudio.currentTime = 4;
    fakeAudio.dispatchEvent(new Event('loadedmetadata'));
    expect(redactionListeners.size).toBe(1);

    // Unrelated redaction is ignored.
    emitRedaction({ event: { redacts: '$other' } });
    expect(fakeAudio.paused).toBe(false);
    expect(controller.getSnapshot(idEdited).playing).toBe(true);

    // Matching owner.eventId stops, revokes, forgets position, and detaches room listener.
    emitRedaction({ event: { redacts: '$a' } });
    expect(fakeAudio.paused).toBe(true);
    expect(fakeAudio.getAttribute('src')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:voice-1');
    expect(redactionListeners.size).toBe(0);
    expect(controller.getSnapshot(idEdited)).toMatchObject({
      status: 'idle',
      currentTime: 0,
      browserDuration: undefined,
      engaged: false,
    });

    // 2. Room v11 content.redacts matching owner.revisionId.
    controller.togglePlay(roomMx, editedSource, defaultOptions);
    await flushMicrotasks();
    fakeAudio.currentTime = 3;
    fakeAudio.dispatchEvent(new Event('timeupdate'));
    expect(redactionListeners.size).toBe(1);

    emitRedaction({ content: { redacts: '$a-edit' } });
    expect(fakeAudio.paused).toBe(true);
    expect(fakeAudio.getAttribute('src')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:voice-2');
    expect(redactionListeners.size).toBe(0);
    expect(controller.getSnapshot(idEdited)).toMatchObject({
      status: 'idle',
      currentTime: 0,
      engaged: false,
    });
  });

  it('preserves paused position and measured duration across clip switches, resumes at that timestamp, and clears on reset', async () => {
    const idA = getAudioContentSourceIdentity(sourceA);
    const idB = getAudioContentSourceIdentity(sourceB);

    controller.togglePlay(mx, sourceA, defaultOptions);
    await flushMicrotasks();
    fakeAudio.duration = 12;
    fakeAudio.readyState = 1;
    fakeAudio.currentTime = 4.5;
    fakeAudio.dispatchEvent(new Event('loadedmetadata'));
    controller.togglePlay(mx, sourceA, defaultOptions); // pause at 4.5s

    // Switch to clip B: clip A revokes its blob URL but remembers paused position & browserDuration.
    controller.togglePlay(mx, sourceB, defaultOptions);
    await flushMicrotasks();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:voice-1');

    const rememberedA = controller.getSnapshot(idA);
    expect(rememberedA).toMatchObject({
      status: 'idle',
      playing: false,
      currentTime: 4.5,
      browserDuration: 12,
      engaged: true,
      src: undefined,
    });

    // Clip A's snapshot reference stays stable and unnotified while clip B advances.
    const listenerA = vi.fn();
    const unsubA = controller.subscribe(idA, listenerA);
    fakeAudio.currentTime = 2;
    fakeAudio.dispatchEvent(new Event('timeupdate'));
    expect(listenerA).not.toHaveBeenCalled();
    expect(controller.getSnapshot(idA)).toBe(rememberedA);

    // Resuming clip A preserves 4.5s while loading and seeks to 4.5s on loadedmetadata.
    controller.togglePlay(mx, sourceA, defaultOptions);
    expect(controller.getSnapshot(idA)).toMatchObject({
      status: 'loading',
      currentTime: 4.5,
      browserDuration: 12,
      engaged: true,
    });
    expect(controller.getLiveProgress(idA, 10)).toBeCloseTo(4.5 / 12);

    await flushMicrotasks();
    fakeAudio.duration = 12;
    fakeAudio.readyState = 1;
    fakeAudio.dispatchEvent(new Event('loadedmetadata'));
    expect(fakeAudio.currentTime).toBe(4.5);
    expect(controller.getSnapshot(idA)).toMatchObject({
      status: 'ready',
      playing: true,
      currentTime: 4.5,
      browserDuration: 12,
    });

    // Switch back to clip B so clip A is remembered again, then reset() (account sign-out/switch).
    controller.togglePlay(mx, sourceB, defaultOptions);
    await flushMicrotasks();
    expect(controller.getSnapshot(idA).currentTime).toBe(4.5);

    listenerA.mockClear();
    controller.reset();
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot(idA)).toMatchObject({
      status: 'idle',
      currentTime: 0,
      browserDuration: undefined,
      engaged: false,
    });
    expect(controller.getSnapshot(idB).status).toBe('idle');
    unsubA();
  });

  it('releases offscreen audio on ended while keeping browserDuration, and keeps subscribed audio loaded for instant replay', async () => {
    const idA = getAudioContentSourceIdentity(sourceA);
    const idB = getAudioContentSourceIdentity(sourceB);

    // 1. Subscribed clip stays loaded on ended so replay does not re-download.
    const unsubA = controller.subscribe(idA, vi.fn());
    controller.togglePlay(mx, sourceA, defaultOptions);
    await flushMicrotasks();
    fakeAudio.duration = 9;
    fakeAudio.readyState = 1;
    fakeAudio.currentTime = 9;
    fakeAudio.dispatchEvent(new Event('ended'));

    expect(fakeAudio.getAttribute('src')).toBe('blob:voice-1');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(controller.getSnapshot(idA)).toMatchObject({
      status: 'ready',
      playing: false,
      browserDuration: 9,
    });

    // Switching away from an already-ended clip remembers duration with currentTime 0 (not 9).
    controller.togglePlay(mx, sourceB, defaultOptions);
    await flushMicrotasks();
    expect(controller.getSnapshot(idA)).toMatchObject({
      status: 'idle',
      currentTime: 0,
      browserDuration: 9,
      engaged: false,
    });
    unsubA();

    // 2. Unsubscribed (offscreen) clip releases blob URL and detaches src immediately on ended.
    fakeAudio.duration = 11;
    fakeAudio.readyState = 1;
    fakeAudio.currentTime = 11;
    fakeAudio.dispatchEvent(new Event('ended'));

    expect(fakeAudio.getAttribute('src')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:voice-2');
    expect(controller.getSnapshot(idB)).toMatchObject({
      status: 'idle',
      playing: false,
      currentTime: 0,
      browserDuration: 11,
      engaged: false,
      src: undefined,
    });
  });
});

describe('getAudioContentSourceIdentity', () => {
  const owner: EventAttachmentOwner = {
    roomId: '!room:example.org',
    eventId: '$event',
    revisionTs: 1_000,
    revisionId: '$rev',
    redacted: false,
  };
  const encInfo: EncryptedAttachmentInfo = {
    v: 'v2',
    iv: 'iv-a',
    hashes: { sha256: 'sha-a' },
    key: { kty: 'oct', key_ops: ['encrypt', 'decrypt'], alg: 'A256CTR', k: 'key-a', ext: true },
  };
  const encrypted: AudioContentSource = {
    mimeType: 'audio/ogg',
    url: 'mxc://example.org/voice-a',
    owner,
    encInfo,
  };
  const identity = getAudioContentSourceIdentity(encrypted);

  it('is equal for equal sources given as new objects', () => {
    expect(
      getAudioContentSourceIdentity({
        mimeType: 'audio/ogg',
        url: 'mxc://example.org/voice-a',
        owner: { ...owner },
        encInfo: { ...encInfo, key: { ...encInfo.key }, hashes: { ...encInfo.hashes } },
      })
    ).toBe(identity);
  });

  it.each([
    ['the revision time', { ...encrypted, owner: { ...owner, revisionTs: 2_000 } }],
    ['the revision ID', { ...encrypted, owner: { ...owner, revisionId: '$edit' } }],
    ['the room', { ...encrypted, owner: { ...owner, roomId: '!other:example.org' } }],
    ['the event', { ...encrypted, owner: { ...owner, eventId: '$other' } }],
    ['the redaction', { ...encrypted, owner: { ...owner, redacted: true } }],
    ['the owner', { ...encrypted, owner: undefined }],
    ['the type', { ...encrypted, mimeType: 'audio/mpeg' }],
    ['the media URI', { ...encrypted, url: 'mxc://example.org/voice-b' }],
    ['the IV', { ...encrypted, encInfo: { ...encInfo, iv: 'iv-b' } }],
    ['the key', { ...encrypted, encInfo: { ...encInfo, key: { ...encInfo.key, k: 'key-b' } } }],
    ['the hash', { ...encrypted, encInfo: { ...encInfo, hashes: { sha256: 'sha-b' } } }],
    ['the version', { ...encrypted, encInfo: { ...encInfo, v: 'v1' } }],
    ['the encryption', { ...encrypted, encInfo: undefined }],
  ] satisfies [string, AudioContentSource][])('changes with %s alone', (_part, changed) => {
    expect(getAudioContentSourceIdentity(changed)).not.toBe(identity);
  });

  it('ignores the key algorithm and key operations', () => {
    expect(
      getAudioContentSourceIdentity({
        ...encrypted,
        encInfo: { ...encInfo, key: { ...encInfo.key, alg: 'other', key_ops: ['decrypt'] } },
      })
    ).toBe(identity);
  });
});
