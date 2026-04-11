import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { Box, Text, config } from 'folds';
import { EventType, Room } from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { isKeyHotkey } from 'is-hotkey';
import { useStateEvent } from '../../hooks/useStateEvent';
import { StateEvent } from '../../../types/matrix/room';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useEditor } from '../../components/editor';
import { RoomInputPlaceholder } from './RoomInputPlaceholder';
import { RoomTimeline } from './RoomTimeline';
import { RoomViewTyping } from './RoomViewTyping';
import { RoomTombstone } from './RoomTombstone';
import { RoomInput } from './RoomInput';
import { RoomViewFollowing, RoomViewFollowingPlaceholder } from './RoomViewFollowing';
import { Page } from '../../components/page';
import { RoomViewHeader } from './RoomViewHeader';
import { useKeyDown } from '../../hooks/useKeyDown';
import { editableActiveElement } from '../../utils/dom';
import { settingsAtom } from '../../state/settings';
import { useSetting } from '../../state/hooks/settings';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useEdgeSwipeBack } from '../../hooks/useEdgeSwipeBack';
import { useIOSKeyboardFix } from '../../hooks/useIOSKeyboardFix';
import type {
  ThreadFilterKey,
  FilterPreset,
  ThreadSortFreezeState,
} from './roomThreadOverviewModel';
import {
  updateThreadFilterKey,
  cycleSortMode,
  cycleTagFilter,
  addTagFilter,
  removeTagFilter,
  applyPreset,
  resetThreadFilterState,
} from './roomThreadOverviewModel';
import { roomThreadFilterAtomFamily } from '../../state/room/roomThreadFilterState';
import { roomViewModeAtomFamily, type RoomViewMode } from '../../state/room/roomViewMode';
import { createSessionId } from '../../state/sessions';
import { ThreadContextBanner } from './ThreadContextBanner';
import { useRoomThreadSummaryState } from './useRoomThreadSummaryState';
import { useThreadRootEvent } from './useThreadRootEvent';
import { bumpRecentThread } from '../../state/recentThreads';

