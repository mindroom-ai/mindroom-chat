import React, {
  type ComponentProps,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  MouseSensor,
  type MouseSensorOptions,
  TouchSensor,
  type TouchSensorOptions,
  type UniqueIdentifier,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { preventClickDefaultsDuringPointerDrag } from '../../lib/sortableDrag';
import { LongPressTouchSensor } from '../../lib/longPressTouchSensor';
import {
  makeRoomSortableId,
  parseRoomSortableId,
  SortableRoomNavItem,
} from './SortableRoomNavItem';
import { moveRoom } from './roomOrder';
import { moveStep } from '../../shortcuts/shortcuts';
import * as css from './SortableRoomList.css';

type DropAt = 'above' | 'below';

type RoomListDrag = {
  listId: string;
  /** The room being dragged. */
  dragged?: string;
  /** The row a dragged room would land next to, and on which side. */
  hint?: { roomId: string; at: DropAt };
  /** Whether same-list drag/keyboard reordering is disabled (e.g. Recent activity sort). */
  reorderDisabled?: boolean;
  /** Moves a room one place up (-1) or down (1). */
  moveBy: (roomId: string, step: -1 | 1) => void;
};

const RoomListDragContext = createContext<RoomListDrag | undefined>(undefined);

/**
 * Where a room dragged from `fromId` lands on the row `toId`: it takes that row's place, so it
 * shows above a row it came up to and below a row it came down to.
 */
const dropAt = (roomIds: readonly string[], fromId: string, toId: string): DropAt | undefined => {
  const from = roomIds.indexOf(fromId);
  const to = roomIds.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return undefined;
  return to < from ? 'above' : 'below';
};

/**
 * Whether a press starts on the row itself: not on its menu button, and not in the menu or dialog
 * it opened, which sit in portals outside the row but pass their events through it.
 */
const pressedOnRow = (event: React.SyntheticEvent): boolean => {
  const { target, currentTarget } = event;
  return target instanceof Element && currentTarget.contains(target) && !target.closest('button');
};

class RowMouseSensor extends MouseSensor {
  static override activators = MouseSensor.activators.map((activator) => ({
    ...activator,
    handler: (event: React.MouseEvent, options: MouseSensorOptions) =>
      pressedOnRow(event) && activator.handler(event, options),
  }));
}

/** A finger drags a row only when it moves on after a long press, which opens the row's menu. */
class RowTouchSensor extends LongPressTouchSensor {
  static override activators = TouchSensor.activators.map((activator) => ({
    ...activator,
    handler: (event: React.TouchEvent, options: TouchSensorOptions) =>
      pressedOnRow(event) && activator.handler(event, options),
  }));
}

/** Rows stay in place while a room is dragged; a line marks where it lands. */
const keepInPlace = () => null;

// The drag library's own announcements are English only and name the rows by their sortable IDs;
// ⌘ or Ctrl with Shift and the arrow keys moves a room from the keyboard instead.
const silent = () => undefined;
const silentAnnouncements = {
  onDragStart: silent,
  onDragOver: silent,
  onDragEnd: silent,
  onDragCancel: silent,
};

const SECTION_PREFIX = 'section:';

export const makeRoomSectionDroppableId = (spaceId: string): string =>
  `${SECTION_PREFIX}${spaceId}`;

type SectionDroppableData = { kind: 'section'; spaceId: string };

const isSectionData = (data: unknown): data is SectionDroppableData =>
  typeof data === 'object' &&
  data !== null &&
  (data as { kind?: unknown }).kind === 'section' &&
  typeof (data as { spaceId?: unknown }).spaceId === 'string';

const sectionSpaceIdOf = (id: UniqueIdentifier | undefined, data: unknown): string | undefined => {
  if (isSectionData(data)) return data.spaceId;
  return typeof id === 'string' && id.startsWith(SECTION_PREFIX)
    ? id.slice(SECTION_PREFIX.length)
    : undefined;
};

const CLIPPING_OVERFLOW = new Set(['auto', 'scroll', 'hidden', 'clip']);

const clipsOverflow = (style: CSSStyleDeclaration): { x: boolean; y: boolean } => {
  const [shortX = '', shortY = shortX] = style.overflow.trim().split(/\s+/);
  return {
    x: CLIPPING_OVERFLOW.has(style.overflowX || shortX),
    y: CLIPPING_OVERFLOW.has(style.overflowY || shortY),
  };
};

/**
 * Whether `point` falls inside `element`'s visible bounds after intersecting every clipping
 * ancestor (e.g. a scroll viewport above Recently Opened) and excluding any sticky header pinned
 * at the top of a scroll viewport (e.g. `PageScrollHeader`). Returns `true` when `element` is
 * absent so `pointerWithin` falls back to `container.rect.current`.
 */
const isPointerWithinVisibleBounds = (
  element: HTMLElement | null,
  point: { x: number; y: number }
): boolean => {
  if (!element) return true;
  const view = element.ownerDocument.defaultView;
  let { top, bottom, left, right } = element.getBoundingClientRect();
  let child: HTMLElement = element;
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = view?.getComputedStyle(ancestor);
    const clips = style ? clipsOverflow(style) : { x: false, y: false };
    if (clips.x || clips.y) {
      const rect = ancestor.getBoundingClientRect();
      if (clips.x) {
        left = Math.max(left, rect.left);
        right = Math.min(right, rect.right);
      }
      if (clips.y) {
        top = Math.max(top, rect.top);
        bottom = Math.min(bottom, rect.bottom);
        for (let prev = child.previousElementSibling; prev; prev = prev.previousElementSibling) {
          if (view?.getComputedStyle(prev).position === 'sticky') {
            const stickyRect = prev.getBoundingClientRect();
            if (
              stickyRect.height > 0 &&
              stickyRect.width > 0 &&
              stickyRect.left < right &&
              stickyRect.right > left
            ) {
              top = Math.max(top, stickyRect.bottom);
            }
          }
        }
      }
    }
    child = ancestor;
  }
  return (
    left < right &&
    top < bottom &&
    point.x >= left &&
    point.x <= right &&
    point.y >= top &&
    point.y <= bottom
  );
};

