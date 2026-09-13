import type { MouseEventHandler } from 'react';
import type { EventTimelineSet, MatrixEvent } from 'matrix-js-sdk';
import type { ThreadRecord } from '../types';
import type { useThreadApprovalTimeline } from '../useThreadApprovalTimeline';

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
  handleOpenReply: MouseEventHandler;
};

export type TimelineMessageKind = 'message' | 'approval' | 'encrypted' | 'sticker';
