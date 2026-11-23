import type { MatrixClient } from 'matrix-js-sdk';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { EventAttachmentOwner } from '../../../matrix/protocol/eventAttachments';
import { downloadCachedAttachment } from '../../../event-store/cache/attachmentRepository';
import { revokeBlobUrl } from '../../../lib/hooks/useBlobUrlCleanup';
import {
  applyVoiceMessageVolume,
  applyVoicePlaybackRate,
  DEFAULT_VOICE_MESSAGE_VOLUME,
  DEFAULT_VOICE_PLAYBACK_RATE,
  sanitizeVoiceMessageVolume,
  sanitizeVoicePlaybackRate,
  type VoicePlaybackRate,
} from '../../../preferences/voiceMessageSettings';

const HAVE_METADATA = 1;
const TIMEUPDATE_THROTTLE_MS = 200;

export type AudioContentSource = {
  owner?: EventAttachmentOwner;
  mimeType: string;
  url: string;
  encInfo?: EncryptedAttachmentInfo;
};

export type VoiceAudioPlaybackSnapshot = {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly playing: boolean;
  readonly buffering: boolean;
  readonly currentTime: number;
  readonly browserDuration: number | undefined;
  readonly engaged: boolean;
  readonly src: string | undefined;
  readonly playbackFailed: boolean;
};

export type VoiceAudioPlaybackOptions = {
  duration?: number;
  rate: VoicePlaybackRate;
  volume: number;
};

export type AudioElementFactory = () => HTMLAudioElement | undefined;

const IDLE_SNAPSHOT: VoiceAudioPlaybackSnapshot = Object.freeze({
  status: 'idle',
  playing: false,
  buffering: false,
  currentTime: 0,
  browserDuration: undefined,
  engaged: false,
  src: undefined,
  playbackFailed: false,
});

const validSeconds = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const clampProgress = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const isAbortError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { name?: unknown }).name === 'AbortError';

const tryCall = (fn: () => void): void => {
  try {
    fn();
  } catch {
    // Stubbed media elements in tests may throw on pause/load.
  }
};

const defaultCreateAudioElement: AudioElementFactory = () => {
  if (typeof document === 'undefined') return undefined;
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.hidden = true;
  audio.setAttribute('data-voice-audio-player', 'true');
  document.body?.append(audio);
  return audio;
};

/**
 * Names one piece of audio: equal for equal sources, different when the event or its revision,
 * the type, the media URI or the encryption key changes. Held in memory only, never stored.
 */
export const getAudioContentSourceIdentity = ({
  owner,
  mimeType,
  url,
  encInfo,
}: AudioContentSource): string =>
  JSON.stringify({
    roomId: owner?.roomId,
    eventId: owner?.eventId,
    revisionTs: owner?.revisionTs,
    revisionId: owner?.revisionId,
    redacted: owner?.redacted,
    mimeType,
    url,
    v: encInfo?.v ?? '',
    iv: encInfo?.iv ?? '',
    sha256: encInfo?.hashes?.sha256 ?? '',
    k: encInfo?.key?.k ?? '',
  });

type ActiveTrack = {
  identity: string;
  generation: number;
  controller: AbortController;
  objectUrl?: string;
  fallbackDuration?: number;
  autoPlay: boolean;
  pendingSeek?: number;
  snapshot: VoiceAudioPlaybackSnapshot;
};

/**
 * Shared playback controller for voice messages and audio attachments. Owns one hidden `<audio>`
 * element, on-demand downloads, and `blob:` URL lifetimes outside virtualized timeline rows so
 * playback continues when a message scrolls out of view.
 */
export class VoiceAudioPlaybackController {
  private audio?: HTMLAudioElement;
  private active?: ActiveTrack;
  private generation = 0;
  private playbackRate: VoicePlaybackRate = DEFAULT_VOICE_PLAYBACK_RATE;
  private volume: number = DEFAULT_VOICE_MESSAGE_VOLUME;
  private readonly listeners = new Map<string, Set<() => void>>();
  private lastTimeEmitAt = 0;
  private timeEmitTimer?: ReturnType<typeof setTimeout>;

