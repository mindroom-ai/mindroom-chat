// @vitest-environment jsdom
import { useRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type MotionPlay, standInForListMotion } from './__tests__/listMotionStandIn';
import { useListMotion } from './listMotion';

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
