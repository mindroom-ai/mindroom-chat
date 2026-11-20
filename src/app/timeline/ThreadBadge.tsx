import React, {
  useId,
  useMemo,
  type ComponentPropsWithoutRef,
  type MouseEventHandler,
} from 'react';
import { useTranslation } from 'react-i18next';
import { atom, useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { config, Text, Tooltip } from 'folds';
import { ThreadIndicator, type ThreadIndicatorUnread } from '../messages/ThreadIndicator';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import { buildThreadBadgeViewModelFromRecord } from '../threads/threadBadgeViewModel';
import {
  crossRoomThreadIndexAtom,
  getCrossRoomThreadIndexKey,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';
import { getThreadSignalsReader } from '../threads/cross-room/threadSignalsReader';
import { PopOut, revealDirectionControls } from '../ui/directional';
import { useAnchoredCard } from '../ui/useAnchoredCard';
import { threadSummaryProvenance } from '../messages/thread-summary/threadSummaryProvenance';
import type { ThreadBadgeViewModel, ThreadRecord } from '../event-store/threads/types';

// Read-only, so it holds nothing an account could leave behind.
const noEntryAtom = atom((): CrossRoomThreadIndexEntry | undefined => undefined);

/**
 * Whether an unread thread mentions the user, from the client's shared signals cache that the
 * sidebar and Activity keep filled: a cached read unless the thread changed. The chip follows
 * only its own thread's index entry, so another thread's update renders nothing here, and a read
 * thread follows nothing and reads nothing. Until the index holds the thread, no mention shows.
 * A receipt or a reply re-renders the chip through the timeline, whose records it reads, and the
 * cache reads the thread again for it (`threadChanges` in `threadSignalsReader.ts`).
 */
const useThreadUnread = (
  room: Room,
  threadRootId: string,
  isUnread: boolean
): ThreadIndicatorUnread | undefined => {
  const entryAtom = useMemo(() => {
    if (!isUnread) return noEntryAtom;
    const key = getCrossRoomThreadIndexKey(room.roomId, threadRootId);
    return selectAtom(crossRoomThreadIndexAtom, ({ entries }) => entries.get(key));
  }, [isUnread, room.roomId, threadRootId]);
  const entry = useAtomValue(entryAtom);
  if (!isUnread) return undefined;
  if (!entry) return { mentionsMe: false };
  const signals = getThreadSignalsReader(room.client).read(room, entry, room.myUserId, Date.now());
  return { mentionsMe: signals.mentionedMe };
};

type TimelineThreadIndicatorProps = Omit<
  ComponentPropsWithoutRef<typeof ThreadIndicator>,
  'unread'
> & {
  room: Room;
  threadRootId: string;
  /** The record's unread state, as the sidebar reads it; the signals only add a mention. */
  isUnread: boolean;
  summaryInfo?: ThreadSummaryInfo;
};

/** The timeline's thread chip, which reads "New" while the thread is unread. */
function TimelineThreadIndicator({
  isUnread,
  summaryInfo,
  ...props
}: TimelineThreadIndicatorProps) {
  const unread = useThreadUnread(props.room, props.threadRootId, isUnread);
  const { t } = useTranslation();
  const descriptionId = useId();
  const { open, triggerRef, show, close, hover, onFocusLeave } = useAnchoredCard();
  const title = summaryInfo?.summaryText?.trim()
    ? revealDirectionControls(summaryInfo.summaryText)
    : undefined;
  const description = title && summaryInfo ? threadSummaryProvenance(t, summaryInfo) : undefined;

  return (
    <>
      <ThreadIndicator
        {...props}
        {...(description && hover)}
        ref={triggerRef}
        unread={unread}
        threadTitle={title}
        aria-describedby={description ? descriptionId : undefined}
        onFocus={(event) => {
          // Track keyboard focus even before an asynchronously delivered title arrives.
          if (event.currentTarget.matches(':focus-visible')) show('focus');
        }}
        onBlur={onFocusLeave}
        onClick={(event) => {
          close();
          props.onClick?.(event);
        }}
      />
      {description && (
        <>
          <span id={descriptionId} hidden>
            {description}
          </span>
          <PopOut
            style={{ pointerEvents: 'none' }}
            anchor={open?.anchor}
            position="Top"
            offset={4}
            content={
              <Tooltip role="tooltip">
                <Text size="T300">{description}</Text>
              </Tooltip>
            }
          />
        </>
      )}
    </>
  );
}

type ThreadBadgeProps = {
  model: ThreadBadgeViewModel | undefined;
  room: Room;
  onClick: MouseEventHandler;
  includeRecentSummaryData?: boolean;
};

export const ThreadBadge = ({
  model,
  room,
  onClick,
  includeRecentSummaryData = false,
}: ThreadBadgeProps): React.ReactNode => {
  if (!model) return null;

  const { threadRootId } = model.id;

  return (
    <TimelineThreadIndicator
      as="button"
      style={{ marginTop: config.space.S200 }}
      summaryInfo={model.summaryInfo}
      data-thread-root-id={threadRootId}
      data-event-id={threadRootId}
      data-thread-summary={includeRecentSummaryData ? model.recentThreadSummaryText : undefined}
      threadReplyCount={model.replyCount}
      threadParticipantIds={model.participantIds}
      isResolved={model.isResolved}
      isUnread={model.isUnread}
      threadRootId={threadRootId}
      room={room}
      onClick={onClick}
    />
  );
};

const getThreadBadgeModel = ({
  eventId,
  event,
  threadRecordMap,
  activeThreadId,
}: {
  eventId: string;
  event: Pick<MatrixEvent, 'threadRootId'>;
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  activeThreadId?: string;
}): ThreadBadgeViewModel | undefined => {
  const record = threadRecordMap.get(eventId);
  if (!record) return undefined;

  return buildThreadBadgeViewModelFromRecord({
    record,
    activeThreadId,
    eventThreadRootId: event.threadRootId,
  });
};

type RenderThreadBadgeOptions = {
  eventId: string;
  event: Pick<MatrixEvent, 'threadRootId'>;
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  activeThreadId?: string;
  room: Room;
  onClick: MouseEventHandler;
  includeRecentSummaryData?: boolean;
};

export const renderThreadBadge = ({
  eventId,
  event,
  threadRecordMap,
  activeThreadId,
  room,
  onClick,
  includeRecentSummaryData,
}: RenderThreadBadgeOptions) => {
  const model = getThreadBadgeModel({
    eventId,
    event,
    threadRecordMap,
    activeThreadId,
  });
  if (!model) return null;

  return (
    <ThreadBadge
      model={model}
      room={room}
      onClick={onClick}
      includeRecentSummaryData={includeRecentSummaryData}
    />
  );
};
