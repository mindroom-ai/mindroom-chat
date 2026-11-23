import {
  ClientEvent,
  EventType,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
} from 'matrix-js-sdk';
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
const REDACTION_EVENT_TYPE: string = EventType.RoomRedaction;

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
const resolvePendingSeek = ({ kind, value }: PendingSeek, duration: number): number => {
  if (kind === 'ratio') return clampProgress(value) * duration;
  return duration > 0 ? Math.min(duration, Math.max(0, value)) : Math.max(0, value);
};

const defaultCreateAudioElement = (): HTMLAudioElement | undefined => {
  if (typeof document === 'undefined') return undefined;
  const el = Object.assign(document.createElement('audio'), { preload: 'metadata', hidden: true });
  el.setAttribute('data-voice-audio-player', 'true');
  return el;
};

const watchRedaction = (
  mx: MatrixClient,
  owner: EventAttachmentOwner | undefined,
  onRedacted: () => void
) => {
  if (!owner?.roomId || !owner.eventId) return undefined;
  const { roomId, eventId, revisionId } = owner;
  const onRedaction = (event: MatrixEvent, filtered: boolean) => {
    if (filtered) {
      const isRedaction = event.isRedaction?.() ?? event.getType?.() === REDACTION_EVENT_TYPE;
      const eventRoomId = event.getRoomId?.();
      if (!isRedaction || (eventRoomId && eventRoomId !== roomId)) return;
    }
    const target: unknown = event.event?.redacts ?? event.getContent?.()?.redacts;
    if (target === eventId || (revisionId !== undefined && target === revisionId)) onRedacted();
  };
  const onRoomRedaction = (event: MatrixEvent) => onRedaction(event, false);
  const onEvent = (event: MatrixEvent) => onRedaction(event, true);
  const rawRoom = typeof mx.getRoom === 'function' ? mx.getRoom(roomId) : undefined;
  const room = rawRoom && typeof rawRoom.on === 'function' ? rawRoom : undefined;
  const client = typeof mx.on === 'function' ? mx : undefined;
  if (!room && !client) return undefined;
  room?.on(RoomEvent.Redaction, onRoomRedaction);
  room?.on(RoomEvent.Timeline, onEvent);
  client?.on(ClientEvent.Event, onEvent);
  return () => {
    room?.removeListener?.(RoomEvent.Redaction, onRoomRedaction);
    room?.removeListener?.(RoomEvent.Timeline, onEvent);
    client?.removeListener?.(ClientEvent.Event, onEvent);
  };
};

/** Names one piece of audio in memory (never stored); changes with event, revision, URI, or key. */
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

/** Shared controller owning one hidden `<audio>`, downloads, and `blob:` URLs outside rows. */
export class VoiceAudioPlaybackController {
  private audio?: HTMLAudioElement;
  private active?: ActiveTrack;
  private playbackRate: VoicePlaybackRate = DEFAULT_VOICE_PLAYBACK_RATE;
  private volume: number = DEFAULT_VOICE_MESSAGE_VOLUME;
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly remembered = new Map<string, VoiceAudioPlaybackSnapshot>();
  private lastTimeEmitAt = 0;
  private timeEmitTimer?: ReturnType<typeof setTimeout>;

  public constructor(private readonly createAudio = defaultCreateAudioElement) {}

  public subscribe(identity: string, listener: () => void): () => void {
    const set = this.listeners.get(identity) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(identity, set);
    return () => {
      set.delete(listener);
      if (set.size > 0 || this.listeners.get(identity) !== set) return;
      this.listeners.delete(identity);
      if (this.active?.identity === identity && this.active.ended) this.stop({ ended: true });
    };
  }

  public getSnapshot(identity: string): VoiceAudioPlaybackSnapshot {
    if (this.active?.identity === identity) return this.active.snapshot;
    return this.remembered.get(identity) ?? IDLE_SNAPSHOT;
  }

  /** Reads the live played ratio for the waveform animation loop. */
  public getLiveProgress(identity: string, fallbackDuration = 0): number {
    const active = this.active;
    if (!active || active.identity !== identity) return 0;
    if (active.pendingSeek?.kind === 'ratio') return active.pendingSeek.value;
    const duration = active.snapshot.browserDuration ?? validSeconds(fallbackDuration) ?? 0;
    const time = active.pendingSeek?.value ?? this.liveTime(active);
    return duration > 0 ? clampProgress(time / duration) : 0;
  }

