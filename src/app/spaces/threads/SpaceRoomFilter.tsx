import { Avatar, Text } from 'folds';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { RoomAvatar, RoomIcon } from '../../avatars/RoomAvatar';
import { nameInitials } from '../../lib/common';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { getDirectPartnerId, getDirectRoomAvatarUrl, getRoomAvatarUrl } from '../../matrix/room';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import {
  ThreadFilterDropdown,
  ThreadFilterPanel,
} from '../../threads/overview/ThreadFilterDropdown';
import * as dropdownCss from '../../threads/overview/ThreadFilterDropdown.css';
import { ownDirectionLine } from '../../ui/directional';
import type { SpaceRoomItem } from './spaceThreadsModel';

export type SpaceRoomFilterProps = {
  rooms: readonly SpaceRoomItem[];
  roomCounts: ReadonlyMap<string, number>;
  selectedRoomIds: ReadonlySet<string> | undefined;
  onToggleRoom: (roomId: string) => void;
  onSelectAll: () => void;
};

function RoomFilterPanel({
  rooms,
  roomCounts,
  selectedRoomIds,
  onToggleRoom,
  onSelectAll,
}: SpaceRoomFilterProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const authenticated = useMediaAuthentication();
  const mDirect = useAtomValue(mDirectAtom);
  const selectedCount = selectedRoomIds?.size ?? 0;

  return (
    <ThreadFilterPanel
      name="room"
      optionAttribute="data-room-option"
      label={t('spaceThreads.roomFilter.ariaLabel')}
      searchLabel={t('spaceThreads.roomFilter.search')}
      noMatchLabel={t('spaceThreads.roomFilter.noMatch')}
      options={(query) => {
        const needle = query.trim().toLocaleLowerCase();
        return rooms
          .filter((item) => !needle || item.name.toLocaleLowerCase().includes(needle))
          .map((item) => {
            const direct = mDirect.has(item.room.roomId);
            const avatarUrl = direct
              ? getDirectRoomAvatarUrl(mx, item.room, 96, authenticated)
              : getRoomAvatarUrl(mx, item.room, 96, authenticated);
            return {
              id: item.room.roomId,
              checked: Boolean(selectedRoomIds?.has(item.room.roomId)),
              count: roomCounts.get(item.room.roomId) ?? 0,
              content: (
                <>
                  <Avatar size="200" radii="400">
                    <RoomAvatar
                      roomId={item.room.roomId}
                      fallbackId={direct ? getDirectPartnerId(item.room) : undefined}
                      src={avatarUrl}
                      alt=""
                      renderFallback={() =>
                        direct ? (
                          <Text as="span" size="H6">
                            {nameInitials(item.name)}
                          </Text>
                        ) : (
                          <RoomIcon size="100" joinRule={item.room.getJoinRule?.()} />
                        )
                      }
                    />
                  </Avatar>
                  <Text
                    as="span"
                    size="T300"
                    truncate
                    className={dropdownCss.Name}
                    {...ownDirectionLine}
                  >
                    {item.name}
                  </Text>
                </>
              ),
            };
          });
      }}
      onToggle={onToggleRoom}
      onClear={selectedCount > 0 ? onSelectAll : undefined}
    />
  );
}

/**
 * The Space Threads toolbar's Rooms dropdown: a search field over a checkbox for every visible
 * room in the Space. Unchecked (0 selected) shows all rooms; checking 1 or more restricts the view.
 */
export function SpaceRoomFilter(props: SpaceRoomFilterProps) {
  const { rooms, selectedRoomIds } = props;
  const { t } = useTranslation();

  if (rooms.length <= 1) return null;

  const selectedCount = selectedRoomIds?.size ?? 0;
  const soleRoomName =
    selectedCount === 1
      ? rooms.find((item) => selectedRoomIds?.has(item.room.roomId))?.name
      : undefined;
  const label = t('spaceThreads.roomFilter.label');
  const ariaLabel = t('spaceThreads.roomFilter.ariaLabel');
  const triggerAriaLabel = soleRoomName
    ? t('spaceThreads.roomFilter.ariaLabelOne', { room: soleRoomName })
    : selectedCount > 0
      ? t('spaceThreads.roomFilter.ariaLabelActive', { number: selectedCount })
      : ariaLabel;

  return (
    <ThreadFilterDropdown
      name="room"
      label={label}
      value={soleRoomName}
      count={selectedCount}
      ariaLabel={triggerAriaLabel}
    >
      <RoomFilterPanel {...props} />
    </ThreadFilterDropdown>
  );
}
