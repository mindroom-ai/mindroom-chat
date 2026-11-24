// @vitest-environment jsdom

import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import {
  SortableRoomGroup,
  SortableRoomList,
  SortableRoomRow,
  useRoomSectionDrop,
} from './SortableRoomList';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../ui/sidebar/Sidebar.css', () => ({ SidebarRowDragSource: 'row' }));
vi.mock('./SortableRoomList.css', () => ({
  RoomDropHint: () => 'hint',
  SectionDropTarget: 'section-drop-target',
}));

// A row is its link, plus a field in a dialog it opened, which sits in a portal.
vi.mock('./RoomNavItem', () => ({
  RoomNavItem: ({ room }: { room: Room }) => (
    <>
      <a href={`#${room.roomId}`}>{room.name}</a>
      {createPortal(<input aria-label={`Dialog of ${room.name}`} />, document.body)}
    </>
  ),
}));

const room = (roomId: string): Room => ({ roomId, name: roomId.slice(1) }) as unknown as Room;

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

const makeRect = (top: number, height: number): DOMRect => ({
  x: 0,
  y: top,
  top,
  left: 0,
  width: 200,
  height,
  right: 200,
  bottom: top + height,
  toJSON: () => ({}),
});

function TestSection({
  spaceId,
  roomIds,
  onReorder,
  reorderDisabled = false,
}: {
  spaceId: string;
  roomIds: string[];
  onReorder: (order: string[]) => void;
  reorderDisabled?: boolean;
}) {
  const sectionDrop = useRoomSectionDrop(spaceId);
  return (
    <div {...sectionDrop} data-section-id={spaceId}>
      <SortableRoomList
        listId={spaceId}
        roomIds={roomIds}
        onReorder={onReorder}
        reorderDisabled={reorderDisabled}
      >
        {roomIds.map((roomId) => (
          <SortableRoomRow key={roomId} room={room(roomId)} selected={false} linkPath="/" />
        ))}
      </SortableRoomList>
    </div>
  );
}

