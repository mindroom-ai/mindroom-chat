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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraggableRoomFolderNavItem } from './DraggableRoomFolderNavItem';
import { RoomFolderNavRow } from './roomFolderNavRows';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../components/sidebar/Sidebar.css', () => ({
  SidebarRowDragSource: 'SidebarRowDragSource',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const row: Extract<RoomFolderNavRow, { type: 'room' }> = {
  type: 'room',
  key: 'room:folder:!room:example.org',
  roomId: '!room:example.org',
  categoryId: 'folder',
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
      <DraggableRoomFolderNavItem row={row} roomName="Room">
        <a href="/room">Room link</a>
        <button type="button">Room menu</button>
      </DraggableRoomFolderNavItem>
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

  it('uses one labelled handle and leaves nested room controls outside the activator', async () => {
    const onDragStart = vi.fn();
    act(() => root.render(<Harness onDragStart={onDragStart} />));

    const rowElement = container.querySelector('[data-room-drag-row]') as HTMLElement;
    const handle = container.querySelector('[aria-label="nav.dragRoom"]') as HTMLElement;
    const menu = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Room menu'
    ) as HTMLButtonElement;

    expect(rowElement.getAttribute('role')).toBeNull();
    expect(rowElement.getAttribute('tabindex')).toBeNull();
    expect(handle).toBeTruthy();

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

    handle.focus();
    await act(async () => {
      handle.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })
      );
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(onDragStart).toHaveBeenCalledOnce();
  });
});
