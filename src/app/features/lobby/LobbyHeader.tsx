import React, { useState } from 'react';
import {
  Avatar,
  Badge,
  Box,
  Icon,
  IconButton,
  Icons,
  PopOut,
  Text,
  Tooltip,
  TooltipProvider,
  config,
  toRem,
} from 'folds';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/page';
import { RoomAvatar } from '../../components/room-avatar';
import { InviteUserPrompt } from '../../components/invite-user-prompt';
import { useMembersDrawer } from '../../mindroom/sidebar/useMembersDrawer';
import { useRoomAvatar, useRoomName } from '../../hooks/useRoomMeta';
import { useSpace } from '../../hooks/useSpace';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import type { IPowerLevels } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useOpenSpaceSettings } from '../../state/hooks/spaceSettings';
import { mxcUrlToHttp } from '../../utils/matrix';
import { nameInitials } from '../../utils/common';
import { stopPropagation } from '../../utils/keyboard';

type LobbyHeaderProps = {
  powerLevels: IPowerLevels;
  /** Pending join requests (knocks) in the space. */
  joinRequestCount?: number;
  /** Back to the sidebar on mobile. */
  onBack?: () => void;
};

/** The header of a space's lobby: back on mobile, the space, members with join requests, options. */
export function LobbyHeader({ powerLevels, joinRequestCount = 0, onBack }: LobbyHeaderProps) {
















  const canReview = canInvite || permissions.action('kick', myUserId);
  const pendingRequests = canReview ? joinRequestCount : 0;

  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [inviteOpen, setInviteOpen] = useState(false);

  const membersLabel =
    pendingRequests > 0
      ? t('featureUi.lobby.header.membersWithRequests', { count: pendingRequests })
      : t('featureUi.lobby.header.members');

  return (
    <PageHeader balance={screenSize === ScreenSize.Mobile}>
      <Box grow="Yes" alignItems="Center" gap="200">
        {screenSize === ScreenSize.Mobile && onBack && (













          <Text size="H4" truncate>
            {name}
          </Text>
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
                  style={{ position: 'absolute', top: 0, right: 0, minWidth: toRem(16) }}
                >
                  <Text size="L400">{pendingRequests}</Text>
                </Badge>
              )}
            </IconButton>


























                      setInviteOpen(true);
                    }}
                  >
                    <Text size="T300">{t('featureUi.lobby.header.invite')}</Text>
                  </MenuItem>
                  <MenuItem
                    size="300"
                    radii="300"




                    }}
                  >
                    <Text size="T300">{t('featureUi.lobby.header.settings')}</Text>
                  </MenuItem>
                </Box>
              </Menu>
            </FocusTrap>
          }
        >
          <IconButton
            onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
              setMenuAnchor(event.currentTarget.getBoundingClientRect())
            }
            aria-label={t('featureUi.lobby.header.options')}
            aria-pressed={!!menuAnchor}
          >
            <Icon size="400" src={Icons.VerticalDots} />
          </IconButton>
        </PopOut>
      </Box>
      {inviteOpen && <InviteUserPrompt room={space} requestClose={() => setInviteOpen(false)} />}
    </PageHeader>
  );
}
