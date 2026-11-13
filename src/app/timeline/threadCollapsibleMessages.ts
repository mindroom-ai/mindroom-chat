import { type IContent, type MatrixEvent, RelationType, type Room } from 'matrix-js-sdk';
import { hasMessageExtras } from '../matrix/protocol/messageExtrasData';
import { getLongTextMxcUri } from '../matrix/protocol/longText';
import { CANVAS_RESPONSE_KEY } from '../messages/canvas/canvasMessages';
import { hasThreadSummary } from '../matrix/protocol/threadSummary';
import type { ThreadFilterState } from '../event-store/threads/roomThreadOverviewModel';
import { isRenderableEvent } from '../event-store/timeline/roomTimelineEvents';
import { getThreadFilteredEvents } from '../threads/threadRoomFocus';
import { isThreadOnlyRoomActivity } from '../event-store/threads/threadRenderUtils';
import type { ThreadRecord } from '../event-store/threads/types';
import { eventBelongsToThread, isVisibleThreadTextMessageEventType } from '../event-store/threads/threadUtils';

const isCollapsibleTextMessageEvent = (mEvent: MatrixEvent): boolean =>
  isVisibleThreadTextMessageEventType(mEvent.getType());

// Only the plain body counts: HTML markup (links, tables) adds length without height, and a
// forced row is never measured, so a false positive would fold a message with nothing hidden.
const FORCE_COLLAPSED_OVERFLOW_BODY_LENGTH = 1200;

export const shouldForceCollapsibleMessageOverflow = (content: IContent): boolean => {
  // A canvas answer shows as a one-line receipt however long its data is; a forged one that
  // renders as text still folds by its measured height.
  if (content[CANVAS_RESPONSE_KEY] !== undefined) return false;
  if (getLongTextMxcUri(content as Record<string, unknown>)) return true;

  const body = content.body;
  return typeof body === 'string' && body.length >= FORCE_COLLAPSED_OVERFLOW_BODY_LENGTH;
};

export type ShouldTrackLiveCollapsibleMessage = {
  mEvent: MatrixEvent;
  room: Room;
  threadId: string | undefined;
  threadFilterState: ThreadFilterState;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
  threadRecordMap?: ReadonlyMap<string, ThreadRecord>;
  ignoredUsersSet: Set<string>;
  readonly hideMembershipEvents: boolean;
  readonly hideNickAvatarEvents: boolean;
  readonly showHiddenEvents: boolean;
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
  // Expand-once opens a long message once as it arrives live; agent replies already show in
  // full, so it applies to other people. The viewer wrote their own, so a long send or edit
  // folds like history.
  if (mEvent.getSender() === room.myUserId) return false;

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

export const getCollapsibleMessageMode = (
  mEventId: string,
  resolvedContent: IContent,
  liveExpandOnceIds: Set<string>,
  isAgentMessage = false
) => {
  // Like T3 Code, agent replies always show in full, attached long text
  // (getLongTextMxcUri) included; people's long messages fold.
  // NOTE deliberately NOT exempt by content: a long-text attachment from a
  // person folds like every other long message, and
  // `shouldForceCollapsibleMessageOverflow` guarantees the "Show more"
  // affordance. Exempting it on hydration unfolded giant rows unprompted
  // (device report 2026-07-06) and flipped their measurement keys mid-life;
  // the agent exemption keys on the sender, which never changes.
  if (
    isAgentMessage ||
    hasThreadSummary(resolvedContent as Record<string, unknown>) ||
    hasMessageExtras(resolvedContent as Record<string, unknown>)
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
