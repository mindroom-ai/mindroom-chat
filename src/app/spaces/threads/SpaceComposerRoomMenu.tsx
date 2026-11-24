import { useState } from 'react';
import { Box, Text, config, toRem, type RectCords } from 'folds';
import { IconChevronDown } from '@tabler/icons-react';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import * as overviewCss from '../../threads/overview/RoomThreadOverview.css';
import { PopOut, ownDirectionLine } from '../../ui/directional';
import { Menu } from '../../ui/glass/GlassPrimitives';
import type { SpaceComposerRoom } from './SpaceThreadComposer';
import * as css from './SpaceThreads.css';

const DROPDOWN_SEARCH_THRESHOLD = 6;
const MENU_STYLE = { minInlineSize: toRem(220), maxBlockSize: '18rem', overflowY: 'auto' } as const;

export type SpaceComposerRoomMenuProps = {
  sendableRooms: readonly SpaceComposerRoom[];
  targetRoom: SpaceComposerRoom;
  onSelect: (roomId: string) => void;
};

export function SpaceComposerRoomMenu({
  sendableRooms,
  targetRoom,
  onSelect,
}: SpaceComposerRoomMenuProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<RectCords>();
  const [query, setQuery] = useState('');

  const close = () => {
    setAnchor(undefined);
    setQuery('');
    return true;
  };
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? sendableRooms.filter((item) => item.name.toLocaleLowerCase().includes(needle))
    : sendableRooms;

  return (
    <PopOut
      anchor={anchor}
      position="Top"
      align="Start"
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            returnFocusOnDeactivate: false,
            clickOutsideDeactivates: close,
            escapeDeactivates: close,
          }}
        >
          <Menu data-owns-focus="" style={MENU_STYLE}>
            <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
              {sendableRooms.length > DROPDOWN_SEARCH_THRESHOLD && (
                <input
                  type="search"
                  className={css.ComposerMenuSearch}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && query) {
                      e.stopPropagation();
                      setQuery('');
                    }
                  }}
                  placeholder={t('spaceThreads.composer.searchRooms')}
                  aria-label={t('spaceThreads.composer.searchRooms')}
                  data-space-composer-search="true"
                />
              )}
              {matches.map((item) => {
                const active = item.room.roomId === targetRoom.room.roomId;
                return (
                  <button
                    key={item.room.roomId}
                    type="button"
                    className={classNames(
                      css.ComposerMenuRow,
                      active && overviewCss.SortButtonActive
                    )}
                    aria-pressed={active}
                    onClick={() => {
                      onSelect(item.room.roomId);
                      close();
                    }}
                    data-space-composer-option={item.room.roomId}
                  >
                    <span
                      className={css.RoomDot}
                      style={{ backgroundColor: item.accentColor }}
                      aria-hidden="true"
                    />
                    <Text as="span" size="T200" truncate {...ownDirectionLine}>
                      {item.name}
                    </Text>
                  </button>
                );
              })}
              {matches.length === 0 && (
                <Text size="T200" style={{ padding: config.space.S200 }}>
                  {t('spaceThreads.composer.noMatchingRooms')}
                </Text>
              )}
            </Box>
          </Menu>
        </FocusTrap>
      }
    >
      <button
        type="button"
        className={classNames(overviewCss.SortButton, overviewCss.SortButtonActive)}
        onClick={(e) =>
          setAnchor((cur) => (cur ? undefined : e.currentTarget.getBoundingClientRect()))
        }
        aria-label={t('spaceThreads.composer.chooseRoomAria')}
        aria-expanded={Boolean(anchor)}
        aria-haspopup="menu"
        data-space-composer-target={targetRoom.room.roomId}
        data-space-composer-picker="true"
      >
        <span
          className={css.RoomDot}
          style={{ backgroundColor: targetRoom.accentColor }}
          aria-hidden="true"
        />
        <Text as="span" size="T200" truncate {...ownDirectionLine}>
          {t('spaceThreads.composer.postToRoom', { room: targetRoom.name })}
        </Text>
        <IconChevronDown size={14} stroke={1.8} aria-hidden="true" />
      </button>
    </PopOut>
  );
}
