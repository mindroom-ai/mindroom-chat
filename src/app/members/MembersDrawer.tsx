import React, {
  ChangeEvent,
  CSSProperties,
  MouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Avatar,
  Box,
  Chip,
  Icon,
  IconButton,
  Icons,
  Input,
  type RectCords,
  Text,
  config,
  toRem,
} from 'folds';
import { PopOut, ownDirectionLine } from '../ui/directional';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Room, RoomMember } from 'matrix-js-sdk';
import { Header } from '../ui/glass/GlassPrimitives';
import { ScrollHeaderProvider } from '../ui/glass/SurfaceContext';
import { InsetScrollbar } from '../ui/InsetScrollbar';
import { Viewport } from '../ui/InsetScrollbar.css';
import { PageNavScrollbar } from '../ui/page/style.css';
import { ScrollTopContainer } from '../ui/ScrollTopContainer';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { usePowerLevelsContext } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
import { useSpaceOptionally } from '../matrix/hooks/useSpace';
import {
  MembershipFilter,
  type MembershipFilterItem,
  useMembershipFilterMenu,
} from './useMemberFilter';
import { useMemberSort, useMemberSortMenu } from './useMemberSort';
import {
  type MemberPowerTag,
  useFlattenPowerTagMembers,
  useGetMemberPowerTag,
} from './useMemberPowerTag';
import { useMembersDrawer } from './useMembersDrawer';
import { useAgentRoles } from './useAgentRoles';
import { useOpenUserRoomProfile } from '../navigation/useUserRoomProfileState';
import { MembershipFilterMenu } from './MembershipFilterMenu';
import { MemberSortMenu } from './MemberSortMenu';
import { InviteUserPrompt } from './invite/InviteUserPrompt';
import { UserAvatar } from '../avatars/UserAvatar';
import { ContainerColor } from '../ui/styles/ContainerColor.css';
import { useFloatingCards } from '../ui/page/floatingCards';
import { nameInitials } from '../lib/common';
import { getMxIdLocalPart } from '../matrix/matrix';
import { mxcUrlToHttp } from '../matrix/mediaUrl';
import { getMemberDisplayName } from '../matrix/room';
import { JoinRequestItem } from './JoinRequestItem';
import { MembersInviteSection } from './MembersInviteSection';
import * as css from './MembersDrawer.css';

// Row heights of the list (see MembersDrawer.css.ts); the virtualizer measures the real ones.
const GROUP_TITLE_HEIGHT = 32;
const GROUP_GAP = 12;
const MEMBER_ROW_HEIGHT = 40;
const REQUEST_ROW_HEIGHT = 140;

// The body runs from S200 at the start edge to S200 plus the inset scrollbar's track at the end.
const BODY_STYLE: CSSProperties = {
  paddingInline: `${config.space.S200} calc(${config.space.S200} + ${toRem(12)})`,
  paddingBottom: config.space.S700,
};
// The filter and sort row sits S200 under the header and S200 above the search field.
const TOOLBAR_STYLE: CSSProperties = { paddingBlock: config.space.S200 };
// The search field: 40 px high with 12 px corners, white on the panel's grey.
const SEARCH_STYLE: CSSProperties = { blockSize: toRem(40), borderRadius: config.radii.R500 };
// Toolbar buttons are flat: the panel shows through them until they are hovered. Their labels
// stay on one line, also at a large page zoom.
const TOOLBAR_BUTTON_STYLE: CSSProperties = {
  blockSize: toRem(24),
  paddingInline: config.space.S200,
  gap: config.space.S100,
  whiteSpace: 'nowrap',
};

/** A room member; only the membership and user ID are required to place it. */
type MembersDrawerMember = Pick<RoomMember, 'userId' | 'membership'> & Partial<RoomMember>;

type MembersDrawerProps = {
  room: Room;
  members: MembersDrawerMember[];
};

type FilterSelection = number | 'auto';

/** One row of the list: a power level group's title or a member. */
export type ListEntry =
  | { kind: 'group'; tag: MemberPowerTag; spaced: boolean }
  | { kind: 'member'; member: RoomMember };

export const memberName = (room: Room, member: RoomMember): string =>
  getMemberDisplayName(room, member.userId) ?? getMxIdLocalPart(member.userId) ?? member.userId;

/**
 * Whether a lowercase search matches the member's name or user name. The server part of the user
 * ID only counts once the search includes a `:`, since every local member shares it.
 */
