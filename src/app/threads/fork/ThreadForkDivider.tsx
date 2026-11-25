import { useTranslation } from 'react-i18next';
import { Icon, Text } from 'folds';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { useCachedThreadRoot } from '../../event-store/sdk/cachedThreadRoots';
import type { ThreadForkRef } from '../../event-store/threads/threadFork';
import { replaceMatrixUserIdsWithDisplayNames } from '../../event-store/threads/threadMessagePreview';
import {
  getThreadPrimarySummaryText,
  resolveThreadPresentationSnapshot,
} from '../../event-store/threads/threadPresentation';
import { useJoinedRoom } from '../../matrix/hooks/useJoinedRoom';
import { useOptionalMatrixClient } from '../../matrix/hooks/useMatrixClient';
import type { ThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import { ForkIcon } from '../../messages/ForkIcon';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import * as css from './ThreadForkDivider.css';

/**
 * Resolves the parent room for a fork reference: `fallbackRoom` for same-room forks, the joined
 * parent room for accessible cross-room forks, or `undefined` when the user is not joined to the
 * referenced cross-room parent.
 */
export const useForkParentRoom = (
  fallbackRoom: Room,
  parentRoomId: string | undefined
): Room | undefined => {
  const mx = useOptionalMatrixClient();
  const isCrossRoom = Boolean(parentRoomId && parentRoomId !== fallbackRoom.roomId);
  const joinedParent = useJoinedRoom(mx, isCrossRoom ? parentRoomId : undefined);
  return isCrossRoom ? joinedParent : fallbackRoom;
};

/**
 * A thread's title as its card names it: its AI summary, else the start of its first message.
 * The root comes from the room, else from `root` (a fork's prefix holds its parent's), else from
 * the event cache.
 */
export const useThreadTitle = (
  room: Room,
  threadId: string,
  root: MatrixEvent | undefined,
  summaryInfo: ThreadSummaryInfo | undefined
): string => {
  const { t } = useTranslation();
  const thread = room.getThread(threadId);
  const knownRoot = thread?.rootEvent ?? room.findEventById(threadId) ?? root;
  const cachedRoot = useCachedThreadRoot(room, threadId, knownRoot);
  const presentation = resolveThreadPresentationSnapshot({
    room,
    threadRootId: threadId,
    thread,
    rootEvent: knownRoot ?? cachedRoot,
    preferredSummaryInfo: summaryInfo,
  });
  const title =
    getThreadPrimarySummaryText(presentation, t) ??
    t('mindroomUi.threads.compactThreadCardViewModel.threadStarted');
  return replaceMatrixUserIdsWithDisplayNames(room, title);
};

function JoinedThreadForkDivider({
  parentRoom,
  parent,
  root,
  summaryInfo,
  isCrossRoom,
}: {
  parentRoom: Room;
  parent: ThreadForkRef;
  root?: MatrixEvent;
  summaryInfo?: ThreadSummaryInfo;
  isCrossRoom: boolean;
}) {
  const { t } = useTranslation();
  const { navigateRoomThread } = useRoomNavigate();
  const title = useThreadTitle(parentRoom, parent.threadId, root, summaryInfo);
  const parentRoomName = parentRoom.name || parentRoom.roomId;
  const text = isCrossRoom
    ? t('threadFork.forkedFromInRoom', { title, room: parentRoomName })
    : t('threadFork.forkedFrom', { title });
  return (
    <div className={css.Divider} data-fork-divider-variant="forked">
      <span className={css.Rule} aria-hidden />
      <button
        type="button"
        className={css.Link}
        onClick={() => navigateRoomThread(parentRoom.roomId, parent.threadId, parent.eventId)}
      >
        <Icon size="100" src={ForkIcon} aria-hidden="true" />
        <Text as="span" size="L400" truncate>
          {text}
        </Text>
      </button>
      <span className={css.Rule} aria-hidden />
    </div>
  );
}

/**
 * The line between a fork's parent messages and its own: "Forked from <the parent's title>" (or
 * "Forked from <title> in <room>" across rooms), which opens the parent thread at the fork point,
 * or static "Forked from another room" when the parent room is not joined. In a fork draft
 * (`variant` `forking`) it sits under the fork point as a dashed Warning draft boundary pointing
 * to the composer below.
 */
export function ThreadForkDivider({
  room,
  parent,
  root,
  summaryInfo,
  variant = 'forked',
  targetRoomName,
}: {
  room: Room;
  parent: ThreadForkRef;
  /** The parent's root, when it is loaded. */
  root?: MatrixEvent;
  /** The parent's AI title, when the room knows it. */
  summaryInfo?: ThreadSummaryInfo;
  variant?: 'forked' | 'forking';
  /** In a cross-room fork draft, the destination room's name. */
  targetRoomName?: string;
}) {
  const { t } = useTranslation();
  const isCrossRoom = Boolean(parent.roomId && parent.roomId !== room.roomId);
  const parentRoom = useForkParentRoom(room, parent.roomId);
  if (variant === 'forking' || !parentRoom) {
    const forking = variant === 'forking';
    const text = forking
      ? targetRoomName
        ? t('threadFork.forkingIntoRoom', { room: targetRoomName })
        : t('threadFork.forking')
      : t('threadFork.forkedFromAnotherRoom');
    return (
      <div
        className={forking ? css.DividerForking : css.Divider}
        data-fork-divider-variant={forking ? 'forking' : 'forked'}
      >
        <span className={forking ? css.RuleForking : css.Rule} aria-hidden />
        <span className={css.Label}>
          <Icon size="100" src={ForkIcon} aria-hidden="true" />
          <Text as="span" size="L400" truncate>
            {text}
          </Text>
        </span>
        <span className={forking ? css.RuleForking : css.Rule} aria-hidden />
      </div>
    );
  }
  return (
    <JoinedThreadForkDivider
      parentRoom={parentRoom}
      parent={parent}
      root={root}
      summaryInfo={summaryInfo}
      isCrossRoom={isCrossRoom}
    />
  );
}
