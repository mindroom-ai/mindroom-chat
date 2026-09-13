import React, { useCallback, useRef } from 'react';
import { useAtom } from 'jotai';
import { Badge, Box, Chip, Icon, IconButton, Icons, Spinner, Text, color, config } from 'folds';
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
import { useThreadResolution, useToggleThreadResolution } from './useRoomThreadResolution';
import { useThreadRootEvent } from './useThreadRootEvent';
import { type ThreadFilter, type ThreadSort } from './RoomThreadOverview';
import { roomIdToThreadFilterAtomFamily } from '../../state/room/roomThreadFilters';

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
  eventId,
  threadId,
}: {
  room: Room;
  eventId?: string;
  threadId?: string;
}) {
  const roomInputRef = useRef<HTMLDivElement>(null);
  const roomViewRef = useRef<HTMLDivElement>(null);

  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');

  const { roomId } = room;
  const editor = useEditor();
  // RoomTimeline is keyed by roomId/threadId below, so room-level filter state
  // must live here to survive thread open/close.
  const [{ threadFilter, threadSort }, setThreadFilterState] = useAtom(
    roomIdToThreadFilterAtomFamily(roomId)
  );

  const mx = useMatrixClient();

  const tombstoneEvent = useStateEvent(room, StateEvent.RoomTombstone);
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const permissions = useRoomPermissions(creators, powerLevels);
  const canMessage = permissions.event(EventType.RoomMessage, mx.getSafeUserId());
  const { navigateRoom } = useRoomNavigate();
  const threadRootEvent = useThreadRootEvent(room, threadId);
  const validThreadId = threadRootEvent?.getId();
  const { isResolved: threadResolved, isPending: threadResolutionPending } = useThreadResolution(
    room,
    validThreadId
  );
  const {
    canToggle: canToggleThreadResolution,
    setResolved,
    updating: updatingThreadResolution,
    error: threadResolutionError,
  } = useToggleThreadResolution(room);

  const handleExitThread = useCallback(() => {
    if (!threadId) return;
    navigateRoom(room.roomId, threadId, { replace: true });
  }, [navigateRoom, room.roomId, threadId]);
  const handleThreadFilterChange = useCallback(
    (filter: ThreadFilter) => {
      setThreadFilterState((current) => ({ ...current, threadFilter: filter }));
    },
    [setThreadFilterState]
  );
  const handleThreadSortChange = useCallback(
    (sort: ThreadSort) => {
      setThreadFilterState((current) => ({ ...current, threadSort: sort }));
    },
    [setThreadFilterState]
  );

  // Thread view has a more specific "back" action than the generic room-page back:
  // first swipe exits the thread, then the room header/back handler can navigate out.
  useEdgeSwipeBack(handleExitThread, !!threadId);

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
      <RoomViewHeader threadId={threadId} />
      {threadId && (
        <Box
          alignItems="Center"
          gap="300"
          style={{
            padding: `${config.space.S400} ${config.space.S400}`,
            backgroundColor: threadResolved
              ? color.Success.Container
              : color.SurfaceVariant.Container,
            borderBottom: `${config.borderWidth.B300} solid ${
              threadResolved ? color.Success.ContainerLine : color.SurfaceVariant.ContainerLine
            }`,
            color: threadResolved ? color.Success.OnContainer : undefined,
          }}
        >
          <IconButton size="300" radii="300" onClick={handleExitThread}>
            <Icon src={Icons.ArrowLeft} />
          </IconButton>
          <Box direction="Column" grow="Yes" gap="100">
            <Box direction="Row" alignItems="Center" gap="200">
              <Text size="B400">Thread View</Text>
              {threadResolved && (
                <Badge as="span" size="400" variant="Success" fill="Soft" radii="Pill" outlined>
                  <Text size="T200">Resolved</Text>
                </Badge>
              )}
            </Box>
            <Text size="T200" priority="300" truncate>
              Focused thread context is active.
            </Text>
          </Box>
          <Box shrink="No" direction="Column" alignItems="End" gap="100">
            <Chip
              variant={threadResolved ? 'Secondary' : 'Success'}
              radii="Pill"
              outlined={threadResolved}
              disabled={
                !canToggleThreadResolution ||
                !validThreadId ||
                updatingThreadResolution ||
                threadResolutionPending
              }
              aria-label={threadResolved ? 'Unresolve this thread' : 'Resolve this thread'}
              before={
                threadResolutionPending ? (
                  <Spinner
                    size="100"
                    variant={threadResolved ? 'Secondary' : 'Success'}
                    fill={threadResolved ? 'Soft' : 'Solid'}
                  />
                ) : (
                  <Icon size="50" src={threadResolved ? Icons.CheckTwice : Icons.Check} />
                )
              }
              onClick={() => validThreadId && setResolved(validThreadId, !threadResolved)}
            >
              <Text size="T200">{threadResolved ? 'Unresolve' : 'Resolve'}</Text>
            </Chip>
            {threadResolutionError && (
              <Text size="T200" style={{ color: color.Critical.Main, maxWidth: '20rem' }}>
                {threadResolutionError.message}
              </Text>
            )}
          </Box>
        </Box>
      )}
      <Box grow="Yes" direction="Column">
        <RoomTimeline
          key={`${roomId}:${threadId ?? ''}`}
          room={room}
          eventId={eventId}
          threadId={threadId}
          threadFilter={threadFilter}
          onThreadFilterChange={handleThreadFilterChange}
          threadSort={threadSort}
          onThreadSortChange={handleThreadSortChange}
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
                  threadId={threadId}
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
