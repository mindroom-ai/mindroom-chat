// @vitest-environment jsdom
import { useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSwipeAway } from './useSwipeAway';

function Panel({ edge, onSwipe }: { edge: 'start' | 'end'; onSwipe: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useSwipeAway(ref, edge, onSwipe);
  return (
    <div ref={ref} data-testid="panel">
      <span data-testid="row">row</span>
    </div>
  );
}

const touch = (target: Element, type: string, point?: { x: number; y: number }) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = point ? [{ clientX: point.x, clientY: point.y }] : [];
  Object.defineProperty(event, 'touches', { value: touches });
  target.dispatchEvent(event);
};

/** A finger that lands at `from`, moves to `to` and lifts, on a row inside the panel. */
const swipe = (target: Element, from: { x: number; y: number }, to: { x: number; y: number }) => {
  touch(target, 'touchstart', from);
  touch(target, 'touchmove', to);
  touch(target, 'touchend');
};

const setup = (edge: 'start' | 'end', direction: 'ltr' | 'rtl' = 'ltr') => {
  const onSwipe = vi.fn();
  const view = render(<Panel edge={edge} onSwipe={onSwipe} />);
  view.getByTestId('panel').style.direction = direction;
  return { onSwipe, row: view.getByTestId('row') };
};

afterEach(cleanup);

describe('useSwipeAway', () => {
  it('puts a panel from the start edge away on a swipe of 56 px toward that edge', () => {
    const { onSwipe, row } = setup('start');
    swipe(row, { x: 200, y: 300 }, { x: 160, y: 300 });
    expect(onSwipe).not.toHaveBeenCalled();
    swipe(row, { x: 200, y: 300 }, { x: 144, y: 310 });
    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  it('puts a panel from the end edge away on a swipe toward the end edge only', () => {
    const { onSwipe, row } = setup('end');
    swipe(row, { x: 200, y: 300 }, { x: 120, y: 300 });
    expect(onSwipe).not.toHaveBeenCalled();
    swipe(row, { x: 200, y: 300 }, { x: 260, y: 300 });
    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  it('leaves a swipe that goes more up or down than sideways to the list', () => {
    const { onSwipe, row } = setup('end');
    swipe(row, { x: 200, y: 300 }, { x: 270, y: 400 });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('mirrors the edges right to left', () => {
    const { onSwipe, row } = setup('end', 'rtl');
    swipe(row, { x: 200, y: 300 }, { x: 260, y: 300 });
    expect(onSwipe).not.toHaveBeenCalled();
    swipe(row, { x: 200, y: 300 }, { x: 140, y: 300 });
    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  it('counts a lift the browser reports as a cancel', () => {
    const { onSwipe, row } = setup('end');
    touch(row, 'touchstart', { x: 200, y: 300 });
    touch(row, 'touchmove', { x: 270, y: 300 });
    touch(row, 'touchcancel');
    expect(onSwipe).toHaveBeenCalledTimes(1);
  });
});
