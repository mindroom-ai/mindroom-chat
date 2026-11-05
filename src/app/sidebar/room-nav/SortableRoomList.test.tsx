// @vitest-environment jsdom

import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { SortableRoomList, SortableRoomRow } from './SortableRoomList';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../ui/sidebar/Sidebar.css', () => ({ SidebarRowDragSource: 'row' }));
vi.mock('./SortableRoomList.css', () => ({ RoomDropHint: () => 'hint' }));

// A row is its link, plus a field in a dialog it opened, which sits in a portal.
vi.mock('./RoomNavItem', () => ({
  RoomNavItem: ({ room }: { room: Room }) => (
    <>
      <a href={`#${room.roomId}`}>{room.name}</a>
      {createPortal(<input aria-label={`Dialog of ${room.name}`} />, document.body)}
    </>
  ),
}));

const room = (roomId: string): Room => ({ roomId, name: roomId.slice(1) } as unknown as Room);

describe('SortableRoomRow', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onReorder = vi.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const roomIds = ['!alder', '!birch', '!cedar'];
    act(() => {
      root.render(
        <SortableRoomList listId="home" roomIds={roomIds} onReorder={onReorder}>
          {roomIds.map((roomId) => (
            <SortableRoomRow key={roomId} room={room(roomId)} selected={false} linkPath="/" />
          ))}
        </SortableRoomList>
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    onReorder.mockReset();
  });

  // Ctrl with Shift: the test platform is not an Apple one, where it is Command with Shift.
  const moveKeys = { ctrlKey: true, shiftKey: true };
  const press = (target: Element, key: string, modifiers: KeyboardEventInit = moveKeys) =>
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, ...modifiers, bubbles: true }));
    });

  it('moves a room one place with Ctrl, Shift and the up or down arrow key on its link', () => {
    press(container.querySelector('a[href="#!birch"]')!, 'ArrowUp');
    expect(onReorder).toHaveBeenLastCalledWith(['!birch', '!alder', '!cedar']);
    press(container.querySelector('a[href="#!birch"]')!, 'ArrowDown');
    expect(onReorder).toHaveBeenLastCalledWith(['!alder', '!cedar', '!birch']);
  });

  it('does not move past either end, with Alt, or without the modifiers', () => {
    press(container.querySelector('a[href="#!alder"]')!, 'ArrowUp');
    press(container.querySelector('a[href="#!cedar"]')!, 'ArrowDown');
    // Alt and the arrows open the room above or below instead.
    press(container.querySelector('a[href="#!birch"]')!, 'ArrowUp', { altKey: true });
    press(container.querySelector('a[href="#!birch"]')!, 'ArrowUp', {});
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('ignores keys typed in a dialog the row opened', () => {
    const field = document.querySelector('input[aria-label="Dialog of birch"]')!;
    press(field, 'ArrowUp');
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('leaves the row without a role or tab stop of its own', () => {
    const row = container.querySelector('[data-room-id="!birch"]')!;
    expect(row.getAttribute('role')).toBeNull();
    expect(row.getAttribute('tabindex')).toBeNull();
  });
});