type GroupListEntry = {
  roomIds: readonly string[];
  onReorder: (order: string[]) => void;
  reorderDisabled: boolean;
};

type RoomGroupDrag = {
  dragged?: { listId: string; roomId: string };
  hint?: { listId: string; roomId: string; at: DropAt };
  dropTargetSpaceId?: string;
  registerList: (
    listId: string,
    roomIds: readonly string[],
    onReorder: (order: string[]) => void,
    reorderDisabled?: boolean
  ) => () => void;
};

const RoomGroupDragContext = createContext<RoomGroupDrag | undefined>(undefined);

export type SortableRoomGroupProps = {
  /** Whether dragging `roomId` from `sourceSpaceId` into `targetSpaceId` is allowed. */
  canMoveRoom?: (sourceSpaceId: string, targetSpaceId: string, roomId: string) => boolean;
  /** Called when a room is dropped onto another eligible section. */
  onMoveRoom?: (
    sourceSpaceId: string,
    targetSpaceId: string,
    roomId: string
  ) => void | Promise<void>;
  children: ReactNode;
};

/**
 * Shared drag context for sibling `SortableRoomList` sections: drags inside a section reorder its
 * rows, while drags onto another eligible section container move the room into that section.
 */
export function SortableRoomGroup({ canMoveRoom, onMoveRoom, children }: SortableRoomGroupProps) {
  const [dragged, setDragged] = useState<RoomGroupDrag['dragged']>();
  const [hint, setHint] = useState<RoomGroupDrag['hint']>();
  const [dropTargetSpaceId, setDropTargetSpaceId] = useState<string>();
  const listsRef = useRef(new Map<string, GroupListEntry>());
  const sensors = useSensors(
    useSensor(RowMouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(RowTouchSensor)
  );

  const registerList = useCallback<RoomGroupDrag['registerList']>(
    (listId, roomIds, onReorder, reorderDisabled = false) => {
      const entry: GroupListEntry = { roomIds, onReorder, reorderDisabled };
      listsRef.current.set(listId, entry);
      return () => {
        if (listsRef.current.get(listId) === entry) listsRef.current.delete(listId);
      };
    },
    []
  );

  const canMoveTo = (sourceId: string, targetId: string, roomId: string) =>
    targetId !== sourceId && Boolean(canMoveRoom?.(sourceId, targetId, roomId));

  const collisionDetection: CollisionDetection = (args) => {
    const activeRoom = parseRoomSortableId(`${args.active.id}`);
    if (!activeRoom) return [];
    const reorderDisabled = Boolean(
      listsRef.current.get(activeRoom.parentSpaceId)?.reorderDisabled
    );
    const sourceRows = () =>
      args.droppableContainers.filter(
        (c) => parseRoomSortableId(`${c.id}`)?.parentSpaceId === activeRoom.parentSpaceId
      );

    const sections = args.droppableContainers.filter((c) => isSectionData(c.data.current));
    if (sections.length === 0) {
      return reorderDisabled ? [] : closestCenter({ ...args, droppableContainers: sourceRows() });
    }
    const pointer = args.pointerCoordinates;
    if (!pointer) return [];

    const visibleSections = sections.filter((c) =>
      isPointerWithinVisibleBounds(c.node.current, pointer)
    );
    const hitSection = pointerWithin({ ...args, droppableContainers: visibleSections })[0];
    if (!hitSection) return [];
    const hitContainer = visibleSections.find((c) => c.id === hitSection.id);
    const targetSpaceId = sectionSpaceIdOf(hitSection.id, hitContainer?.data.current);
    if (!targetSpaceId) return [];
    if (targetSpaceId === activeRoom.parentSpaceId) {
      return reorderDisabled ? [] : closestCenter({ ...args, droppableContainers: sourceRows() });
    }
    return canMoveTo(activeRoom.parentSpaceId, targetSpaceId, activeRoom.roomId)
      ? [hitSection]
      : [];
  };

  const handleDragStart = (event: DragStartEvent) => {
    preventClickDefaultsDuringPointerDrag(event.activatorEvent);
    const parsed = parseRoomSortableId(`${event.active.id}`);
    setDragged(parsed ? { listId: parsed.parentSpaceId, roomId: parsed.roomId } : undefined);
  };
  const endDrag = () => {
    setDragged(undefined);
    setHint(undefined);
    setDropTargetSpaceId(undefined);
  };
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    const from = parseRoomSortableId(`${active.id}`);
    if (!from || !over) {
      setHint(undefined);
      setDropTargetSpaceId(undefined);
      return;
    }
    const targetSpaceId = sectionSpaceIdOf(over.id, over.data.current);
    if (targetSpaceId) {
      setHint(undefined);
      setDropTargetSpaceId(
        canMoveTo(from.parentSpaceId, targetSpaceId, from.roomId) ? targetSpaceId : undefined
      );
      return;
    }
    setDropTargetSpaceId(undefined);
    const to = parseRoomSortableId(`${over.id}`);
    const list = listsRef.current.get(from.parentSpaceId);
    const at =
      to && list && !list.reorderDisabled && to.parentSpaceId === from.parentSpaceId
        ? dropAt(list.roomIds, from.roomId, to.roomId)
        : undefined;
    setHint(to && at ? { listId: from.parentSpaceId, roomId: to.roomId, at } : undefined);
  };
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    endDrag();
    const from = parseRoomSortableId(`${active.id}`);
    if (!from || !over) return;
    const targetSpaceId = sectionSpaceIdOf(over.id, over.data.current);
    if (targetSpaceId) {
      if (canMoveTo(from.parentSpaceId, targetSpaceId, from.roomId)) {
        void onMoveRoom?.(from.parentSpaceId, targetSpaceId, from.roomId);
      }
      return;
    }
    const to = parseRoomSortableId(`${over.id}`);
    const list =
      to?.parentSpaceId === from.parentSpaceId
        ? listsRef.current.get(from.parentSpaceId)
        : undefined;
    const toIndex = to && list && !list.reorderDisabled ? list.roomIds.indexOf(to.roomId) : -1;
    if (list && !list.reorderDisabled && toIndex >= 0 && list.roomIds[toIndex] !== from.roomId) {
      list.onReorder(moveRoom(list.roomIds, from.roomId, toIndex));
    }
  };

  const activeDropTargetSpaceId =
    dragged && dropTargetSpaceId && canMoveTo(dragged.listId, dropTargetSpaceId, dragged.roomId)
      ? dropTargetSpaceId
      : undefined;

  const group = useMemo<RoomGroupDrag>(
    () => ({ dragged, hint, dropTargetSpaceId: activeDropTargetSpaceId, registerList }),
    [dragged, hint, activeDropTargetSpaceId, registerList]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
      accessibility={{ announcements: silentAnnouncements }}
    >
      <RoomGroupDragContext value={group}>{children}</RoomGroupDragContext>
    </DndContext>
  );
}

