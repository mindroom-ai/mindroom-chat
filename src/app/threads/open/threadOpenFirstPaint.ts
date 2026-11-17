import type { EventTimelineSet, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { hydrateCachedLongText } from '../../event-store/cache/attachmentRepository';
import { hasLoadedFirstThreadPage } from '../../event-store/sdk/threadBootstrapSdk';
import { getKnownThreadReplyCount } from '../../event-store/threads/threadRecord';
import { getThreadTimelineEvents } from '../../event-store/timeline/linkedTimelines';
import { getEventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import {
  getCachedLongTextContent,
  getLongTextSource,
  getLongTextSourceIdentity,
  type LongTextSource,
} from '../../matrix/protocol/longText';
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

/** The long texts of the last rows the thread shows, read from their shown versions. */
export const getTailLongTextSources = (
  rows: MatrixEvent[],
  timelineSet: Pick<EventTimelineSet, 'relations'> | undefined
): LongTextSource[] =>
  rows
    .filter((mEvent) => !reactionOrEditEvent(mEvent) && !mEvent.isRedaction())
    .slice(-FIRST_PAINT_LONG_TEXT_ROWS)
    .flatMap((mEvent) => {
      const edited = getEditedEvent(mEvent.getId()!, mEvent, timelineSet);
      const source = getLongTextSource(getLatestMessageContent(mEvent, edited));
      return source ? [{ ...source, owner: getEventAttachmentOwner(mEvent) }] : [];
    });

/**
 * Holds an open's first paint until the tail `readTail` gives, read again after each load, has
 * no long text left that is neither cached nor tried, or until the cap has passed since the open.
 * A gate made without `held` is open from the start.
 */
export const createThreadFirstPaintGate = ({
  held,
  mx,
  readTail,
  onRelease,
}: {
  held: boolean;
  mx: MatrixClient;
  readTail: () => LongTextSource[];
  onRelease: () => void;
}) => {
  let open = !held;
  let loading = false;
  const tried = new Set<string>();
  const release = () => {
    if (open) return;
    open = true;
    clearTimeout(timer);
    onRelease();
  };
  const timer = held ? setTimeout(release, THREAD_FIRST_PAINT_CAP_MS) : undefined;
  const loadTail = async () => {
    for (;;) {
      const cold = readTail().filter(
        (source) =>
          !getCachedLongTextContent(source, mx) && !tried.has(getLongTextSourceIdentity(source))
      );
      if (open || cold.length === 0) return;
      cold.forEach((source) => tried.add(getLongTextSourceIdentity(source)));
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(cold.map((source) => hydrateCachedLongText(mx, source)));
    }
  };
  return {
    held,
    /** The view has every reply: load its tail, then paint. A call while loading reads it again. */
    ready: () => {
      if (open || loading) return;
      loading = true;
      void loadTail().then(release, release);
    },
    cancel: () => {
      open = true;
      clearTimeout(timer);
    },
  };
};