export const matchesQuery = (room: Room, member: RoomMember, query: string): boolean => {
  const userId = member.userId.toLowerCase();
  const searched = query.includes(':') ? userId : getMxIdLocalPart(userId) ?? userId;
  return (
    memberName(room, member).toLowerCase().includes(query) ||
    searched.includes(query.replace(/^@/, ''))
  );
};

const isMember = (item: MemberPowerTag | RoomMember): item is RoomMember => 'userId' in item;

export const toListEntries = (items: Array<MemberPowerTag | RoomMember>): ListEntry[] => {
  let groups = 0;
  return items.map((item) => {
    if (isMember(item)) return { kind: 'member', member: item };
    groups += 1;
    return { kind: 'group', tag: item, spaced: groups > 1 };
  });
};

export const entryKey = (entry: ListEntry): string =>
  entry.kind === 'member' ? entry.member.userId : `group:${entry.tag.level}`;

/** Where a pop-out menu opens: under the button that was clicked, until `close`. */
const useMenuAnchor = () => {
  const [anchor, setAnchor] = useState<RectCords>();
  return {
    anchor,
    open: (event: MouseEvent<HTMLElement>) =>
      setAnchor(event.currentTarget.getBoundingClientRect()),
    close: () => setAnchor(undefined),
  };
};

export function MemberGroupTitle({ tag, spaced }: { tag: MemberPowerTag; spaced: boolean }) {
  return (
    <Text
      as="h3"
      size="T200"
      truncate
      className={classNames(css.MemberGroupTitle, spaced && css.MemberGroupTitleSpaced)}
    >
      {tag.name}
    </Text>
  );
}

/** A member's row: avatar and name, and under an agent's name its role, cut to one line. */
export function MemberRow({
  room,
  member,
  role,
}: {
  room: Room;
  member: RoomMember;
  role?: string;
}) {
  const client = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  const openProfile = useOpenUserRoomProfile();
  const spaceId = useSpaceOptionally()?.roomId;
  const name = memberName(room, member);
  const avatarMxc = member.getMxcAvatarUrl?.();
  const avatarSrc = avatarMxc
    ? mxcUrlToHttp(client, avatarMxc, authenticatedMedia, 48, 48, 'crop') ?? undefined
    : undefined;

  // The drawer sits at the inline end, so the card opens towards the timeline.
  const showProfile = (event: MouseEvent<HTMLButtonElement>) => {
    const anchorRect = event.currentTarget.getBoundingClientRect();
    openProfile(room.roomId, spaceId, member.userId, anchorRect, 'Left');
  };

  return (
    <button
      type="button"
      className={css.MemberRow}
      data-user-id={member.userId}
      onClick={showProfile}
    >
      {/* The name follows; the avatar only decorates the row. */}
      <Avatar className={css.MemberAvatar} size="200" radii="Pill" aria-hidden>
        <UserAvatar
          alt=""
          userId={member.userId}
          src={avatarSrc}
          renderFallback={() => (
            <Text as="span" size="L400">
              {nameInitials(name)}
            </Text>
          )}
        />
      </Avatar>
      <span className={css.MemberText}>
        <Text as="span" size="T400" truncate {...ownDirectionLine}>
          {name}
        </Text>
        {role && (
          <Text as="span" size="T200" priority="300" truncate {...ownDirectionLine}>
            {role}
          </Text>
        )}
      </span>
    </button>
  );
}

/**
 * The room's people under their power level groups (Founder, Admin, Member, ...), one
 * membership filter at a time, in the chosen order, with a name search and the invite button.
 * For someone who may invite, the search also lists the people outside the room it matches,
 * each with an Invite button.
 * Moderators who may approve (invite) or decline (kick) also get a Requests filter for `knock`
 * memberships; it opens there while requests wait, until the moderator picks a filter themselves.
 */
