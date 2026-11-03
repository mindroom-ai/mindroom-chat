import { useEffect, useMemo, useState } from 'react';
import { ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';
import type { ImagePack } from '../plugins/custom-emoji';
import { getRecentEmojis } from '../plugins/recent-emoji';

/**
 * The account's recently used emoji (`io.element.recent_emoji`), most used first, following
 * changes. Custom emoji are kept only when one of `imagePacks` still has them.
 */
export const useRecentEmoji = (mx: MatrixClient, limit?: number, imagePacks?: ImagePack[]) => {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handleAccountData = (event: MatrixEvent) => {
      if (event.getType() === AccountDataEvent.ElementRecentEmoji) {









  return useMemo(() => {
    void version;
    return getRecentEmojis(mx, limit, imagePacks);
  }, [mx, limit, imagePacks, version]);
};
