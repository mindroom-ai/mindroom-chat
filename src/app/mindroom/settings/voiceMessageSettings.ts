import { atom } from 'jotai';
import { atomWithLocalStorage } from '../../state/utils/atomWithLocalStorage';

export const VOICE_PLAYBACK_RATES = [1, 1.5, 2] as const;
export type VoicePlaybackRate = typeof VOICE_PLAYBACK_RATES[number];

export const DEFAULT_VOICE_PLAYBACK_RATE: VoicePlaybackRate = 1;
export const VOICE_PLAYBACK_RATE_STORAGE_KEY = 'voiceMessagePlaybackRate';
export const DEFAULT_VOICE_MESSAGE_VOLUME = 1;
export const VOICE_MESSAGE_VOLUME_STORAGE_KEY = 'voiceMessageVolume';

type PitchPreservingAudioElement = HTMLAudioElement & {
  mozPreservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
};

export const isVoicePlaybackRate = (value: unknown): value is VoicePlaybackRate =>
  VOICE_PLAYBACK_RATES.some((rate) => rate === value);

export const sanitizeVoicePlaybackRate = (value: unknown): VoicePlaybackRate =>
  isVoicePlaybackRate(value) ? value : DEFAULT_VOICE_PLAYBACK_RATE;

export const sanitizeVoiceMessageVolume = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_VOICE_MESSAGE_VOLUME;
  return Math.min(1, Math.max(0, value));
};

export const formatVoicePlaybackRate = (rate: VoicePlaybackRate): string => `${rate}\u00d7`;

export const cycleVoicePlaybackRate = (rate: VoicePlaybackRate): VoicePlaybackRate => {
  const currentIndex = VOICE_PLAYBACK_RATES.indexOf(rate);
  return VOICE_PLAYBACK_RATES[(currentIndex + 1) % VOICE_PLAYBACK_RATES.length];
};

const getStoredVoicePlaybackRate = (key: string): VoicePlaybackRate => {
  if (typeof globalThis.localStorage?.getItem !== 'function') return DEFAULT_VOICE_PLAYBACK_RATE;

  const item = globalThis.localStorage.getItem(key);
  if (item === null) return DEFAULT_VOICE_PLAYBACK_RATE;

  try {
    return sanitizeVoicePlaybackRate(JSON.parse(item) as unknown);
  } catch {
    return DEFAULT_VOICE_PLAYBACK_RATE;
  }
};

const setStoredVoicePlaybackRate = (key: string, value: unknown) => {
  if (typeof globalThis.localStorage?.setItem !== 'function') return;

  globalThis.localStorage.setItem(key, JSON.stringify(sanitizeVoicePlaybackRate(value)));
};

const voiceMessagePlaybackRateStorageAtom = atomWithLocalStorage<unknown>(
  VOICE_PLAYBACK_RATE_STORAGE_KEY,
  getStoredVoicePlaybackRate,
  setStoredVoicePlaybackRate
);

const getStoredVoiceMessageVolume = (key: string): number => {
  if (typeof globalThis.localStorage?.getItem !== 'function') return DEFAULT_VOICE_MESSAGE_VOLUME;

  const item = globalThis.localStorage.getItem(key);
  if (item === null) return DEFAULT_VOICE_MESSAGE_VOLUME;

  try {
    return sanitizeVoiceMessageVolume(JSON.parse(item) as unknown);
  } catch {
    return DEFAULT_VOICE_MESSAGE_VOLUME;
  }
};

const setStoredVoiceMessageVolume = (key: string, value: unknown) => {
  if (typeof globalThis.localStorage?.setItem !== 'function') return;

  globalThis.localStorage.setItem(key, JSON.stringify(sanitizeVoiceMessageVolume(value)));
};

const voiceMessageVolumeStorageAtom = atomWithLocalStorage<unknown>(
  VOICE_MESSAGE_VOLUME_STORAGE_KEY,
  getStoredVoiceMessageVolume,
  setStoredVoiceMessageVolume
);

export const voiceMessagePlaybackRateAtom = atom<VoicePlaybackRate, [unknown], undefined>(
  (get) => sanitizeVoicePlaybackRate(get(voiceMessagePlaybackRateStorageAtom)),
  (_get, set, value) => {
    set(voiceMessagePlaybackRateStorageAtom, sanitizeVoicePlaybackRate(value));
  }
);

export const voiceMessageVolumeAtom = atom<number, [unknown], undefined>(
  (get) => sanitizeVoiceMessageVolume(get(voiceMessageVolumeStorageAtom)),
  (_get, set, value) => {
    set(voiceMessageVolumeStorageAtom, sanitizeVoiceMessageVolume(value));
  }
);

export const applyVoicePlaybackRate = (audioEl: HTMLAudioElement, rate: VoicePlaybackRate) => {
  const pitchPreservingAudio = audioEl as PitchPreservingAudioElement;

  audioEl.playbackRate = rate;
  audioEl.preservesPitch = true;
  pitchPreservingAudio.webkitPreservesPitch = true;
  pitchPreservingAudio.mozPreservesPitch = true;
};

export const applyVoiceMessageVolume = (audioEl: HTMLAudioElement, volume: number) => {
  const v = sanitizeVoiceMessageVolume(volume);

  audioEl.volume = v;
  audioEl.muted = v === 0;
};
