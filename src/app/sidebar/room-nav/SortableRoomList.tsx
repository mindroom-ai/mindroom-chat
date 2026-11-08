import React, {
  type ComponentProps,
  type ReactNode,
  createContext,
  useContext,
  useState,
} from 'react';
import {
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

type SortableRoomListProps = {
  /** The list's ID in the saved order: `home` or the space's room ID. */
  listId: string;
  /** The rooms in the order the section shows them. */
  roomIds: string[];
  /** Called with the list's new order after a drop or a keyboard move. */
  onReorder: (order: string[]) => void;
  children: ReactNode;
};

/**
 * A room section whose rows (`SortableRoomRow`) move by drag and drop, the mouse after a short
 * move and a finger that moves on after a long press, or one place at a time with ⌘ or Ctrl, Shift
 * and the up or down arrow key on a row's link.
 */
export function SortableRoomList({ listId, roomIds, onReorder, children }: SortableRoomListProps) {
  const [dragged, setDragged] = useState<string>();
  const [hint, setHint] = useState<RoomListDrag['hint']>();
  const sensors = useSensors(
    useSensor(RowMouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(RowTouchSensor)
  );

  const roomOf = (id: UniqueIdentifier | undefined): string | undefined => {
    const parsed = id === undefined ? undefined : parseRoomSortableId(`${id}`);
    return parsed?.parentSpaceId === listId ? parsed.roomId : undefined;
  };
  const moveTo = (roomId: string, toIndex: number) => {
    if (toIndex < 0 || toIndex >= roomIds.length || roomIds[toIndex] === roomId) return;
    onReorder(moveRoom(roomIds, roomId, toIndex));
  };

  const handleDragStart = (event: DragStartEvent) => {
    preventClickDefaultsDuringPointerDrag(event.activatorEvent);
    setDragged(roomOf(event.active.id));
  };
  const endDrag = () => {
    setDragged(undefined);
    setHint(undefined);
  };
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    const from = roomOf(active.id);
    const to = roomOf(over?.id);
    const at = from && to ? dropAt(roomIds, from, to) : undefined;
    setHint(to && at ? { roomId: to, at } : undefined);
  };
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    endDrag();
    const from = roomOf(active.id);
    const to = roomOf(over?.id);
    if (from && to) moveTo(from, roomIds.indexOf(to));
  };

  const drag: RoomListDrag = {
    listId,
    dragged,
    hint,
    moveBy: (roomId, step) => moveTo(roomId, roomIds.indexOf(roomId) + step),
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
      accessibility={{ announcements: silentAnnouncements }}
    >
      <SortableContext
        items={roomIds.map((roomId) => makeRoomSortableId(listId, roomId))}
        strategy={keepInPlace}
      >
        <RoomListDragContext.Provider value={drag}>{children}</RoomListDragContext.Provider>
      </SortableContext>
    </DndContext>
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
