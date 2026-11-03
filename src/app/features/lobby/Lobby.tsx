import React, { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Icon, IconButton, Icons, config, toRem } from 'folds';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { Page, PageHero, PageHeroSection, PageScroll } from '../../components/page';
import { ScrollTopContainer } from '../../components/scroll-top-container';
import { LocalRoomSummaryLoader, RoomSummaryLoader } from '../../components/RoomSummaryLoader';
import { AsyncStatus } from '../../hooks/useAsyncCallback';
import type { LocalRoomSummary } from '../../hooks/useLocalRoomSummary';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomName, useRoomTopic } from '../../hooks/useRoomMeta';
import { PowerLevelsContextProvider, usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { useSpace } from '../../hooks/useSpace';
import type { HierarchyItem } from '../../hooks/useSpaceHierarchy';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { getSpacePath, getSpaceRoomPath } from '../../pages/pathUtils';
import { MembersDrawer } from '../room/MembersDrawer';
import { ResizableMembersPanel } from '../../mindroom/sidebar/ResizableMembersPanel';
import { useMembersDrawer } from '../../mindroom/sidebar/useMembersDrawer';
import { LobbyHeader, SpaceAvatar, useSpaceAvatarSrc } from './LobbyHeader';
import { RoomItemCard } from './RoomItem';
import { SpaceItemCard } from './SpaceItem';

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

/** The `m.space.child` entries of a space, ordered by `order`, then by when they were added. */
const getChildItems = (space: Room, depth: number, parentId: string): HierarchyItem[] =>
  space.currentState
    .getStateEvents('m.space.child')
    .flatMap((event): HierarchyItem[] => {
      const roomId = event.getStateKey();
      const content = event.getContent() as HierarchyItem['content'];
      if (!roomId || !Array.isArray(content.via) || content.via.length === 0) return [];
      const base = { roomId, content, ts: event.getTs(), depth };
      const child = space.client.getRoom(roomId);
      const isSpaceChild = child?.isSpaceRoom() ?? false;
      return [isSpaceChild ? { ...base, space: true, parentId } : { ...base, parentId }];
    })
    .sort((a, b) => {
      const orderA = typeof a.content.order === 'string' ? a.content.order : undefined;
      const orderB = typeof b.content.order === 'string' ? b.content.order : undefined;
      if (orderA !== undefined && orderB !== undefined && orderA !== orderB) {
        return orderA < orderB ? -1 : 1;
      }
      if (orderA !== undefined && orderB === undefined) return -1;
      if (orderA === undefined && orderB !== undefined) return 1;
      return a.ts - b.ts;
    });

/** The space's rooms and subspaces, one level of each joined subspace below it. */
const getLobbyItems = (client: MatrixClient, space: Room): HierarchyItem[] =>
  getChildItems(space, 1, space.roomId).flatMap((item) => {
    if (!item.space) return [item];
    const subspace = client.getRoom(item.roomId);
    return subspace ? [item, ...getChildItems(subspace, 2, item.roomId)] : [item];
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

/** The space's picture, name and topic at the top of its lobby. */
function LobbyHero({ heroRef }: { heroRef: RefObject<HTMLDivElement> }) {
  const space = useSpace();
  const name = useRoomName(space);
  const picture = (
    <SpaceAvatar roomId={space.roomId} name={name} src={useSpaceAvatarSrc(space)} large />
  );
  return (
    <PageHeroSection ref={heroRef} style={{ paddingBlock: config.space.S500 }}>
      <PageHero icon={picture} title={name} subTitle={useRoomTopic(space)} />
    </PageHeroSection>
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
  const items = useMemo(() => getLobbyItems(client, space), [client, space]);
  const getRoom = useCallback((roomId: string) => client.getRoom(roomId) ?? undefined, [client]);
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const heroPassed = useScrolledPast(scrollRef, heroRef);

  const toggleCategory = (categoryId: string) =>
    setClosedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });

  const openRoom = (roomId: string) => navigate(getSpaceRoomPath(space.roomId, roomId));

  const renderRoom = (item: HierarchyItem) => {
    const local = getRoom(item.roomId);
    const card = (summary: CardSummary, loading: boolean, error: Error | null) => (
      <RoomItemCard
        key={item.roomId}
        item={item}
        loading={loading}
        error={error}
        summary={summary}
        onOpen={openRoom}
        onDragging={noop}
        canReorder={false}
        getRoom={getRoom}
      />
    );
    if (local) {
      return (
        <LocalRoomSummaryLoader key={item.roomId} room={local}>
          {(summary) => card(toCardSummary(summary), false, null)}
        </LocalRoomSummaryLoader>
      );
    }
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
              {items.map((item) => {
                if (item.space) {
                  const joined = !!getRoom(item.roomId);
                  return (
                    <SpaceItemCard
                      key={item.roomId}
                      item={item}
                      summary={undefined}
                      joined={joined}
                      categoryId={item.roomId}
                      closed={closedCategories.has(item.roomId)}
                      handleClose={toggleCategory}
                      canEditChild={false}
                      canReorder={false}
                      onDragging={noop}
                      getRoom={getRoom}
                    />
                  );
                }
                if (item.depth === 2 && closedCategories.has(item.parentId)) return null;
                return renderRoom(item);
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
        {membersOpen && (
          <ResizableMembersPanel onClose={() => setMembersOpen(false)}>
            <MembersDrawer key={space.roomId} room={space} members={members} />
          </ResizableMembersPanel>
        )}
      </Box>
    </PowerLevelsContextProvider>
  );
}
