import type { MatrixClient } from 'matrix-js-sdk';
import type { ImagePack, PackImageReader } from './custom';
import { getEmojiByUnicode, type IEmoji } from './emoji';
import { resolveRecentEmoji } from './recent-emoji-list';

export { addRecentEmoji } from './recent-emoji-list';

/**
 * The user's recently used emoji, most used first, as emoji or as the custom emoji of the given
 * packs; a custom emoji none of the packs has is left out before `limit` applies. It reads the
 * emoji data, so the emoji board uses it; `recent-emoji-list.ts` works without the data.
 */
export const getRecentEmojis = (
  mx: MatrixClient,
  limit?: number,
  imagePacks: ImagePack[] = []
): Array<IEmoji | PackImageReader> => resolveRecentEmoji(mx, getEmojiByUnicode, imagePacks, limit);
