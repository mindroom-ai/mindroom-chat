import { type IContent, type MatrixEvent, RelationType, type Room } from 'matrix-js-sdk';
import { hasMindroomMessageExtras } from '../../components/message/mindroomMessageExtras';
import { getMindroomLongTextMxcUri } from '../messages/longText';
import { hasMindroomThreadSummary } from '../messages/threadSummary';
import type { ThreadFilterState } from './roomThreadOverviewModel';
import { isRenderableEvent } from './roomTimelineEvents';
import { getThreadFilteredEvents } from './threadRoomFocus';
import { isThreadOnlyRoomActivity } from './threadRenderUtils';
import type { ThreadRecord } from './types';
import { eventBelongsToThread, isVisibleThreadTextMessageEventType } from './threadUtils';

const isCollapsibleTextMessageEvent = (mEvent: MatrixEvent): boolean =>
  isVisibleThreadTextMessageEventType(mEvent.getType());

export type ShouldTrackLiveCollapsibleMessage = {
  mEvent: MatrixEvent;
  room: Room;
  threadId: string | undefined;
  threadFilterState: ThreadFilterState;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
  threadRecordMap?: ReadonlyMap<string, ThreadRecord>;
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
};

export const shouldTrackLiveCollapsibleMessage = ({
  mEvent,
  room,
  threadId,
  threadFilterState,
  threadResolutionMap,
  threadRecordMap,
  ignoredUsersSet,
  showHiddenEvents,
  hideMembershipEvents,
  hideNickAvatarEvents,
}: ShouldTrackLiveCollapsibleMessage): boolean => {
  const mEventId = mEvent.getId();
  if (!mEventId || !isCollapsibleTextMessageEvent(mEvent)) return false;

  if (
    !isRenderableEvent(
      mEvent,
      room,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents
    )
  ) {
    return false;
  }

  if (threadId) {
    return mEventId === threadId || eventBelongsToThread(mEvent, threadId);
  }

  if (isThreadOnlyRoomActivity(room, mEvent)) {
    return false;
  }

  return (
    getThreadFilteredEvents(
      [mEvent],
      room,
      threadResolutionMap,
      threadId,
      threadFilterState,
      undefined,
      threadRecordMap
    ).length > 0
  );
};

export const getLiveCollapsibleMessageExpandId = (
  opts: ShouldTrackLiveCollapsibleMessage
): string | undefined => {
  const { mEvent, room } = opts;
  const mEventId = mEvent.getId();
  if (!mEventId || !isCollapsibleTextMessageEvent(mEvent)) return undefined;

  const relation = mEvent.getRelation();
  if (relation?.rel_type === RelationType.Replace) {
    const targetEventId = relation.event_id;
    if (!targetEventId) return undefined;

    const targetEvent = room.findEventById(targetEventId);
    if (
      targetEvent &&
      isCollapsibleTextMessageEvent(targetEvent) &&
      shouldTrackLiveCollapsibleMessage({
        ...opts,
        mEvent: targetEvent,
      })
    ) {
      return targetEventId;
    }

    return undefined;
  }

  return shouldTrackLiveCollapsibleMessage(opts) ? mEventId : undefined;
};

export const getHydratedLongTextExtrasCollapseKey = (
  mEventId: string,
  resolvedContent: IContent
): string | undefined => {
  const mxcUri = getMindroomLongTextMxcUri(resolvedContent as Record<string, unknown>);
  return mxcUri ? JSON.stringify([mEventId, mxcUri]) : undefined;
};

export const getCollapsibleMessageMode = (
  mEventId: string,
  resolvedContent: IContent,
  liveExpandOnceIds: Set<string>,
  hydratedLongTextExtrasCollapseKeys?: ReadonlySet<string>
) => {
  const hydratedLongTextExtrasCollapseKey = getHydratedLongTextExtrasCollapseKey(
    mEventId,
    resolvedContent
  );
  if (
    hasMindroomThreadSummary(resolvedContent as Record<string, unknown>) ||
    hasMindroomMessageExtras(resolvedContent as Record<string, unknown>) ||
    (hydratedLongTextExtrasCollapseKey &&
      hydratedLongTextExtrasCollapseKeys?.has(hydratedLongTextExtrasCollapseKey))
  ) {
    return 'always-expanded';
  }

  return liveExpandOnceIds.has(mEventId) ? 'initially-expanded' : 'default';
};

export const getCollapsibleMessageMeasurementKey = (
  mEvent: MatrixEvent,
  collapseMode: ReturnType<typeof getCollapsibleMessageMode>,
  editedEvent?: MatrixEvent
): string =>
  [
    mEvent.getId() ?? '',
    mEvent.isRedacted() ? 'redacted' : 'active',
    editedEvent?.getId() ?? '',
    collapseMode,
  ].join('|');

export const consumeLiveExpandOnceId = (liveExpandOnceIds: Set<string>, mEventId: string) => {
  liveExpandOnceIds.delete(mEventId);
};
