import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Icon, IconButton, Icons, Text, config, toRem } from 'folds';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { Page, PageHeroSection, PageScroll } from '../../ui/page';
import { ScrollTopContainer } from '../../ui/scroll-top-container';
import { LocalRoomSummaryLoader, RoomSummaryLoader } from '../../rooms/RoomSummaryLoader';
import { AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import type { LocalRoomSummary } from '../../rooms/useLocalRoomSummary';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomName, useRoomTopic } from '../../matrix/hooks/useRoomMeta';
import { PowerLevelsContextProvider, usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { useSpace } from '../../matrix/hooks/useSpace';
import { type HierarchyItem, useSpaceHierarchy } from '../useSpaceHierarchy';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { getSpacePath, getSpaceRoomPath } from '../../routes/pathUtils';
import { MembersDrawer } from '../../members/MembersDrawer';
import { ResizableMembersPanel } from '../../members/ResizableMembersPanel';
import { usePanelSlot } from '../../ui/panels/panelPresence';
import { useMembersDrawer } from '../../members/useMembersDrawer';
import { LobbyHeader, SpaceAvatar, useSpaceAvatarSrc } from './LobbyHeader';
import { RoomItemCard } from './RoomItem';
import { AddToSpaceChips, SpaceItemCard } from './SpaceItem';
import { HierarchyItemMenu } from './HierarchyItemMenu';
import { canSendState } from './spaceChildren';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { StateEvent } from '../../matrix/types/room';

type CardSummary = (Omit<IHierarchyRoom, 'join_rule'> & { join_rule?: string }) | undefined;

const toCardSummary = (summary: LocalRoomSummary): CardSummary => ({
  room_id: summary.roomId,
  name: summary.name,
  topic: summary.topic,
  avatar_url: summary.avatarUrl,
  canonical_alias: summary.canonicalAlias,
  world_readable: summary.worldReadable,
  guest_can_join: summary.guestCanJoin,
  num_joined_members: summary.memberCount,
  room_type: summary.roomType,
  join_rule: summary.joinRule,
  children_state: [],
});

const noop = () => undefined;

// The lobby's column: S400 around it, at most 720 px wide, centered.
const LOBBY_COLUMN = { padding: config.space.S400, maxWidth: toRem(720), margin: '0 auto' };
// Under the 54 px header, with a gap.
const SCROLL_TOP_PLACE = { top: `calc(${toRem(54)} + ${config.space.S300})` };

/**
 * Whether `target` has scrolled out from under the sticky title of `scrollRef` (its bottom edge
 * above the title's bottom edge), following scrolling and resizing.
 */
const useScrolledPast = (
  scrollRef: RefObject<HTMLDivElement>,
  targetRef: RefObject<HTMLElement>
): boolean => {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const viewport = scrollRef.current;
    const target = targetRef.current;
    if (!viewport || !target) return undefined;
    const check = () => {
      const title = viewport.querySelector('header');
      const titleBottom = title
        ? title.getBoundingClientRect().bottom
        : viewport.getBoundingClientRect().top;
      setPast(target.getBoundingClientRect().bottom < titleBottom);
    };
    check();
    viewport.addEventListener('scroll', check, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(check);
    observer?.observe(viewport);
    observer?.observe(target);
    return () => {
      viewport.removeEventListener('scroll', check);
      observer?.disconnect();
    };
  }, [scrollRef, targetRef]);
  return past;
};

/**
 * The space's picture, name and topic at the top of its lobby. The name is the lobby's section
 * heading (h2); the topic under it is not part of the heading.
 */
