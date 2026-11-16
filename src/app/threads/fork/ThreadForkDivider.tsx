import { useTranslation } from 'react-i18next';
import { Text } from 'folds';
import { IconGitFork } from '@tabler/icons-react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { useCachedThreadRoot } from '../../event-store/sdk/cachedThreadRoots';
import type { ThreadForkRef } from '../../event-store/threads/threadFork';
import { replaceMatrixUserIdsWithDisplayNames } from '../../event-store/threads/threadMessagePreview';
import {
  getThreadPrimarySummaryText,
  resolveThreadPresentationSnapshot,
} from '../../event-store/threads/threadPresentation';
import type { ThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import * as css from './ThreadForkDivider.css';

/**
 * A thread's title as its card names it: its AI summary, else the start of its first message.
 * The root comes from the room, else from `root` (a fork's prefix holds its parent's), else from
 * the event cache.
 */
const useThreadTitle = (
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

/**
 * The line between a fork's parent messages and its own: "Forked from <the parent's title>",
 * which opens the parent thread at the fork point.
 */
export function ThreadForkDivider({
  room,
  parent,
  root,
  summaryInfo,
}: {
  room: Room;
  parent: ThreadForkRef;
  /** The parent's root, when it is loaded. */
  root?: MatrixEvent;
  /** The parent's AI title, when the room knows it. */
  summaryInfo?: ThreadSummaryInfo;
}) {
  const { t } = useTranslation();
  const { navigateRoomThread } = useRoomNavigate();
  const title = useThreadTitle(room, parent.threadId, root, summaryInfo);
  return (
    <div className={css.Divider}>
      <span className={css.Rule} aria-hidden />
      <button
        type="button"
        className={css.Link}
        onClick={() => navigateRoomThread(room.roomId, parent.threadId, parent.eventId)}
      >
        <IconGitFork size={14} stroke={1.8} aria-hidden />
        <Text as="span" size="L400" truncate>
          {t('threadFork.forkedFrom', { title })}
        </Text>
      </button>
      <span className={css.Rule} aria-hidden />
    </div>
  );
}