/**
 * Registers a section container (`NavCategory`) as a drop target for cross-section room moves
 * inside a `SortableRoomGroup`.
 */
export function useRoomSectionDrop(spaceId: string) {
  const group = useContext(RoomGroupDragContext);
  const { setNodeRef } = useDroppable({
    id: makeRoomSectionDroppableId(spaceId),
    disabled: !group,
    data: { kind: 'section', spaceId } satisfies SectionDroppableData,
  });
  const active = group?.dropTargetSpaceId === spaceId;
  return {
    ref: setNodeRef,
    className: css.SectionDropTarget,
    'data-section-drop-target': active ? 'true' : undefined,
  };
}

type SortableRoomListProps = {
  /** The list's ID in the saved order: `home` or the space's room ID. */
  listId: string;
  /** The rooms in the order the section shows them. */
  roomIds: string[];
  /** Called with the list's new order after a drop or a keyboard move. */
  onReorder: (order: string[]) => void;
  /** Suppresses same-list drop hints, drop reorder, and keyboard reorder while keeping cross-section drag. */
  reorderDisabled?: boolean;
  children: ReactNode;
};

function SortableRoomListInner({
  listId,
  roomIds,
  onReorder,
  reorderDisabled = false,
  children,
}: SortableRoomListProps) {
  const group = useContext(RoomGroupDragContext);
  if (!group) throw new Error('SortableRoomListInner must be inside a SortableRoomGroup');
  const { registerList } = group;
  useEffect(
    () => registerList(listId, roomIds, onReorder, reorderDisabled),
    [registerList, listId, roomIds, onReorder, reorderDisabled]
  );

  const drag: RoomListDrag = {
    listId,
    dragged: group.dragged?.listId === listId ? group.dragged.roomId : undefined,
    hint: group.hint?.listId === listId ? group.hint : undefined,
    reorderDisabled,
    moveBy: (roomId, step) => {
      if (reorderDisabled) return;
      const toIndex = roomIds.indexOf(roomId) + step;
      if (toIndex < 0 || toIndex >= roomIds.length || roomIds[toIndex] === roomId) return;
      onReorder(moveRoom(roomIds, roomId, toIndex));
    },
  };

  return (
    <SortableContext
      items={roomIds.map((roomId) => makeRoomSortableId(listId, roomId))}
      strategy={keepInPlace}
    >
      <RoomListDragContext value={drag}>{children}</RoomListDragContext>
    </SortableContext>
  );
}

