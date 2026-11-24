// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TimelineMinimap } from './TimelineMinimap';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ITEMS = [
  { id: '$a', userText: 'First turn', agentText: 'First reply' },
  { id: '$b', userText: 'Second turn', agentText: 'Second reply' },
  { id: '$c', userText: 'Third turn', agentText: 'Third reply' },
];

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
    vi.useFakeTimers();
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

    // Releasing outside clears the preview, releases selection block, and eats the trailing click.
    fireEvent.pointerUp(rail, { ...p, clientX: 120, clientY: 200 });
    expect(selectionBlocked()).toBe(false);
    expect(screen.queryByText('Third turn')).toBeNull();
    fireEvent.click(rail, { clientX: 8, clientY: 200 });
    expect(onSelect).toHaveBeenCalledTimes(1);

    // After the suppression window clears, a standalone click selects again.
    act(() => {
      vi.runAllTimers();
    });
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
});
