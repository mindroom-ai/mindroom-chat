import type { MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent } from '../matrix/types/accountData';
import { getAccountData } from '../matrix/room';
import type { ImagePack, PackImageReader } from './custom';
import type { IEmoji } from './emoji';

// Recently used emoji live in `io.element.recent_emoji` account data, which Element and other
// clients share: `{ recent_emoji: [[emoji, count], ...] }`, most recent first. An emoji is its
// Unicode text; a custom emoji is the mxc URL of its image. This file needs no emoji data, so the
// composer and the message menu can use it before the data has loaded (`recent-emoji.ts`).

type RecentEntry = [string, number];

/** A Unicode emoji before the emoji data has loaded: only its text, without a name. */
export type UnnamedEmoji = Pick<IEmoji, 'unicode'>;

/** A recently used emoji: a Unicode one, named or not yet, or a custom one. */
export type RecentEmoji = IEmoji | UnnamedEmoji | PackImageReader;

/** Whether a recent emoji is a Unicode one the emoji data knows. */
export const isNamedEmoji = (emoji: RecentEmoji): emoji is IEmoji => 'shortcodes' in emoji;

/** How many emoji the list keeps. */
const MAX_RECENT_EMOJI = 100;

const readRecentEmoji = (mx: MatrixClient): RecentEntry[] => {
  const content = getAccountData(mx, AccountDataEvent.ElementRecentEmoji)?.getContent();
  const recent: unknown = content?.recent_emoji;
  if (!Array.isArray(recent)) return [];
  return recent.filter(
    (entry): entry is RecentEntry =>
      Array.isArray(entry) &&
      typeof entry[0] === 'string' &&
      entry[0] !== '' &&
      typeof entry[1] === 'number' &&
      Number.isFinite(entry[1])
  );
};

/**
 * The recently used emoji, most used first: the Unicode ones as `lookUp` gives them and the
 * custom ones as the images of `imagePacks`. An entry neither finds is left out before `limit`
 * applies.
 */
export const resolveRecentEmoji = <T>(
  mx: MatrixClient,
  lookUp: (unicode: string) => T | undefined,
  imagePacks: ImagePack[] = [],
  limit?: number
): Array<T | PackImageReader> => {
  const customByUrl = new Map<string, PackImageReader>();
  imagePacks.forEach((pack) =>
    pack.images.collection.forEach((image) => {
      if (!customByUrl.has(image.url)) customByUrl.set(image.url, image);
    })
  );
  const recent = readRecentEmoji(mx)
    // A stable sort keeps the most recent first among emoji used as often.
    .sort(([, countA], [, countB]) => countB - countA)
    .flatMap(([key]): Array<T | PackImageReader> => {
      const emoji = key.startsWith('mxc://') ? customByUrl.get(key) : lookUp(key);
      return emoji ? [emoji] : [];
    });
  return limit === undefined ? recent : recent.slice(0, limit);
};

/** Records a use of the emoji (Unicode text, or the mxc URL of a custom emoji). */
export const addRecentEmoji = async (mx: MatrixClient, emoji: string): Promise<void> => {
  const recent = readRecentEmoji(mx);
  const count = recent.find(([key]) => key === emoji)?.[1] ?? 0;
  const used: RecentEntry = [emoji, count + 1];
  const next = [used, ...recent.filter(([key]) => key !== emoji)].slice(0, MAX_RECENT_EMOJI);
  await mx.setAccountData(
    AccountDataEvent.ElementRecentEmoji as never,
    {
      recent_emoji: next,
    } as never
  );
};
