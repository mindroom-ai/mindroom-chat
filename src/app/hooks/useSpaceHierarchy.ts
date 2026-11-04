import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClientEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  RoomEvent,
  RoomStateEvent,
} from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { RoomType, StateEvent } from '../../types/matrix/room';
import { useMatrixClient } from './useMatrixClient';
import { matchesEnum } from '../utils/matchesEnum';

/** `m.space.child` content. */
type SpaceChildContent = {
  via: string[];
  order?: string;
  suggested?: boolean;
};

/** Fields every lobby entry carries, whether it is a space or a room. */
type LobbyEntryFields = {
  roomId: string;
  content: SpaceChildContent;
  /** When the child was added (the child event's timestamp). */
  ts: number;
  /** Nesting below the top space; 0 for the top space itself. */
  depth?: number;
};

/**
 * One entry of a space's lobby: a space or a room below it. Only the top space has no parent;
 * every other entry names the space it sits in.
 */
export type HierarchyItem =
  | (LobbyEntryFields & { space: true; parentId?: string })
  | (LobbyEntryFields & { space?: false; parentId: string });

/** A child link as either source states it: the synced state of a joined space, or `/hierarchy`. */
export type SpaceChildLink = {
  roomId: string;
  content: Partial<SpaceChildContent>;
  ts: number;
};

// The Matrix spec ("Ordering" under Spaces) only honours an `order` of at most 50 printable ASCII
// characters; any other value counts as no order at all.
const VALID_ORDER = /^[\x20-\x7E]{1,50}$/;

const orderOf = (link: SpaceChildLink): string | undefined => {
  const { order } = link.content;
  return typeof order === 'string' && VALID_ORDER.test(order) ? order : undefined;
};

const compareText = (a: string, b: string): number => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

/**
 * Children in the order the spec gives: those with a valid `order` first, by that string; then
 * the rest by when they were added; the room ID settles any tie.
 */
export const sortSpaceChildren = <T extends SpaceChildLink>(links: T[]): T[] =>
  [...links].sort((a, b) => {
    const orderA = orderOf(a);
    const orderB = orderOf(b);
    if (orderA !== undefined && orderB !== undefined && orderA !== orderB) {
      return compareText(orderA, orderB);
    }
    if (orderA !== undefined && orderB === undefined) return -1;
    if (orderA === undefined && orderB !== undefined) return 1;
    if (a.ts !== b.ts) return a.ts - b.ts;
    return compareText(a.roomId, b.roomId);
  });

/** A link only counts while its `via` names at least one server. */
const isLiveLink = (link: SpaceChildLink): boolean =>
  !!link.roomId &&
  Array.isArray(link.content.via) &&
  link.content.via.length > 0 &&
  link.content.via.every((server) => typeof server === 'string');

/** The children a joined space lists in its synced state. */
const getLocalSpaceChildren = (space: Room): SpaceChildLink[] =>
  space.currentState.getStateEvents(StateEvent.SpaceChild).map((event: MatrixEvent) => ({
    roomId: event.getStateKey() ?? '',
    content: event.getContent<Partial<SpaceChildContent>>(),
    ts: event.getTs(),
  }));

/** The children `/hierarchy` reported for a space. */
const getSummaryChildren = (summary: IHierarchyRoom): SpaceChildLink[] =>
  summary.children_state.map((relation) => ({
    roomId: relation.state_key,
    content: relation.content,
    ts: relation.origin_server_ts,
  }));

/** What the tree builder needs to know about any room in it. */
export type HierarchySources = {
  /** Children of a space, from its synced state when joined, else from `/hierarchy`. */
  childrenOf: (spaceId: string) => SpaceChildLink[] | undefined;
  isSpace: (roomId: string) => boolean;
};

/**
 * The entries below `rootId` in lobby order: each space's rooms first, then its subspaces, each
 * subspace followed by its own entries. A space reached twice (a cycle, or listed in two places)
 * shows its entries only the first time.
 */
