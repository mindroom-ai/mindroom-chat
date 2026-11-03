import { useCallback, useEffect, useMemo, useState } from 'react';
import { EventTimeline, MatrixClient, MatrixEvent, Room, RoomStateEvent } from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';
import { useMatrixClient } from './useMatrixClient';

/** `m.space.child` content. */
export type SpaceChildContent = {
  via: string[];
  order?: string;
  suggested?: boolean;
};

type HierarchyItemBase = {
  roomId: string;
  content: SpaceChildContent;
  /** When the child was added (the child event's timestamp). */
  ts: number;
  /** Nesting below the top space; 0 for the top space itself. */
  depth?: number;
};

export type HierarchyItemSpace = HierarchyItemBase & {
  space: true;
  parentId?: string;
};

export type HierarchyItemRoom = HierarchyItemBase & {







const readChildContent = (event: MatrixEvent): SpaceChildContent | undefined => {
  const content = event.getContent();
  if (!Array.isArray(content.via) || content.via.length === 0) return undefined;
  return {
    via: content.via.filter((server: unknown): server is string => typeof server === 'string'),
    order: typeof content.order === 'string' ? content.order : undefined,
    suggested: content.suggested === true,
  };
};

/** Children ordered by the specification: by `order` first, then by when they were added. */
const compareChildren = (a: HierarchyItem, b: HierarchyItem): number => {
  const orderA = a.content.order;
  const orderB = b.content.order;
  if (orderA !== undefined && orderB === undefined) return -1;
  if (orderA === undefined && orderB !== undefined) return 1;
  if (orderA !== undefined && orderB !== undefined && orderA !== orderB) {
    return orderA < orderB ? -1 : 1;
  }
  if (a.ts !== b.ts) return a.ts - b.ts;
  return a.roomId < b.roomId ? -1 : 1;
};

const getSpaceChildren = (space: Room, depth: number): HierarchyItem[] => {
  const events =
    space
      .getLiveTimeline()
      .getState(EventTimeline.FORWARDS)
      ?.getStateEvents(StateEvent.SpaceChild) ?? [];
  const children: HierarchyItem[] = [];
  events.forEach((event) => {
    const roomId = event.getStateKey();
    const content = readChildContent(event);
    if (!roomId || !content) return;
    const childRoom = space.client.getRoom(roomId);
    const base = { roomId, content, ts: event.getTs(), depth };
    children.push(
      childRoom?.isSpaceRoom()
        ? { ...base, space: true, parentId: space.roomId }
        : { ...base, parentId: space.roomId }
    );
  });
  return children.sort(compareChildren);
};

/**
 * The hierarchy of a joined space from local state, depth first: the space, its rooms, then
 * each child space followed by its own rooms. Each space appears once even when the tree has
 * cycles; `isClosed` collapses a space's rooms.
 */
export const getSpaceHierarchy = (
  mx: MatrixClient,
  spaceId: string,
  isClosed: (spaceId: string) => boolean = () => false
): HierarchyItem[] => {
  const space = mx.getRoom(spaceId);
  if (!space) return [];
  const seen = new Set<string>([spaceId]);
  const items: HierarchyItem[] = [
    { roomId: spaceId, content: { via: [] }, ts: 0, depth: 0, space: true },
  ];

  const visit = (current: Room, depth: number) => {
    const children = getSpaceChildren(current, depth);
    if (!isClosed(current.roomId)) {
      children.filter((child) => !child.space).forEach((child) => items.push(child));
    }
    children.forEach((child) => {
      if (!child.space || seen.has(child.roomId)) return;
      seen.add(child.roomId);
      items.push(child);
      const childSpace = mx.getRoom(child.roomId);
      if (childSpace) visit(childSpace, depth + 1);
    });
  };
  visit(space, 1);
  return items;
};

/** The space's hierarchy from local state, following child changes in any space. */
export const useSpaceHierarchy = (
  spaceId: string,
  isClosed?: (spaceId: string) => boolean
): HierarchyItem[] => {
  const mx = useMatrixClient();
  const [version, setVersion] = useState(0);

  const handleStateEvent = useCallback((event: MatrixEvent) => {
    if (event.getType() === StateEvent.SpaceChild) setVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    mx.on(RoomStateEvent.Events, handleStateEvent);
    return () => {
      mx.removeListener(RoomStateEvent.Events, handleStateEvent);
    };
  }, [mx, handleStateEvent]);

  return useMemo(() => {
    void version;
    return getSpaceHierarchy(mx, spaceId, isClosed);
  }, [mx, spaceId, isClosed, version]);
};
