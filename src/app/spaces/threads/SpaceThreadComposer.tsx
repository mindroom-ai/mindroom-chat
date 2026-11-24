import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Text } from 'folds';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { EventTimeline, type MatrixEvent, type Room } from 'matrix-js-sdk';
import classNames from 'classnames';
import type { Editor } from 'slate';
import { RoomInput } from '../../composer/RoomInput';
import {
  composerUploadItemsAtom,
  getRoomInputDraftKey,
  roomIdToMsgDraftAtomFamily,
} from '../../composer/roomInputDrafts';
import { useEditor } from '../../editor/Editor';
import { isEmptyEditor } from '../../editor/utils';
import {
  isConfirmedMatrixEventId,
  isLocalEchoEventId,
} from '../../event-store/threads/threadRouteUtils';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { matchesEnum } from '../../lib/matchesEnum';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  getPowersLevelFromMatrixEvent,
  PowerLevelsContextProvider,
  usePowerLevels,
} from '../../matrix/hooks/usePowerLevels';
import { getRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { getRoomPermissionsAPI } from '../../matrix/hooks/useRoomPermissions';
import { useStateEventCallback } from '../../matrix/hooks/useStateEventCallback';
import { StateEvent } from '../../matrix/types/room';
import { ConversationViewContext, SPACE_THREADS_VIEW } from '../../navigation/conversationView';
import * as overviewCss from '../../threads/overview/RoomThreadOverview.css';
import { ownDirectionLine } from '../../ui/directional';
import { SpaceComposerRoomMenu } from './SpaceComposerRoomMenu';
import { resolveComposerTargetRoom } from './spaceThreadsModel';
import * as css from './SpaceThreads.css';

const MAX_INLINE_PILLS = 4;

export type SpaceComposerRoom = { room: Room; name: string; accentColor: string };

export type SpaceThreadComposerProps = {
  spaceId: string;
  rooms: readonly SpaceComposerRoom[];
  activeRoomIds: readonly string[];
  fileDropContainerRef: RefObject<HTMLElement | null>;
  onThreadCreated: (roomId: string, eventId: string) => void;
};

const canSendMessageToRoom = (room: Room, userId: string): boolean => {
  const state = room.getLiveTimeline?.()?.getState?.(EventTimeline.FORWARDS);
  if (state?.getStateEvents?.(StateEvent.RoomTombstone, '')) return false;
  const createEvent = state?.getStateEvents?.(StateEvent.RoomCreate, '') ?? undefined;
  const powerEvent = state?.getStateEvents?.(StateEvent.RoomPowerLevels, '') ?? undefined;
  const creators = createEvent ? getRoomCreators(createEvent) : new Set<string>();
  return getRoomPermissionsAPI(creators, getPowersLevelFromMatrixEvent(powerEvent)).event(
    'm.room.message',
    userId
  );
};

function SpaceRoomInputBridge({
  room,
  editor,
  fileDropContainerRef,
  onThreadCreated,
}: {
  room: Room;
  editor: Editor;
  fileDropContainerRef: RefObject<HTMLElement | null>;
  onThreadCreated: (roomId: string, eventId: string) => void;
}) {
  const powerLevels = usePowerLevels(room);
  const onRoomMessageSent = useCallback(
    (eventId: string): boolean => {
      if (!isConfirmedMatrixEventId(eventId) && !isLocalEchoEventId(eventId)) return false;
      onThreadCreated(room.roomId, eventId);
      return true;
    },
    [onThreadCreated, room.roomId]
  );
  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <ConversationViewContext.Provider value={SPACE_THREADS_VIEW}>
        <RoomInput
          editor={editor}
          fileDropContainerRef={fileDropContainerRef}
          roomId={room.roomId}
          room={room}
          threadingEnabled
          onRoomMessageSent={onRoomMessageSent}
        />
      </ConversationViewContext.Provider>
    </PowerLevelsContextProvider>
  );
}

