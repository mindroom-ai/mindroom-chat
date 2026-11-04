import { useEffect, useMemo, useState } from 'react';
import { ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';
import type { ImagePack } from '../plugins/custom-emoji';
import type { IEmoji } from '../plugins/emoji';
import { useEmojiData } from '../plugins/emojiData';
import {
  type RecentEmoji,
  type UnnamedEmoji,
  resolveRecentEmoji,
} from '../plugins/recent-emoji-list';

export type { RecentEmoji } from '../plugins/recent-emoji-list';

/**
 * The account's recently used emoji (`io.element.recent_emoji`), most used first, following
 * changes. Custom emoji are kept only when one of `imagePacks` still has them. Unicode emoji
 * come as their text at once, which asks for the emoji data, and as the emoji it knows (or not
 * at all, for text it does not know) once it has loaded.
 */
export const useRecentEmoji = (
  client: MatrixClient,
  limit?: number,
  imagePacks?: ImagePack[]
): RecentEmoji[] => {
  const [version, setVersion] = useState(0);
  const emojiData = useEmojiData();

  useEffect(() => {
    // The list is read from the account data, so a new version is all a reader needs.
    const bumpOnRecentEmoji = (event: MatrixEvent) => {
      if (event.getType() !== AccountDataEvent.ElementRecentEmoji) return;
      setVersion((count) => count + 1);
    };
    client.on(ClientEvent.AccountData, bumpOnRecentEmoji);
    return () => {
      client.off(ClientEvent.AccountData, bumpOnRecentEmoji);
    };
  }, [client]);

  return useMemo(() => {
    void version;
    const lookUp = (unicode: string): IEmoji | UnnamedEmoji | undefined =>
      emojiData ? emojiData.getEmojiByUnicode(unicode) : { unicode };
    return resolveRecentEmoji(client, lookUp, imagePacks, limit);
  }, [client, limit, imagePacks, version, emojiData]);
};
