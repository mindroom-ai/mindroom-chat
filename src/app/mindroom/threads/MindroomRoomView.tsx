import React, { useCallback, useRef } from 'react';
import { Box, Text, config } from 'folds';
import { EventType, Room } from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { isKeyHotkey } from 'is-hotkey';
import { useStateEvent } from '../../hooks/useStateEvent';
import { StateEvent } from '../../../types/matrix/room';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useEditor } from '../../components/editor';
import { RoomInputPlaceholder } from '../../features/room/RoomInputPlaceholder';
import { RoomViewTyping } from '../../features/room/RoomViewTyping';
import { RoomTombstone } from '../../features/room/RoomTombstone';
import {
  RoomViewFollowing,
  RoomViewFollowingPlaceholder,
} from '../../features/room/RoomViewFollowing';
import { RoomInput } from '../room-input/MindroomRoomInput';
import { RoomTimeline } from './MindroomRoomTimeline';
import { Page } from '../../components/page';
import { RoomViewHeader } from './MindroomRoomViewHeader';
import { useKeyDown } from '../../hooks/useKeyDown';
import { editableActiveElement } from '../../utils/dom';
import { settingsAtom } from '../../state/settings';
import { useSetting } from '../../state/hooks/settings';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { hasBlockingPortalOverlay } from '../../utils/portalOverlay';
import { ThreadContextBanner } from './ThreadContextBanner';
import { useRoomViewThreadState } from './useRoomViewThreadState';
import { isLocalEchoEventId } from './threadRouteUtils';

const FN_KEYS_REGEX = /^F\d+$/;
const shouldFocusMessageField = (evt: KeyboardEvent): boolean => {
  const { code } = evt;
  if (evt.metaKey || evt.altKey || evt.ctrlKey) {
    return false;
  }

  if (FN_KEYS_REGEX.test(code)) return false;

  if (
    code.startsWith('OS') ||
    code.startsWith('Meta') ||
    code.startsWith('Shift') ||
    code.startsWith('Alt') ||
    code.startsWith('Control') ||
    code.startsWith('Arrow') ||
    code.startsWith('Page') ||
    code.startsWith('End') ||
    code.startsWith('Home') ||
    code === 'Tab' ||
    code === 'Space' ||
    code === 'Enter' ||
    code === 'NumLock' ||
    code === 'ScrollLock'
  ) {
    return false;
  }

  return true;
};