export function SpaceThreadComposer({
  spaceId,
  rooms,
  activeRoomIds,
  fileDropContainerRef,
  onThreadCreated,
}: SpaceThreadComposerProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const myUserId = mx.getSafeUserId();
  const screenSize = useScreenSizeContext();
  const editor = useEditor();
  const [permissionsVersion, refreshPermissions] = useForceUpdate();
  const [chosenTargetRoomId, setChosenTargetRoomId] = useState<string | undefined>(undefined);
  const [lastTargetRoomId, setLastTargetRoomId] = useState<string | undefined>(undefined);
  const boundDraftRoomRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setChosenTargetRoomId(undefined);
    setLastTargetRoomId(undefined);
  }, [spaceId]);

  const roomIdsSet = useMemo(() => new Set(rooms.map((item) => item.room.roomId)), [rooms]);
  useStateEventCallback(
    mx,
    useCallback(
      (event: MatrixEvent) => {
        const id = event.getRoomId();
        if (!id || !roomIdsSet.has(id)) return;
        const type = event.getType();
        if (
          matchesEnum(type, StateEvent.RoomPowerLevels) ||
          matchesEnum(type, StateEvent.RoomTombstone) ||
          matchesEnum(type, StateEvent.RoomCreate)
        ) {
          refreshPermissions();
        }
      },
      [refreshPermissions, roomIdsSet]
    )
  );

  const sendableRooms = useMemo(() => {
    void permissionsVersion;
    return rooms.filter((item) => canSendMessageToRoom(item.room, myUserId));
  }, [myUserId, permissionsVersion, rooms]);
  const sendableRoomIds = useMemo(
    () => sendableRooms.map((item) => item.room.roomId),
    [sendableRooms]
  );

  const draftRoomId = chosenTargetRoomId ?? sendableRoomIds[0] ?? '';
  const draft = useAtomValue(
    useMemo(
      () => roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(myUserId, draftRoomId)),
      [draftRoomId, myUserId]
    )
  );
  const stagedUploads = useAtomValue(
    useMemo(() => composerUploadItemsAtom(draftRoomId, SPACE_THREADS_VIEW), [draftRoomId])
  );
  const hasDraft =
    Boolean(chosenTargetRoomId) &&
    (draft.length > 0 ||
      stagedUploads.length > 0 ||
      (boundDraftRoomRef.current === chosenTargetRoomId && !isEmptyEditor(editor)));

  const targetRoomId = resolveComposerTargetRoom({
    activeRoomIds,
    sendableRoomIds,
    currentTargetRoomId: chosenTargetRoomId,
    lastTargetRoomId,
    hasDraft,
  });

  useEffect(() => {
    boundDraftRoomRef.current = targetRoomId;
    if (targetRoomId && targetRoomId !== chosenTargetRoomId) {
      setChosenTargetRoomId(targetRoomId);
      setLastTargetRoomId(targetRoomId);
    }
  }, [chosenTargetRoomId, targetRoomId]);

  const targetRoom = sendableRooms.find((item) => item.room.roomId === targetRoomId);
  if (!targetRoom) {
    return (
      <div className={css.ComposerDock} data-space-composer="true">
        <Text size="T200" className={css.ReadOnlyNotice}>
          {t('spaceThreads.composer.readOnly')}
        </Text>
      </div>
    );
  }

  const activeSet = new Set(activeRoomIds);
  const activeSendable = sendableRooms.filter((item) => activeSet.has(item.room.roomId));
  const draftPinnedOutsideFilter = hasDraft && !activeSet.has(targetRoom.room.roomId);
  const useDropdown =
    screenSize === ScreenSize.Mobile ||
    activeSendable.length > MAX_INLINE_PILLS ||
    (activeSendable.length === 0 && sendableRooms.length > MAX_INLINE_PILLS);
  const basePills = activeSendable.length > 0 ? activeSendable : sendableRooms;
  const pillRooms = basePills.some((item) => item.room.roomId === targetRoom.room.roomId)
    ? basePills
    : [targetRoom, ...basePills];
  const selectTarget = (roomId: string) => {
    setChosenTargetRoomId(roomId);
    setLastTargetRoomId(roomId);
  };

  return (
    <div
      className={css.ComposerDock}
      data-space-composer="true"
      data-space-composer-active-target={targetRoom.room.roomId}
    >
      <div className={css.ComposerTargetBar}>
        {useDropdown ? (
          <SpaceComposerRoomMenu
            sendableRooms={sendableRooms}
            targetRoom={targetRoom}
            onSelect={selectTarget}
          />
        ) : (
          <>
            <Text as="span" size="T200" priority="400">
              {t('spaceThreads.composer.postTo')}
            </Text>
            {pillRooms.map((item) => {
              const active = item.room.roomId === targetRoom.room.roomId;
              return (
                <button
                  key={item.room.roomId}
                  type="button"
                  className={classNames(
                    overviewCss.SortButton,
                    active && overviewCss.SortButtonActive
                  )}
                  aria-pressed={active}
                  onClick={() => selectTarget(item.room.roomId)}
                  data-space-composer-target={item.room.roomId}
                >
                  <span
                    className={css.RoomDot}
                    style={{ backgroundColor: item.accentColor }}
                    aria-hidden="true"
                  />
                  <Text as="span" size="T200" className={css.RoomChipName} {...ownDirectionLine}>
                    {item.name}
                  </Text>
                </button>
              );
            })}
          </>
        )}
        {draftPinnedOutsideFilter && (
          <Text
            as="span"
            size="T200"
            className={css.ComposerDraftNote}
            data-space-composer-draft-pinned={targetRoom.room.roomId}
          >
            {t('spaceThreads.composer.draftPinned', { room: targetRoom.name })}
          </Text>
        )}
      </div>
      <SpaceRoomInputBridge
        room={targetRoom.room}
        editor={editor}
        fileDropContainerRef={fileDropContainerRef}
        onThreadCreated={onThreadCreated}
      />
    </div>
  );
}
