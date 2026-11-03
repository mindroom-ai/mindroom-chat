import React, { useState } from 'react';
import { Avatar, Box, Icon, IconButton, Icons, PopOut, Text, config, toRem } from 'folds';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useFocusWithin, useHover } from 'react-aria';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { NavItem, NavItemContent, NavItemOptions, NavLink } from '../../components/nav';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { UnreadBadge } from '../../components/unread-badge';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomAvatar, useRoomName } from '../../hooks/useRoomMeta';
import { RoomNotificationMode } from '../../hooks/useRoomsNotificationPreferences';
import { useRoomUnread } from '../../state/hooks/unread';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { useOpenRoomSettings } from '../../state/hooks/roomSettings';
import { getCanonicalAliasOrRoomId, mxcUrlToHttp } from '../../utils/matrix';
import { getRoomAvatarUrl } from '../../utils/room';
import { copyToClipboard } from '../../utils/dom';
import { getMatrixToRoom } from '../../plugins/matrix-to';
import { useRoomBackgroundJobs } from '../../mindroom/background-jobs/useRoomBackgroundJobs';
import { IconTooltip } from '../../mindroom/tooltip/IconTooltip';
import { MindroomMarkRoomReadMenuItem } from '../../mindroom/notifications/MindroomMarkRoomReadMenuItem';

const AVATAR_SIZE = 96;






  /** A direct message: shows the other person's avatar with initials as fallback. */
  direct?: boolean;
  showAvatar?: boolean;
};

function RoomNavItemMenu({ room, requestClose }: { room: Room; requestClose: () => void }) {





    void copyToClipboard(getMatrixToRoom(getCanonicalAliasOrRoomId(mx, room.roomId)));
    requestClose();
  };

  const handleLeave = () => {
    void mx.leave(room.roomId);
    requestClose();
  };

  return (


        <MindroomMarkRoomReadMenuItem room={room} onClose={requestClose} />
        <MenuItem
          size="300"
          radii="300"




            {t('featureUi.roomNav.copyLink')}
          </Text>
        </MenuItem>
        <MenuItem
          size="300"
          radii="300"
          after={<Icon size="100" src={Icons.Setting} />}
          onClick={() => {
            openRoomSettings(room.roomId);
            requestClose();
          }}
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            {t('featureUi.roomNav.roomSettings')}
          </Text>
        </MenuItem>
        <MenuItem
          size="300"
          radii="300"
          variant="Critical"
          fill="None"




            {t('featureUi.roomNav.leaveRoom')}
          </Text>
        </MenuItem>
      </Box>
    </Menu>
  );
}

/**
 * One room in the sidebar: avatar or privacy icon, name, unread badge, a mark
 * while agents run background jobs in it, and a menu on hover or focus.
 */


















  const backgroundJobs = useRoomBackgroundJobs(room);
  const directAvatar = direct && showAvatar;
  const avatarMxc = useRoomAvatar(room, directAvatar);

  let avatarSrc: string | undefined;
  if (avatarMxc) {
    avatarSrc =
      mxcUrlToHttp(mx, avatarMxc, useAuthentication, AVATAR_SIZE, AVATAR_SIZE, 'crop') ?? undefined;
  } else if (directAvatar) {
    // A person without an avatar shows the room's own one before initials.
    avatarSrc = getRoomAvatarUrl(mx, room, AVATAR_SIZE, useAuthentication);
  }

  const muted = notificationMode === RoomNotificationMode.Mute;
  const hasJobs = backgroundJobs.length > 0;
  const unreadCount = unread?.total ?? 0;

  return (
    <NavItem
      variant="Background"
      radii="400"











                <RoomAvatar
                  roomId={room.roomId}
                  src={avatarSrc}
                  alt={name}
                  renderFallback={() => (
                    <Text as="span" size="H6">
                      {(name.trim()[0] ?? '#').toUpperCase()}
                    </Text>
                  )}
                />
              ) : (
                <RoomAvatar
                  roomId={room.roomId}
                  src={avatarSrc}
                  alt={name}
                  renderFallback={() => (
                    <RoomIcon size="100" joinRule={room.getJoinRule()} filled={selected} />







              </Text>
            </Box>
            {hasJobs && (
              <IconTooltip label={t('featureUi.roomNav.backgroundJobs')}>
                {(triggerRef) => (
                  <Icon
                    ref={triggerRef}
                    size="50"
                    src={Icons.Clock}
                    aria-label={t('featureUi.roomNav.backgroundJobs')}
                    style={{ opacity: config.opacity.P500 }}
                  />
                )}
              </IconTooltip>
            )}
            {!hover && !menuAnchor && unread && (
              <UnreadBadge highlight={unread.highlight > 0} count={unreadCount} dm={direct} />
            )}
            {!hover && !menuAnchor && muted && !unread && (
              <Icon
                size="50"
                src={Icons.Message}
                aria-label={t('featureUi.roomNav.muted')}
                style={{ opacity: config.opacity.P300 }}
              />
            )}
          </Box>
        </NavItemContent>
      </NavLink>






















                setMenuAnchor(event.currentTarget.getBoundingClientRect())
              }
              aria-pressed={!!menuAnchor}














