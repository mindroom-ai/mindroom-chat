import {
  type MouseEvent,
  type MouseEventHandler,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Avatar,
  Box,
  Icon,
  IconButton,
  Icons,
  Text,
  toRem,
  type IconSrc,
  type RectCords,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { atom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { stopPropagation } from '../../lib/keyboard';
import { navigationRoomToUnreadAtom } from '../../notifications/navigationUnread';
import {
  type CollapsedSectionUnread,
  getCollapsedSectionUnread,
} from '../../spaces/spaceRoomSections';
import { PopOut } from '../../ui/directional';
import { Menu } from '../../ui/glass/GlassPrimitives';
import { MenuEntry, MenuGroup } from '../../ui/MenuEntry';
import { NavCategoryHeader } from '../../ui/nav/NavCategoryHeader';
import { NavButton, NavItem, NavItemContent, NavLink } from '../../ui/nav/NavItem';
import * as scrollableMenuCss from '../../ui/ScrollableMenu.css';
import { UnreadBadgeCenter } from '../../ui/UnreadBadge';
import { RoomNavCategoryButton } from '../room-nav/RoomNavCategoryButton';
import * as spaceHeaderCss from '../space/SpaceSectionHeader.css';
import * as css from './HomeSections.css';

const EMPTY_UNREAD_ATOM = atom((): CollapsedSectionUnread | undefined => undefined);
const COMPACT_HEADER_STYLE = { minHeight: undefined };

type HomeEmptyRoomActionProps = {
  /** Value of `data-home-room-action`, which tests and styles select on. */
  action: 'create' | 'join';
  icon: IconSrc;
  label: string;
  selected?: boolean;
} & ({ onSelect: () => void; to?: undefined } | { to: string; onSelect?: undefined });

/** One of the empty-state shortcuts: a link when it opens a page, else a button. */
export function HomeEmptyRoomAction({
  action,
  icon,
  label,
  selected,
  onSelect,
  to,
}: HomeEmptyRoomActionProps) {
  const content = (
    <NavItemContent>
      <Box as="span" alignItems="Center" gap="200" grow="Yes">
        <Avatar radii="400" size="200">
          <Icon size="100" src={icon} />
        </Avatar>
        <Text as="span" size="Inherit" truncate>
          {label}
        </Text>
      </Box>
    </NavItemContent>
  );
  return (
    <NavItem aria-selected={selected} radii="400" variant="Background">
      {to === undefined ? (
        <NavButton data-home-room-action={action} onClick={onSelect}>
          {content}
        </NavButton>
      ) : (
        <NavLink data-home-room-action={action} to={to}>
          {content}
        </NavLink>
      )}
    </NavItem>
  );
}

const useCollapsedSectionUnread = (
  closed: boolean,
  roomIds: readonly string[],
  selectedRoomId: string | undefined
): CollapsedSectionUnread | undefined => {
  const unreadAtom = useMemo(
    () =>
      closed
        ? atom((get) =>
            getCollapsedSectionUnread(
              true,
              roomIds,
              selectedRoomId,
              get(navigationRoomToUnreadAtom)
            )
          )
        : EMPTY_UNREAD_ATOM,
    [closed, roomIds, selectedRoomId]
  );
  return useAtomValue(unreadAtom);
};

export type HomeSectionHeaderProps = {
  label: string;
  icon?: IconSrc;
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
 * Compact collapsible heading for Home sections (`Rooms`, `Direct messages`, `Agents`) with an
 * optional leading icon, collapsed quiet unread dot, and hover `+` quick action.
 */
export function HomeSectionHeader({
  label,
  icon,
  categoryId,
  closed,
  roomIds,
  selectedRoomId,
  onCategoryClick,
  addAction,
}: HomeSectionHeaderProps) {
  const { t } = useTranslation();
  const unread = useCollapsedSectionUnread(closed, roomIds, selectedRoomId);
  return (
    <NavCategoryHeader
      className={spaceHeaderCss.Header}
      style={COMPACT_HEADER_STYLE}
      data-actions-count={addAction ? 1 : undefined}
      data-menu-open={addAction?.menuOpen ? 'true' : undefined}
    >
      <RoomNavCategoryButton
        className={spaceHeaderCss.HeaderButton}
        closed={closed}
        data-category-id={categoryId}
        aria-label={unread ? t('featureUi.spaceNav.subspaceUnread', { name: label }) : undefined}
        before={
          icon ? (
            <Icon size="50" src={icon} className={css.SectionIcon} aria-hidden="true" />
          ) : undefined
        }
        after={
          unread && (
            <span className={spaceHeaderCss.UnreadSlot}>
              <UnreadBadgeCenter>
                <span data-unread data-highlight={unread.highlight ? 'true' : undefined}>
                  <span
                    className={
                      unread.highlight
                        ? spaceHeaderCss.QuietHighlightDot
                        : spaceHeaderCss.QuietUnreadDot
                    }
                    aria-hidden="true"
                  />
                </span>
              </UnreadBadgeCenter>
            </span>
          )
        }
        onClick={onCategoryClick}
      >
        {label}
      </RoomNavCategoryButton>
      {addAction && (
        <div className={spaceHeaderCss.SectionActions}>
          <IconButton
            size="300"
            radii="300"
            variant="Background"
            fill="None"
            className={spaceHeaderCss.ActionButton}
            aria-label={addAction.label}
            aria-haspopup={addAction.hasMenu ? 'menu' : undefined}
            aria-expanded={addAction.hasMenu ? Boolean(addAction.menuOpen) : undefined}
            onClick={addAction.onClick}
          >
            <Icon size="50" src={Icons.Plus} />
          </IconButton>
        </div>
      )}
    </NavCategoryHeader>
  );
}

export type AddRoomsMenuSource = 'header' | 'row';

type AddRoomsMenuState = {
  source: AddRoomsMenuSource;
  anchor: RectCords;
  align: 'Start' | 'End';
};

/** Manages the Create Room / Join a Room popover shared by the Rooms header `+` and `+ Add rooms`. */
export function useHomeAddRoomsMenu({
  onCreate,
  onJoin,
}: {
  onCreate: () => void;
  onJoin: () => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<AddRoomsMenuState>();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const refocusRef = useRef(false);

  const close = useCallback(() => {
    setMenu(undefined);
    if (refocusRef.current) {
      refocusRef.current = false;
      returnFocusRef.current?.focus();
    }
    returnFocusRef.current = null;
  }, []);

  const open = useCallback(
    (source: AddRoomsMenuSource, align: 'Start' | 'End', event: MouseEvent<HTMLButtonElement>) => {
      refocusRef.current = false;
      returnFocusRef.current = event.currentTarget;
      setMenu({ source, align, anchor: event.currentTarget.getBoundingClientRect() });
    },
    []
  );
  const openFromHeader = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => open('header', 'End', event),
    [open]
  );
  const openFromRow = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => open('row', 'Start', event),
    [open]
  );

  const popover = menu ? (
    <PopOut
      anchor={menu.anchor}
      position="Bottom"
      align={menu.align}
      offset={4}
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            returnFocusOnDeactivate: false,
            clickOutsideDeactivates: true,
            escapeDeactivates: (event) => {
              if (!stopPropagation(event)) return false;
              refocusRef.current = true;
              return true;
            },
            onDeactivate: close,
          }}
        >
          <Menu
            className={scrollableMenuCss.ScrollableMenu}
            style={{ width: '100vw', maxWidth: toRem(220) }}
          >
            <div className={scrollableMenuCss.ScrollableMenuRows}>
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
                    close();
                    onJoin();
                  }}
                />
              </MenuGroup>
            </div>
          </Menu>
        </FocusTrap>
      }
    />
  ) : null;

  return { source: menu?.source, openFromHeader, openFromRow, popover };
}

/** Inline `+ Add rooms` row at the bottom of expanded Rooms (or below search/Spaces when unspaced is empty). */
export function HomeAddRoomsRow({
  menuOpen,
  onOpenMenu,
}: {
  menuOpen: boolean;
  onOpenMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useTranslation();
  return (
    <NavItem radii="400" variant="Background">
      <NavButton
        data-home-room-action="add"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={onOpenMenu}
      >
        <NavItemContent>
          <Box as="span" alignItems="Center" gap="200" grow="Yes">
            <Avatar size="200" radii="400" className={css.InlinePlusAvatar}>
              <Icon size="100" src={Icons.Plus} />
            </Avatar>
            <Text as="span" size="Inherit" priority="300" truncate>
              {t('featureUi.homeNav.addRooms')}
            </Text>
          </Box>
        </NavItemContent>
      </NavButton>
    </NavItem>
  );
}
