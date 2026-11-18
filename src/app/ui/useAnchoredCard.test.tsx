// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnchoredCard } from './useAnchoredCard';

let rect = { x: 10, y: 20, width: 100, height: 16 };
let renders = 0;

// A trigger and, while open, a focusable card that shows the anchor's top.
function Harness({ closeDelayMs }: { closeDelayMs?: number }) {
  renders += 1;
  const { open, triggerRef, cardRef, toggle, pin, hover, onFocusLeave } =
    useAnchoredCard(closeDelayMs);
  return (
    <>
      <button
        ref={(node) => {
          if (node) node.getBoundingClientRect = () => ({ ...rect } as DOMRect);
          (triggerRef as React.MutableRefObject<HTMLButtonElement | null>).current = node;
        }}
        type="button"
        {...hover}
        onClick={toggle}
        onBlur={onFocusLeave}
      >
        Example trigger
      </button>
      {open && (
        <div ref={cardRef} data-testid="card" data-top={open.anchor.y} tabIndex={-1} onFocus={pin}>
          <button type="button">Example action</button>
        </div>
      )}
    </>
  );
}

const card = () => screen.queryByTestId('card');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  rect = { x: 10, y: 20, width: 100, height: 16 };
});

describe('useAnchoredCard', () => {
  it('follows the trigger once a frame with no render of its own, and stops once closed', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    render(<Harness />);
    fireEvent.click(screen.getByText('Example trigger'));
    const frame = () =>
      act(() => {
        vi.advanceTimersToNextFrame();
      });
    // The first frames measure the new card (a new anchor); React may render once more to find the
    // state unchanged before it bails out.
    for (let i = 0; i < 3; i += 1) frame();
    const settled = renders;
    for (let i = 0; i < 3; i += 1) frame();
    // Nothing moved: the same anchor, no render.
    expect(renders).toBe(settled);

    rect = { ...rect, y: 140 };
    frame();
    expect(card()?.dataset.top).toBe('140');

    // A trigger not displayed measures all zeros: the card stays where it was.
    rect = { x: 0, y: 0, width: 0, height: 0 };
    frame();
    expect(card()?.dataset.top).toBe('140');

    fireEvent.click(screen.getByText('Example trigger'));
    expect(card()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives focus in the card back to the trigger on Escape, and keeps that Escape from the room', () => {
    render(<Harness />);
    const trigger = screen.getByText('Example trigger');
    fireEvent.click(trigger);
    act(() => screen.getByText('Example action').focus());

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    act(() => {
      document.dispatchEvent(escape);
    });
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(escape.defaultPrevented).toBe(true);

    // Focus outside the card: the card closes and the room keeps its Escape.
    fireEvent.click(trigger);
    const later = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    act(() => {
      document.dispatchEvent(later);
    });
    expect(card()).toBeNull();
    expect(later.defaultPrevented).toBe(false);
  });
});
