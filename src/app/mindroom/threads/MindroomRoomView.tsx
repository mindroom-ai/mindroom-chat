import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import type { CanvasListEntry } from '../canvas/canvasIndexStore';
import type { ScrollAnchorMemory } from '../scroll/scrollAnchorMemory';
import { RoomTimeline } from './MindroomRoomTimeline';
import { RoomViewHeader } from './MindroomRoomViewHeader';
import { ThreadContextBanner } from './ThreadContextBanner';
import { useRoomViewThreadState } from './useRoomViewThreadState';
import type { ThreadSortFreezeState } from './roomThreadOverviewModel';

const BACKGROUND_JOB_CANCEL_EVENT = 'io.mindroom.background_job_cancel';

export type RoomViewProps = {
  room: Room;
  eventId?: string;
  threadId?: string;
  focusEventInRoom?: boolean;
  hasMindroomAgents?: boolean;
  joinRequestCount?: number;
  callView?: boolean;
  computerAvailable?: boolean;
  computerOpen?: boolean;
  computerShown?: boolean;
  onComputerToggle?: () => void;
  canvasOpen?: boolean;
  canvases?: CanvasListEntry[];
  openCanvasId?: string;
  onCanvasOpen?: (canvasId: string) => void;
  onCanvasClose?: () => void;
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
  focusEventInRoom,
  hasMindroomAgents,
  joinRequestCount,
  callView,
  computerAvailable,
  computerOpen,
  onComputerToggle,
  onThreadLoadError,
}: RoomViewProps) {



  const compactRoomScrollStateRef = useRef<ScrollAnchorMemory>(new Map());



  const canCancelJobs = permissions.event(BACKGROUND_JOB_CANCEL_EVENT, mx.getSafeUserId());

  const threadState = useRoomViewThreadState({ room, threadId, eventId, hasMindroomAgents });
  const effectiveThreadId = threadState.effectiveThreadId;
  const [localSortFreeze, setLocalSortFreeze] = useState<ThreadSortFreezeState | null>(null);
  const noop = useCallback(() => undefined, []);

  const timelineProps = useMemo(
    () => ({
      summaryMap: threadState.summaryMap ?? new Map(),
      onStoreThreadSummary: threadState.storeThreadSummary ?? noop,
      threadFilterState: threadState.threadFilterState,
      threadSortFreezeState: threadState.threadSortFreezeState ?? localSortFreeze,
      onToggle: threadState.handleToggle ?? noop,
      onSortDirectionChange: threadState.handleSortDirectionChange ?? noop,
      onToggleThreadSortFreeze: threadState.handleToggleThreadSortFreeze ?? noop,
      setThreadSortFreezeState: threadState.setThreadSortFreezeState ?? setLocalSortFreeze,
      onCycleTag: threadState.handleCycleTag ?? noop,
      onAddTag: threadState.handleAddTag ?? noop,
      onRemoveTag: threadState.handleRemoveTag ?? noop,
      onReset: threadState.handleReset ?? noop,
      onViewModeChange: threadState.handleViewModeChange ?? noop,
    }),
    [localSortFreeze, noop, threadState]
  );

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
        {!callView && (
          <RoomViewHeader
            room={room}
            hasMindroomAgents={hasMindroomAgents}
            joinRequestCount={joinRequestCount}
            computerAvailable={computerAvailable}
            computerOpen={computerOpen}
            onComputerToggle={onComputerToggle}
          />
        )}
        {effectiveThreadId && (
          <ThreadContextBanner
            room={room}
            threadId={effectiveThreadId}
            summaryInfo={threadState.threadSummaryInfo}
            onExitThread={threadState.handleExitThread ?? noop}
          />
        )}
        <Box grow="Yes" direction="Column" style={{ minHeight: 0 }}>
          <RoomTimeline
            key={`${room.roomId}:${effectiveThreadId ?? ''}`}
            room={room}
            eventId={eventId}
            focusEventInRoom={focusEventInRoom}
            threadId={effectiveThreadId}
            hasMindroomAgents={hasMindroomAgents}
            viewMode={threadState.viewMode}
            roomInputRef={roomInputRef}
            compactRoomScrollStateRef={compactRoomScrollStateRef}
            editor={editor}
            onThreadLoadError={onThreadLoadError}
            {...timelineProps}
          />
        </Box>
        <Box direction="Column" shrink="No">
          <BackgroundJobsBar
            room={room}
            threadId={effectiveThreadId ?? null}
            canCancel={canCancelJobs}
          />
          {effectiveThreadId && <ThreadApprovalQueue />}





            threadId={effectiveThreadId}
            editor={editor}
            fileDropContainerRef={roomInputRef}
            onRoomMessageSent={threadState.handleRoomMessageSent}
          />
        </Box>
      </ThreadApprovalProvider>
    </Page>
  );
}
