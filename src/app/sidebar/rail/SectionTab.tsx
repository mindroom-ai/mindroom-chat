import { type ReactNode, useState } from 'react';
import { Icon, type IconSrc, type RectCords } from 'folds';
import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
} from '../../ui/sidebar/SidebarItem';
import { UnreadBadge } from '../../ui/unread-badge/UnreadBadge';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { useNavToActivePathAtom } from '../../routes/useNavToActivePath';
import { useRoomsUnread } from '../../matrix/state/useUnread';
import { roomToUnreadAtom } from '../../matrix/state/roomToUnread';
import { joinPathComponent } from '../../routes/pathUtils';
import { SidebarContextMenu, toggleContextMenu } from './SidebarContextMenu';

type SectionTabProps = {
  /** The section's key among the last opened paths. */
  section: 'home' | 'direct';
  /** The section's list page. */
  path: string;
  /** Its icon, and the name its tooltip shows and screen readers read. */
  icon: IconSrc;
  label: string;
  selected: boolean;
  /** The rooms its unread badge counts. */
  rooms: string[];
  /** The right-click menu's entries (Mark as Read for the same rooms); `close` dismisses it. */
  menu: (close: () => void) => ReactNode;
  /** Direct messages are personal, so any unread one stands out like a mention. */
  personal?: boolean;
  /** Lets the navigation panel take the click, given whether the section is shown; true when it did. */
  onSelect?: (selected: boolean) => boolean;
};

/**
 * A section button of the icon rail (Home, Direct Messages): returns to the last place opened in
 * the section, shows its unread count, and opens its menu on right click.
 */
export function SectionTab({
  section,
  path,
  icon,
  label,
  selected,
  rooms,
  menu,
  personal,
  onSelect,
}: SectionTabProps) {
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const closeMenu = () => setMenuAnchor(undefined);
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const lastPaths = useAtomValue(useNavToActivePathAtom());
  const sectionUnread = useRoomsUnread(rooms, roomToUnreadAtom);
  const navigate = useNavigate();

  const open = () => {
    if (onSelect?.(selected)) return;
    // On phones the first tap shows the section's list; a second one returns to the last room.
    const lastPath = phone && !selected ? undefined : lastPaths.get(section);
    navigate(lastPath ? joinPathComponent(lastPath) : path);
  };

  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip={label}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={label}
            onClick={open}
            onContextMenu={toggleContextMenu(setMenuAnchor)}
          >
            <Icon filled={selected} src={icon} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
      {sectionUnread && (
        <SidebarItemBadge hasCount={sectionUnread.total > 0}>
          <UnreadBadge
            dm={personal}
            count={sectionUnread.total}
            highlight={sectionUnread.highlight > 0}
          />
        </SidebarItemBadge>
      )}
      <SidebarContextMenu anchor={menuAnchor} onClose={closeMenu}>
        {menu(closeMenu)}
      </SidebarContextMenu>
    </SidebarItem>
  );
}