function LobbyHero({ heroRef }: { heroRef: RefObject<HTMLDivElement> }) {
  const lobbySpace = useSpace();
  const spaceTopic = useRoomTopic(lobbySpace);
  const name = useRoomName(lobbySpace);
  const pictureSrc = useSpaceAvatarSrc(lobbySpace);
  return (
    <PageHeroSection ref={heroRef} style={{ paddingBlock: config.space.S500 }}>
      <Box direction="Column" alignItems="Center" gap="200">
        <Box style={{ marginBottom: config.space.S200 }}>
          <SpaceAvatar roomId={lobbySpace.roomId} name={name} src={pictureSrc} large />
        </Box>
        <Text as="h2" size="H2" align="Center" style={{ margin: 0 }}>
          {name}
        </Text>
        {spaceTopic && (
          <Text priority="400" align="Center">
            {spaceTopic}
          </Text>
        )}
      </Box>
    </PageHeroSection>
  );
}

/** Entries whose space (or a space above it) is collapsed; their headings stay visible. */
const getHiddenEntries = (
  items: HierarchyItem[],
  closed: ReadonlySet<string>
): Set<HierarchyItem> => {
  const hidden = new Set<HierarchyItem>();
  const hiddenSpaces = new Set<string>();
  items.forEach((item) => {
    const parentId = item.parentId ?? '';
    if (!closed.has(parentId) && !hiddenSpaces.has(parentId)) return;
    hidden.add(item);
    if (item.space) hiddenSpaces.add(item.roomId);
  });
  return hidden;
};

/** Nested entries step in from the lobby's edge, one step per level below the first. */
const nestingInset = (depth = 1) =>
  depth > 1 ? { marginInlineStart: `calc(${config.space.S400} * ${depth - 1})` } : undefined;

