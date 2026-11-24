import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import {
  ThreadFilterDropdown,
  ThreadFilterPanel,
} from '../../threads/overview/ThreadFilterDropdown';
import * as dropdownCss from '../../threads/overview/ThreadFilterDropdown.css';
import { ownDirectionLine } from '../../ui/directional';

export type SpaceRoomOption = {
  roomId: string;
  name: string;
  count: number;
  accentColor: string;
};

export type SpaceRoomFilterProps = {
  rooms: readonly SpaceRoomOption[];
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
  selectedRoomIds,
  onToggleRoom,
  onSelectAll,
}: SpaceRoomFilterProps) {
  const { t } = useTranslation();

  if (rooms.length <= 1) return null;

  const selectedCount = selectedRoomIds?.size ?? 0;
  const soleRoomId = selectedCount === 1 ? selectedRoomIds?.values().next().value : undefined;
  const soleRoomName = soleRoomId
    ? rooms.find((room) => room.roomId === soleRoomId)?.name
    : undefined;
  const ariaLabel = t('spaceThreads.roomFilter.ariaLabel');

  return (
    <ThreadFilterDropdown
      name="room"
      label={t('spaceThreads.roomFilter.label')}
      value={soleRoomName}
      count={selectedCount}
      ariaLabel={
        selectedCount > 0
          ? t('spaceThreads.roomFilter.ariaLabelActive', { number: selectedCount })
          : ariaLabel
      }
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
            .filter((room) => !needle || room.name.toLocaleLowerCase().includes(needle))
            .map((room) => ({
              id: room.roomId,
              checked: Boolean(selectedRoomIds?.has(room.roomId)),
              count: room.count,
              content: (
                <>
                  <span
                    className={dropdownCss.Swatch}
                    style={{ backgroundColor: room.accentColor }}
                    aria-hidden="true"
                  />
                  <Text
                    as="span"
                    size="T300"
                    truncate
                    className={dropdownCss.Name}
                    {...ownDirectionLine}
                  >
                    {room.name}
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
