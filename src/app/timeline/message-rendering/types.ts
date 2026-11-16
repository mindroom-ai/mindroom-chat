import type { MouseEventHandler } from 'react';
import type { EventTimelineSet, MatrixEvent } from 'matrix-js-sdk';
import type { ThreadRecord } from '../../event-store/threads/types';
import type { useThreadApprovalTimeline } from '../../approvals/useThreadApprovalTimeline';
import type { ThreadSummaryTimelinePlan } from '../../event-store/threads/threadSummaryTimeline';

export type TimelineMessageRow = Readonly<{
  eventId: string;
  event: MatrixEvent;
  index: number;
  timelineSet: EventTimelineSet;
  collapse: boolean;
  highlighted: boolean;
  previousEventId?: string;
}>;

export type TimelineMessageData = {
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  threadEventMap: ReadonlyMap<string, MatrixEvent>;
  approvalTimeline: ReturnType<typeof useThreadApprovalTimeline>;
  threadSummaryTimeline: ThreadSummaryTimelinePlan;
  handleOpenReply: MouseEventHandler;
  /** In a fork, the IDs of its parent's messages shown before its own: rows read-only here. */
  forkPrefixEventIds?: ReadonlySet<string>;
};

export type { TimelineMessageKind } from '../../event-store/timeline/timelineRowTypes';
