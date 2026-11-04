import { useEffect, useSyncExternalStore } from 'react';
import type { IEmoji, IEmojiGroup } from './emoji';

/** The Emojibase emoji and their look-ups (`emoji.ts`), which load on first use. */
export type EmojiData = {
  emojis: IEmoji[];
  emojiGroups: IEmojiGroup[];
  getEmojiByUnicode: (unicode: string) => IEmoji | undefined;
  getEmojiByShortcode: (shortcode: string) => IEmoji | undefined;
};

let data: EmojiData | undefined;
let request: Promise<EmojiData> | undefined;
const listeners = new Set<() => void>();

/**
 * Called by `emoji.ts` when it has built its tables, whoever loaded it: `loadEmojiData`, or the
 * emoji board's chunk, which imports it directly.
 */
export const provideEmojiData = (next: EmojiData): void => {
  data = next;
  listeners.forEach((listener) => listener());
};

/** Loads the emoji data once; a failed load is tried again on the next call. */
export const loadEmojiData = (): Promise<EmojiData> => {
  request ??= import('./emoji').then(
    () => {
      if (!data) throw new Error('The emoji data did not register itself');
      return data;
    },
    (error: unknown) => {
      request = undefined;
      throw error;
    }
  );
  return request;
};

/** The emoji data if it has loaded. */
export const getEmojiData = (): EmojiData | undefined => data;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The emoji data, loading it on first use: undefined until it has loaded. */
export const useEmojiData = (): EmojiData | undefined => {
  const current = useSyncExternalStore(subscribe, getEmojiData, getEmojiData);
  useEffect(() => {
    if (current) return;
    loadEmojiData().catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[emoji] the emoji data did not load', error);
    });
  }, [current]);
  return current;
};
