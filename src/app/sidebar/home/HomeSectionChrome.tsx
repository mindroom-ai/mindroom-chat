import { type MouseEvent, type MouseEventHandler, useCallback, useState } from 'react';
import { Avatar, Box, Icon, Icons, Text, type IconSrc, type RectCords } from 'folds';
import { useTranslation } from 'react-i18next';
import { MenuEntry, MenuGroup } from '../../ui/MenuEntry';
import { NavCategoryHeader } from '../../ui/nav/NavCategoryHeader';
import { NavButton, NavItem, NavItemContent } from '../../ui/nav/NavItem';
import * as roomNavCss from '../room-nav/RoomNavItem.css';
import { SectionMenuPopOut } from '../SectionMenuPopOut';
import {
  COMPACT_HEADER_STYLE,
  SectionActionButton,
  SectionHeaderButton,
} from '../space/SpaceSectionHeader';
import * as spaceHeaderCss from '../space/SpaceSectionHeader.css';

/** Shared leading-icon + label layout for Home's inline and empty-state action rows. */
export function HomeActionRowContent({
  icon,
  label,
  tintedTile = false,
  iconClassName,
  quiet = true,
}: {
  icon: IconSrc;
  label: string;
  /** Render the subtle rounded tile behind `+` action icons. */
  tintedTile?: boolean;
  iconClassName?: string;
  /** Use muted `300` text priority (default for inline rows); empty-state rows omit priority. */
  quiet?: boolean;
}) {
  return (
    <NavItemContent>
      <Box as="span" alignItems="Center" gap="200" grow="Yes">
        <Avatar
          size="200"
          radii="400"
          className={tintedTile ? roomNavCss.SubtleAvatarTile : undefined}
        >
          <Icon size="100" src={icon} className={iconClassName} />
        </Avatar>
        <Text as="span" size="Inherit" priority={quiet ? '300' : undefined} truncate>
          {label}
        </Text>
      </Box>
    </NavItemContent>
  );
}

/** One of the empty-state shortcuts (`Create Room`, `Join a Room`). */
export function HomeEmptyRoomAction({
  action,
  icon,
  label,
  selected,
  onSelect,
}: {
  /** Value of `data-home-room-action`, which tests and styles select on. */
  action: 'create' | 'join';
  icon: IconSrc;
  label: string;
  selected?: boolean;
  onSelect: () => void;
}) {
  return (
    <NavItem aria-selected={selected} radii="400" variant="Background">
      <NavButton data-home-room-action={action} onClick={onSelect}>
        <HomeActionRowContent icon={icon} label={label} quiet={false} />
      </NavButton>
    </NavItem>
  );
}

export type HomeSectionHeaderProps = {
  label: string;
  categoryId: string;
  closed: boolean;
  roomIds: readonly string[];
  selectedRoomId: string | undefined;
  onCategoryClick: MouseEventHandler<HTMLElement>;
  addAction?: {
    label: string;
    hasMenu?: boolean;
    menuOpen?: boolean;
    onClick: MouseEventHandler<HTMLButtonElement>;
  };
};

/**
 * Compact collapsible heading for Home sections (`Rooms`, `Direct messages`, `Agents`) with a
 * collapsed quiet unread dot and optional hover `+` quick action.
 */
export function HomeSectionHeader({
  label,
  categoryId,
  closed,
  roomIds,
  selectedRoomId,
  onCategoryClick,
  addAction,
}: HomeSectionHeaderProps) {
  return (
    <NavCategoryHeader
      className={spaceHeaderCss.Header}
      style={COMPACT_HEADER_STYLE}
      data-actions-count={addAction ? 1 : undefined}
      data-menu-open={addAction?.menuOpen ? 'true' : undefined}
    >
      <SectionHeaderButton
        label={label}
        categoryId={categoryId}
        closed={closed}
        shownRoomIds={roomIds}
        selectedRoomId={selectedRoomId}
        quietUnread
        onClick={onCategoryClick}
      />
      {addAction && (
        <div className={spaceHeaderCss.SectionActions}>
          <SectionActionButton
            icon={Icons.Plus}
            label={addAction.label}
            hasMenu={addAction.hasMenu}
            menuOpen={addAction.menuOpen}
            onClick={addAction.onClick}
          />
        </div>
      )}
    </NavCategoryHeader>
  );
}

export type AddRoomsMenuSource = 'header' | 'row';

type AddRoomsMenuState = {
  source: AddRoomsMenuSource;
  anchor: RectCords;
  opener: HTMLElement | null;
};

/** Manages the Create Room / Join a Room popover shared by the Rooms header `+` and `+ Add rooms`. */
export function useHomeAddRoomsMenu({
  onCreate,
  onJoin,
}: {
  onCreate: () => void;
  onJoin: (opener: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<AddRoomsMenuState>();

  const close = useCallback(() => setMenu(undefined), []);
  const open = useCallback(
    (source: AddRoomsMenuSource, event: MouseEvent<HTMLButtonElement>) =>
      setMenu({
        source,
        anchor: event.currentTarget.getBoundingClientRect(),
        opener: event.currentTarget,
      }),
    []
  );
  const openFromHeader = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => open('header', event),
    [open]
  );
  const openFromRow = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => open('row', event),
    [open]
  );

  const popover = menu ? (
    <SectionMenuPopOut
      anchor={menu.anchor}
      align={menu.source === 'header' ? 'End' : 'Start'}
      returnFocusTo={menu.opener}
      onClose={close}
    >
      <MenuGroup>
        <MenuEntry
          icon={Icons.Plus}
          label={t('nav.createRoom')}
          data-home-room-action="create"
          onSelect={() => {
            close();
            onCreate();
          }}
        />
        <MenuEntry
          icon={Icons.Link}
          label={t('sharedUi.joinAddressPrompt.joinARoom')}
          data-home-room-action="join"
          onSelect={() => {
            const { opener } = menu;
            close();
            onJoin(opener);
          }}
        />
      </MenuGroup>
    </SectionMenuPopOut>
  ) : null;

  return { source: menu?.source, openFromHeader, openFromRow, popover };
}

export type HomeAddRoomsMenu = ReturnType<typeof useHomeAddRoomsMenu>;

/** Inline `+ Add rooms` row at the bottom of expanded Rooms (or below search/Spaces when unspaced is empty). */
export function HomeAddRoomsRow({ addRoomsMenu }: { addRoomsMenu: HomeAddRoomsMenu }) {
  const { t } = useTranslation();
  return (
    <NavItem radii="400" variant="Background">
      <NavButton
        data-home-room-action="add"
        aria-haspopup="menu"
        aria-expanded={addRoomsMenu.source === 'row'}
        onClick={addRoomsMenu.openFromRow}
      >
        <HomeActionRowContent
          icon={Icons.Plus}
          label={t('featureUi.homeNav.addRooms')}
          tintedTile
        />
      </NavButton>
    </NavItem>
  );
}
