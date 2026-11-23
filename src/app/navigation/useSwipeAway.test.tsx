// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type InteractiveSwipeBegin, type InteractiveSwipeScene } from './interactiveSwipe';
import { useSwipeAway } from './useSwipeAway';

function Panel({
  edge,
  onSwipe,
  enabled,
  begin,
}: {
  edge: 'start' | 'end';
  onSwipe: () => void;
  enabled?: boolean;
  begin?: InteractiveSwipeBegin;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useSwipeAway(ref, edge, onSwipe, { enabled, begin });
  return (
    <div ref={ref} data-testid="panel">
      <span data-testid="row">row</span>
    </div>
  );
}

const touch = (
  target: Element,
  type: string,
  point?: { x: number; y: number },
  timeStamp?: number
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = point ? [{ clientX: point.x, clientY: point.y }] : [];
  Object.defineProperty(event, 'touches', { value: touches });
  if (timeStamp !== undefined) {
    Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  }
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

  it('does not fire when disabled via options.enabled', () => {
    const onSwipe = vi.fn();
    const view = render(<Panel edge="end" onSwipe={onSwipe} enabled={false} />);
    swipe(view.getByTestId('row'), { x: 200, y: 300 }, { x: 300, y: 300 });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('tracks interactive finger movement, settles, and commits past threshold', async () => {
    const update = vi.fn();
    const settle = vi.fn().mockResolvedValue(undefined);
    const commit = vi.fn();
    const cleanupScene = vi.fn();
    const scene: InteractiveSwipeScene = {
      extent: 300,
      update,
      settle,
      commit,
      cleanup: cleanupScene,
    };
    const begin = vi.fn(() => scene);
    const onSwipe = vi.fn();

    const view = render(<Panel edge="start" onSwipe={onSwipe} begin={begin} />);
    const row = view.getByTestId('row');

    act(() => {
      touch(row, 'touchstart', { x: 260, y: 300 });
      touch(row, 'touchmove', { x: 250, y: 300 }); // locks at 10px
      touch(row, 'touchmove', { x: 100, y: 300 }); // offset = 150 (50% of 300)
      touch(row, 'touchend');
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(begin).toHaveBeenCalledWith({ axisSign: -1, dirSign: 1 });
    expect(update).toHaveBeenLastCalledWith(150, 0.5);
    expect(settle).toHaveBeenCalledWith(true, expect.any(Number), 150);
    expect(commit).toHaveBeenCalledOnce();
    expect(cleanupScene).toHaveBeenCalledWith(true);
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('cancels interactive drag below threshold without committing', async () => {
    const update = vi.fn();
    const settle = vi.fn().mockResolvedValue(undefined);
    const commit = vi.fn();
    const cleanupScene = vi.fn();
    const scene: InteractiveSwipeScene = {
      extent: 300,
      update,
      settle,
      commit,
      cleanup: cleanupScene,
    };

    const view = render(<Panel edge="end" onSwipe={vi.fn()} begin={() => scene} />);
    const row = view.getByTestId('row');

    act(() => {
      touch(row, 'touchstart', { x: 100, y: 300 }, 100);
      touch(row, 'touchmove', { x: 150, y: 300 }, 400); // slow drag: offset = 40 (< 35% of 300)
      touch(row, 'touchend', undefined, 420);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(update).toHaveBeenLastCalledWith(40, 40 / 300);
    expect(settle).toHaveBeenCalledWith(false, expect.any(Number), 40);
    expect(commit).not.toHaveBeenCalled();
    expect(cleanupScene).toHaveBeenCalledWith(false);
  });

  it('leaves the drag of the account quick switcher alone', () => {
    const { onSwipe, row } = setup('start');
    const quickMenu = document.createElement('div');
    quickMenu.setAttribute('role', 'menu');
    quickMenu.setAttribute('data-quick-account-menu', '');

    try {
      // A finger holds the avatar in the panel, the quick menu opens, and the finger drags
      // toward the panel's edge to an account; the menu closes as it lifts.
      touch(row, 'touchstart', { x: 200, y: 300 });
      document.body.append(quickMenu);
      touch(row, 'touchmove', { x: 100, y: 300 });
      quickMenu.remove();
      touch(row, 'touchend');
      expect(onSwipe).not.toHaveBeenCalled();

      // The same while the menu is still open at the lift, and for a touch that starts under it.
      touch(row, 'touchstart', { x: 200, y: 300 });
      document.body.append(quickMenu);
      touch(row, 'touchmove', { x: 100, y: 300 });
      touch(row, 'touchend');
      swipe(row, { x: 200, y: 300 }, { x: 100, y: 300 });
      expect(onSwipe).not.toHaveBeenCalled();

      // Once it is gone the panel swipes away again.
      quickMenu.remove();
      swipe(row, { x: 200, y: 300 }, { x: 100, y: 300 });
      expect(onSwipe).toHaveBeenCalledTimes(1);
    } finally {
      quickMenu.remove();
    }
  });

  it.each(['alertdialog', 'menu', 'dialog'])(
    'still swipes away while another layer is open, such as an incoming-call card (%s)',
    (role) => {
      const { onSwipe, row } = setup('start');
      const layer = document.createElement('div');
      layer.setAttribute('role', role);
      document.body.append(layer);
      try {
        swipe(row, { x: 200, y: 300 }, { x: 100, y: 300 });
        expect(onSwipe).toHaveBeenCalledTimes(1);
      } finally {
        layer.remove();
      }
    }
  );
});
