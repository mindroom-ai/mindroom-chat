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




































































































































                    size="50"
                    src={Icons.Clock}
                    aria-label={t('mindroomUi.backgroundJobs.inRoom')}
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
                aria-label={t('sharedUi.powerLevels.muted')}
                style={{ opacity: config.opacity.P300 }}
              />
            )}
          </Box>
        </NavItemContent>
      </NavLink>






















                setMenuAnchor(event.currentTarget.getBoundingClientRect())
              }
              aria-pressed={!!menuAnchor}
              aria-label={t('featureUi.roomNav.roomNavItem.moreOptions')}
              variant="Background"
              fill="None"
              size="300"
              radii="300"
            >
              <Icon size="50" src={Icons.VerticalDots} />
            </IconButton>
          </PopOut>
        </NavItemOptions>
      )}
    </NavItem>
  );
}
