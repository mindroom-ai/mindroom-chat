import React, { Suspense, lazy, useState } from 'react';
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
import type { IconSrc, RectCords } from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../ui/page/Page';
import { PhoneBackButton } from '../../ui/page/PhoneBackButton';
import { RoomAvatar } from '../../avatars/RoomAvatar';
import { LeaveRoomPrompt } from '../../rooms/LeaveRoomPrompt';
import { useNavigate } from 'react-router-dom';
import { getHomePath, getSpaceThreadsPath } from '../../routes/pathUtils';
import { useMembersDrawer } from '../../members/useMembersDrawer';
import { useRoomAvatar, useRoomName } from '../../matrix/hooks/useRoomMeta';
import { useSpace } from '../../matrix/hooks/useSpace';

const InviteUserPrompt = lazy(() =>
  import('../../members/invite/InviteUserPrompt').then((module) => ({
    default: module.InviteUserPrompt,
  }))
);
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import type { IPowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { useOpenRoomSettings } from '../../navigation/useRoomSettingsState';
import { getCanonicalAliasOrRoomId, mxcUrlToHttp } from '../../matrix/matrix';
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

/** A Space header icon button with tooltip that navigates to `to`. */
export function SpaceHeaderIconLink({
  label,
  icon,
  to,
}: {
  label: string;
  icon: IconSrc;
  to: string;
}) {
  const navigate = useNavigate();
  return (
    <TooltipProvider
      position="Bottom"
      offset={4}
      tooltip={
        <Tooltip>
          <Text>{label}</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          className={LoneTouchTarget}
          aria-label={label}
          onClick={() => void navigate(to)}
        >
          <Icon size="400" src={icon} />
        </IconButton>
      )}
    </TooltipProvider>
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
  const navigate = useNavigate();
  const screenSize = useScreenSizeContext();
  const { t } = useTranslation();
  const allThreadsPath = getSpaceThreadsPath(getCanonicalAliasOrRoomId(client, space.roomId));
  const allThreadsLabel = t('sharedUi.space.allThreads');
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
    ...(screenSize === ScreenSize.Mobile
      ? [
          {
            label: allThreadsLabel,
            icon: Icons.Thread,
            disabled: false,
            run: () => void navigate(allThreadsPath),
          },
        ]
      : []),
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
        {screenSize !== ScreenSize.Mobile && (
          <SpaceHeaderIconLink label={allThreadsLabel} icon={Icons.Thread} to={allThreadsPath} />
        )}
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
      {inviteOpen && (
        <Suspense fallback={null}>
          <InviteUserPrompt room={space} requestClose={() => setInviteOpen(false)} />
        </Suspense>
      )}
      {leaving && (
        <LeaveRoomPrompt
          roomId={space.roomId}
          requestClose={() => setLeaving(false)}
          onLeft={() => {
            setLeaving(false);
            void navigate(getHomePath());
          }}
        />
      )}
    </PageHeader>
  );
}
