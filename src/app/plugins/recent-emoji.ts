import type { MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { getAccountData } from '../utils/room';
import type { ImagePack, PackImageReader } from './custom-emoji';
import { getEmojiByUnicode, type IEmoji } from './emoji';

// Recently used emoji live in `io.element.recent_emoji` account data, which Element and other
// clients share: `{ recent_emoji: [[emoji, count], ...] }`, most recent first. An emoji is its
// Unicode text; a custom emoji is the mxc URL of its image.

type RecentEmoji = [string, number];

/** How many emoji the list keeps. */
const MAX_RECENT_EMOJI = 100;

const readRecentEmoji = (mx: MatrixClient): RecentEmoji[] => {
  const content = getAccountData(mx, AccountDataEvent.ElementRecentEmoji)?.getContent();
  const recent: unknown = content?.recent_emoji;
  if (!Array.isArray(recent)) return [];
  return recent.filter(
    (entry): entry is RecentEmoji =>
      Array.isArray(entry) &&
      typeof entry[0] === 'string' &&
      entry[0] !== '' &&
      typeof entry[1] === 'number' &&
      Number.isFinite(entry[1])
  );
};

/**
 * The user's recently used emoji, most used first, as emoji or as the custom emoji of the given
 * packs; a custom emoji none of the packs has is left out before `limit` applies.
 */
export const getRecentEmojis = (
  mx: MatrixClient,
  limit?: number,
  imagePacks: ImagePack[] = []
): Array<IEmoji | PackImageReader> => {
  const customByUrl = new Map<string, PackImageReader>();
  imagePacks.forEach((pack) =>
    pack.images.collection.forEach((image) => {
      if (!customByUrl.has(image.url)) customByUrl.set(image.url, image);
    })
  );
  const recent = readRecentEmoji(mx)
    // A stable sort keeps the most recent first among emoji used as often.
    .sort(([, countA], [, countB]) => countB - countA)
    .flatMap(([key]): Array<IEmoji | PackImageReader> => {
      const emoji = key.startsWith('mxc://') ? customByUrl.get(key) : getEmojiByUnicode(key);
      return emoji ? [emoji] : [];
    });
  return limit === undefined ? recent : recent.slice(0, limit);
};

/** Records a use of the emoji (Unicode text, or the mxc URL of a custom emoji). */
export const addRecentEmoji = async (mx: MatrixClient, emoji: string): Promise<void> => {
  const recent = readRecentEmoji(mx);
  const count = recent.find(([key]) => key === emoji)?.[1] ?? 0;
  const used: RecentEmoji = [emoji, count + 1];
  const next = [used, ...recent.filter(([key]) => key !== emoji)].slice(0, MAX_RECENT_EMOJI);
  await mx.setAccountData(
    AccountDataEvent.ElementRecentEmoji as never,
    {
      recent_emoji: next,
    } as never
  );
};
