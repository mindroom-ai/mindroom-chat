import { useCallback, useEffect, useMemo, type RefObject } from 'react';
import { Icons, Text } from 'folds';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent } from 'matrix-js-sdk';
import classNames from 'classnames';
import { ComposerMenuButton, ComposerRadioMenuEntry } from '../../composer/ComposerMenuButton';
import { RoomInput } from '../../composer/RoomInput';
import {
  getSpaceThreadsDraftKey,
  spaceThreadsDestinationAtomFamily,
  spaceThreadsHasDraftAtom,
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
import { useStateEventCallback } from '../../matrix/hooks/useStateEventCallback';
import { canSendMessageInRoom } from '../../matrix/room';
import { StateEvent } from '../../matrix/types/room';
import * as overviewCss from '../../threads/overview/RoomThreadOverview.css';
import { ownDirectionLine } from '../../ui/directional';
import { RoomDot } from './RoomDot';
import { resolveComposerTargetRoom, type SpaceRoomItem } from './spaceThreadsModel';
import * as css from './SpaceThreads.css';

const MAX_INLINE_PILLS = 4;

export type SpaceThreadComposerProps = {
  spaceId: string;
  rooms: readonly SpaceRoomItem[];
  roomsById: ReadonlyMap<string, SpaceRoomItem>;
  activeRoomIds: readonly string[];
  fileDropContainerRef: RefObject<HTMLElement | null>;
  onThreadCreated: (roomId: string, eventId: string) => void;
};

export function SpaceThreadComposer({
  spaceId,
  rooms,
  roomsById,
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
  const draftKey = getSpaceThreadsDraftKey(myUserId, spaceId);
  const [chosenTargetRoomId, setChosenTargetRoomId] = useAtom(
    spaceThreadsDestinationAtomFamily(draftKey)
  );

  useStateEventCallback(
    mx,
    useCallback(
      (event: MatrixEvent) => {
        const id = event.getRoomId();
        if (!id || !roomsById.has(id)) return;
        const type = event.getType();
        if (
          matchesEnum(type, StateEvent.RoomPowerLevels) ||
          matchesEnum(type, StateEvent.RoomTombstone) ||
          matchesEnum(type, StateEvent.RoomCreate)
        ) {
          refreshPermissions();
        }
      },
      [refreshPermissions, roomsById]
    )
  );

  const sendableRoomIds = useMemo(() => {
    void permissionsVersion;
    return rooms
      .filter((item) => canSendMessageInRoom(item.room, myUserId))
      .map((item) => item.room.roomId);
  }, [myUserId, permissionsVersion, rooms]);

  // Returns a boolean so subsequent keystrokes do not re-render this dock.
  const hasDraft = useAtomValue(useMemo(() => spaceThreadsHasDraftAtom(draftKey), [draftKey]));

  const { targetRoomId, destinationRoomIds } = useMemo(
    () =>
      resolveComposerTargetRoom({
        activeRoomIds,
        sendableRoomIds,
        currentTargetRoomId: chosenTargetRoomId,
        hasDraft,
      }),
    [activeRoomIds, chosenTargetRoomId, hasDraft, sendableRoomIds]
  );
  // Freeze destination once the composer holds a draft when none is stored yet, so a temporarily
  // non-sendable stored target stays intact while displaying the resolver fallback.
  useEffect(() => {
    if (hasDraft) {
      if (targetRoomId && chosenTargetRoomId === undefined) {
        setChosenTargetRoomId(targetRoomId);
      }
    } else if (chosenTargetRoomId !== undefined && targetRoomId !== chosenTargetRoomId) {
      setChosenTargetRoomId(undefined);
    }
  }, [chosenTargetRoomId, hasDraft, setChosenTargetRoomId, targetRoomId]);

  const targetRoom = targetRoomId ? roomsById.get(targetRoomId) : undefined;
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

  const eligibleRooms = destinationRoomIds
    .map((id) => roomsById.get(id))
    .filter((item): item is SpaceRoomItem => Boolean(item));
  const draftPinnedOutsideFilter = hasDraft && !activeRoomIds.includes(targetRoom.room.roomId);
  const useDropdown = screenSize === ScreenSize.Mobile || eligibleRooms.length > MAX_INLINE_PILLS;
  const postToRoomLabel = t('spaceThreads.composer.postToRoom', { room: targetRoom.name });

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
                    <RoomDot color={targetRoom.accentColor} />
                    <Text as="span" size="T200" truncate {...ownDirectionLine}>
                      {postToRoomLabel}
                    </Text>
                  </>
                ),
                label: postToRoomLabel,
              }}
            >
              {({ choose }) =>
                eligibleRooms.map((item) => (
                  <ComposerRadioMenuEntry
                    key={item.room.roomId}
                    label={item.name}
                    checked={item.room.roomId === targetRoom.room.roomId}
                    badge={<RoomDot color={item.accentColor} />}
                    onSelect={choose(() => setChosenTargetRoomId(item.room.roomId))}
                  />
                ))
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
                  <RoomDot color={item.accentColor} />
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
        stagedDraftKey={draftKey}
        onRoomMessageSent={onRoomMessageSent}
      />
    </div>
  );
}
