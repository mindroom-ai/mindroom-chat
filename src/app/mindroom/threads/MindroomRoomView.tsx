import React, { useCallback, useRef } from 'react';
import type { Room } from 'matrix-js-sdk';
import { Box } from 'folds';
import { useEditor } from '../../components/editor';
import { Page } from '../../components/page';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { RoomViewTyping } from '../../features/room/RoomViewTyping';
import { RoomInput } from '../room-input/MindroomRoomInput';
import { BackgroundJobsBar } from '../background-jobs/BackgroundJobsBar';
import { ThreadApprovalQueue } from '../messages/ThreadApprovalControls';
import { ThreadApprovalProvider } from '../messages/ThreadApprovalProvider';
import type { ScrollAnchorMemory } from '../scroll/scrollAnchorMemory';
import { RoomTimeline } from './MindroomRoomTimeline';
import { RoomViewHeader } from './MindroomRoomViewHeader';
import { ThreadContextBanner } from './ThreadContextBanner';
import { useRoomViewThreadState } from './useRoomViewThreadState';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';

const EMPTY_SUMMARY_MAP = new Map<string, MindroomThreadSummaryInfo>();
/** Stand-in for handlers the thread state mock or a minimal state leaves out. */
const ignoreSummary = () => undefined;

const BACKGROUND_JOB_CANCEL_EVENT = 'io.mindroom.background_job_cancel';

export type RoomViewProps = {
  room: Room;
  eventId?: string;
  threadId?: string;
  hasMindroomAgents?: boolean;
  joinRequestCount?: number;
  computerAvailable?: boolean;
  computerOpen?: boolean;
  onComputerToggle?: () => void;
  onThreadLoadError?: (threadId: string) => void;
};

/**
 * The main area of a room: header, the Compact or Full timeline (or the open thread with its
 * banner), approvals and background jobs, and the composer. The composer stays mounted when a
 * thread opens, so a send that opened the thread keeps its pending uploads.
 */
export function RoomView({
  room,
  eventId,
  threadId,
  hasMindroomAgents,
  joinRequestCount,
  computerAvailable,
  computerOpen,
  onComputerToggle,
  onThreadLoadError,
}: RoomViewProps) {



  const compactRoomScrollStateRef = useRef<ScrollAnchorMemory>(new Map());



  const canCancelJobs = permissions.event(BACKGROUND_JOB_CANCEL_EVENT, mx.getSafeUserId());

  const threadState = useRoomViewThreadState({ room, threadId, eventId, hasMindroomAgents });
  const effectiveThreadId = threadState.effectiveThreadId;
  const focusConversation = useCallback(() => {
    roomInputRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
  }, []);

  return (
    <Page>
      <ThreadApprovalProvider
        room={room}
        threadId={effectiveThreadId}
        focusConversation={focusConversation}
      >
        <RoomViewHeader
          hasMindroomAgents={hasMindroomAgents}
          joinRequestCount={joinRequestCount}
          computerAvailable={computerAvailable}
          computerOpen={computerOpen}
          onComputerToggle={onComputerToggle}
        />
        {effectiveThreadId && (
          <ThreadContextBanner
            room={room}
            threadId={effectiveThreadId}
            summaryInfo={threadState.threadSummaryInfo}
            onExitThread={threadState.handleExitThread ?? ignoreSummary}
          />
        )}
        <Box grow="Yes" direction="Column" style={{ minHeight: 0 }}>
          <RoomTimeline
            key={`${room.roomId}:${effectiveThreadId ?? ''}`}
            room={room}
            eventId={eventId}
            threadId={effectiveThreadId}
            summaryMap={threadState.summaryMap ?? EMPTY_SUMMARY_MAP}
            onStoreThreadSummary={threadState.storeThreadSummary ?? ignoreSummary}
            threadFilterState={threadState.threadFilterState}
            threadSortFreezeState={threadState.threadSortFreezeState ?? null}
            viewMode={threadState.viewMode}
            compactRoomScrollStateRef={compactRoomScrollStateRef}
            editor={editor}
            onThreadLoadError={onThreadLoadError}
          />
        </Box>
        <Box direction="Column" shrink="No">
          <BackgroundJobsBar
            room={room}
            threadId={effectiveThreadId ?? null}
            canCancel={canCancelJobs}
          />
          {effectiveThreadId && <ThreadApprovalQueue />}
        </Box>
      </ThreadApprovalProvider>
      {/* Outside the approval provider: opening a thread must not remount the composer. */}
      <Box direction="Column" shrink="No">





          threadId={effectiveThreadId}
          editor={editor}
          fileDropContainerRef={roomInputRef}
          onRoomMessageSent={threadState.handleRoomMessageSent}
        />
      </Box>
    </Page>
  );
}