const FN_KEYS_REGEX = /^F\d+$/;
const shouldFocusMessageField = (evt: KeyboardEvent): boolean => {
  const { code } = evt;
  if (evt.metaKey || evt.altKey || evt.ctrlKey) {
    return false;
  }

  // do not focus on F keys
  if (FN_KEYS_REGEX.test(code)) return false;

  // do not focus on numlock/scroll lock
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
  eventId,
  focusEventInRoom,
  threadId,
  onThreadLoadError,
}: {
  room: Room;
  eventId?: string;
  focusEventInRoom?: boolean;
  threadId?: string;
  onThreadLoadError?: (threadId: string) => void;
}) {
  const roomInputRef = useRef<HTMLDivElement>(null);
  const roomViewRef = useRef<HTMLDivElement>(null);

  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');

  const { roomId } = room;
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const sessionId = useMemo(() => createSessionId(mx.getHomeserverUrl(), userId), [mx, userId]);
  const editor = useEditor();
  const roomViewModeAtom = roomViewModeAtomFamily(roomId);
  const [viewMode, setViewMode] = useAtom(roomViewModeAtom);
  const threadFilterAtom = useMemo(
    () => roomThreadFilterAtomFamily(userId, roomId),
    [roomId, userId]
  );
  const [threadFilterState, setThreadFilterState] = useAtom(threadFilterAtom);
  const [threadSortFreezeState, setThreadSortFreezeState] =
    useState<ThreadSortFreezeState | null>(null);

  const tombstoneEvent = useStateEvent(room, StateEvent.RoomTombstone);
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const permissions = useRoomPermissions(creators, powerLevels);
  const canMessage = permissions.event(EventType.RoomMessage, mx.getSafeUserId());
  const { navigateRoomFocusEvent, navigateRoomThread } = useRoomNavigate();
  const { summaryMap, storeThreadSummary } = useRoomThreadSummaryState({
    roomId,
    sessionId,
  });
  const threadRootId = useThreadRootEvent(room, threadId);
  const effectiveThreadId = threadRootId ?? threadId;
  const threadSummaryText = threadRootId ? summaryMap.get(threadRootId)?.summaryText : undefined;

  const handleExitThread = useCallback(() => {
    if (!effectiveThreadId) return;
    navigateRoomFocusEvent(room.roomId, effectiveThreadId, { replace: true });
  }, [effectiveThreadId, navigateRoomFocusEvent, room.roomId]);

  const handleToggle = useCallback(
    (key: ThreadFilterKey) => {
      setThreadFilterState(updateThreadFilterKey(threadFilterState, key));
    },
    [setThreadFilterState, threadFilterState]
  );

  const handleSortDirectionChange = useCallback(() => {
    setThreadFilterState({
      ...threadFilterState,
      ...cycleSortMode(threadFilterState),
    });
  }, [setThreadFilterState, threadFilterState]);

  const handleToggleThreadSortFreeze = useCallback(() => {
    setThreadSortFreezeState((currentState) =>
      currentState
        ? null
        : {
            controlSignature: null,
            orderedRootIds: [],
          }
    );
  }, []);

  const handleReset = useCallback(() => {
    setThreadFilterState(resetThreadFilterState());
  }, [setThreadFilterState]);

  const handleCycleTag = useCallback(
    (tag: string) => {
      setThreadFilterState(cycleTagFilter(threadFilterState, tag));
    },
    [setThreadFilterState, threadFilterState]
  );

  const handleAddTag = useCallback(
    (tag: string) => {
      setThreadFilterState(addTagFilter(threadFilterState, tag));
    },
    [setThreadFilterState, threadFilterState]
  );

  const handleRemoveTag = useCallback(
    (tag: string) => {
      setThreadFilterState(removeTagFilter(threadFilterState, tag));
    },
    [setThreadFilterState, threadFilterState]
  );

  const handleApplyPreset = useCallback(
    (preset: FilterPreset) => {
      setThreadFilterState(applyPreset(threadFilterState, preset));
    },
    [setThreadFilterState, threadFilterState]
  );

  const handleSearchQueryChange = useCallback(
    (query: string) => {
      setThreadFilterState({
        ...threadFilterState,
        searchQuery: query,
      });
    },
    [setThreadFilterState, threadFilterState]
  );

  const handleViewModeChange = useCallback(
    (mode: RoomViewMode) => setViewMode(mode),
    [setViewMode]
  );

  useEffect(() => {
    setThreadSortFreezeState(null);
  }, [roomId]);

  useEffect(() => {
    if (threadFilterState.sortBy === 'natural') {
      setThreadSortFreezeState(null);
    }
  }, [threadFilterState.sortBy]);

  useEffect(() => {
    if (!threadId || !effectiveThreadId || threadId === effectiveThreadId) return;

    navigateRoomThread(room.roomId, effectiveThreadId, eventId, { replace: true });
  }, [effectiveThreadId, eventId, navigateRoomThread, room.roomId, threadId]);

  useEffect(() => {
    if (!effectiveThreadId) return;

    bumpRecentThread(room.roomId, effectiveThreadId);
  }, [effectiveThreadId, room.roomId]);

  // Thread view has a more specific "back" action than the generic room-page back:
  // first swipe exits the thread, then the room header/back handler can navigate out.
  useEdgeSwipeBack(handleExitThread, !!threadId);
  useIOSKeyboardFix();

  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (editableActiveElement()) return;
        const portalContainer = document.getElementById('portalContainer');
        if (portalContainer && portalContainer.children.length > 0) {
          return;
        }
        if (shouldFocusMessageField(evt) || isKeyHotkey('mod+v', evt)) {
          ReactEditor.focus(editor);
        }
      },
      [editor]
    )
  );

  return (
    <Page ref={roomViewRef}>
      <RoomViewHeader threadId={effectiveThreadId} />
      {effectiveThreadId && (
        <ThreadContextBanner
          room={room}
          threadId={effectiveThreadId}
          summaryText={threadSummaryText}
          onExitThread={handleExitThread}
        />
      )}
      <Box grow="Yes" direction="Column">
        <RoomTimeline
          key={`${roomId}:${effectiveThreadId ?? ''}`}
          room={room}
          eventId={eventId}
          focusEventInRoom={focusEventInRoom}
          threadId={effectiveThreadId}
          threadFilterState={threadFilterState}
          threadSortFreezeState={threadSortFreezeState}
          onToggle={handleToggle}
          onSortDirectionChange={handleSortDirectionChange}
          onToggleThreadSortFreeze={handleToggleThreadSortFreeze}
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
              {canMessage && (
                <RoomInput
                  room={room}
                  editor={editor}
                  roomId={roomId}
                  threadId={effectiveThreadId}
                  fileDropContainerRef={roomViewRef}
                  ref={roomInputRef}
                />
              )}
              {!canMessage && (
                <RoomInputPlaceholder
                  style={{ padding: config.space.S200 }}
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
