import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { hydrateCachedLongText } from '../../event-store/cache/attachmentRepository';
import { hasLoadedFirstThreadPage } from '../../event-store/sdk/threadBootstrapSdk';
import { getKnownThreadReplyCount } from '../../event-store/threads/threadRecord';
import { getThreadTimelineEvents } from '../../event-store/timeline/linkedTimelines';
import { getEventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { getLongTextSource } from '../../matrix/protocol/longText';
import { getEditedEvent, getLatestMessageContent, reactionOrEditEvent } from '../../matrix/room';

/** How long a first open waits for a view without missing replies before it paints what it has. */
export const THREAD_FIRST_PAINT_CAP_MS = 600;
/** The last rows whose long texts load before the first paint, so they mount whole. */
const FIRST_PAINT_LONG_TEXT_ROWS = 10;

const isReplyRow = (mEvent: MatrixEvent, threadId: string): boolean =>
  !!mEvent.getId() &&
  mEvent.getId() !== threadId &&
  !reactionOrEditEvent(mEvent) &&
  !mEvent.isRedaction();

/**
 * Whether the rows an open could paint now leave out replies the thread is known to have: before
 * its first page, a thread holds its root and the replies sync brought, often only the newest.
 */
export const threadSeedHasGap = (room: Room, threadId: string, seed: MatrixEvent[]): boolean => {
  const thread = room.getThread(threadId);
  if (thread && hasLoadedFirstThreadPage(thread)) return false;
  const root = thread?.rootEvent ?? room.findEventById(threadId);
  const known = thread?.length || (root ? getKnownThreadReplyCount(root) : undefined) || 0;
  const replies = new Set(
    [...seed, ...(thread ? getThreadTimelineEvents(thread) : [])]
      .filter((mEvent) => isReplyRow(mEvent, threadId))
      .map((mEvent) => mEvent.getId())
  );
  return replies.size < known;
};

/** Loads the long texts of a thread's last rows into the cache their rows read on mount. */
export const hydrateThreadTailLongTexts = async (
  mx: MatrixClient,
  room: Room,
  threadId: string,
  events: MatrixEvent[] = []
): Promise<void> => {
  const thread = room.getThread(threadId);
  const timelineSet = thread?.getUnfilteredTimelineSet() ?? room.getUnfilteredTimelineSet();
  const rows = new Map<string, MatrixEvent>();
  [...events, ...(thread ? getThreadTimelineEvents(thread) : [])].forEach((mEvent) => {
    if (isReplyRow(mEvent, threadId)) rows.set(mEvent.getId()!, mEvent);
  });
  const tail = [...rows.values()]
    .sort((left, right) => left.getTs() - right.getTs())
    .slice(-FIRST_PAINT_LONG_TEXT_ROWS);
  await Promise.all(
    tail.map((mEvent) => {
      const edited = getEditedEvent(mEvent.getId()!, mEvent, timelineSet);
      const source = getLongTextSource(getLatestMessageContent(mEvent, edited));
      return source
        ? hydrateCachedLongText(mx, { ...source, owner: getEventAttachmentOwner(mEvent) })
        : undefined;
    })
  );
};

/**
 * Holds an open's first paint until `ready` has run its work, or until the cap has passed since
 * the open, whichever is first. A gate made without `held` is open from the start.
 */
export const createThreadFirstPaintGate = (held: boolean, onRelease: () => void) => {
  let open = !held;
  const release = () => {
    if (open) return;
    open = true;
    clearTimeout(timer);
    onRelease();
  };
  const timer = held ? setTimeout(release, THREAD_FIRST_PAINT_CAP_MS) : undefined;
  return {
    held,
    ready: (beforePaint: () => Promise<void>) => {
      if (open) return;
      void beforePaint().then(release, release);
    },
    cancel: () => {
      open = true;
      clearTimeout(timer);
    },
  };
};
