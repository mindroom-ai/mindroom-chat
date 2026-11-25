import { useCallback, type ReactNode } from 'react';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { isUserId } from '../matrix/matrix';
import { getMatrixToUser } from '../matrix/matrix-to';
import { makeMentionCustomProps, renderMatrixMention } from './html/react-custom-html-parser';
import { useMentionClickHandler } from './useMentionClickHandler';

/** Renders a Matrix user ID as a clickable mention in `roomId`, falling back to the raw ID. */
export function useOwnerMention(roomId: string): (userId: string) => ReactNode {
  const mx = useMatrixClient();
  const mentionClickHandler = useMentionClickHandler(roomId);
  return useCallback(
    (userId: string): ReactNode =>
      (isUserId(userId)
        ? renderMatrixMention(mx, roomId, getMatrixToUser(userId), {
            ...makeMentionCustomProps(mentionClickHandler),
            title: userId,
          })
        : undefined) ?? userId,
    [mx, roomId, mentionClickHandler]
  );
}