export function RoomView({
  room,
  hasMindroomAgents = true,
  eventId,
  focusEventInRoom,
  threadId,
  onThreadLoadError,
}: {
  room: Room;
  hasMindroomAgents?: boolean;
  eventId?: string;
  focusEventInRoom?: boolean;
  threadId?: string;
  onThreadLoadError?: (threadId: string) => void;
}) {
  const roomInputRef = useRef<HTMLDivElement>(null);
  const roomViewRef = useRef<HTMLDivElement>(null);
  const compactRoomScrollStateRef = useRef(new Map<string, number>());

  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');

  const { roomId } = room;
  const mx = useMatrixClient();
  const editor = useEditor();

  const tombstoneEvent = useStateEvent(room, StateEvent.RoomTombstone);
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const permissions = useRoomPermissions(creators, powerLevels);
  const canMessage = permissions.event(EventType.RoomMessage, mx.getSafeUserId());
  const {
    effectiveThreadId,
    handleAddTag,
    handleApplyPreset,
    handleCycleTag,
    handleExitThread,
    handleRemoveTag,
    handleReset,
    handleRoomMessageSent,
    handleSearchQueryChange,
    handleSortDirectionChange,
    handleToggle,
    handleToggleThreadSortFreeze,
    handleToggleUnresolvedOnly,
    handleViewModeChange,
    setThreadSortFreezeState,
    storeThreadSummary,
    summaryMap,
    threadFilterState,
    threadSortFreezeState,
    threadSummaryInfo,
    viewMode,
  } = useRoomViewThreadState({ eventId, hasMindroomAgents, room, threadId });
  const pendingThreadRoot = isLocalEchoEventId(effectiveThreadId);

  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (pendingThreadRoot) return;
        if (editableActiveElement()) return;
        if (hasBlockingPortalOverlay()) return;
        if (shouldFocusMessageField(evt) || isKeyHotkey('mod+v', evt)) {
          ReactEditor.focus(editor);
        }
      },
      [editor, pendingThreadRoot]
    )
  );

  return (
    <Page ref={roomViewRef}>
      <RoomViewHeader threadId={effectiveThreadId} />
      {effectiveThreadId && (
        <ThreadContextBanner
          room={room}
          threadId={effectiveThreadId}
          summaryInfo={threadSummaryInfo}
          onExitThread={handleExitThread}
        />
      )}
      <Box grow="Yes" direction="Column">
        <RoomTimeline
          key={`${roomId}:${effectiveThreadId ?? ''}`}
          room={room}
          hasMindroomAgents={hasMindroomAgents}
          eventId={eventId}
          focusEventInRoom={focusEventInRoom}
          threadId={effectiveThreadId}
          threadFilterState={threadFilterState}
          threadSortFreezeState={threadSortFreezeState}
          onToggle={handleToggle}
          onSortDirectionChange={handleSortDirectionChange}
          onToggleThreadSortFreeze={handleToggleThreadSortFreeze}
          onToggleUnresolvedOnly={handleToggleUnresolvedOnly}
          setThreadSortFreezeState={setThreadSortFreezeState}
          onCycleTag={handleCycleTag}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onReset={handleReset}
          onApplyPreset={handleApplyPreset}
          onSearchQueryChange={handleSearchQueryChange}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          onThreadLoadError={onThreadLoadError}
          summaryMap={summaryMap}
          onStoreThreadSummary={storeThreadSummary}
          roomInputRef={roomInputRef}
          compactRoomScrollStateRef={compactRoomScrollStateRef}
          editor={editor}
        />
        <RoomViewTyping room={room} />
      </Box>
      <Box shrink="No" direction="Column">
        <div style={{ padding: `0 ${config.space.S400}` }}>
          {tombstoneEvent ? (
            <RoomTombstone
              roomId={roomId}
              body={tombstoneEvent.getContent().body}
              replacementRoomId={tombstoneEvent.getContent().replacement_room}
            />
          ) : (
            <>
              {canMessage && !pendingThreadRoot && (
                <RoomInput
                  room={room}
                  editor={editor}
                  roomId={roomId}
                  threadId={effectiveThreadId}
                  threadingEnabled={viewMode !== 'classic'}
                  onRoomMessageSent={handleRoomMessageSent}
                  fileDropContainerRef={roomViewRef}
                  ref={roomInputRef}
                />
              )}
              {canMessage && pendingThreadRoot && (
                <RoomInputPlaceholder
                  style={{
                    padding: config.space.S200,
                    paddingBottom: `calc(${config.space.S200} + env(safe-area-inset-bottom, 0px))`,
                  }}
                  alignItems="Center"
                  justifyContent="Center"
                >
                  <Text align="Center">Replies are available after this message is confirmed.</Text>
                </RoomInputPlaceholder>
              )}
              {!canMessage && (
                <RoomInputPlaceholder
                  style={{
                    padding: config.space.S200,
                    paddingBottom: `calc(${config.space.S200} + env(safe-area-inset-bottom, 0px))`,
                  }}
                  alignItems="Center"
                  justifyContent="Center"
                >
                  <Text align="Center">You do not have permission to post in this room</Text>
                </RoomInputPlaceholder>
              )}
            </>
          )}
        </div>
        {hideActivity ? <RoomViewFollowingPlaceholder /> : <RoomViewFollowing room={room} />}
      </Box>
    </Page>
  );
}
