import React, { useState } from 'react';
import { Box, Icon, IconButton, Icons, Line, config, toRem } from 'folds';
import { PopOut } from '../../ui/directional';
import type { IconSrc, RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import type { Options as FocusTrapOptions } from 'focus-trap';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Menu } from '../../ui/glass/GlassPrimitives';
import { InviteUserPrompt } from '../../members/invite/InviteUserPrompt';
import { LeaveRoomPrompt } from '../../rooms/LeaveRoomPrompt';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import type { HierarchyItem } from '../useSpaceHierarchy';
import { useOpenRoomSettings } from '../../navigation/useRoomSettingsState';
import { stopPropagation } from '../../lib/keyboard';
import {
  isSpaceInSidebar,
  pinSpaceToSidebar,
  unpinSpaceFromSidebar,
  useSavedSidebarItems,
  useTopLevelSpaceIds,
} from '../sidebarSpaces';
import {
  canSendState,
  getMyRoomPermissions,
  removeSpaceChild,
  setSpaceChildSuggested,
} from './spaceChildren';
import { StateEvent } from '../../matrix/types/room';
import { MenuEntry } from '../../ui/MenuEntry';
import { LoneTouchTarget } from '../../ui/styles/TouchTarget.css';

type HierarchyItemMenuProps = {
  item: HierarchyItem;
  /** The space the item is listed in, when the client has it. */
  parent: Room | undefined;
  /** The client's copy of the item, when the user is in it. */
  joinedRoom: Room | undefined;
};

type Dialog = 'invite' | 'leave' | undefined;

type MenuAction = {
  key: string;
  label: string;
  icon: IconSrc;
  critical?: boolean;
  /** The icon points along the reading direction, so right-to-left languages mirror it. */
  directional?: boolean;
  run: () => void;
};

const MENU_WIDTH = toRem(200);

/** The menu closes on Escape (which goes no further) and on a click anywhere else. */
const menuTrap = (onClose: () => void): FocusTrapOptions => ({
  onDeactivate: onClose,
  escapeDeactivates: stopPropagation,
  clickOutsideDeactivates: true,
  returnFocusOnDeactivate: false,
  initialFocus: false,
});

/**
 * The options of a room or subspace in a lobby: invite people, open its settings, mark it as
 * suggested, pin a subspace to the rail, take it out of the space, or leave it. Each choice shows
 * only for those allowed to make it.
 */
export function HierarchyItemMenu({ item, parent, joinedRoom }: HierarchyItemMenuProps) {
  const [anchor, setAnchor] = useState<RectCords>();
  const [dialog, setDialog] = useState<Dialog>();
  const { t } = useTranslation();
  const client = useMatrixClient();
  const pinnedSpaces = useSavedSidebarItems();
  const topLevelSpaces = useTopLevelSpaceIds();
  const showRoomSettings = useOpenRoomSettings();
  const { roomId } = item;
  const isSpaceItem = !!item.space;

  const canEditParent = !!parent && canSendState(client, parent, StateEvent.SpaceChild);
  const canInvite = !!joinedRoom && getMyRoomPermissions(client, joinedRoom).invite();
  const pinned = isSpaceInSidebar(pinnedSpaces, roomId);

  const actions: MenuAction[] = [];
  if (joinedRoom && canInvite) {
    actions.push({
      key: 'invite',
      label: t('featureUi.lobby.hierarchyItemMenu.invite'),
      icon: Icons.UserPlus,
      run: () => setDialog('invite'),
    });
  }
  if (joinedRoom) {
    actions.push({
      key: 'settings',
      label: t('featureUi.lobby.hierarchyItemMenu.settings'),
      icon: Icons.Setting,
      run: () => showRoomSettings(roomId),
    });
  }
  if (canEditParent && parent) {
    const suggested = item.content.suggested === true;
    actions.push({
      key: 'suggested',
      label: suggested
        ? t('featureUi.lobby.hierarchyItemMenu.unsetSuggested')
        : t('featureUi.lobby.hierarchyItemMenu.setSuggested'),
      icon: Icons.Star,
      run: () => {
        void setSpaceChildSuggested(client, parent, roomId, !suggested);
      },
    });
  }
  if (isSpaceItem && joinedRoom) {
    actions.push({
      key: 'pin',
      label: pinned
        ? t('featureUi.lobby.hierarchyItemMenu.unpinFromSidebar')
        : t('featureUi.lobby.hierarchyItemMenu.pinToSidebar'),
      icon: Icons.Pin,
      run: () => {
        if (pinned) void unpinSpaceFromSidebar(client, roomId);
        else void pinSpaceToSidebar(client, roomId, topLevelSpaces);
      },
    });
  }
  const parting: MenuAction[] = [];
  if (canEditParent && parent) {
    parting.push({
      key: 'remove',
      label: t('featureUi.lobby.hierarchyItemMenu.remove'),
      icon: Icons.Delete,
      critical: true,
      run: () => {
        void removeSpaceChild(client, parent.roomId, roomId);
      },
    });
  }
  if (joinedRoom) {
    parting.push({
      key: 'leave',
      label: t('featureUi.lobby.hierarchyItemMenu.leave'),
      icon: Icons.ArrowGoLeft,
      critical: true,
      directional: true,
      run: () => setDialog('leave'),
    });
  }

  if (actions.length === 0 && parting.length === 0) return null;

  const close = () => {
    setAnchor(undefined);
  };
  const renderAction = (action: MenuAction) => (
    <MenuEntry
      key={action.key}
      label={action.label}
      icon={action.icon}
      critical={action.critical}
      directional={action.directional}
      onSelect={() => {
        close();
        action.run();
      }}
    />
  );

  const menu = (
    <FocusTrap focusTrapOptions={menuTrap(close)}>
      <Menu style={{ width: '100vw', maxWidth: MENU_WIDTH }}>
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          {actions.map(renderAction)}
        </Box>
        {actions.length > 0 && parting.length > 0 && <Line size="300" />}
        {parting.length > 0 && (
          <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
            {parting.map(renderAction)}
          </Box>
        )}
      </Menu>
    </FocusTrap>
  );

  return (
    <>
      <PopOut anchor={anchor} position="Bottom" align="End" offset={4} content={menu}>
        <IconButton
          size="300"
          radii="300"
          variant="SurfaceVariant"
          className={LoneTouchTarget}
          aria-label={t('featureUi.lobby.lobbyHeader.moreOptions')}
          aria-pressed={!!anchor}
          onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
            setAnchor(anchor ? undefined : event.currentTarget.getBoundingClientRect())
          }
        >
          <Icon size="100" src={Icons.VerticalDots} />
        </IconButton>
      </PopOut>
      {dialog === 'invite' && joinedRoom && (
        <InviteUserPrompt room={joinedRoom} requestClose={() => setDialog(undefined)} />
      )}
      {dialog === 'leave' && (
        <LeaveRoomPrompt
          roomId={roomId}
          onLeft={() => setDialog(undefined)}
          requestClose={() => setDialog(undefined)}
        />
      )}
    </>
  );
}
