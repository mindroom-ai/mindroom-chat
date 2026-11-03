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
  const avatarSrc = avatarMxc
    ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 64, 64, 'crop') ?? undefined
    : undefined;

  return (
    <button
      type="button"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: config.space.S200,
        width: '100%',
        height: MEMBER_ROW_HEIGHT,



        textAlign: 'start',
        background: 'none',
        border: 0,
        cursor: 'pointer',
      }}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
        openProfile(
          room.roomId,
          undefined,
          member.userId,










          src={avatarSrc}
          renderFallback={() => <Icon filled size="50" src={Icons.User} />}
        />
      </Avatar>
      <Text as="span" size="T400" truncate>
        {name}
      </Text>
    </button>
  );
}

const byName =
  (room: Room) =>
  (a: RoomMember, b: RoomMember): number =>
    memberName(room, a).localeCompare(memberName(room, b));

const matchesQuery = (room: Room, member: RoomMember, query: string): boolean =>
  memberName(room, member).toLowerCase().includes(query) ||
  member.userId.toLowerCase().includes(query);

/**
 * The room's people, one membership filter at a time, with a name search and the
 * invite button. Moderators who may approve (invite) or decline (kick) also get a
 * Requests filter for `knock` memberships; it opens there while requests wait,
 * until the moderator picks a filter themselves.
 */
export function MembersDrawer({ room, members }: MembersDrawerProps) {
  const { t } = useTranslation();
  const myUserId = useMatrixClient().getSafeUserId();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevelsContext());
  const canInvite = permissions.action('invite', myUserId);
  const canKick = permissions.action('kick', myUserId);
  const reviewsRequests = canInvite || canKick;

  const [selection, setSelection] = useState<FilterSelection>('auto');
  const [query, setQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const roomMembers = members as RoomMember[];
  const requestCount = reviewsRequests
    ? roomMembers.filter(MembershipFilter.filterKnocked).length
    : 0;

  const membershipFilters = useMembershipFilterMenu();
  const requestsLabel = t('featureUi.room.membersDrawer.requestCount', { count: requestCount });
  const filters = useMemo<MembershipFilterItem[]>(() => {
    if (!reviewsRequests) return membershipFilters;
    return [
      ...membershipFilters,
      { name: requestsLabel, filterFn: MembershipFilter.filterKnocked },
    ];
  }, [membershipFilters, requestsLabel, reviewsRequests]);
  const requestsIndex = reviewsRequests ? membershipFilters.length : -1;
  const invitedIndex = filters.findIndex(
    (item) => item.filterFn === MembershipFilter.filterInvited
  );

  // Losing the right to review requests sends the list back to Joined for good,
  // even if requests become reviewable again later.
  useEffect(() => {
    if (!reviewsRequests) setSelection(0);
  }, [reviewsRequests]);

  let wantedIndex = selection === 'auto' ? 0 : selection;
  if (selection === 'auto' && requestCount > 0) wantedIndex = requestsIndex;
  const selectedIndex = wantedIndex >= 0 && wantedIndex < filters.length ? wantedIndex : 0;
  const selectedFilter = filters[selectedIndex] as MembershipFilterItem | undefined;
  const showingRequests = selectedIndex === requestsIndex;

  const joinedCount = room.getJoinedMemberCount();
  const invitedCount = room.getInvitedMemberCount();

  const visibleMembers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = roomMembers.filter(
      (member) =>
        (selectedFilter?.filterFn(member) ?? false) &&
        (needle === '' || matchesQuery(room, member, needle))
    );
    return matching.sort(byName(room));
  }, [query, room, roomMembers, selectedFilter]);

  const virtualizer = useVirtualizer({
    count: visibleMembers.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (showingRequests ? REQUEST_ROW_HEIGHT : MEMBER_ROW_HEIGHT),
    overscan: 8,
  });

  // A new filter or search starts the list from the top.
  useEffect(() => {
    virtualizer.scrollToOffset(0);
  }, [selectedIndex, query, virtualizer]);

  return (
    <Box
      className={`${css.MembersDrawer} ${ContainerColor({ variant: 'Background' })}`}
      direction="Column"
      shrink="No"
    >
      <Header className={css.MembersHeaderControl} size="600" variant="Background">
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
          aria-label={t('featureUi.room.membersDrawer.invitePeople')}
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
            placeholder={t('featureUi.room.membersDrawer.typeName')}
            aria-label={t('featureUi.room.membersDrawer.typeName')}
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
              if (member === undefined) return null;
              return (
                <div
                  key={`${selectedIndex}:${member.userId}`}
                  ref={virtualizer.measureElement}
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
                {t('featureUi.room.membersDrawer.noResults')}
              </Text>
            </Box>
          )}
        </Scroll>
      </Box>
    </Box>
  );
}