  public togglePlay(mx: MatrixClient, src: AudioContentSource, opts: VoiceAudioPlaybackOptions) {
    const { identity, fallbackDuration, active } = this.prepare(src, opts);
    if (!active || active.snapshot.status === 'error') {
      return this.startTrack(mx, src, identity, true, fallbackDuration, active?.pendingSeek);
    }
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
    const seek: PendingSeek = { kind: 'ratio', value: clampProgress(progress) };
    if (!active || active.snapshot.status === 'error') {
      return this.startTrack(mx, src, identity, false, fallbackDuration, seek);
    }
    if (active.snapshot.playbackFailed) return;
    active.ended = false;
    const target = seek.value * (active.snapshot.browserDuration ?? active.fallbackDuration ?? 0);
    const audio = this.audio;
    const ready = active.snapshot.status === 'ready' && audio && audio.readyState >= HAVE_METADATA;
    active.pendingSeek = ready ? undefined : seek;
    if (ready && audio) audio.currentTime = target;
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
    const measured = this.hasActiveSource() ? validSeconds(this.audio?.duration) : undefined;
    const browserDuration = measured ?? prev.snapshot.browserDuration;
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
      const [oldest] = this.remembered.size >= MAX_REMEMBERED ? this.remembered.keys() : [];
      if (oldest !== undefined) this.remembered.delete(oldest);
      const next = snap({ currentTime, browserDuration, engaged: !ended && currentTime > 0 });
      this.remembered.set(prev.identity, next);
    }
    this.notify(prev.identity);
  }

  /** Stops playback and clears all remembered clip positions (for account switch/sign-out). */
  public reset(): void {
    const ids = [...this.remembered.keys()];
    this.remembered.clear();
    this.stop({ forget: true });
    ids.forEach((id) => this.notify(id));
  }

  private prepare(source: AudioContentSource, options: VoiceAudioPlaybackOptions) {
    this.playbackRate = sanitizeVoicePlaybackRate(options.rate);
    this.volume = sanitizeVoiceMessageVolume(options.volume);
    const identity = getAudioContentSourceIdentity(source);
    const fallbackDuration = validSeconds(options.duration);
    const active = this.active?.identity === identity ? this.active : undefined;
    if (active && fallbackDuration !== undefined) active.fallbackDuration = fallbackDuration;
    return { identity, fallbackDuration, active };
  }

  private startTrack(
    mx: MatrixClient,
    source: AudioContentSource,
    identity: string,
    autoPlay: boolean,
    fallbackDuration?: number,
    seek?: PendingSeek
  ) {
    const hadActive = Boolean(this.active);
    this.stop();
    const audio = this.ensureAudio();
    const saved = this.remembered.get(identity);
    this.remembered.delete(identity);
    const pendingSeek: PendingSeek | undefined =
      seek ?? (saved?.currentTime ? { kind: 'seconds', value: saved.currentTime } : undefined);
    const browserDuration = saved?.browserDuration;
    const duration = browserDuration ?? fallbackDuration ?? 0;
    const currentTime = pendingSeek ? resolvePendingSeek(pendingSeek, duration) : 0;
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
        track.objectUrl = URL.createObjectURL(blob);
        const activeAudio = this.ensureAudio();
        if (activeAudio) {
          activeAudio.src = track.objectUrl;
          this.applySettings(activeAudio);
        }
        this.updateActive({ status: 'ready', src: track.objectUrl, playbackFailed: false });
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
    on(['play', 'playing'], (active, ev) => {
      active.ended = false;
      if (ev === 'play') this.applySettings(audio);
      const buffering = ev === 'playing' ? { buffering: false } : {};
      this.updateActive({ playing: true, engaged: true, ...buffering });
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
      return this.syncMediaState();
    }
    this.timeEmitTimer ??= setTimeout(() => {
      this.timeEmitTimer = undefined;
      this.handleTimeUpdate();
    }, remaining);
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
    const durationPatch = measured !== undefined ? { browserDuration: measured } : {};
    this.updateActive({ ...durationPatch, currentTime: this.liveTime(this.active), ...extra });
  }

  private startAudioPlayback(audio: HTMLAudioElement, track: ActiveTrack): void {
    const onRejected = (err: unknown) => {
      if (this.active !== track || (err as Error | null)?.name === 'AbortError') return;
      track.autoPlay = false;
      this.updateActive({ playing: false, buffering: false });
    };
    try {
      void Promise.resolve(audio.play()).catch(onRejected);
    } catch (err) {
      onRejected(err);
    }
  }

  private liveTime(track: ActiveTrack): number {
    const t = this.audio?.currentTime ?? Number.NaN;
    const useLive = this.hasActiveSource() && !track.pendingSeek && Number.isFinite(t);
    return useLive ? t : track.snapshot.currentTime;
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
