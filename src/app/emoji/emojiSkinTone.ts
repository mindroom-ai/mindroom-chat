import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../lib/state/atomWithLocalStorage';
import { SKIN_TONES, type SkinTone } from './skinTone';

const STORAGE_KEY = 'emojiSkinTone';

/** A stored tone when it is one of the six, else the default (0). */
export const readSkinTone = (value: unknown): SkinTone =>
  SKIN_TONES.find((tone) => tone === value) ?? 0;

/**
 * The skin tone this device's emoji picker and `:shortcode:` suggestions give person emoji. It
 * is a device preference like the other display settings, so it stays out of account data.
 */
export const emojiSkinToneAtom = atomWithLocalStorage<SkinTone>(
  STORAGE_KEY,
  (key) => readSkinTone(getLocalStorageItem<unknown>(key, 0)),
  (key, value) => setLocalStorageItem(key, readSkinTone(value))
);
