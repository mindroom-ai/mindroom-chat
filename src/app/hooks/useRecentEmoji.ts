import { useEffect, useMemo, useState } from 'react';
import { ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';
import type { ImagePack } from '../plugins/custom-emoji';
import { getRecentEmojis } from '../plugins/recent-emoji';

/**
 * The account's recently used emoji (`io.element.recent_emoji`), most used first, following
 * changes. Custom emoji are kept only when one of `imagePacks` still has them.
 */
export const useRecentEmoji = (client: MatrixClient, limit?: number, imagePacks?: ImagePack[]) => {
  const [version, setVersion] = useState(0);

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
    return getRecentEmojis(client, limit, imagePacks);
  }, [client, limit, imagePacks, version]);
};