export function MembersDrawer({ room, members }: MembersDrawerProps) {
  const { t } = useTranslation();
  // As a floating card the panel takes the conversation card's surface.
  const variant = useFloatingCards() ? 'Surface' : 'Background';
  const myUserId = useMatrixClient().getSafeUserId();
  const [, setDrawerOpen] = useMembersDrawer();
  const agentRoles = useAgentRoles(room);
  const levels = usePowerLevelsContext();
  const roomCreators = useRoomCreators(room);
  const may = useRoomPermissions(roomCreators, levels);
  const canInvite = may.action('invite', myUserId);
  const canKick = may.action('kick', myUserId);
  const reviewsRequests = canInvite || canKick;

  const [selection, setSelection] = useState<FilterSelection>('auto');
  const [sortIndex, setSortIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const filterMenu = useMenuAnchor();
  const sortMenu = useMenuAnchor();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [listOffset, setListOffset] = useState(0);

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

  const sorts = useMemberSortMenu();
  const sort = useMemberSort(sortIndex, sorts);

  const joinedCount = room.getJoinedMemberCount();
  const invitedCount = room.getInvitedMemberCount();

  const visibleMembers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = roomMembers.filter(
      (member) =>
        (selectedFilter?.filterFn(member) ?? false) &&
        (needle === '' || matchesQuery(room, member, needle))
    );
    return sort ? matching.sort(sort.sortFn) : matching;
  }, [query, room, roomMembers, selectedFilter, sort]);

  const getPowerTag = useGetMemberPowerTag(room, roomCreators, levels);
  const grouped = useFlattenPowerTagMembers(visibleMembers, getPowerTag);
  // Join requests are reviewed one by one, without power groups.
  const entries = useMemo<ListEntry[]>(
    () =>
      showingRequests
        ? visibleMembers.map((member) => ({ kind: 'member', member }))
        : toListEntries(grouped),
    [grouped, showingRequests, visibleMembers]
  );

  // The list starts below the header, the filter and sort row and the search field.
  useLayoutEffect(() => {
    setListOffset(listRef.current?.offsetTop ?? 0);
  }, []);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const entry = entries[index];
      if (entry?.kind === 'group') return GROUP_TITLE_HEIGHT + (entry.spaced ? GROUP_GAP : 0);
      return showingRequests ? REQUEST_ROW_HEIGHT : MEMBER_ROW_HEIGHT;
    },
    getItemKey: (index) => {
      const entry = entries[index];
      return entry ? `${selectedIndex}:${entryKey(entry)}` : index;
    },
    scrollMargin: listOffset,
    overscan: 8,
  });

  // A new filter or search starts the list from the top.
  useEffect(() => {
    virtualizer.scrollToOffset(0);
  }, [selectedIndex, query, virtualizer]);

  // People who may invite find others by the same search, under the members it matches; it is
  // mounted without a search too, so an invitation still going or failed stays in view.
  const showInvites = canInvite && !showingRequests;
  const searchLabel = showInvites
    ? t('featureUi.room.membersDrawer.searchOrInvite')
    : t('featureUi.room.membersDrawer.typeName');

  const emptyText = () => {
    if (query.trim() !== '') {
      // People outside the room may still match, in the section under this line.
      return showInvites
        ? t('featureUi.room.membersDrawer.noMatchingMembers')
        : t('featureUi.room.membersDrawer.noResults');
    }
    if (showingRequests) return t('featureUi.room.membersDrawer.noPendingJoinRequests');
    return t('featureUi.room.membersDrawer.noMembersForFilter', { filter: selectedFilter?.name });
  };

  return (
    <Box
      className={`${css.MembersDrawer} ${ContainerColor({ variant })}`}
      direction="Column"
      shrink="No"
    >
      {inviteOpen && <InviteUserPrompt room={room} requestClose={() => setInviteOpen(false)} />}
      <Box className={css.MemberDrawerContentBase} grow="Yes" direction="Column">
        <Box
          ref={scrollRef}
          className={Viewport}
          grow="Yes"
          direction="Column"
          style={{ minHeight: 0 }}
          data-y-scrollbar-width={0}
        >
          <ScrollHeaderProvider value>
            <Header className={css.MembersHeaderControl} size="600" variant={variant}>
              <Box grow="Yes" alignItems="Center" gap="100" style={{ minWidth: 0 }}>
                <Text
                  role="heading"
                  aria-level={2}
                  className={css.MembersHeaderCount}
                  size="H5"
                  truncate
                >
                  {t('featureUi.room.membersDrawer.memberCount', { count: joinedCount })}
                </Text>
                {invitedCount > 0 && (
                  <>
                    <Text as="span" size="T200" priority="300" aria-hidden>
                      ·
                    </Text>
                    <button
                      type="button"
                      className={css.MembersHeaderInvited}
                      onClick={() => setSelection(invitedIndex)}
                    >
                      <Text as="span" size="T200">
                        {t('featureUi.room.membersDrawer.invitedCount', { count: invitedCount })}
                      </Text>
                    </button>
                  </>
                )}
              </Box>
              <Box shrink="No" alignItems="Center" gap="300">
                <IconButton
                  size="300"
                  radii="300"
                  variant={variant}
                  fill="None"
                  aria-label={t('featureUi.room.membersDrawer.invitePeople')}
                  disabled={!canInvite}
                  onClick={() => setInviteOpen(true)}
                >
                  <Icon src={Icons.UserPlus} />
                </IconButton>
                <IconButton
                  size="300"
                  radii="300"
                  variant={variant}
                  fill="None"
                  aria-label={t('featureUi.room.membersDrawer.close')}
                  onClick={() => setDrawerOpen(false)}
                >
                  <Icon src={Icons.Cross} />
                </IconButton>
              </Box>
            </Header>
          </ScrollHeaderProvider>
          <Box ref={contentRef} direction="Column" shrink="No" style={BODY_STYLE}>
            <Box alignItems="Center" justifyContent="SpaceBetween" gap="200" style={TOOLBAR_STYLE}>
              <PopOut
                anchor={filterMenu.anchor}
                position="Bottom"
                align="Start"
                offset={4}
                content={
                  <MembershipFilterMenu
                    items={filters}
                    selected={selectedIndex}
                    onSelect={(index: number) => {
                      filterMenu.close();
                      setSelection(index);
                    }}
                    onDismiss={filterMenu.close}
                  />
                }
              >
                <Chip
                  variant={variant}
                  radii="300"
                  style={TOOLBAR_BUTTON_STYLE}
                  aria-haspopup="menu"
                  aria-expanded={!!filterMenu.anchor}
                  onClick={filterMenu.open}
                >
                  <Icon size="50" src={Icons.Filter} />
                  <Text size="T200">{selectedFilter?.name}</Text>
                </Chip>
              </PopOut>
              {sort && (
                <PopOut
                  anchor={sortMenu.anchor}
                  position="Bottom"
                  align="End"
                  offset={4}
                  content={
                    <MemberSortMenu
                      items={sorts}
                      selected={sortIndex}
                      onSelect={(index: number) => {
                        sortMenu.close();
                        setSortIndex(index);
                      }}
                      onDismiss={sortMenu.close}
                    />
                  }
                >
                  <Chip
                    variant={variant}
                    radii="300"
                    style={TOOLBAR_BUTTON_STYLE}
                    aria-haspopup="menu"
                    aria-expanded={!!sortMenu.anchor}
                    onClick={sortMenu.open}
                  >
                    <Text size="T200">{sort.name}</Text>
                    <Icon size="50" src={Icons.Sort} />
                  </Chip>
                </PopOut>
              )}
            </Box>
            <Input
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
              placeholder={searchLabel}
              aria-label={searchLabel}
              variant="Surface"
              size="400"
              radii="500"
              style={SEARCH_STYLE}
              before={<Icon size="50" src={Icons.Search} />}
            />
            <div
              ref={listRef}
              style={{
                position: 'relative',
                marginTop: config.space.S200,
                height: virtualizer.getTotalSize(),
              }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const entry = entries[item.index];
                if (entry === undefined) return null;
                let row: React.ReactNode;
                if (entry.kind === 'group') {
                  row = <MemberGroupTitle tag={entry.tag} spaced={entry.spaced} />;
                } else if (showingRequests) {
                  row = (
                    <JoinRequestItem
                      room={room}
                      member={entry.member}
                      canApprove={canInvite}
                      canDecline={canKick}
                    />
                  );
                } else {
                  row = (
                    <MemberRow
                      room={room}
                      member={entry.member}
                      role={agentRoles.get(entry.member.userId)}
                    />
                  );
                }
                return (
                  <div
                    key={item.key}
                    ref={virtualizer.measureElement}
                    data-index={item.index}
                    className={css.DrawerVirtualItem}
                    style={{ transform: `translateY(${item.start - listOffset}px)` }}
                  >
                    {row}
                  </div>
                );
              })}
            </div>
            {visibleMembers.length === 0 && (
              <Box className={css.MembersGroupLabel} justifyContent="Center">
                <Text size="T200" priority="300">
                  {emptyText()}
                </Text>
              </Box>
            )}
            {showInvites && <MembersInviteSection room={room} query={query} />}
          </Box>
          <InsetScrollbar
            scrollRef={scrollRef}
            contentRef={contentRef}
            label={t('sharedUi.pageScroll.scrollbar')}
            className={PageNavScrollbar}
          />
        </Box>
        <ScrollTopContainer scrollRef={scrollRef} style={{ top: toRem(62) }}>
          <IconButton
            size="300"
            radii="Pill"
            variant="Surface"
            outlined
            aria-label={t('featureUi.room.membersDrawer.scrollToTop')}
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <Icon size="200" src={Icons.ChevronTop} />
          </IconButton>
        </ScrollTopContainer>
      </Box>
    </Box>
  );
}
