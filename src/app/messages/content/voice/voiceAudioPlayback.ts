import { RoomEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
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
const MAX_REMEMBERED = 100;

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

type AudioFactory = () => HTMLAudioElement | undefined;
type PendingSeek = { kind: 'ratio' | 'seconds'; value: number };

type ActiveTrack = {
  identity: string;
  controller: AbortController;
  stopWatchingRedaction?: () => void;
  objectUrl?: string;
  fallbackDuration?: number;
  autoPlay: boolean;
  ended: boolean;
  pendingSeek?: PendingSeek;
  snapshot: VoiceAudioPlaybackSnapshot;
};

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

const snap = (patch: Partial<VoiceAudioPlaybackSnapshot>): VoiceAudioPlaybackSnapshot =>
  Object.freeze({ ...IDLE_SNAPSHOT, ...patch });

const validSeconds = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const clampProgress = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const resolvePendingSeek = (pending: PendingSeek, duration: number): number => {
  if (pending.kind === 'ratio') return clampProgress(pending.value) * duration;
  const seconds = Math.max(0, pending.value);
  return duration > 0 ? Math.min(duration, seconds) : seconds;
};

const isAbortError = (error: unknown): boolean =>
  (error as { name?: unknown } | null)?.name === 'AbortError';

const defaultCreateAudioElement: AudioFactory = () => {
  if (typeof document === 'undefined') return undefined;
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.hidden = true;
  audio.setAttribute('data-voice-audio-player', 'true');
  document.body?.append(audio);
  return audio;
};

const watchRedaction = (
  mx: MatrixClient,
  owner: EventAttachmentOwner | undefined,
  onRedacted: () => void
) => {
  if (!owner?.roomId || !owner.eventId || typeof mx.getRoom !== 'function') return undefined;
  const room = mx.getRoom(owner.roomId);
  if (!room || typeof room.on !== 'function') return undefined;
  const targets = new Set([owner.eventId, ...(owner.revisionId ? [owner.revisionId] : [])]);
  const onEvent = (event: MatrixEvent) => {
    const target = event.event?.redacts ?? event.getContent?.().redacts;
    if (typeof target === 'string' && targets.has(target)) onRedacted();
  };
  room.on(RoomEvent.Redaction, onEvent);
  return () => void room.removeListener?.(RoomEvent.Redaction, onEvent);
};

/**
 * Names one piece of audio: equal for equal sources, different when the event or its revision,
 * the type, the media URI or the encryption key changes. Held in memory only, never stored.
 */
export const getAudioContentSourceIdentity = (s: AudioContentSource): string =>
  JSON.stringify({
    roomId: s.owner?.roomId,
    eventId: s.owner?.eventId,
    revisionTs: s.owner?.revisionTs,
    revisionId: s.owner?.revisionId,
    redacted: s.owner?.redacted,
    mimeType: s.mimeType,
    url: s.url,
    v: s.encInfo?.v ?? '',
    iv: s.encInfo?.iv ?? '',
    sha256: s.encInfo?.hashes?.sha256 ?? '',
    k: s.encInfo?.key?.k ?? '',
  });

/**
 * Shared playback controller for voice messages and audio attachments. Owns one hidden `<audio>`
 * element, on-demand downloads, and `blob:` URL lifetimes outside virtualized timeline rows so
 * playback continues when a message scrolls out of view.
 */
export class VoiceAudioPlaybackController {
  private audio?: HTMLAudioElement;
  private active?: ActiveTrack;
  private playbackRate: VoicePlaybackRate = DEFAULT_VOICE_PLAYBACK_RATE;
  private volume: number = DEFAULT_VOICE_MESSAGE_VOLUME;
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly remembered = new Map<string, VoiceAudioPlaybackSnapshot>();
  private lastTimeEmitAt = 0;
  private timeEmitTimer?: ReturnType<typeof setTimeout>;

  public constructor(private readonly createAudio: AudioFactory = defaultCreateAudioElement) {}

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
    return this.active?.identity === identity
      ? this.active.snapshot
      : this.remembered.get(identity) ?? IDLE_SNAPSHOT;
  }

  /** Reads the live played ratio for the waveform animation loop. */
  public getLiveProgress(identity: string, fallbackDuration = 0): number {
    const active = this.active;
    if (!active || active.identity !== identity) return 0;
    if (active.pendingSeek?.kind === 'ratio') return active.pendingSeek.value;
    const duration = active.snapshot.browserDuration ?? validSeconds(fallbackDuration) ?? 0;
    if (duration <= 0) return 0;
    const time = active.pendingSeek ? active.pendingSeek.value : this.liveTime(active);
    return clampProgress(time / duration);
  }

  public togglePlay(mx: MatrixClient, src: AudioContentSource, opts: VoiceAudioPlaybackOptions) {
    const { identity, fallbackDuration, active } = this.prepare(src, opts);
    if (!active) return this.startTrack(mx, src, identity, true, fallbackDuration);
    if (active.snapshot.playbackFailed) return;
    const audio = this.ensureAudio();
    if (active.snapshot.status === 'loading') {
      active.autoPlay = true;
      this.updateActive({ engaged: true });
      if (audio && !this.hasActiveSource()) audio.load();
      return;
    }
    if (!audio) return;
    this.applySettings(audio);
    if (active.snapshot.playing) {
      active.autoPlay = false;
      audio.pause();
      return this.syncMediaState({ playing: false, buffering: false });
    }
    active.autoPlay = true;
    active.ended = false;
    this.updateActive({ engaged: true });
    this.startAudioPlayback(audio, active);
  }

  public seek(
    mx: MatrixClient,
    src: AudioContentSource,
    progress: number,
    opts: VoiceAudioPlaybackOptions
  ) {
    const { identity, fallbackDuration, active } = this.prepare(src, opts);
    const clamped = clampProgress(progress);
    if (!active) return this.startTrack(mx, src, identity, false, fallbackDuration, clamped);
    if (active.snapshot.playbackFailed) return;
    active.ended = false;
    const target = clamped * (active.snapshot.browserDuration ?? active.fallbackDuration ?? 0);
    const audio = this.audio;
    if (active.snapshot.status === 'ready' && audio && audio.readyState >= HAVE_METADATA) {
      active.pendingSeek = undefined;
      audio.currentTime = target;
    } else {
      active.pendingSeek = { kind: 'ratio', value: clamped };
    }
    this.updateActive({ engaged: true, currentTime: target });
  }

  public setPlaybackRate(rate: VoicePlaybackRate): void {
    this.playbackRate = sanitizeVoicePlaybackRate(rate);
    if (this.audio) applyVoicePlaybackRate(this.audio, this.playbackRate);
  }

  public setVolume(volume: number): void {
    this.volume = sanitizeVoiceMessageVolume(volume);
    if (this.audio) applyVoiceMessageVolume(this.audio, this.volume);
  }

  /** Stops playback and forgets state for `identity` (used on in-place prop identity change). */
  public stopIfActive(identity: string): void {
    if (this.active?.identity === identity) this.stop({ forget: true });
    else if (this.remembered.delete(identity)) this.notify(identity);
  }

  public stop(options?: { forget?: boolean; ended?: boolean }): void {
    this.clearTimeEmitTimer();
    this.lastTimeEmitAt = 0;
    const prev = this.active;
    if (!prev) return;
    const ended = Boolean(options?.ended || prev.ended);
    const currentTime = ended ? 0 : this.liveTime(prev);
    const browserDuration =
      (this.hasActiveSource() ? validSeconds(this.audio?.duration) : undefined) ??
      prev.snapshot.browserDuration;

    this.active = undefined;
    prev.stopWatchingRedaction?.();
    prev.controller.abort();
    this.audio?.pause();
    this.audio?.removeAttribute('src');
    this.audio?.load();
    if (prev.objectUrl) revokeBlobUrl(prev.objectUrl);

    this.remembered.delete(prev.identity);
    const keep =
      !options?.forget && !prev.snapshot.playbackFailed && prev.snapshot.status !== 'error';
    if (keep && (currentTime > 0 || browserDuration !== undefined)) {
      if (this.remembered.size >= MAX_REMEMBERED) {
        const [oldest] = this.remembered.keys();
        if (oldest !== undefined) this.remembered.delete(oldest);
      }
      const next = snap({ currentTime, browserDuration, engaged: !ended && currentTime > 0 });
      this.remembered.set(prev.identity, next);
    }
    this.notify(prev.identity);
  }

  /** Stops playback and clears all remembered clip positions (for account switch/sign-out). */
  public reset(): void {
    const rememberedIds = [...this.remembered.keys()];
    this.remembered.clear();
    this.stop({ forget: true });
    rememberedIds.forEach((id) => this.notify(id));
  }

  private prepare(source: AudioContentSource, options: VoiceAudioPlaybackOptions) {
    this.playbackRate = sanitizeVoicePlaybackRate(options.rate);
    this.volume = sanitizeVoiceMessageVolume(options.volume);
    const identity = getAudioContentSourceIdentity(source);
    const fallbackDuration = validSeconds(options.duration);
    const active =
      this.active?.identity === identity && this.active.snapshot.status !== 'error'
        ? this.active
        : undefined;
    if (active && fallbackDuration !== undefined) active.fallbackDuration = fallbackDuration;
    return { identity, fallbackDuration, active };
  }

  private startTrack(
    mx: MatrixClient,
    source: AudioContentSource,
    identity: string,
    autoPlay: boolean,
    fallbackDuration?: number,
    seek?: number
  ) {
    const hadActive = Boolean(this.active);
    this.stop();
    const audio = this.ensureAudio();
    const saved = this.remembered.get(identity);
    this.remembered.delete(identity);
    const pendingSeek: PendingSeek | undefined =
      seek !== undefined
        ? { kind: 'ratio', value: seek }
        : saved?.currentTime
        ? { kind: 'seconds', value: saved.currentTime }
        : undefined;
    const browserDuration = saved?.browserDuration;
    const currentTime = pendingSeek
      ? resolvePendingSeek(pendingSeek, browserDuration ?? fallbackDuration ?? 0)
      : 0;
    const track: ActiveTrack = {
      identity,
      controller: new AbortController(),
      fallbackDuration,
      autoPlay,
      ended: false,
      pendingSeek,
      snapshot: snap({ status: 'loading', currentTime, browserDuration, engaged: true }),
    };
    track.stopWatchingRedaction = watchRedaction(mx, source.owner, () => {
      if (this.active === track) this.stop({ forget: true });
    });
    this.active = track;
    this.notify(identity);
    if (autoPlay && audio && !hadActive) audio.load();

    const isCurrent = () => this.active === track && !track.controller.signal.aborted;
    const { owner, url, mimeType, encInfo } = source;
    void downloadCachedAttachment(
      mx,
      { owner, mxcUri: url, mimeType, ...(encInfo ? { encryptedFile: { ...encInfo, url } } : {}) },
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
        if (track.autoPlay && isCurrent()) this.startAudioPlayback(activeAudio, track);
      },
      () => {
        if (isCurrent()) this.updateActive({ status: 'error', playing: false, buffering: false });
      }
    );
  }

  private ensureAudio(): HTMLAudioElement | undefined {
    const audio = this.audio ?? this.createAudio();
    if (!audio) return undefined;
    if (!this.audio) this.bindAudioEvents((this.audio = audio));
    if (this.createAudio === defaultCreateAudioElement && !audio.isConnected) {
      document.body?.append(audio);
    }
    return audio;
  }

  private bindAudioEvents(audio: HTMLAudioElement): void {
    const on = (events: readonly string[], fn: (active: ActiveTrack, event: string) => void) =>
      events.forEach((ev) =>
        audio.addEventListener(ev, () => {
          if (this.hasActiveSource() && this.active) fn(this.active, ev);
        })
      );
    on(['loadstart', 'waiting', 'canplay'], (_, ev) =>
      this.updateActive({ buffering: ev !== 'canplay' })
    );
    on(['play', 'playing'], (active, event) => {
      active.ended = false;
      if (event === 'play') this.applySettings(audio);
      this.updateActive({
        playing: true,
        engaged: true,
        ...(event === 'playing' && { buffering: false }),
      });
    });
    on(['pause', 'ended'], (active, event) => {
      if (event === 'ended') active.ended = true;
      this.syncMediaState({ playing: false, buffering: false });
      if (event === 'ended' && !this.listeners.has(active.identity)) this.stop({ ended: true });
    });
    on(['loadedmetadata', 'durationchange', 'seeked'], (active, event) => {
      if (event !== 'loadedmetadata') return this.syncMediaState();
      this.applySettings(audio);
      this.applyMetadata(audio, active);
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
    const remaining = TIMEUPDATE_THROTTLE_MS - (Date.now() - this.lastTimeEmitAt);
    if (remaining <= 0) {
      this.lastTimeEmitAt = Date.now();
      this.syncMediaState();
    } else if (this.timeEmitTimer === undefined) {
      this.timeEmitTimer = setTimeout(() => {
        this.timeEmitTimer = undefined;
        this.handleTimeUpdate();
      }, remaining);
    }
  };

  private applyMetadata(audio: HTMLAudioElement, track: ActiveTrack): void {
    if (!track.pendingSeek) return this.syncMediaState();
    const duration =
      validSeconds(audio.duration) ?? track.snapshot.browserDuration ?? track.fallbackDuration ?? 0;
    const target = resolvePendingSeek(track.pendingSeek, duration);
    track.pendingSeek = undefined;
    audio.currentTime = target;
    this.syncMediaState({ currentTime: target });
  }

  private syncMediaState(extra?: Partial<VoiceAudioPlaybackSnapshot>): void {
    this.clearTimeEmitTimer();
    if (!this.audio || !this.active) return;
    const measured = validSeconds(this.audio.duration);
    this.updateActive({
      ...(measured !== undefined ? { browserDuration: measured } : {}),
      currentTime: this.liveTime(this.active),
      ...extra,
    });
  }

  private startAudioPlayback(audio: HTMLAudioElement, track: ActiveTrack): void {
    const onRejected = (error: unknown) => {
      if (this.active !== track || isAbortError(error)) return;
      track.autoPlay = false;
      this.updateActive({ playing: false, buffering: false });
    };
    try {
      void Promise.resolve(audio.play()).catch(onRejected);
    } catch (error) {
      onRejected(error);
    }
  }

  private liveTime(track: ActiveTrack): number {
    const t = this.audio?.currentTime ?? Number.NaN;
    return this.hasActiveSource() && !track.pendingSeek && Number.isFinite(t)
      ? t
      : track.snapshot.currentTime;
  }

  private applySettings(audio: HTMLAudioElement): void {
    applyVoicePlaybackRate(audio, this.playbackRate);
    applyVoiceMessageVolume(audio, this.volume);
  }

  private hasActiveSource(): boolean {
    const url = this.active?.objectUrl;
    return Boolean(url && this.audio?.getAttribute('src') === url);
  }

  private clearTimeEmitTimer(): void {
    clearTimeout(this.timeEmitTimer);
    this.timeEmitTimer = undefined;
  }

  private updateActive(patch: Partial<VoiceAudioPlaybackSnapshot>): void {
    if (!this.active) return;
    const prev = this.active.snapshot;
    const next: VoiceAudioPlaybackSnapshot = { ...prev, ...patch };
    const keys = Object.keys(patch) as (keyof VoiceAudioPlaybackSnapshot)[];
    if (keys.every((key) => Object.is(prev[key], next[key]))) return;
    this.active.snapshot = Object.freeze(next);
    this.notify(this.active.identity);
  }

  private notify(identity: string): void {
    this.listeners.get(identity)?.forEach((listener) => listener());
  }
}

export const voiceAudioPlayback = new VoiceAudioPlaybackController();

/** Stops active voice playback, revokes its object URL, and forgets remembered positions. */
export const stopVoiceAudioPlayback = (): void => voiceAudioPlayback.reset();
