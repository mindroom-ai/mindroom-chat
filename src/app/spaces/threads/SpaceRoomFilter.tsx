import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
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

/**
 * The Space Threads toolbar's Rooms dropdown: a search field over a checkbox for every visible
 * room in the Space. Unchecked (0 selected) shows all rooms; checking 1 or more restricts the view.
 */
export function SpaceRoomFilter({
  rooms,
  roomCounts,
  selectedRoomIds,
  onToggleRoom,
  onSelectAll,
}: SpaceRoomFilterProps) {
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
      <ThreadFilterPanel
        name="room"
        optionAttribute="data-room-option"
        label={ariaLabel}
        searchLabel={t('spaceThreads.roomFilter.search')}
        noMatchLabel={t('spaceThreads.roomFilter.noMatch')}
        options={(query) => {
          const needle = query.trim().toLocaleLowerCase();
          return rooms
            .filter((item) => !needle || item.name.toLocaleLowerCase().includes(needle))
            .map((item) => ({
              id: item.room.roomId,
              checked: Boolean(selectedRoomIds?.has(item.room.roomId)),
              count: roomCounts.get(item.room.roomId) ?? 0,
              content: (
                <>
                  <span
                    className={dropdownCss.Swatch}
                    style={{ backgroundColor: item.accentColor }}
                    aria-hidden="true"
                  />
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
            }));
        }}
        onToggle={onToggleRoom}
        onClear={selectedCount > 0 ? onSelectAll : undefined}
      />
    </ThreadFilterDropdown>
  );
}
