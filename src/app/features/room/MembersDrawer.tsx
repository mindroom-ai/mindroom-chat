import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Box, Chip, Icon, IconButton, Icons, Input, Scroll, Text, config } from 'folds';
import { Header } from '../../components/glass/GlassPrimitives';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Room, RoomMember } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import {
  MembershipFilter,
  type MembershipFilterItem,
  useMembershipFilterMenu,
} from '../../hooks/useMemberFilter';
import { useOpenUserRoomProfile } from '../../state/hooks/userRoomProfile';
import { MembershipFilterMenu } from '../../components/MembershipFilterMenu';
import { InviteUserPrompt } from '../../components/invite-user-prompt';
import { UserAvatar } from '../../components/user-avatar';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { getMxIdLocalPart } from '../../utils/matrix';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import { getMemberDisplayName } from '../../utils/room';
import { JoinRequestItem } from './JoinRequestItem';
import * as css from './MembersDrawer.css';

const MEMBER_ROW_HEIGHT = 44;
const REQUEST_ROW_HEIGHT = 140;

/** A room member; only the membership and user ID are required to place it. */
export type MembersDrawerMember = Pick<RoomMember, 'userId' | 'membership'> & Partial<RoomMember>;

type MembersDrawerProps = {
  room: Room;
  members: MembersDrawerMember[];
};

type FilterSelection = number | 'auto';

const memberName = (room: Room, member: RoomMember): string =>
  getMemberDisplayName(room, member.userId) ?? getMxIdLocalPart(member.userId) ?? member.userId;

function MemberRow({ room, member }: { room: Room; member: RoomMember }) {



  const name = memberName(room, member);
  const avatarMxc = member.getMxcAvatarUrl?.();













        background: 'none',
        border: 0,
        cursor: 'pointer',
      }}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
        openProfile(
          room.roomId,
          undefined,
          member.userId,

















































































































        <Box grow="Yes" alignItems="Center" gap="200">
          <Text className={css.MembersHeaderCount} size="H5" truncate>
            {t('featureUi.room.membersDrawer.memberCount', { count: joinedCount })}
          </Text>
          {invitedCount > 0 && (
            <Chip
              className={css.MembersHeaderInvited}
              variant="Secondary"
              radii="Pill"
              onClick={() => setSelection(invitedIndex)}
            >
              <Text size="T200">
                {t('featureUi.room.membersDrawer.invitedCount', { count: invitedCount })}
              </Text>
            </Chip>
          )}
        </Box>
        <IconButton
          variant="Background"
          aria-label={t('featureUi.room.membersDrawer.invite')}
          disabled={!canInvite}
          onClick={() => setInviteOpen(true)}
        >
          <Icon src={Icons.UserPlus} />
        </IconButton>
      </Header>
      {inviteOpen && <InviteUserPrompt room={room} requestClose={() => setInviteOpen(false)} />}
      <Box className={css.MemberDrawerContentBase} grow="Yes" direction="Column">
        <Box direction="Column" gap="200" style={{ padding: config.space.S200 }}>
          <Box alignItems="Center" justifyContent="SpaceBetween" gap="200">
            <Box alignItems="Center" gap="100">
              <Icon size="50" src={Icons.Filter} />
              <Text size="T200">{selectedFilter?.name}</Text>
            </Box>
            <MembershipFilterMenu
              items={filters}
              selected={selectedIndex}
              onSelect={(index: number) => setSelection(index)}
            />
          </Box>
          <Input
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            placeholder={t('featureUi.room.membersDrawer.searchPlaceholder')}
            aria-label={t('featureUi.room.membersDrawer.searchPlaceholder')}
            variant="Background"
            size="400"
            radii="400"
            before={<Icon size="50" src={Icons.Search} />}
          />
        </Box>
        <Scroll ref={scrollRef} variant="Background" size="300" visibility="Hover" hideTrack>
          <div style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const member = visibleMembers[item.index];





                  data-index={item.index}
                  className={css.DrawerVirtualItem}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {showingRequests ? (
                    <JoinRequestItem
                      room={room}
                      member={member}
                      canApprove={canInvite}
                      canDecline={canKick}
                    />
                  ) : (
                    <MemberRow room={room} member={member} />
                  )}
                </div>
              );
            })}
          </div>
          {visibleMembers.length === 0 && (
            <Box className={css.MembersGroupLabel} justifyContent="Center">
              <Text size="T200" priority="300">
                {t('featureUi.room.membersDrawer.empty')}
              </Text>
            </Box>
          )}
        </Scroll>
      </Box>
    </Box>
  );
}