describe('SortableRoomGroup', () => {
  let container: HTMLDivElement;
  let root: Root;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  const rects: Record<string, DOMRect> = {
    'section:!root': makeRect(0, 120),
    'room:!alder': makeRect(20, 40),
    'room:!birch': makeRect(60, 40),
    'section:!design': makeRect(140, 120),
    'room:!cedar': makeRect(160, 40),
    'section:!empty': makeRect(280, 40),
    viewport: makeRect(0, 200),
    'sticky-header': makeRect(0, 50),
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getMockRect(this: HTMLElement) {
        if (this.dataset.sectionId)
          return rects[`section:${this.dataset.sectionId}`] ?? makeRect(0, 0);
        if (this.dataset.roomId) return rects[`room:${this.dataset.roomId}`] ?? makeRect(0, 0);
        if (this.dataset.rectKey) return rects[this.dataset.rectKey] ?? makeRect(0, 0);
        return makeRect(0, 0);
      });
  });

  afterEach(() => {
    act(() => root.unmount());
    rectSpy.mockRestore();
    container.remove();
    document.body.innerHTML = '';
  });

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  const dragRow = async (
    roomId: string,
    startY: number,
    targetY: number,
    whileOver?: () => void
  ) => {
    const rowEl = container.querySelector(`[data-room-id="${roomId}"]`) as HTMLElement;
    await act(async () => {
      rowEl.dispatchEvent(
        new MouseEvent('mousedown', { button: 0, clientX: 50, clientY: startY, bubbles: true })
      );
      await tick();
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 50, clientY: startY + 10, bubbles: true })
      );
      await tick();
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 50, clientY: targetY, bubbles: true })
      );
      await tick();
    });
    whileOver?.();
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 50, clientY: targetY, bubbles: true })
      );
      await tick();
    });
  };

  it('reorders within the source section without requiring move permission', async () => {
    const onReorderRoot = vi.fn();
    const onReorderDesign = vi.fn();
    const onMoveRoom = vi.fn();

    act(() => {
      root.render(
        <SortableRoomGroup canMoveRoom={() => false} onMoveRoom={onMoveRoom}>
          <TestSection spaceId="!root" roomIds={['!alder', '!birch']} onReorder={onReorderRoot} />
          <TestSection spaceId="!design" roomIds={['!cedar']} onReorder={onReorderDesign} />
        </SortableRoomGroup>
      );
    });

    await dragRow('!birch', 80, 30, () => {
      const alderWrapper = container.querySelector('[data-room-id="!alder"]')!.parentElement!;
      expect(alderWrapper.getAttribute('data-drop-at')).toBe('above');
      expect(container.querySelector('[data-section-drop-target="true"]')).toBeNull();
    });

    expect(onReorderRoot).toHaveBeenCalledWith(['!birch', '!alder']);
    expect(onReorderDesign).not.toHaveBeenCalled();
    expect(onMoveRoom).not.toHaveBeenCalled();
  });

  it('highlights eligible target sections (populated or empty) and calls onMoveRoom on drop', async () => {
    const onReorderRoot = vi.fn();
    const onReorderDesign = vi.fn();
    const onMoveRoom = vi.fn();

    act(() => {
      root.render(
        <SortableRoomGroup canMoveRoom={() => true} onMoveRoom={onMoveRoom}>
          <TestSection spaceId="!root" roomIds={['!alder', '!birch']} onReorder={onReorderRoot} />
          <TestSection spaceId="!design" roomIds={['!cedar']} onReorder={onReorderDesign} />
          <TestSection spaceId="!empty" roomIds={[]} onReorder={vi.fn()} />
        </SortableRoomGroup>
      );
    });

    await dragRow('!alder', 40, 180, () => {
      const designSection = container.querySelector('[data-section-id="!design"]')!;
      expect(designSection.getAttribute('data-section-drop-target')).toBe('true');
      expect(container.querySelector('[data-drop-at]')).toBeNull();
    });
    expect(onMoveRoom).toHaveBeenLastCalledWith('!root', '!design', '!alder');

    await dragRow('!birch', 80, 300, () => {
      const emptySection = container.querySelector('[data-section-id="!empty"]')!;
      expect(emptySection.getAttribute('data-section-drop-target')).toBe('true');
    });
    expect(onMoveRoom).toHaveBeenLastCalledWith('!root', '!empty', '!birch');
    expect(onReorderRoot).not.toHaveBeenCalled();
    expect(onReorderDesign).not.toHaveBeenCalled();
  });

  it('shows no hint and does not reorder or move when hovering an ineligible section or outside sections', async () => {
    const onReorderRoot = vi.fn();
    const onReorderDesign = vi.fn();
    const onMoveRoom = vi.fn();

    act(() => {
      root.render(
        <SortableRoomGroup canMoveRoom={() => false} onMoveRoom={onMoveRoom}>
          <TestSection spaceId="!root" roomIds={['!alder', '!birch']} onReorder={onReorderRoot} />
          <TestSection spaceId="!design" roomIds={['!cedar']} onReorder={onReorderDesign} />
        </SortableRoomGroup>
      );
    });

    await dragRow('!alder', 40, 180, () => {
      expect(container.querySelector('[data-section-drop-target="true"]')).toBeNull();
      expect(container.querySelector('[data-drop-at]')).toBeNull();
    });
    await dragRow('!alder', 40, 500, () => {
      expect(container.querySelector('[data-section-drop-target="true"]')).toBeNull();
      expect(container.querySelector('[data-drop-at]')).toBeNull();
    });

    expect(onMoveRoom).not.toHaveBeenCalled();
    expect(onReorderRoot).not.toHaveBeenCalled();
    expect(onReorderDesign).not.toHaveBeenCalled();
  });

  it('cancels the move if permission is lost mid-drag before release', async () => {
    const onReorderRoot = vi.fn();
    const onMoveRoom = vi.fn();
    let allowed = true;

    const renderGroup = () =>
      act(() => {
        root.render(
          <SortableRoomGroup canMoveRoom={() => allowed} onMoveRoom={onMoveRoom}>
            <TestSection spaceId="!root" roomIds={['!alder', '!birch']} onReorder={onReorderRoot} />
            <TestSection spaceId="!design" roomIds={['!cedar']} onReorder={vi.fn()} />
          </SortableRoomGroup>
        );
      });

    renderGroup();
    await dragRow('!alder', 40, 180, () => {
      expect(
        container
          .querySelector('[data-section-id="!design"]')!
          .getAttribute('data-section-drop-target')
      ).toBe('true');
      allowed = false;
      renderGroup();
      expect(container.querySelector('[data-section-drop-target="true"]')).toBeNull();
    });

    expect(onMoveRoom).not.toHaveBeenCalled();
    expect(onReorderRoot).not.toHaveBeenCalled();
  });

  it('clips section hit-testing to the visible scroll viewport and sticky header', async () => {
    const onMoveRoom = vi.fn();

    act(() => {
      root.render(
        <div data-rect-key="viewport" style={{ overflowY: 'auto' }}>
          <header data-rect-key="sticky-header" style={{ position: 'sticky', top: 0 }} />
          <div>
            <SortableRoomGroup canMoveRoom={() => true} onMoveRoom={onMoveRoom}>
              <TestSection spaceId="!root" roomIds={['!alder', '!birch']} onReorder={vi.fn()} />
              <TestSection spaceId="!design" roomIds={['!cedar']} onReorder={vi.fn()} />
            </SortableRoomGroup>
          </div>
        </div>
      );
    });

    // `!design` spans y=140..260, extending below the scroll viewport (y=0..200). Releasing in the
    // clipped overflow (e.g. over a footer below the scroll container) must not move the room.
    await dragRow('!birch', 80, 230, () => {
      expect(container.querySelector('[data-section-drop-target="true"]')).toBeNull();
    });
    expect(onMoveRoom).not.toHaveBeenCalled();

    // `!root` spans y=0..120, extending behind the sticky header (y=0..50). Releasing over the
    // sticky header must not move the room either.
    await dragRow('!cedar', 170, 30, () => {
      expect(container.querySelector('[data-section-drop-target="true"]')).toBeNull();
    });
    expect(onMoveRoom).not.toHaveBeenCalled();

    // Releasing inside each section's visible unclipped region still highlights and moves.
    await dragRow('!birch', 80, 180, () => {
      expect(
        container
          .querySelector('[data-section-id="!design"]')!
          .getAttribute('data-section-drop-target')
      ).toBe('true');
    });
    expect(onMoveRoom).toHaveBeenLastCalledWith('!root', '!design', '!birch');

    await dragRow('!cedar', 170, 80, () => {
      expect(
        container
          .querySelector('[data-section-id="!root"]')!
          .getAttribute('data-section-drop-target')
      ).toBe('true');
    });
    expect(onMoveRoom).toHaveBeenLastCalledWith('!design', '!root', '!cedar');
  });

  it('suppresses same-list drag hints, drop reorder, and keyboard reorder when reorderDisabled, while allowing cross-section moves', async () => {
    const onReorderRoot = vi.fn();
    const onMoveRoom = vi.fn();

    act(() => {
      root.render(
        <SortableRoomGroup canMoveRoom={() => true} onMoveRoom={onMoveRoom}>
          <TestSection
            spaceId="!root"
            roomIds={['!alder', '!birch']}
            onReorder={onReorderRoot}
            reorderDisabled
          />
          <TestSection spaceId="!design" roomIds={['!cedar']} onReorder={vi.fn()} />
        </SortableRoomGroup>
      );
    });

    // Keyboard Cmd/Ctrl+Shift+ArrowUp is suppressed.
    const birchLink = container.querySelector('a[href="#!birch"]') as HTMLElement;
    act(() => {
      birchLink.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowUp',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        })
      );
    });
    expect(onReorderRoot).not.toHaveBeenCalled();

    // Same-list drag from !birch over !alder shows no drop hint and does not reorder.
    await dragRow('!birch', 80, 40, () => {
      expect(container.querySelector('[data-drop-at]')).toBeNull();
    });
    expect(onReorderRoot).not.toHaveBeenCalled();

    // Cross-section drag from the reorderDisabled !root section into !design still works!
    await dragRow('!birch', 80, 180, () => {
      expect(
        container
          .querySelector('[data-section-id="!design"]')!
          .getAttribute('data-section-drop-target')
      ).toBe('true');
    });
    expect(onMoveRoom).toHaveBeenCalledWith('!root', '!design', '!birch');
    expect(onReorderRoot).not.toHaveBeenCalled();
  });

  it('suppresses same-list drag hints and reorder in a standalone single list (Home) when reorderDisabled', async () => {
    const onReorder = vi.fn();

    act(() => {
      root.render(
        <SortableRoomList
          listId="home"
          roomIds={['!alder', '!birch']}
          onReorder={onReorder}
          reorderDisabled
        >
          <SortableRoomRow room={room('!alder')} selected={false} linkPath="#!alder" />
          <SortableRoomRow room={room('!birch')} selected={false} linkPath="#!birch" />
        </SortableRoomList>
      );
    });

    await dragRow('!birch', 80, 40, () => {
      expect(container.querySelector('[data-drop-at]')).toBeNull();
    });
    expect(onReorder).not.toHaveBeenCalled();
  });
});
