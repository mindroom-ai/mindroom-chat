import React, { useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import {
  Avatar,
  Badge,
  Box,
  Icon,
  IconButton,
  Icons,
  Line,
  Text,
  Tooltip,
  config,
  toRem,
} from 'folds';
import {
  PopOut,
  TooltipProvider,
  ownDirectionLine,
  revealDirectionControls,
} from '../../ui/directional';
import { Menu } from '../../ui/glass/GlassPrimitives';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../ui/page/Page';
import { PhoneBackButton } from '../../ui/page/PhoneBackButton';
import { RoomAvatar } from '../../avatars/RoomAvatar';
import { InviteUserPrompt } from '../../members/invite/InviteUserPrompt';
import { LeaveRoomPrompt } from '../../rooms/LeaveRoomPrompt';
import { useNavigate } from 'react-router-dom';
import { getHomePath } from '../../routes/pathUtils';
import { useMembersDrawer } from '../../members/useMembersDrawer';
import { useRoomAvatar, useRoomName } from '../../matrix/hooks/useRoomMeta';
import { useSpace } from '../../matrix/hooks/useSpace';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import type { IPowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { useOpenRoomSettings } from '../../navigation/useRoomSettingsState';
import { mxcUrlToHttp } from '../../matrix/matrix';
import { nameInitials } from '../../lib/common';
import { MenuEntry } from '../../ui/MenuEntry';
import { LoneTouchTarget } from '../../ui/styles/TouchTarget.css';

type LobbyHeaderProps = {
  powerLevels: IPowerLevels;
  /** Pending join requests (knocks) in the space. */
  joinRequestCount?: number;
  /** The space's room list, where a phone's back chevron leads. */
  backTo?: string;
  /** The space's picture and name; the lobby hides them while its own title is in view. */
  showProfile?: boolean;
};

/** The space's avatar as a small cropped thumbnail URL, or undefined when it has none. */
export const useSpaceAvatarSrc = (space: Room): string | undefined => {
  const client = useMatrixClient();
  const authenticated = useMediaAuthentication();
  const avatarMxc = useRoomAvatar(space);
  if (!avatarMxc) return undefined;
  return mxcUrlToHttp(client, avatarMxc, authenticated, 96, 96, 'crop') ?? undefined;
};

type SpaceAvatarProps = { roomId: string; name: string; src?: string; large?: boolean };

/** The space's picture (in the header, or large atop the lobby), or its initials without one. */
export function SpaceAvatar({ roomId, name, src, large = false }: SpaceAvatarProps) {
  return (
    <Avatar size={large ? '500' : '300'} radii={large ? '500' : '300'}>
      <RoomAvatar
        roomId={roomId}
        src={src}
        alt={name}
        renderFallback={() => <Text size={large ? 'H2' : 'H6'}>{nameInitials(name)}</Text>}
      />
    </Avatar>
  );
}

/** Asks before leaving the space, then goes Home, since the space's pages close with it. */
function LeaveSpaceDialog({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <LeaveRoomPrompt
      roomId={spaceId}
      requestClose={onClose}
      onLeft={() => {
        onClose();
        navigate(getHomePath());
      }}
    />
  );
}

/** The header of a space's lobby: back on mobile, the space, members with join requests, options. */
export function LobbyHeader({
  powerLevels,
  joinRequestCount = 0,
  backTo,
  showProfile = true,
}: LobbyHeaderProps) {
  const space = useSpace();
  const spaceName = revealDirectionControls(useRoomName(space));
  const avatarSrc = useSpaceAvatarSrc(space);
  const client = useMatrixClient();
  const screenSize = useScreenSizeContext();
  const { t } = useTranslation();
  const [membersOpen, setMembersOpen] = useMembersDrawer();
  const openSpaceSettings = useOpenRoomSettings();

  // Reviewing join requests takes the power to let people in (invite) or to keep them out (kick).
  const myUserId = client.getSafeUserId();
  const permissions = useRoomPermissions(useRoomCreators(space), powerLevels);
  const canInvite = permissions.action('invite', myUserId);
  const canReview = canInvite || permissions.action('kick', myUserId);
  const pendingRequests = canReview ? joinRequestCount : 0;

  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Also the focus trap's outside-click and Escape handler, so it returns true to let those through.
  const closeMenu = () => {
    setMenuAnchor(undefined);
    return true;
  };
  const menuActions = [
    {
      label: t('featureUi.lobby.lobbyHeader.invite'),
      icon: Icons.UserPlus,
      disabled: !canInvite,
      run: () => setInviteOpen(true),
    },
    {
      label: t('featureUi.lobby.lobbyHeader.spaceSettings'),
      icon: Icons.Setting,
      disabled: false,
      run: () => openSpaceSettings(space.roomId),
    },
  ];

  const baseMembersLabel = t('featureUi.lobby.lobbyHeader.members');
  const membersLabel =
    pendingRequests > 0
      ? t('featureUi.room.pendingJoinRequests.accessibleLabel', {
          baseLabel: baseMembersLabel,
          count: pendingRequests,
        })
      : baseMembersLabel;

  return (
    <PageHeader balance={screenSize === ScreenSize.Mobile}>
      <Box grow="Yes" alignItems="Center" gap="200">
        {backTo && <PhoneBackButton to={backTo} />}
        <Box grow="Yes" alignItems="Center" gap="300" style={{ minWidth: 0 }}>
          {showProfile && (
            <>
              <SpaceAvatar roomId={space.roomId} name={spaceName} src={avatarSrc} />
              <Text size="H4" truncate {...ownDirectionLine}>
                {spaceName}
              </Text>
            </>
          )}
        </Box>
        <TooltipProvider
          position="Bottom"
          offset={4}
          tooltip={
            <Tooltip>
              <Text>{membersLabel}</Text>
            </Tooltip>
          }
        >
          {(triggerRef) => (
            <IconButton
              ref={triggerRef}
              className={LoneTouchTarget}
              aria-label={membersLabel}
              aria-pressed={membersOpen}
              onClick={() => setMembersOpen(!membersOpen)}
              style={{ position: 'relative' }}
            >
              <Icon size="400" src={Icons.User} filled={membersOpen} />
              {pendingRequests > 0 && (
                <Badge
                  variant="Primary"
                  fill="Solid"
                  radii="Pill"
                  size="400"
                  style={{ position: 'absolute', top: 0, insetInlineEnd: 0, minWidth: toRem(16) }}
                >
                  <Text size="L400">{pendingRequests}</Text>
                </Badge>
              )}
            </IconButton>
          )}
        </TooltipProvider>
        <PopOut
          anchor={menuAnchor}
          position="Bottom"
          align="End"
          content={
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                returnFocusOnDeactivate: false,
                clickOutsideDeactivates: closeMenu,
                escapeDeactivates: closeMenu,
              }}
            >
              <Menu style={{ minWidth: toRem(180) }}>
                <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                  {menuActions.map((action) => (
                    <MenuEntry
                      key={action.label}
                      label={action.label}
                      icon={action.icon}
                      disabled={action.disabled}
                      onSelect={() => {
                        closeMenu();
                        action.run();
                      }}
                    />
                  ))}
                </Box>
                <Line size="300" />
                <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                  <MenuEntry
                    label={t('featureUi.lobby.lobbyHeader.leaveSpace')}
                    icon={Icons.ArrowGoLeft}
                    directional
                    critical
                    onSelect={() => {
                      closeMenu();
                      setLeaving(true);
                    }}
                  />
                </Box>
              </Menu>
            </FocusTrap>
          }
        >
          <IconButton
            className={LoneTouchTarget}
            onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
              setMenuAnchor(event.currentTarget.getBoundingClientRect())
            }
            aria-label={t('featureUi.lobby.lobbyHeader.moreOptions')}
            aria-pressed={!!menuAnchor}
          >
            <Icon size="400" src={Icons.VerticalDots} />
          </IconButton>
        </PopOut>
      </Box>
      {inviteOpen && <InviteUserPrompt room={space} requestClose={() => setInviteOpen(false)} />}
      {leaving && <LeaveSpaceDialog spaceId={space.roomId} onClose={() => setLeaving(false)} />}
    </PageHeader>
  );
}