export const buildHierarchyItems = (rootId: string, sources: HierarchySources): HierarchyItem[] => {
  const items: HierarchyItem[] = [];
  const expanded = new Set<string>([rootId]);

  const visit = (spaceId: string, depth: number) => {
    const children = sortSpaceChildren((sources.childrenOf(spaceId) ?? []).filter(isLiveLink));
    const toItem = (link: SpaceChildLink) => ({
      roomId: link.roomId,
      content: link.content as SpaceChildContent,
      ts: link.ts,
      depth,
      parentId: spaceId,
    });
    children
      .filter((link) => !sources.isSpace(link.roomId))
      .forEach((link) => items.push(toItem(link)));
    children
      .filter((link) => sources.isSpace(link.roomId))
      .forEach((link) => {
        items.push({ ...toItem(link), space: true });
        if (expanded.has(link.roomId)) return;
        expanded.add(link.roomId);
        visit(link.roomId, depth + 1);
      });
  };

  visit(rootId, 1);
  return items;
};

// Pages of `/hierarchy` the lobby reads at most; large spaces show what these pages hold.
const PAGE_SIZE = 50;
const MAX_PAGES = 20;

const fetchHierarchy = async (client: MatrixClient, rootId: string): Promise<IHierarchyRoom[]> => {
  const rooms: IHierarchyRoom[] = [];
  let from: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // Each page needs the token of the one before it.
    // eslint-disable-next-line no-await-in-loop
    const response = await client.getRoomHierarchy(rootId, PAGE_SIZE, undefined, false, from);
    rooms.push(...response.rooms);
    from = response.next_batch;
    if (!from) break;
  }
  return rooms;
};

const spaceHierarchyQueryKey = (rootId: string) => ['space-hierarchy', rootId] as const;

/**
 * Counts changes that alter a lobby: a child link added, edited or removed in any space the
 * client has, a room arriving, and a membership change (a joined subspace reads its own state).
 */
const useSpaceTreeVersion = (client: MatrixClient): number => {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((current) => current + 1);
    const onState = (event: MatrixEvent) => {
      if (matchesEnum(event.getType(), StateEvent.SpaceChild)) bump();
    };
    client.on(RoomStateEvent.Events, onState);
    client.on(ClientEvent.Room, bump);
    client.on(RoomEvent.MyMembership, bump);
    return () => {
      client.removeListener(RoomStateEvent.Events, onState);
      client.removeListener(ClientEvent.Room, bump);
      client.removeListener(RoomEvent.MyMembership, bump);
    };
  }, [client]);
  return version;
};

type SpaceHierarchy = {
  items: HierarchyItem[];
  /** What `/hierarchy` says about each room it could see, by room ID. */
  summaries: Map<string, IHierarchyRoom>;
  /** The first `/hierarchy` read is still running. */
  loading: boolean;
  /** Reads `/hierarchy` again, such as after joining or leaving one of its rooms. */
  refresh: () => void;
};

const isJoined = (room: Room | null): room is Room => room?.getMyMembership() === 'join';

/**
 * The rooms and subspaces of a space, at every depth. Joined spaces list their children from
 * synced state, so changes show at once; `/hierarchy` fills in spaces the user has not joined
 * and describes rooms the client does not have.
 */
export const useSpaceHierarchy = (space: Room): SpaceHierarchy => {
  const client = useMatrixClient();
  const queryClient = useQueryClient();
  const rootId = space.roomId;
  const version = useSpaceTreeVersion(client);

  const query = useQuery({
    queryKey: spaceHierarchyQueryKey(rootId),
    queryFn: () => fetchHierarchy(client, rootId),
    staleTime: 60_000,
    retry: false,
  });

  const summaries = useMemo(() => {
    const byId = new Map<string, IHierarchyRoom>();
    query.data?.forEach((summary) => byId.set(summary.room_id, summary));
    return byId;
  }, [query.data]);

  const items = useMemo(() => {
    const sources: HierarchySources = {
      childrenOf: (spaceId) => {
        const local = client.getRoom(spaceId);
        if (isJoined(local)) return getLocalSpaceChildren(local);
        const summary = summaries.get(spaceId);
        return summary ? getSummaryChildren(summary) : undefined;
      },
      isSpace: (roomId) => {
        const local = client.getRoom(roomId);
        if (local?.isSpaceRoom()) return true;
        return summaries.get(roomId)?.room_type === RoomType.Space;
      },
    };
    return buildHierarchyItems(rootId, sources);
    // `version` stands for the synced state the sources read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, rootId, summaries, version]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: spaceHierarchyQueryKey(rootId) });
  };

  return { items, summaries, loading: query.isLoading, refresh };
};
