// @vitest-environment jsdom
import { useRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type MotionPlay,
  ROW_HEIGHT,
  ROW_WIDTH,
  standInForListMotion,
} from './__tests__/listMotionStandIn';
import { LONGEST_PLAY_MS, MOST_ROWS_IN_MOTION, useListMotion } from './listMotion';

const GLIDE = { duration: 280, easing: 'cubic-bezier(0.2, 0, 0, 1)' };

function List({ order, pinned = [] }: { order: string[]; pinned?: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useListMotion(ref, [pinned.join(','), order.join(',')].join('|'));
  const row = (key: string) => <div key={key} data-motion-row={key} />;
  return (
    <div ref={ref} data-testid="list">
      {motion}
      {pinned.length > 0 && <section>{pinned.map(row)}</section>}
      {order.filter((key) => !pinned.includes(key)).map(row)}
    </div>
  );
}

let motion: ReturnType<typeof standInForListMotion>;
const raises = ({ keyframes }: MotionPlay) => 'zIndex' in (keyframes[0] ?? {});
/** What moved each row, by the row's key; a row that left plays as `(left)`. */
const playedByRow = () => {
  const byRow: Record<string, Keyframe[][]> = {};
  motion.plays
    .filter((play) => !raises(play))
    .forEach(({ element, keyframes }) => {
      (byRow[element.dataset.motionRow ?? '(left)'] ??= []).push(keyframes);
    });
  return byRow;
};
const glide = (from: number): Keyframe[] => [{ translate: `0px ${from}px` }, { translate: 'none' }];

beforeEach(() => {
  motion = standInForListMotion();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  motion.restore();
  Reflect.deleteProperty(window, 'matchMedia');
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('useListMotion', () => {
  it('plays each row that moved from where it was to where it is', () => {
    const { rerender } = render(<List order={['a', 'b', 'c']} />);
    expect(motion.plays).toEqual([]);

    rerender(<List order={['c', 'a', 'b']} />);

    // The last row starts two rows down, the others one row up.
    expect(playedByRow()).toEqual({ c: [glide(200)], a: [glide(-100)], b: [glide(-100)] });
    expect(motion.plays[0]?.options).toEqual(GLIDE);
  });

  it('raises the row that travels furthest over the others', () => {
    const { rerender } = render(<List order={['a', 'b', 'c']} />);
    rerender(<List order={['c', 'a', 'b']} />);

    expect(motion.plays.filter(raises).map(({ element }) => element.dataset.motionRow)).toEqual([
      'c',
    ]);
  });

  it('leaves a row that kept its place alone, and lets a new row in view enter', () => {
    const { rerender } = render(<List order={['a', 'b']} />);
    rerender(<List order={['a', 'b', 'new']} />);

    expect(Object.keys(playedByRow())).toEqual(['new']);
    expect(playedByRow().new?.[0]?.[0]).toMatchObject({ opacity: 0 });
  });

  it('fades a row that left where it stood, outside the rows, while the gap closes', async () => {
    const { rerender } = render(<List order={['a', 'b', 'c']} />);
    rerender(<List order={['a', 'c']} />);

    const list = screen.getByTestId('list');
    const [left] = motion.left();
    // First in the list, so the rows that close the gap pass over it.
    expect(list.firstElementChild).toBe(left);
    expect(left?.getAttribute('aria-hidden')).toBe('true');
    expect(left?.style).toMatchObject({
      position: 'absolute',
      top: '100px',
      left: '0px',
      width: '300px',
      height: '100px',
    });
    expect(playedByRow()).toMatchObject({ c: [glide(100)], '(left)': [[{}, { opacity: 0 }]] });
    expect(list.querySelectorAll('[data-motion-row]')).toHaveLength(2);

    await motion.finish();
    expect(left?.isConnected).toBe(false);
  });

  it('follows a row that moved under another parent', () => {
    const { rerender } = render(<List order={['a', 'b', 'c']} />);
    rerender(<List order={['a', 'b', 'c']} pinned={['c']} />);

    expect(playedByRow()).toEqual({ c: [glide(200)], a: [glide(-100)], b: [glide(-100)] });
  });

  it('plays nothing when no row in view stays: the list shows something else', () => {
    const { rerender } = render(<List order={['a', 'b']} />);
    rerender(<List order={['x', 'y']} />);

    expect(motion.plays).toEqual([]);
    expect(screen.getByTestId('list').querySelectorAll('[aria-hidden]')).toHaveLength(0);
  });

  it('leaves rows far out of view alone', () => {
    // The page is 768 pixels high: rows play up to half a page past it, the first twelve.
    const rows = Array.from({ length: 16 }, (_, index) => `row${index}`);
    const { rerender } = render(<List order={rows} />);
    rerender(<List order={[...rows.slice(0, 14), 'row15', 'row14']} />);

    expect(motion.plays).toEqual([]);
  });

  it('glides a row in from just past the view, where the rows that close a gap come from', () => {
    const rows = Array.from({ length: 16 }, (_, index) => `row${index}`);
    const { rerender } = render(<List order={rows} />);
    // The first row leaves: the ninth, which stood right under the view, moves up into it.
    rerender(<List order={rows.slice(1)} />);

    expect(playedByRow().row8).toEqual([glide(100)]);
  });

  it('plays and measures nothing in a list too long for a play to start within a frame', () => {
    const rows = Array.from({ length: MOST_ROWS_IN_MOTION + 1 }, (_, index) => `row${index}`);
    const { rerender } = render(<List order={rows} />);
    motion.rects.mockClear();
    rerender(<List order={rows.slice(1)} />);

    expect(motion.plays).toEqual([]);
    expect(motion.rects).not.toHaveBeenCalled();
    expect(screen.getByTestId('list').querySelectorAll('[aria-hidden]')).toHaveLength(0);
  });

  it('plays nothing when a change makes the list too long', () => {
    const rows = Array.from({ length: MOST_ROWS_IN_MOTION }, (_, index) => `row${index}`);
    const { rerender } = render(<List order={rows} />);
    rerender(<List order={['new', ...rows]} />);

    expect(motion.plays).toEqual([]);
  });

  it('finds a row that shows in view while it glides to a place far out of it', () => {
    // The list is scrolled ten rows down, and its first row still shows in view on its way up:
    // the rows do not show in the order the list holds them in.
    const rows = Array.from({ length: 20 }, (_, index) => `row${index}`);
    const { rerender } = render(<List order={rows} />);
    motion.rects.mockImplementation(function rect(this: HTMLElement) {
      const index = rows.indexOf(this.dataset.motionRow ?? '');
      const top = index === 0 ? 0 : (index - 10) * ROW_HEIGHT;
      const size = { width: ROW_WIDTH, height: ROW_HEIGHT };
      return { top, left: 0, bottom: top + ROW_HEIGHT, right: ROW_WIDTH, ...size } as DOMRect;
    });
    rerender(<List order={rows.slice(1)} />);

    // It left, and fades where it showed.
    expect(motion.left()).toHaveLength(1);
  });

  it('plays in the longest list that may', () => {
    const rows = Array.from({ length: MOST_ROWS_IN_MOTION }, (_, index) => `row${index}`);
    const { rerender } = render(<List order={rows} />);
    rerender(<List order={rows.slice(1)} />);

    expect(playedByRow().row1).toEqual([glide(100)]);
  });

  it('measures nothing while the order stays', () => {
    const { rerender } = render(<List order={['a', 'b']} />);
    motion.rects.mockClear();
    rerender(<List order={['a', 'b']} />);

    expect(motion.rects).not.toHaveBeenCalled();
  });

  it('ends the moves still running when the order changes again', () => {
    const { rerender } = render(<List order={['a', 'b']} />);
    rerender(<List order={['b', 'a']} />);
    expect(motion.cancel).not.toHaveBeenCalled();
    const running = motion.plays.length;

    rerender(<List order={['a', 'b']} />);

    expect(motion.cancel).toHaveBeenCalledTimes(running);
  });

  it('lets the play of a row that shows where it did run on, and starts the moved ones again', () => {
    // A filter change mounts its cards a chunk per task: each chunk restarted the glides the
    // browser had not started yet, and the cards jumped back to where they were for each one.
    const { rerender } = render(<List order={['a', 'b', 'c']} />);
    rerender(<List order={['c', 'a', 'b']} />);
    const playOf = (key: string) =>
      motion.plays.find((play) => !raises(play) && play.element.dataset.motionRow === key);
    const [c, a, b] = ['c', 'a', 'b'].map(playOf);

    rerender(<List order={['c', 'new', 'a', 'b']} />);

    expect(c?.animation.playState).toBe('running');
    expect(a?.animation.playState).toBe('idle');
    expect(b?.animation.playState).toBe('idle');
    // The rows that moved glide again from where they showed, the new one fades in.
    expect(playedByRow()).toMatchObject({
      a: [glide(-100), glide(-100)],
      new: [expect.anything()],
    });
    expect(playedByRow().c).toEqual([glide(200)]);
  });

  it('leaves the plays that ended alone', async () => {
    const { rerender } = render(<List order={['a', 'b']} />);
    rerender(<List order={['b', 'a']} />);
    await motion.finish();

    rerender(<List order={['a', 'b']} />);

    expect(motion.cancel).not.toHaveBeenCalled();
    expect(motion.glided().slice(-2).sort()).toEqual(['a', 'b']);
  });

  it('ends a play the browser does not end: no row stays away from its place or after it left', async () => {
    // On a phone, cards that left stayed where they stood. Whatever a browser does with an
    // animation, a row is not left as the play's first frame shows it.
    vi.useFakeTimers();
    const { rerender } = render(<List order={['a', 'b', 'c']} />);
    rerender(<List order={['a', 'c']} />);
    const [left] = motion.left();
    const running = motion.plays.length;
    expect(running).toBeGreaterThan(1);

    await vi.advanceTimersByTimeAsync(LONGEST_PLAY_MS - 1);
    expect(motion.cancel).not.toHaveBeenCalled();
    expect(left?.isConnected).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(motion.cancel).toHaveBeenCalledTimes(running);
    expect(left?.isConnected).toBe(false);
  });

  describe('under a press', () => {
    // jsdom has no PointerEvent: a mouse event of the pointer's type.
    const pointer = (type: string, target: Element, button = 0) =>
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, button }));
    const row = (key: string) =>
      screen.getByTestId('list').querySelector(`[data-motion-row="${key}"]`) as HTMLElement;
    const states = () => [...new Set(motion.plays.map(({ animation }) => animation.playState))];
    const reorder = () => {
      const { rerender } = render(<List order={['a', 'b', 'c']} />);
      rerender(<List order={['c', 'a', 'b']} />);
      expect(states()).toEqual(['running']);
    };

    it('holds every play where it shows until the click, so the pressed row gets it', () => {
      reorder();

      pointer('pointerdown', row('c'));
      expect(states()).toEqual(['paused']);

      // A finger's click comes after its pointerup, and is aimed anew then.
      pointer('pointerup', row('c'));
      expect(states()).toEqual(['paused']);

      pointer('click', row('c'));
      expect(states()).toEqual(['running']);
    });

    it('lets go when the press is cancelled, as when it became a scroll', () => {
      reorder();

      pointer('pointerdown', row('a'));
      pointer('pointercancel', row('a'));

      expect(states()).toEqual(['running']);
    });

    it('holds nothing for a press outside the list or with another button', () => {
      reorder();

      pointer('pointerdown', document.body);
      pointer('pointerdown', row('c'), 2);

      expect(states()).toEqual(['running']);
    });

    it('leaves a play that ended while it was held alone', async () => {
      vi.useFakeTimers();
      reorder();

      pointer('pointerdown', row('c'));
      // The list ends the plays the browser has not ended.
      await vi.advanceTimersByTimeAsync(LONGEST_PLAY_MS);
      pointer('click', row('c'));

      expect(states()).toEqual(['idle']);
    });

    it('lets go when the list goes during the press', () => {
      reorder();
      const { plays } = motion;

      pointer('pointerdown', row('c'));
      cleanup();

      expect([...new Set(plays.map(({ animation }) => animation.playState))]).toEqual(['running']);
    });
  });

  it('plays nothing with reduced motion', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query.includes('prefers-reduced-motion') }),
    });
    const { rerender } = render(<List order={['a', 'b']} />);
    rerender(<List order={['b', 'a']} />);

    expect(motion.plays).toEqual([]);
  });

  it('plays nothing in a page nobody sees, where a move would never end', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const { rerender } = render(<List order={['a', 'b', 'c']} />);
    rerender(<List order={['a', 'c']} />);

    expect(motion.plays).toEqual([]);
    expect(screen.getByTestId('list').querySelectorAll('[aria-hidden]')).toHaveLength(0);
  });

  it('does nothing where the browser has no Web Animations', () => {
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    const { rerender } = render(<List order={['a', 'b']} />);

    expect(() => rerender(<List order={['b', 'a']} />)).not.toThrow();
  });
});
