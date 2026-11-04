import React, { useState } from 'react';
import { Box, Icon, IconButton, Icons, Line, PopOut, Text, config, toRem } from 'folds';
import type { IconSrc, RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import type { Options as FocusTrapOptions } from 'focus-trap';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import { InviteUserPrompt } from '../../components/invite-user-prompt';
import { LeaveRoomPrompt } from '../../components/leave-room-prompt/LeaveRoomPrompt';
import { LeaveSpacePrompt } from '../../components/leave-space-prompt';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import type { HierarchyItem } from '../../hooks/useSpaceHierarchy';
import { useOpenRoomSettings } from '../../state/hooks/roomSettings';
import { useOpenSpaceSettings } from '../../state/hooks/spaceSettings';
import { stopPropagation } from '../../utils/keyboard';
import {
  isSpaceInSidebar,
  pinSpaceToSidebar,
  unpinSpaceFromSidebar,
  useSavedSidebarItems,
  useTopLevelSpaceIds,
} from '../../pages/client/sidebar/sidebarSpaces';
import {
  canSendState,
  getMyRoomPermissions,
  removeSpaceChild,
  setSpaceChildSuggested,
} from './spaceChildren';
import { StateEvent } from '../../../types/matrix/room';

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
  const showSpaceSettings = useOpenSpaceSettings();
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
      run: () =>
        isSpaceItem ? showSpaceSettings(roomId) : showRoomSettings(roomId, parent?.roomId),
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
        setSpaceChildSuggested(client, parent, roomId, !suggested);
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
        if (pinned) unpinSpaceFromSidebar(client, roomId);
        else pinSpaceToSidebar(client, roomId, topLevelSpaces);
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
        removeSpaceChild(client, parent.roomId, roomId);
      },
    });
  }
  if (joinedRoom) {
    parting.push({
      key: 'leave',
      label: t('featureUi.lobby.hierarchyItemMenu.leave'),
      icon: Icons.ArrowGoLeft,
      critical: true,
      run: () => setDialog('leave'),
    });
  }

  if (actions.length === 0 && parting.length === 0) return null;

  const close = () => {
    setAnchor(undefined);
  };
  const renderAction = (action: MenuAction) => (
    <MenuItem
      key={action.key}
      size="300"
      radii="300"
      variant={action.critical ? 'Critical' : undefined}
      fill={action.critical ? 'None' : undefined}
      after={<Icon size="100" src={action.icon} />}
      onClick={() => {
        close();
        action.run();
      }}
    >
      <Text as="span" size="T300" align="Left" truncate style={{ flexGrow: 1 }}>
        {action.label}
      </Text>
    </MenuItem>
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
      {dialog === 'leave' && isSpaceItem && (
        <LeaveSpacePrompt
          roomId={roomId}
          onLeft={() => setDialog(undefined)}
          requestClose={() => setDialog(undefined)}
        />
      )}
      {dialog === 'leave' && !isSpaceItem && (
        <LeaveRoomPrompt
          roomId={roomId}
          onLeft={() => setDialog(undefined)}
          requestClose={() => setDialog(undefined)}
        />
      )}
    </>
  );
}