/**
 * A room section whose rows (`SortableRoomRow`) move by drag and drop, the mouse after a short
 * move and a finger that moves on after a long press, or one place at a time with ⌘ or Ctrl, Shift
 * and the up or down arrow key on a row's link. Inside a `SortableRoomGroup`, it shares the
 * group's `DndContext` instead of nesting one.
 */
export function SortableRoomList(props: SortableRoomListProps) {
  const group = useContext(RoomGroupDragContext);
  if (group) return <SortableRoomListInner {...props} />;
  return (
    <SortableRoomGroup>
      <SortableRoomListInner {...props} />
    </SortableRoomGroup>
  );
}

type SortableRoomRowProps = Omit<ComponentProps<typeof SortableRoomNavItem>, 'parentSpaceId'>;

/** A room row of a `SortableRoomList`. */
export function SortableRoomRow(props: SortableRoomRowProps) {
  const drag = useContext(RoomListDragContext);
  const { roomId } = props.room;
  if (!drag) throw new Error('SortableRoomRow must be inside a SortableRoomList');
  const at = drag.hint?.roomId === roomId ? drag.hint.at : undefined;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (drag.reorderDisabled) return;
    const step = moveStep(event.nativeEvent);
    // Keys typed in the row's menu or dialogs (portals that pass their events through) move nothing.
    if (!step || !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) {
      return;
    }
    event.preventDefault();
    drag.moveBy(roomId, step);
  };

  return (
    <div
      className={css.RoomDropHint({ at, dragged: drag.dragged === roomId })}
      data-drop-at={at}
      onKeyDown={handleKeyDown}
    >
      <SortableRoomNavItem
        parentSpaceId={drag.listId}
        dragging={drag.dragged === roomId}
        {...props}
      />
    </div>
  );
}
