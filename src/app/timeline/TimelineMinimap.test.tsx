// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TimelineMinimap, useTimelineMinimapInView } from './TimelineMinimap';
import {
  TIMELINE_MINIMAP_MAX_SLOTS,
  TimelineMinimapItem,
  resolveTimelineMinimapSlotIndex,
} from './timelineMinimapViewModel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ITEMS = [
  { id: '$a', userText: 'First turn', agentText: 'First reply' },
  { id: '$b', userText: 'Second turn', agentText: 'Second reply' },
  { id: '$c', userText: 'Third turn', agentText: 'Third reply' },
];

const makeItems = (count: number): TimelineMinimapItem[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `$m${index}`,
    userText: `Turn ${index + 1}`,
    agentText: `Reply ${index + 1}`,
  }));

const mockRailRect = (rail: HTMLElement) => {
  rail.getBoundingClientRect = () =>
    ({ left: 0, right: 16, top: 100, bottom: 200, width: 16, height: 100 }) as DOMRect;
  rail.setPointerCapture = vi.fn();
  rail.hasPointerCapture = vi.fn(() => true);
  rail.releasePointerCapture = vi.fn();
};

const selectionBlocked = () => document.documentElement.hasAttribute('data-drag-no-select');

describe('TimelineMinimap', () => {
  it('jumps on a plain Space or Enter, never on a chord, which it still cancels, or a key another listener took', () => {
    const onSelect = vi.fn();
    const items = ['$a', '$b'].map((id) => ({ id, userText: id, agentText: null }));
    render(<TimelineMinimap items={items} stripMap={new Map()} onSelect={onSelect} />);
    const rail = screen.getByRole('slider');
    fireEvent.focus(rail);
    // fireEvent is false when the event was cancelled: the button's click on release never comes.
    expect(
      fireEvent.keyDown(rail, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true })
    ).toBe(false);
    expect(fireEvent.keyDown(rail, { key: 'Enter', code: 'Enter', metaKey: true })).toBe(false);
    const taken = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener('keydown', taken, true);
    fireEvent.keyDown(rail, { key: ' ', code: 'Space' });
    window.removeEventListener('keydown', taken, true);
    expect(onSelect).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(rail, { key: ' ', code: 'Space' })).toBe(false);
    fireEvent.keyDown(rail, { key: 'Enter', code: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('scrubs across stripes during drag, keeps preview open off-rail, and suppresses the trailing click', () => {
    const onSelect = vi.fn();
    const onScrub = vi.fn();
    render(
      <TimelineMinimap items={ITEMS} stripMap={new Map()} onSelect={onSelect} onScrub={onScrub} />
    );
    const rail = screen.getByRole('slider');
    mockRailRect(rail);

    const p = { pointerId: 1, isPrimary: true, button: 0, buttons: 1 };
    expect(fireEvent.pointerDown(rail, { ...p, clientX: 8, clientY: 100 })).toBe(false);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(ITEMS[0]);
    expect(onScrub).not.toHaveBeenCalled();
    expect(selectionBlocked()).toBe(true);
    expect(screen.getByText('First turn')).toBeTruthy();

    // Moving horizontally off the rail and staying within the same stripe does not re-fire.
    fireEvent.pointerLeave(rail, { ...p, clientX: 120, clientY: 105 });
    fireEvent.mouseLeave(rail);
    fireEvent.pointerMove(rail, { ...p, clientX: 120, clientY: 110 });
    expect(onScrub).not.toHaveBeenCalled();
    expect(screen.getByText('First turn')).toBeTruthy();

    // Dragging across stripes fires onScrub once per newly entered item.
    fireEvent.pointerMove(rail, { ...p, clientX: 120, clientY: 150 });
    fireEvent.pointerMove(rail, { ...p, clientX: 120, clientY: 155 });
    fireEvent.pointerMove(rail, { ...p, clientX: 120, clientY: 200 });
    expect(onScrub.mock.calls).toEqual([[ITEMS[1]], [ITEMS[2]]]);
    expect(screen.getByText('Third turn')).toBeTruthy();

    // Releasing outside clears the preview, releases selection block, and ignores the trailing pointer click.
    fireEvent.pointerUp(rail, { ...p, clientX: 120, clientY: 200 });
    expect(selectionBlocked()).toBe(false);
    expect(screen.queryByText('Third turn')).toBeNull();
    fireEvent.click(rail, { detail: 1, clientX: 8, clientY: 200 });
    expect(onSelect).toHaveBeenCalledTimes(1);

    // A standalone programmatic/assistive click (detail === 0) selects.
    fireEvent.click(rail, { clientX: 8, clientY: 150 });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith(ITEMS[1]);
  });

  it('keeps hover preview open when releasing inside the rail and falls back to onSelect when onScrub is omitted', () => {
    const onSelect = vi.fn();
    render(<TimelineMinimap items={ITEMS} stripMap={new Map()} onSelect={onSelect} />);
    const rail = screen.getByRole('slider');
    mockRailRect(rail);

    const p = { pointerId: 2, isPrimary: true, button: 0, buttons: 1 };
    fireEvent.pointerDown(rail, { ...p, clientX: 8, clientY: 100 });
    fireEvent.pointerMove(rail, { ...p, clientX: 8, clientY: 150 });
    expect(onSelect.mock.calls).toEqual([[ITEMS[0]], [ITEMS[1]]]);

    fireEvent.pointerUp(rail, { ...p, clientX: 8, clientY: 150 });
    expect(selectionBlocked()).toBe(false);
    expect(screen.getByText('Second turn')).toBeTruthy();

    fireEvent.mouseLeave(rail);
    expect(screen.queryByText('Second turn')).toBeNull();
  });

  it.each(['pointerCancel', 'lostPointerCapture', 'unmount'] as const)(
    'cleans up active drag and selection block on %s',
    (end) => {
      const { unmount } = render(
        <TimelineMinimap items={ITEMS} stripMap={new Map()} onSelect={vi.fn()} />
      );
      const rail = screen.getByRole('slider');
      mockRailRect(rail);

      const p = { pointerId: 3, isPrimary: true, button: 0, buttons: 1 };
      fireEvent.pointerDown(rail, { ...p, clientX: 8, clientY: 100 });
      expect(selectionBlocked()).toBe(true);
      expect(screen.getByText('First turn')).toBeTruthy();

      if (end === 'unmount') {
        unmount();
      } else if (end === 'pointerCancel') {
        fireEvent.pointerCancel(rail, p);
      } else {
        fireEvent.lostPointerCapture(rail, p);
      }
      expect(selectionBlocked()).toBe(false);
      expect(screen.queryByText('First turn')).toBeNull();
    }
  );

  it('ignores non-primary presses and drags crossing the rail while allowing standalone clicks', () => {
    const onSelect = vi.fn();
    const onScrub = vi.fn();
    render(
      <TimelineMinimap items={ITEMS} stripMap={new Map()} onSelect={onSelect} onScrub={onScrub} />
    );
    const rail = screen.getByRole('slider');
    mockRailRect(rail);

    fireEvent.pointerDown(rail, { pointerId: 1, isPrimary: true, button: 2, clientY: 100 });
    fireEvent.pointerDown(rail, { pointerId: 2, isPrimary: false, button: 0, clientY: 100 });
    fireEvent.pointerMove(rail, { pointerId: 1, isPrimary: true, buttons: 1, clientY: 150 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onScrub).not.toHaveBeenCalled();
    expect(selectionBlocked()).toBe(false);
    expect(screen.queryByText('Second turn')).toBeNull();

    // Plain hover with no button held shows the preview; standalone click selects without pointerdown.
    fireEvent.pointerMove(rail, { pointerId: 1, isPrimary: true, buttons: 0, clientY: 150 });
    expect(screen.getByText('Second turn')).toBeTruthy();
    fireEvent.click(rail, { clientX: 8, clientY: 200 });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(ITEMS[2]);
  });

  it('forwards vertical wheel events to scrollRef while ignoring horizontal and pinch-zoom gestures', () => {
    const scrollElement = document.createElement('div');
    Object.defineProperty(scrollElement, 'clientHeight', { value: 400, configurable: true });
    scrollElement.scrollTop = 100;
    const scrollRef = { current: scrollElement };
    const parentWheel = vi.fn();

    const { container, rerender } = render(
      <TimelineMinimap
        items={[ITEMS[0]!]}
        stripMap={new Map()}
        scrollRef={scrollRef}
        onSelect={vi.fn()}
      />
    );
    expect(screen.queryByRole('slider')).toBeNull();

    // Mounting after starting hidden must still attach the wheel listener.
    rerender(
      <TimelineMinimap
        items={ITEMS}
        stripMap={new Map()}
        scrollRef={scrollRef}
        onSelect={vi.fn()}
      />
    );
    container.addEventListener('wheel', parentWheel);
    const rail = screen.getByRole('slider');

    const pixelEvent = new WheelEvent('wheel', {
      deltaY: 120,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      cancelable: true,
      bubbles: true,
    });
    rail.dispatchEvent(pixelEvent);
    expect(pixelEvent.defaultPrevented).toBe(true);
    expect(scrollElement.scrollTop).toBe(220);

    const lineEvent = new WheelEvent('wheel', {
      deltaY: 3,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
      cancelable: true,
      bubbles: true,
    });
    rail.dispatchEvent(lineEvent);
    expect(lineEvent.defaultPrevented).toBe(true);
    expect(scrollElement.scrollTop).toBe(268);

    const pageEvent = new WheelEvent('wheel', {
      deltaY: -0.5,
      deltaMode: WheelEvent.DOM_DELTA_PAGE,
      cancelable: true,
      bubbles: true,
    });
    rail.dispatchEvent(pageEvent);
    expect(pageEvent.defaultPrevented).toBe(true);
    expect(scrollElement.scrollTop).toBe(68);
    expect(parentWheel).toHaveBeenCalledTimes(3);

    const horizontalEvent = new WheelEvent('wheel', {
      deltaX: 50,
      deltaY: 10,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      cancelable: true,
      bubbles: true,
    });
    rail.dispatchEvent(horizontalEvent);
    expect(horizontalEvent.defaultPrevented).toBe(false);
    expect(scrollElement.scrollTop).toBe(68);

    const ctrlPinchEvent = new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: 40,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      cancelable: true,
      bubbles: true,
    });
    rail.dispatchEvent(ctrlPinchEvent);
    expect(ctrlPinchEvent.defaultPrevented).toBe(false);
    expect(scrollElement.scrollTop).toBe(68);

    const metaPinchEvent = new WheelEvent('wheel', {
      metaKey: true,
      deltaY: 40,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      cancelable: true,
      bubbles: true,
    });
    rail.dispatchEvent(metaPinchEvent);
    expect(metaPinchEvent.defaultPrevented).toBe(false);
    expect(scrollElement.scrollTop).toBe(68);

    const zeroEvent = new WheelEvent('wheel', {
      deltaY: 0,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      cancelable: true,
      bubbles: true,
    });
    rail.dispatchEvent(zeroEvent);
    expect(zeroEvent.defaultPrevented).toBe(false);
    expect(scrollElement.scrollTop).toBe(68);
  });

  it('selects once without entering a stuck drag when setPointerCapture throws', () => {
    const onSelect = vi.fn();
    const onScrub = vi.fn();
    render(
      <TimelineMinimap items={ITEMS} stripMap={new Map()} onSelect={onSelect} onScrub={onScrub} />
    );
    const rail = screen.getByRole('slider');
    mockRailRect(rail);
    rail.setPointerCapture = vi.fn(() => {
      throw new DOMException('No active pointer', 'NotFoundError');
    });

    const p = { pointerId: 99, isPrimary: true, button: 0, buttons: 1 };
    fireEvent.pointerDown(rail, { ...p, clientX: 8, clientY: 100 });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(ITEMS[0]);
    expect(selectionBlocked()).toBe(false);

    // Subsequent pointermove does not scrub because drag was never entered.
    fireEvent.pointerMove(rail, { ...p, clientX: 8, clientY: 200 });
    expect(onScrub).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);

    // Hover state can still clear normally on pointer leave.
    fireEvent.pointerLeave(rail, p);
    expect(screen.queryByText('First turn')).toBeNull();
  });

  it('continues into drag normally when setPointerCapture is undefined', () => {
    const onSelect = vi.fn();
    const onScrub = vi.fn();
    render(
      <TimelineMinimap items={ITEMS} stripMap={new Map()} onSelect={onSelect} onScrub={onScrub} />
    );
    const rail = screen.getByRole('slider');
    rail.getBoundingClientRect = () =>
      ({ left: 0, right: 16, top: 100, bottom: 200, width: 16, height: 100 }) as DOMRect;
    Object.defineProperty(rail, 'setPointerCapture', { value: undefined, configurable: true });

    const p = { pointerId: 7, isPrimary: true, button: 0, buttons: 1 };
    fireEvent.pointerDown(rail, { ...p, clientX: 8, clientY: 100 });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(selectionBlocked()).toBe(true);

    fireEvent.pointerMove(rail, { ...p, clientX: 8, clientY: 200 });
    expect(onScrub).toHaveBeenCalledWith(ITEMS[2]);

    fireEvent.pointerUp(rail, { ...p, clientX: 8, clientY: 200 });
    expect(selectionBlocked()).toBe(false);
  });

  it('toggles data-expanded on hover, drag, focus, blur, and pointer leave', () => {
    render(<TimelineMinimap items={ITEMS} stripMap={new Map()} onSelect={vi.fn()} />);
    const rail = screen.getByRole('slider');
    mockRailRect(rail);

    expect(rail.getAttribute('data-expanded')).toBe('false');

    fireEvent.pointerMove(rail, { pointerId: 1, isPrimary: true, buttons: 0, clientY: 150 });
    expect(rail.getAttribute('data-expanded')).toBe('true');
    fireEvent.pointerLeave(rail, { pointerId: 1 });
    expect(rail.getAttribute('data-expanded')).toBe('false');

    fireEvent.focus(rail);
    expect(rail.getAttribute('data-expanded')).toBe('true');
    fireEvent.blur(rail);
    expect(rail.getAttribute('data-expanded')).toBe('false');

    const p = { pointerId: 2, isPrimary: true, button: 0, buttons: 1 };
    fireEvent.pointerDown(rail, { ...p, clientX: 8, clientY: 100 });
    expect(rail.getAttribute('data-expanded')).toBe('true');
    fireEvent.pointerUp(rail, { ...p, clientX: 120, clientY: 100 });
    expect(rail.getAttribute('data-expanded')).toBe('false');
  });

  it('caps rendered stripes at 44, shows position counter only when bucketed, and scrubs exact items', () => {
    const onSelect = vi.fn();
    const onScrub = vi.fn();
    const stripMap = new Map<string, HTMLSpanElement>();
    const exactCapItems = makeItems(TIMELINE_MINIMAP_MAX_SLOTS);
    const { container, rerender } = render(
      <TimelineMinimap
        items={exactCapItems}
        stripMap={stripMap}
        onSelect={onSelect}
        onScrub={onScrub}
      />
    );
    const rail = screen.getByRole('slider');
    mockRailRect(rail);

    expect(container.querySelectorAll('[data-minimap-strip]')).toHaveLength(
      TIMELINE_MINIMAP_MAX_SLOTS
    );
    fireEvent.focus(rail);
    expect(screen.getByText('Turn 1')).toBeTruthy();
    expect(screen.queryByText(`1 / ${TIMELINE_MINIMAP_MAX_SLOTS}`)).toBeNull();
    fireEvent.blur(rail);

    const largeItems = makeItems(200);
    rerender(
      <TimelineMinimap
        items={largeItems}
        stripMap={stripMap}
        onSelect={onSelect}
        onScrub={onScrub}
      />
    );
    expect(container.querySelectorAll('[data-minimap-strip]')).toHaveLength(
      TIMELINE_MINIMAP_MAX_SLOTS
    );
    expect(stripMap.size).toBe(TIMELINE_MINIMAP_MAX_SLOTS);
    expect(rail.getAttribute('aria-valuemax')).toBe('199');
    expect(rail.style.height).toContain('344px');

    const p = { pointerId: 4, isPrimary: true, button: 0, buttons: 1 };
    fireEvent.pointerDown(rail, { ...p, clientX: 8, clientY: 100 });
    expect(onSelect).toHaveBeenCalledWith(largeItems[0]);
    expect(screen.getByText('1 / 200')).toBeTruthy();

    fireEvent.pointerMove(rail, { ...p, clientX: 8, clientY: 150 });
    expect(onScrub).toHaveBeenLastCalledWith(largeItems[100]);
    expect(screen.getByText('101 / 200')).toBeTruthy();
    expect(screen.getByText('Turn 101')).toBeTruthy();

    fireEvent.pointerMove(rail, { ...p, clientX: 8, clientY: 200 });
    expect(onScrub).toHaveBeenLastCalledWith(largeItems[199]);
    expect(screen.getByText('200 / 200')).toBeTruthy();
    expect(screen.getByText('Turn 200')).toBeTruthy();

    fireEvent.pointerUp(rail, { ...p, clientX: 120, clientY: 200 });
    expect(screen.queryByText('200 / 200')).toBeNull();

    fireEvent.focus(rail);
    fireEvent.keyDown(rail, { key: 'ArrowDown' });
    expect(screen.getByText('2 / 200')).toBeTruthy();
    fireEvent.keyDown(rail, { key: 'End' });
    expect(screen.getByText('200 / 200')).toBeTruthy();
  });

  it('lights up the bucketed slot when a member item is in view and clears it when scrolled away', () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const flushRaf = () => {
      while (rafQueue.length > 0) {
        rafQueue.shift()!(0);
      }
    };

    const items = makeItems(200);
    let scrollOffset = 10000;

    function InViewHarness() {
      const scrollRef = useRef<HTMLDivElement>(null);
      const [stripMap] = useState(() => new Map<string, HTMLSpanElement>());
      useTimelineMinimapInView(scrollRef, items, stripMap, true);
      return (
        <>
          <div ref={scrollRef} data-testid="scroll-root">
            {items.map((item) => (
              <div key={item.id} data-message-id={item.id} />
            ))}
          </div>
          <TimelineMinimap items={items} stripMap={stripMap} onSelect={vi.fn()} />
        </>
      );
    }

    const { container } = render(<InViewHarness />);
    const scrollRoot = screen.getByTestId('scroll-root');
    scrollRoot.getBoundingClientRect = () =>
      ({ top: 0, bottom: 100, left: 0, right: 400, width: 400, height: 100 }) as DOMRect;
    scrollRoot.querySelectorAll<HTMLElement>('[data-message-id]').forEach((node, index) => {
      node.getBoundingClientRect = () =>
        ({
          top: index * 100 - scrollOffset,
          bottom: (index + 1) * 100 - scrollOffset,
          left: 0,
          right: 400,
          width: 400,
          height: 100,
        }) as DOMRect;
    });

    const strips = Array.from(container.querySelectorAll<HTMLSpanElement>('[data-minimap-strip]'));
    const midSlot = resolveTimelineMinimapSlotIndex(100, items.length, TIMELINE_MINIMAP_MAX_SLOTS);
    const lastSlot = TIMELINE_MINIMAP_MAX_SLOTS - 1;

    flushRaf();
    expect(strips[midSlot]?.dataset.inView).toBe('true');
    expect(strips[0]?.dataset.inView).toBe('false');
    expect(strips[lastSlot]?.dataset.inView).toBe('false');

    scrollOffset = 19900;
    fireEvent.scroll(scrollRoot);
    flushRaf();
    expect(strips[midSlot]?.dataset.inView).toBe('false');
    expect(strips[lastSlot]?.dataset.inView).toBe('true');
  });
});
