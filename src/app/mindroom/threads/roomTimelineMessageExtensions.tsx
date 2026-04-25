import type { MatrixEvent } from 'matrix-js-sdk';
import {
  getToolApprovalRenderContent,
  MINDROOM_TOOL_APPROVAL_EVENT,
} from '../messages/toolApproval';
import { ThreadBadgeRenderer } from './ThreadBadgeRenderer';
import { buildThreadBadgeViewModelFromRecord } from './threadBadgeViewModel';
import type { ThreadBadgeViewModel, ThreadRecord } from './types';

export const MINDROOM_ROOM_TIMELINE_APPROVAL_EVENT = MINDROOM_TOOL_APPROVAL_EVENT;

export { ThreadBadgeRenderer as MindroomRoomTimelineThreadBadgeRenderer };

export const getMindroomRoomTimelineApprovalContent = (
  event: MatrixEvent,
  editedEvent?: MatrixEvent
): Record<string, unknown> =>
  getToolApprovalRenderContent(
    event.getContent() as Record<string, unknown>,
    editedEvent?.getContent() as Record<string, unknown> | undefined
  );

export const getMindroomRoomTimelineThreadBadgeModel = ({
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
