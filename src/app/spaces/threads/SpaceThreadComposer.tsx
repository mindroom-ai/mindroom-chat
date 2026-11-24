import { useCallback, useMemo, useState, type RefObject } from 'react';
import { Box, Icon, Icons, Text } from 'folds';
import { atom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { EventTimeline, type MatrixEvent, type Room } from 'matrix-js-sdk';
import classNames from 'classnames';
import { ComposerMenuButton } from '../../composer/ComposerMenuButton';
import { RoomInput } from '../../composer/RoomInput';
import * as composerCss from '../../composer/RoomInput.css';
import {
  composerUploadItemsAtom,
  getRoomInputDraftKey,
  roomIdToMsgDraftAtomFamily,
} from '../../composer/roomInputDrafts';
import { useEditor } from '../../editor/Editor';
import {
  isConfirmedMatrixEventId,
  isLocalEchoEventId,
} from '../../event-store/threads/threadRouteUtils';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { matchesEnum } from '../../lib/matchesEnum';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { getPowersLevelFromMatrixEvent } from '../../matrix/hooks/usePowerLevels';
import { getRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { getRoomPermissionsAPI } from '../../matrix/hooks/useRoomPermissions';
import { useStateEventCallback } from '../../matrix/hooks/useStateEventCallback';
import { StateEvent } from '../../matrix/types/room';
import * as overviewCss from '../../threads/overview/RoomThreadOverview.css';
import { ownDirectionLine } from '../../ui/directional';
import { MenuEntry } from '../../ui/MenuEntry';
import { resolveComposerTargetRoom } from './spaceThreadsModel';
import * as css from './SpaceThreads.css';

const MAX_INLINE_PILLS = 4;

export type SpaceComposerRoom = { room: Room; name: string; accentColor: string };

export type SpaceThreadComposerProps = {
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

export function SpaceThreadComposer({
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

  // Primitive key stays equal across subsequent keystrokes so typing does not re-render this dock.
  const draftedRoomsKeyAtom = useMemo(
    () =>
      atom((get) =>
        sendableRoomIds
          .filter(
            (roomId) =>
              get(roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(myUserId, roomId))).length > 0 ||
              get(composerUploadItemsAtom(roomId, undefined)).length > 0
          )
          .join('\0')
      ),
    [myUserId, sendableRoomIds]
  );
  const draftedRoomsKey = useAtomValue(draftedRoomsKeyAtom);
  const draftedRoomIds = useMemo(
    () => new Set(draftedRoomsKey ? draftedRoomsKey.split('\0') : []),
    [draftedRoomsKey]
  );

  const currentHasDraft = Boolean(chosenTargetRoomId && draftedRoomIds.has(chosenTargetRoomId));
  const targetRoomId = resolveComposerTargetRoom({
    activeRoomIds,
    sendableRoomIds,
    currentTargetRoomId: chosenTargetRoomId,
    hasDraft: currentHasDraft,
  });
  const targetHasDraft = Boolean(targetRoomId && draftedRoomIds.has(targetRoomId));
  // Freeze destination once the active target holds a draft so later room-filter changes keep it.
  if (targetHasDraft && targetRoomId && chosenTargetRoomId !== targetRoomId) {
    setChosenTargetRoomId(targetRoomId);
  }

  const targetRoom = sendableRooms.find((item) => item.room.roomId === targetRoomId);
  const onRoomMessageSent = useCallback(
    (eventId: string): boolean => {
      if (!targetRoomId || (!isConfirmedMatrixEventId(eventId) && !isLocalEchoEventId(eventId))) {
        return false;
      }
      onThreadCreated(targetRoomId, eventId);
      return true;
    },
    [onThreadCreated, targetRoomId]
  );

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
  const baseDestinations = activeSendable.length > 0 ? activeSendable : sendableRooms;
  const eligibleRooms = baseDestinations.some((item) => item.room.roomId === targetRoom.room.roomId)
    ? baseDestinations
    : [targetRoom, ...baseDestinations];
  const draftPinnedOutsideFilter = targetHasDraft && !activeSet.has(targetRoom.room.roomId);
  const useDropdown = screenSize === ScreenSize.Mobile || eligibleRooms.length > MAX_INLINE_PILLS;

  return (
    <div
      className={css.ComposerDock}
      data-space-composer="true"
      data-space-composer-active-target={targetRoom.room.roomId}
    >
      <div className={css.ComposerTargetBar}>
        {useDropdown ? (
          <span data-space-composer-picker="true">
            <ComposerMenuButton
              label={t('spaceThreads.composer.chooseRoomAria')}
              icon={Icons.ChevronBottom}
              face={{
                content: (
                  <>
                    <span
                      className={css.RoomDot}
                      style={{ backgroundColor: targetRoom.accentColor }}
                      aria-hidden="true"
                    />
                    <Text as="span" size="T200" truncate {...ownDirectionLine}>
                      {t('spaceThreads.composer.postToRoom', { room: targetRoom.name })}
                    </Text>
                  </>
                ),
                label: t('spaceThreads.composer.postToRoom', { room: targetRoom.name }),
              }}
            >
              {({ choose }) =>
                eligibleRooms.map((item) => {
                  const active = item.room.roomId === targetRoom.room.roomId;
                  return (
                    <MenuEntry
                      key={item.room.roomId}
                      role="menuitemradio"
                      aria-checked={active}
                      fill={active ? 'Soft' : 'None'}
                      className={composerCss.ComposerMenuItem}
                      label={item.name}
                      icon={Icons.Check}
                      after={
                        <Box as="span" alignItems="Center" gap="200">
                          {active && <Icon size="50" src={Icons.Check} aria-hidden="true" />}
                          <span
                            className={css.RoomDot}
                            style={{ backgroundColor: item.accentColor }}
                            aria-hidden="true"
                          />
                        </Box>
                      }
                      onSelect={choose(() => setChosenTargetRoomId(item.room.roomId))}
                      data-space-composer-option={item.room.roomId}
                    />
                  );
                })
              }
            </ComposerMenuButton>
          </span>
        ) : (
          <>
            <Text as="span" size="T200" priority="400">
              {t('spaceThreads.composer.postTo')}
            </Text>
            {eligibleRooms.map((item) => {
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
                  onClick={() => setChosenTargetRoomId(item.room.roomId)}
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
      <RoomInput
        editor={editor}
        fileDropContainerRef={fileDropContainerRef}
        roomId={targetRoom.room.roomId}
        room={targetRoom.room}
        threadingEnabled
        onRoomMessageSent={onRoomMessageSent}
      />
    </div>
  );
}
