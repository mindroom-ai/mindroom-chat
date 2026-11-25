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
  type ThreadFilterOption,
} from '../../threads/overview/ThreadFilterDropdown';
import * as dropdownCss from '../../threads/overview/ThreadFilterDropdown.css';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { SpaceAvatar } from '../lobby/LobbyHeader';
import type {
  SpaceRoomFilterGroup,
  SpaceRoomFilterGroups,
  SpaceRoomItem,
} from './spaceThreadsModel';

const getSubspaceName = (group: SpaceRoomFilterGroup): string =>
  revealDirectionControls(group.room.name || group.spaceId);

export type SpaceRoomFilterProps = {
  rooms: readonly SpaceRoomItem[];
  roomCounts: ReadonlyMap<string, number>;
  selectedRoomIds: ReadonlySet<string> | undefined;
  groups?: SpaceRoomFilterGroups;
  onToggleRoom: (roomId: string) => void;
  onToggleRoomGroup?: (roomIds: readonly string[]) => void;
  onSelectAll: () => void;
};

function RoomFilterPanel({
  rooms,
  roomCounts,
  selectedRoomIds,
  groups,
  onToggleRoom,
  onToggleRoomGroup,
  onSelectAll,
}: SpaceRoomFilterProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const authenticated = useMediaAuthentication();
  const mDirect = useAtomValue(mDirectAtom);
  const selectedCount = selectedRoomIds?.size ?? 0;
  const subspaceById = groups
    ? new Map(groups.subspaces.map((group) => [group.spaceId, group]))
    : undefined;

  const toRoomOption = (item: SpaceRoomItem, key?: string, indent?: number): ThreadFilterOption => {
    const direct = mDirect.has(item.room.roomId);
    const avatarUrl = direct
      ? getDirectRoomAvatarUrl(mx, item.room, 96, authenticated)
      : getRoomAvatarUrl(mx, item.room, 96, authenticated);
    return {
      id: item.room.roomId,
      ...(key ? { key } : {}),
      ...(indent ? { indent } : {}),
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
          <Text as="span" size="T300" truncate className={dropdownCss.Name} {...ownDirectionLine}>
            {item.name}
          </Text>
        </>
      ),
    };
  };

  return (
    <ThreadFilterPanel
      name="room"
      optionAttribute="data-room-option"
      label={t('spaceThreads.roomFilter.ariaLabel')}
      searchLabel={t('spaceThreads.roomFilter.search')}
      noMatchLabel={t('spaceThreads.roomFilter.noMatch')}
      options={(query) => {
        const needle = query.trim().toLocaleLowerCase();
        if (!groups) {
          return rooms
            .filter((item) => !needle || item.name.toLocaleLowerCase().includes(needle))
            .map((item) => toRoomOption(item));
        }

        const roomById = new Map(rooms.map((item) => [item.room.roomId, item]));
        const forcedRoomIds = needle
          ? new Set(
              groups.subspaces
                .filter((group) => getSubspaceName(group).toLocaleLowerCase().includes(needle))
                .flatMap((group) => group.subtreeRoomIds)
            )
          : undefined;
        const matchesRoom = (item: SpaceRoomItem) =>
          !needle ||
          Boolean(forcedRoomIds?.has(item.room.roomId)) ||
          item.name.toLocaleLowerCase().includes(needle);
        const visibleRoomIds = new Set(rooms.filter(matchesRoom).map((item) => item.room.roomId));

        const rows: ThreadFilterOption[] = [];
        groups.rootRoomIds.forEach((id) => {
          if (!visibleRoomIds.has(id)) return;
          const item = roomById.get(id);
          if (item) rows.push(toRoomOption(item));
        });

        groups.subspaces.forEach((group) => {
          const name = getSubspaceName(group);
          const matchesGroup =
            !needle ||
            name.toLocaleLowerCase().includes(needle) ||
            group.subtreeRoomIds.some((id) => visibleRoomIds.has(id));
          if (!matchesGroup) return;

          const selectedInSubtree = selectedRoomIds
            ? group.subtreeRoomIds.filter((id) => selectedRoomIds.has(id)).length
            : 0;
          const checked =
            selectedInSubtree > 0 && selectedInSubtree === group.subtreeRoomIds.length;
          const indeterminate =
            selectedInSubtree > 0 && selectedInSubtree < group.subtreeRoomIds.length;
          const count = group.subtreeRoomIds.reduce(
            (sum, id) => sum + (roomCounts.get(id) ?? 0),
            0
          );

          rows.push({
            id: group.spaceId,
            key: `subspace:${group.spaceId}`,
            rowAttribute: 'data-subspace-option',
            groupHeader: true,
            indent: Math.min(group.depth - 1, 2),
            checked,
            indeterminate,
            count,
            content: (
              <>
                <SpaceAvatar
                  roomId={group.spaceId}
                  name={name}
                  src={getRoomAvatarUrl(mx, group.room, 96, authenticated)}
                  compact
                  alt=""
                />
                <Text
                  as="span"
                  size="T300"
                  truncate
                  className={dropdownCss.Name}
                  {...ownDirectionLine}
                >
                  {name}
                </Text>
              </>
            ),
          });

          group.directRoomIds.forEach((id) => {
            if (!visibleRoomIds.has(id)) return;
            const item = roomById.get(id);
            if (item) {
              rows.push(toRoomOption(item, `${group.spaceId}:${id}`, Math.min(group.depth, 3)));
            }
          });
        });

        return rows;
      }}
      onToggle={(id) => {
        const group = subspaceById?.get(id);
        if (group && onToggleRoomGroup) onToggleRoomGroup(group.subtreeRoomIds);
        else onToggleRoom(id);
      }}
      onClear={selectedCount > 0 ? onSelectAll : undefined}
    />
  );
}

/**
 * The Space Threads toolbar's Rooms dropdown: a search field over a checkbox for every visible
 * room in the Space. Unchecked (0 selected) shows all rooms; checking 1 or more restricts the view.
 */
export function SpaceRoomFilter(props: SpaceRoomFilterProps) {
  const { rooms, selectedRoomIds, groups } = props;
  const { t } = useTranslation();

  if (rooms.length <= 1) return null;

  const selectedCount = selectedRoomIds?.size ?? 0;
  const soleRoomName =
    selectedCount === 1
      ? rooms.find((item) => selectedRoomIds?.has(item.room.roomId))?.name
      : undefined;
  const soleSubspaceName =
    !soleRoomName && selectedCount > 1 && selectedRoomIds && groups
      ? (() => {
          const matches = groups.subspaces.filter(
            (group) =>
              group.subtreeRoomIds.length === selectedCount &&
              group.subtreeRoomIds.every((id) => selectedRoomIds.has(id))
          );
          return matches.length === 1 ? getSubspaceName(matches[0]!) : undefined;
        })()
      : undefined;
  const soleLabel = soleRoomName ?? soleSubspaceName;
  const label = t('spaceThreads.roomFilter.label');
  const ariaLabel = t('spaceThreads.roomFilter.ariaLabel');
  const triggerAriaLabel = soleLabel
    ? t('spaceThreads.roomFilter.ariaLabelOne', { room: soleLabel })
    : selectedCount > 0
      ? t('spaceThreads.roomFilter.ariaLabelActive', { number: selectedCount })
      : ariaLabel;

  return (
    <ThreadFilterDropdown
      name="room"
      label={label}
      value={soleLabel}
      count={selectedCount}
      ariaLabel={triggerAriaLabel}
    >
      <RoomFilterPanel {...props} />
    </ThreadFilterDropdown>
  );
}
