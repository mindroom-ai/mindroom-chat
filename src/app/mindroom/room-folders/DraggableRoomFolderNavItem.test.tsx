// @vitest-environment jsdom

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRoomSortableId } from '../../features/room-nav/SortableRoomNavItem';
import { DraggableRoomFolderNavItem } from './DraggableRoomFolderNavItem';
import { RoomFolderNavRow } from './roomFolderNavRows';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../components/sidebar/Sidebar.css', () => ({
  SidebarRowDragSource: 'SidebarRowDragSource',
  SidebarRowKeyboardDragHandle: 'SidebarRowKeyboardDragHandle',
}));
vi.mock('../../features/room-nav/RoomNavItem', () => ({
  RoomNavItem: () => null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const row: Extract<RoomFolderNavRow, { type: 'room' }> = {
  type: 'room',
  key: 'room:folder:!room:example.org',
  roomId: '!room:example.org',
  categoryId: 'folder',
  roomOrderKey: 'folder:work',
  categoryKind: 'folder',
  parentId: 'work',
};

function Harness({ onDragStart }: { onDragStart: () => void }) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );
  return (
    <DndContext sensors={sensors} onDragStart={onDragStart}>
      <SortableContext
        items={[makeRoomSortableId('folder:work', '!room:example.org')]}
        strategy={verticalListSortingStrategy}
      >
        <DraggableRoomFolderNavItem row={row} roomName="Example room">
          <a href="/room">Room link</a>
          <button type="button">Room menu</button>
        </DraggableRoomFolderNavItem>
      </SortableContext>
    </DndContext>
  );
}

describe('DraggableRoomFolderNavItem', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('reuses whole-row mouse sorting while keeping nested controls accessible', async () => {
    const onDragStart = vi.fn();
    act(() => root.render(<Harness onDragStart={onDragStart} />));

    const rowElement = container.querySelector('[data-room-id]') as HTMLElement;
    const menu = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Room menu'
    ) as HTMLButtonElement;
    const dragHandle = container.querySelector(
      'button[aria-label="nav.dragRoom"]'
    ) as HTMLButtonElement;

    expect(rowElement.getAttribute('role')).toBeNull();
    expect(rowElement.getAttribute('tabindex')).toBeNull();
    expect(container.querySelector('a')?.textContent).toBe('Room link');
    expect(menu).toBeTruthy();
    expect(dragHandle.getAttribute('role')).toBe('button');
    expect(dragHandle.getAttribute('tabindex')).toBe('0');

    await act(async () => {
      menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }));
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 20, clientY: 20 })
      );
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(onDragStart).not.toHaveBeenCalled();

    await act(async () => {
      rowElement.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0, buttons: 1 })
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 20, clientY: 20, buttons: 1 })
      );
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(onDragStart).toHaveBeenCalledOnce();
  });
});