  public constructor(
    private readonly createAudioElement: AudioElementFactory = defaultCreateAudioElement
  ) {}

  public subscribe(identity: string, listener: () => void): () => void {
    const set = this.listeners.get(identity) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(identity, set);
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.listeners.get(identity) === set) this.listeners.delete(identity);
    };
  }

  public getSnapshot(identity: string): VoiceAudioPlaybackSnapshot {
    return this.active?.identity === identity ? this.active.snapshot : IDLE_SNAPSHOT;
  }

  /** Reads the live played ratio for the waveform animation loop. */
  public getLiveProgress(identity: string, fallbackDuration = 0): number {
    if (!this.active || this.active.identity !== identity) return 0;
    if (this.active.pendingSeek !== undefined) return this.active.pendingSeek;
    const duration = this.active.snapshot.browserDuration ?? validSeconds(fallbackDuration) ?? 0;
    if (duration <= 0) return 0;
    const time =
      this.audio &&
      this.active.snapshot.status === 'ready' &&
      Number.isFinite(this.audio.currentTime)
        ? this.audio.currentTime
        : this.active.snapshot.currentTime;
    return clampProgress(time / duration);
  }

  public togglePlay(
    mx: MatrixClient,
    source: AudioContentSource,
    options: VoiceAudioPlaybackOptions
  ): void {
    const { identity, fallbackDuration } = this.prepare(source, options);
    const active = this.active?.identity === identity ? this.active : undefined;
    if (active) {
      if (fallbackDuration !== undefined) active.fallbackDuration = fallbackDuration;
      if (active.snapshot.status === 'ready') {
        if (active.snapshot.playbackFailed) return;
        const audio = this.ensureAudio();
        if (!audio) return;
        this.applySettings(audio);
        if (active.snapshot.playing) {
          active.autoPlay = false;
          this.clearTimeEmitTimer();
          tryCall(() => audio.pause());
          this.syncMediaState({ playing: false, buffering: false });
          return;
        }
        active.autoPlay = true;
        this.updateActive({ engaged: true });
        this.startAudioPlayback(audio, active.generation);
        return;
      }
      if (active.snapshot.status === 'loading') {
        active.autoPlay = true;
        this.updateActive({ engaged: true });
        const audio = this.ensureAudio();
        if (audio && !this.hasActiveSource()) tryCall(() => audio.load());
        return;
      }
    }
    this.startTrack(mx, source, identity, true, fallbackDuration);
  }

  public seek(
    mx: MatrixClient,
    source: AudioContentSource,
    progress: number,
    options: VoiceAudioPlaybackOptions
  ): void {
    const { identity, fallbackDuration } = this.prepare(source, options);
    const clamped = clampProgress(progress);
    const active = this.active?.identity === identity ? this.active : undefined;
    if (active && active.snapshot.status !== 'error') {
      if (active.snapshot.playbackFailed) return;
      if (fallbackDuration !== undefined) active.fallbackDuration = fallbackDuration;
      const target = clamped * (active.snapshot.browserDuration ?? active.fallbackDuration ?? 0);
      if (
        active.snapshot.status === 'ready' &&
        this.audio &&
        this.audio.readyState >= HAVE_METADATA
      ) {
        active.pendingSeek = undefined;
        this.audio.currentTime = target;
      } else {
        active.pendingSeek = clamped;
      }
      this.updateActive({ engaged: true, currentTime: target });
      return;
    }
    this.startTrack(mx, source, identity, false, fallbackDuration, clamped);
  }

  public setPlaybackRate(rate: VoicePlaybackRate): void {
    this.playbackRate = sanitizeVoicePlaybackRate(rate);
    if (this.audio) applyVoicePlaybackRate(this.audio, this.playbackRate);
  }

  public setVolume(volume: number): void {
    this.volume = sanitizeVoiceMessageVolume(volume);
    if (this.audio) applyVoiceMessageVolume(this.audio, this.volume);
  }

  /** Stops playback only when `identity` is the currently active track (in-place prop change). */
  public stopIfActive(identity: string): void {
    if (this.active?.identity === identity) this.stop();
  }

  public stop(): void {
    this.clearTimeEmitTimer();
    this.lastTimeEmitAt = 0;
    const prev = this.active;
    if (!prev) return;
    this.generation += 1;
    this.active = undefined;
    prev.controller.abort();
    if (this.audio) {
      const audio = this.audio;
      tryCall(() => audio.pause());
      audio.removeAttribute('src');
      tryCall(() => audio.load());
    }
    if (prev.objectUrl) {
      revokeBlobUrl(prev.objectUrl);
      prev.objectUrl = undefined;
    }
    this.notify(prev.identity);
  }

  private prepare(source: AudioContentSource, options: VoiceAudioPlaybackOptions) {
    this.playbackRate = sanitizeVoicePlaybackRate(options.rate);
    this.volume = sanitizeVoiceMessageVolume(options.volume);
    return {
      identity: getAudioContentSourceIdentity(source),
      fallbackDuration: validSeconds(options.duration),
    };
  }

  private startTrack(
    mx: MatrixClient,
    source: AudioContentSource,
    identity: string,
    autoPlay: boolean,
    fallbackDuration?: number,
    pendingSeek?: number
  ): void {
    const hadActive = Boolean(this.active);
    this.stop();
    const audio = this.ensureAudio();
    this.generation += 1;
    const track: ActiveTrack = {
      identity,
      generation: this.generation,
      controller: new AbortController(),
      fallbackDuration,
      autoPlay,
      pendingSeek,
      snapshot: Object.freeze({
        ...IDLE_SNAPSHOT,
        status: 'loading',
        currentTime: (pendingSeek ?? 0) * (fallbackDuration ?? 0),
        engaged: true,
      }),
    };
    this.active = track;
    this.notify(identity);
    if (autoPlay && audio && !hadActive) tryCall(() => audio.load());

    const isCurrent = () =>
      this.active === track &&
      this.generation === track.generation &&
      !track.controller.signal.aborted;

    void downloadCachedAttachment(
      mx,
      {
        owner: source.owner,
        mxcUri: source.url,
        mimeType: source.mimeType,
        ...(source.encInfo ? { encryptedFile: { ...source.encInfo, url: source.url } } : {}),
      },
      { signal: track.controller.signal }
    ).then(
      (blob) => {
        if (!isCurrent()) return;
        const objectUrl = URL.createObjectURL(blob);
        track.objectUrl = objectUrl;
        const activeAudio = this.ensureAudio();
        if (activeAudio) {
          activeAudio.src = objectUrl;
          this.applySettings(activeAudio);
        }
        this.updateActive({ status: 'ready', src: objectUrl, playbackFailed: false });
        if (!activeAudio || !isCurrent()) return;
        if (activeAudio.readyState >= HAVE_METADATA) this.applyMetadata(activeAudio, track);
        if (track.autoPlay && isCurrent()) this.startAudioPlayback(activeAudio, track.generation);
      },
      () => {
        if (isCurrent()) this.updateActive({ status: 'error', playing: false, buffering: false });
      }
    );
  }

  private ensureAudio(): HTMLAudioElement | undefined {
    if (this.audio) {
      if (this.createAudioElement === defaultCreateAudioElement && !this.audio.isConnected) {
        document.body?.append(this.audio);
      }
      return this.audio;
    }
    const audio = this.createAudioElement();
    if (audio) this.bindAudioEvents((this.audio = audio));
    return audio;
  }

  private bindAudioEvents(audio: HTMLAudioElement): void {
    const on = (events: readonly string[], fn: (active: ActiveTrack) => void) => {
      const handler = () => {
        if (this.hasActiveSource() && this.active) fn(this.active);
      };
      events.forEach((event) => audio.addEventListener(event, handler));
    };
    on(['loadstart', 'waiting'], () => this.updateActive({ buffering: true }));
    on(['canplay'], () => this.updateActive({ buffering: false }));
    on(['playing'], () => this.updateActive({ playing: true, buffering: false, engaged: true }));
    on(['play'], () => {
      this.applySettings(audio);
      this.updateActive({ playing: true, engaged: true });
    });
    on(['pause', 'ended'], () => {
      this.clearTimeEmitTimer();
      this.syncMediaState({ playing: false, buffering: false });
    });
    on(['loadedmetadata'], (active) => {
      this.clearTimeEmitTimer();
      this.applySettings(audio);
      this.applyMetadata(audio, active);
    });
    on(['durationchange', 'seeked'], () => {
      this.clearTimeEmitTimer();
      this.syncMediaState();
    });
    on(['error'], (active) => {
      this.clearTimeEmitTimer();
      active.autoPlay = false;
      this.updateActive({ playing: false, buffering: false, playbackFailed: true });
    });
    audio.addEventListener('timeupdate', this.handleTimeUpdate);
  }

  private readonly handleTimeUpdate = (): void => {
    if (!this.hasActiveSource()) return;
    const emit = () => {
      this.clearTimeEmitTimer();
      if (!this.hasActiveSource()) return;
      this.lastTimeEmitAt = Date.now();
      this.syncMediaState();
    };
    const remaining = TIMEUPDATE_THROTTLE_MS - (Date.now() - this.lastTimeEmitAt);
    if (remaining <= 0) emit();
    else if (this.timeEmitTimer === undefined) this.timeEmitTimer = setTimeout(emit, remaining);
  };

  private applyMetadata(audio: HTMLAudioElement, track: ActiveTrack): void {
    if (track.pendingSeek === undefined) {
      this.syncMediaState();
      return;
    }
    const target =
      track.pendingSeek * (validSeconds(audio.duration) ?? track.fallbackDuration ?? 0);
    track.pendingSeek = undefined;
    audio.currentTime = target;
    this.syncMediaState({ currentTime: target });
  }

  private syncMediaState(extra?: Partial<VoiceAudioPlaybackSnapshot>): void {
    if (!this.audio || !this.active) return;
    const measured = validSeconds(this.audio.duration);
    this.updateActive({
      ...(measured !== undefined ? { browserDuration: measured } : {}),
      ...(this.active.pendingSeek === undefined && Number.isFinite(this.audio.currentTime)
        ? { currentTime: this.audio.currentTime }
        : {}),
      ...extra,
    });
  }

  private startAudioPlayback(audio: HTMLAudioElement, generation: number): void {
    const onRejected = (error: unknown) => {
      if (this.generation !== generation || !this.active || isAbortError(error)) return;
      this.active.autoPlay = false;
      this.updateActive({ playing: false, buffering: false });
    };
    try {
      void Promise.resolve(audio.play()).catch(onRejected);
    } catch (error) {
      onRejected(error);
    }
  }

  private applySettings(audio: HTMLAudioElement): void {
    applyVoicePlaybackRate(audio, this.playbackRate);
    applyVoiceMessageVolume(audio, this.volume);
  }

  private hasActiveSource(): boolean {
    return Boolean(
      this.active?.objectUrl && this.audio?.getAttribute('src') === this.active.objectUrl
    );
  }

  private clearTimeEmitTimer(): void {
    clearTimeout(this.timeEmitTimer);
    this.timeEmitTimer = undefined;
  }

  private updateActive(patch: Partial<VoiceAudioPlaybackSnapshot>): void {
    if (!this.active) return;
    const prev = this.active.snapshot;
    const next: VoiceAudioPlaybackSnapshot = { ...prev, ...patch };
    const changed = (Object.keys(patch) as (keyof VoiceAudioPlaybackSnapshot)[]).some(
      (key) => !Object.is(prev[key], next[key])
    );
    if (!changed) return;
    this.active.snapshot = Object.freeze(next);
    this.notify(this.active.identity);
  }

  private notify(identity: string): void {
    this.listeners.get(identity)?.forEach((listener) => listener());
  }
}

export const voiceAudioPlayback = new VoiceAudioPlaybackController();

/** Stops any active voice playback and revokes its object URL (for account lifecycle cleanup). */
export const stopVoiceAudioPlayback = (): void => {
  voiceAudioPlayback.stop();
};
