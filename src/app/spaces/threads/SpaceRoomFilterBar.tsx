import { useCallback, useRef, type KeyboardEvent } from 'react';
import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import * as overviewCss from '../../threads/overview/RoomThreadOverview.css';
import {
  ThreadFilterDropdown,
  ThreadFilterPanel,
  type ThreadFilterOption,
} from '../../threads/overview/ThreadFilterDropdown';
import { ownDirectionLine } from '../../ui/directional';
import * as css from './SpaceThreads.css';

const LARGE_SPACE_ROOM_THRESHOLD = 6;

export type SpaceRoomOption = { roomId: string; name: string; count: number; accentColor: string };

export type SpaceRoomFilterBarProps = {
  rooms: readonly SpaceRoomOption[];
  totalCount: number;
  selectedRoomIds: ReadonlySet<string> | undefined;
  onSelectAll: () => void;
  onToggleRoom: (roomId: string) => void;
  onSelectOnlyRoom: (roomId: string) => void;
};

export function SpaceRoomFilterBar({
  rooms,
  totalCount,
  selectedRoomIds,
  onSelectAll,
  onToggleRoom,
  onSelectOnlyRoom,
}: SpaceRoomFilterBarProps) {
  const { t } = useTranslation();
  const stripRef = useRef<HTMLDivElement>(null);
  const isAllSelected = !selectedRoomIds || selectedRoomIds.size === 0;
  const activeCount = isAllSelected ? rooms.length : selectedRoomIds.size;
  const isSingleSelected = !isAllSelected && selectedRoomIds.size === 1;

  const buildPickerOptions = useCallback(
    (query: string): ThreadFilterOption[] => {
      const needle = query.trim().toLocaleLowerCase();
      return rooms
        .filter((room) => !needle || room.name.toLocaleLowerCase().includes(needle))
        .map((room) => ({
          id: room.roomId,
          checked: isAllSelected || selectedRoomIds.has(room.roomId),
          count: room.count,
          content: (
            <>
              <span
                className={css.RoomDot}
                style={{ backgroundColor: room.accentColor }}
                aria-hidden="true"
              />
              <Text as="span" size="T200" truncate {...ownDirectionLine}>
                {room.name}
              </Text>
            </>
          ),
        }));
    },
    [isAllSelected, rooms, selectedRoomIds]
  );

  const handleStripKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      if (
        document.activeElement instanceof HTMLElement &&
        stripRef.current?.contains(document.activeElement)
      ) {
        document.activeElement.blur();
      }
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const buttons = [...(stripRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || buttons.length === 0) return;
    event.preventDefault();
    buttons[
      (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    ]?.focus();
  };

  if (rooms.length === 0) return null;

  return (
    <div
      className={css.RoomFilterBar}
      role="toolbar"
      aria-label={t('spaceThreads.roomFilter.aria')}
      data-space-room-filter-bar="true"
    >
      {rooms.length > LARGE_SPACE_ROOM_THRESHOLD && (
        <ThreadFilterDropdown
          name="space-room"
          label={t('spaceThreads.roomFilter.roomsButton', {
            active: activeCount,
            total: rooms.length,
          })}
          count={isAllSelected ? 0 : activeCount}
          ariaLabel={t('spaceThreads.roomFilter.pickerAria')}
        >
          <ThreadFilterPanel
            name="space-room"
            optionAttribute="data-space-room-option"
            label={t('spaceThreads.roomFilter.pickerAria')}
            searchLabel={t('spaceThreads.roomFilter.searchPlaceholder')}
            noMatchLabel={t('spaceThreads.roomFilter.noMatch')}
            options={buildPickerOptions}
            onToggle={onToggleRoom}
            onClear={isAllSelected ? undefined : onSelectAll}
          />
        </ThreadFilterDropdown>
      )}

      <div ref={stripRef} className={css.RoomChipStrip} onKeyDown={handleStripKeyDown}>
        <div className={classNames(css.RoomChipGroup, isAllSelected && css.RoomChipGroupActive)}>
          <button
            type="button"
            className={css.RoomChipButton}
            aria-pressed={isAllSelected}
            onClick={onSelectAll}
            data-space-room-filter-all="true"
          >
            <Text as="span" size="T200">
              {t('spaceThreads.roomFilter.all')}
            </Text>
            <Text as="span" size="T200" className={css.RoomChipCount}>
              {totalCount}
            </Text>
          </button>
        </div>

        {rooms.map((room) => {
          const active = isAllSelected || selectedRoomIds.has(room.roomId);
          const isSoleActive = isSingleSelected && selectedRoomIds.has(room.roomId);
          return (
            <div
              key={room.roomId}
              className={classNames(css.RoomChipGroup, active && css.RoomChipGroupActive)}
            >
              <button
                type="button"
                className={css.RoomChipButton}
                aria-pressed={active}
                onClick={() => onToggleRoom(room.roomId)}
                data-space-room-chip={room.roomId}
              >
                <span
                  className={css.RoomDot}
                  style={{ backgroundColor: room.accentColor }}
                  aria-hidden="true"
                />
                <Text as="span" size="T200" className={css.RoomChipName} {...ownDirectionLine}>
                  {room.name}
                </Text>
                <Text as="span" size="T200" className={css.RoomChipCount}>
                  {room.count}
                </Text>
              </button>
              {rooms.length > 1 && !isSoleActive && (
                <button
                  type="button"
                  className={css.RoomChipOnlyButton}
                  aria-label={t('spaceThreads.roomFilter.onlyRoomAria', { room: room.name })}
                  onClick={() => onSelectOnlyRoom(room.roomId)}
                  data-space-room-only={room.roomId}
                >
                  {t('spaceThreads.roomFilter.only')}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {isSingleSelected && rooms.length > 1 && (
        <button
          type="button"
          className={overviewCss.ResetLink}
          onClick={onSelectAll}
          data-space-room-reset="true"
        >
          <Text as="span" size="T200">
            {t('spaceThreads.roomFilter.showAll', { count: rooms.length })}
          </Text>
        </button>
      )}
    </div>
  );
}