/** The top space's own heading: its rooms' title and, for those allowed, ways to add more. */
function LobbyRootHeading({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const space = useSpace();
  return (
    <Box alignItems="Center" gap="200" style={{ paddingBlock: config.space.S200 }}>
      <Box grow="Yes">
        <Text size="H4">{t('featureUi.lobby.spaceItem.rooms')}</Text>
      </Box>
      {canEdit && <AddToSpaceChips spaceId={space.roomId} />}
    </Box>
  );
}

function EmptyLobby() {
  const { t } = useTranslation();
  return (
    <Box direction="Column" alignItems="Center" gap="100" style={{ padding: config.space.S700 }}>
      <Text size="H5">{t('featureUi.lobby.spaceHierarchy.noRooms')}</Text>
      <Text size="T300" priority="300" align="Center">
        {t('featureUi.lobby.spaceHierarchy.thisSpaceDoesNotContainsRoomsYet')}
      </Text>
    </Box>
  );
}

/** A space's lobby: its header, the rooms and subspaces it lists, and the space's members. */
export function Lobby() {
  const space = useSpace();
  const client = useMatrixClient();
  const screenSize = useScreenSizeContext();
  const navigate = useNavigate();
  const powerLevels = usePowerLevels(space);
  const members = useRoomMembers(client, space.roomId);
  const [membersOpen, setMembersOpen] = useMembersDrawer();
  const [closedCategories, setClosedCategories] = useState<Set<string>>(() => new Set());
  // Joins and leaves change which cards open a room and which offer a way in.
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const { items, summaries, loading } = useSpaceHierarchy(space);
  const getRoom = useCallback(
    (roomId: string) => client.getRoom(roomId) ?? undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, joinedRoomIds]
  );
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const heroPassed = useScrolledPast(scrollRef, heroRef);
  const canEditRoot = useRoomPermissions(useRoomCreators(space), powerLevels).stateEvent(
    StateEvent.SpaceChild,
    client.getSafeUserId()
  );
  const hidden = useMemo(
    () => getHiddenEntries(items, closedCategories),
    [items, closedCategories]
  );

  const toggleCategory = (categoryId: string) =>
    setClosedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });

  const openRoom = (roomId: string) => navigate(getSpaceRoomPath(space.roomId, roomId));

  /** The joined copy of a lobby entry, if the user is in it. */
  const joinedCopy = (roomId: string): Room | undefined => {
    const room = getRoom(roomId);
    return room?.getMyMembership() === 'join' ? room : undefined;
  };

  const optionsFor = (item: HierarchyItem) => (
    <HierarchyItemMenu
      item={item}
      parent={item.parentId ? joinedCopy(item.parentId) : undefined}
      joinedRoom={joinedCopy(item.roomId)}
    />
  );

  const renderRoom = (item: HierarchyItem) => {
    const local = getRoom(item.roomId);
    const card = (summary: CardSummary, cardLoading: boolean, error: Error | null) => (
      <RoomItemCard
        key={item.roomId}
        item={item}
        loading={cardLoading}
        error={error}
        summary={summary}
        onOpen={openRoom}
        onDragging={noop}
        canReorder={false}
        getRoom={getRoom}
        options={optionsFor(item)}
      />
    );
    if (local) {
      return (
        <LocalRoomSummaryLoader key={item.roomId} room={local}>
          {(summary) => card(toCardSummary(summary), false, null)}
        </LocalRoomSummaryLoader>
      );
    }
    const known = summaries.get(item.roomId);
    if (known) return card(known, false, null);
    if (loading) return card(undefined, true, null);
    return (
      <RoomSummaryLoader
        key={item.roomId}
        roomIdOrAlias={item.roomId}
        viaServers={item.content.via}
      >
        {(state) =>
          card(
            state.status === AsyncStatus.Success
              ? (state.data as unknown as CardSummary)
              : undefined,
            state.status === AsyncStatus.Loading || state.status === AsyncStatus.Idle,
            state.status === AsyncStatus.Error ? (state.error as Error) : null
          )
        }
      </RoomSummaryLoader>
    );
  };

  const renderSpace = (item: HierarchyItem) => {
    const joinedSpace = joinedCopy(item.roomId);
    return (
      <SpaceItemCard
        key={`${item.parentId}/${item.roomId}`}
        item={item}
        summary={summaries.get(item.roomId)}
        loading={!joinedSpace && loading}
        joined={!!joinedSpace}
        categoryId={item.roomId}
        closed={closedCategories.has(item.roomId)}
        handleClose={toggleCategory}
        canEditChild={!!joinedSpace && canSendState(client, joinedSpace, StateEvent.SpaceChild)}
        canReorder={false}
        onDragging={noop}
        getRoom={getRoom}
        options={optionsFor(item)}
      />
    );
  };

  const membersPanel = usePanelSlot(
    membersOpen ? (
      <ResizableMembersPanel key="members" onClose={() => setMembersOpen(false)}>
        <MembersDrawer key={space.roomId} room={space} members={members} />
      </ResizableMembersPanel>
    ) : undefined
  );
  const lobbyHeader = (
    <LobbyHeader
      powerLevels={powerLevels}
      showProfile={heroPassed}
      onBack={
        screenSize === ScreenSize.Mobile ? () => navigate(getSpacePath(space.roomId)) : undefined
      }
    />
  );

  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <Box grow="Yes" style={{ minWidth: 0, minHeight: 0 }}>
        <Page style={{ position: 'relative' }}>
          <PageScroll scrollRef={scrollRef} header={lobbyHeader}>
            <Box direction="Column" gap="200" style={LOBBY_COLUMN}>
              <LobbyHero heroRef={heroRef} />
              <LobbyRootHeading canEdit={canEditRoot} />
              {items.length === 0 && !loading && <EmptyLobby />}
              {items.map((item) => {
                if (hidden.has(item)) return null;
                return (
                  <Box
                    key={`${item.parentId}/${item.roomId}`}
                    direction="Column"
                    style={nestingInset(item.depth)}
                    data-lobby-entry={item.roomId}
                  >
                    {item.space ? renderSpace(item) : renderRoom(item)}
                  </Box>
                );
              })}
            </Box>
          </PageScroll>
          <ScrollTopContainer scrollRef={scrollRef} style={SCROLL_TOP_PLACE}>
            <IconButton
              size="300"
              radii="Pill"
              variant="Surface"
              outlined
              aria-label={t('featureUi.lobby.scrollToTop')}
              onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            >
              <Icon size="200" src={Icons.ChevronTop} />
            </IconButton>
          </ScrollTopContainer>
        </Page>
        {membersPanel}
      </Box>
    </PowerLevelsContextProvider>
  );
}
