// @vitest-environment jsdom
import { useRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useListMotion } from './listMotion';

const ROW_HEIGHT = 100;
const ROW_WIDTH = 300;
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

type Played = { element: HTMLElement; keyframes: Keyframe[]; options: KeyframeAnimationOptions };
let played: Played[] = [];
let finishAll: (() => void)[] = [];
const cancel = vi.fn();

const raises = ({ keyframes }: Played) => 'zIndex' in (keyframes[0] ?? {});
/** What moved each row, by the row's key; a row that left plays as `(left)`. */
const playedByRow = () => {
  const byRow: Record<string, Keyframe[][]> = {};
  played
    .filter((entry) => !raises(entry))
    .forEach(({ element, keyframes }) => {
      (byRow[element.dataset.motionRow ?? '(left)'] ??= []).push(keyframes);
    });
  return byRow;
};
const glide = (from: number): Keyframe[] => [{ translate: `0px ${from}px` }, { translate: 'none' }];
const rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');

beforeEach(() => {
  played = [];
  finishAll = [];
  // jsdom lays nothing out: a row's place is its place among the rows, in one column.
  rects.mockImplementation(function rect(this: HTMLElement) {
    const index = [...document.querySelectorAll('[data-motion-row]')].indexOf(this);
    const top = Math.max(index, 0) * ROW_HEIGHT;
    const size = index < 0 ? { width: 0, height: 0 } : { width: ROW_WIDTH, height: ROW_HEIGHT };
    return { top, left: 0, bottom: top + size.height, right: size.width, ...size } as DOMRect;
  });
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    writable: true,
    value(this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      played.push({ element: this, keyframes, options });
      const finished = new Promise<void>((resolve) => {
        finishAll.push(resolve);
      });
      return { finished, cancel };
    },
  });
});

afterEach(() => {
  cleanup();
  cancel.mockReset();
  rects.mockReset();
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  Reflect.deleteProperty(window, 'matchMedia');
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('useListMotion', () => {
  it('plays each row that moved from where it was to where it is', () => {
    const { rerender } = render(<List order={['a', 'b', 'c']} />);
    expect(played).toEqual([]);

    rerender(<List order={['c', 'a', 'b']} />);

    // The last row starts two rows down, the others one row up.
    expect(playedByRow()).toMatchObject({ c: [glide(200)], a: [glide(-100)], b: [glide(-100)] });
    expect(played[0]?.options).toEqual(GLIDE);
  });

  it('raises the row that travels furthest over the others', () => {
    const { rerender } = render(<List order={['a', 'b', 'c']} />);
    rerender(<List order={['c', 'a', 'b']} />);

    expect(played.filter(raises).map(({ element }) => element.dataset.motionRow)).toEqual(['c']);
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
    const left = played.find(({ element }) => !element.dataset.motionRow)?.element;
    // First in the list, so the rows that close the gap pass over it.
    expect(list.firstElementChild).toBe(left);
    expect(left?.getAttribute('aria-hidden')).toBe('true');
    expect(left?.hasAttribute('inert')).toBe(true);
    expect(left?.style).toMatchObject({
      position: 'absolute',
      top: '100px',
      left: '0px',
      width: '300px',
      height: '100px',
    });
    expect(playedByRow()).toMatchObject({ c: [glide(100)], '(left)': [[{}, { opacity: 0 }]] });
    expect(list.querySelectorAll('[data-motion-row]')).toHaveLength(2);

    finishAll.forEach((finish) => finish());
    await Promise.resolve();
    expect(left?.isConnected).toBe(false);
  });

  it('follows a row that moved under another parent', () => {
    const { rerender } = render(<List order={['a', 'b', 'c']} />);
    rerender(<List order={['a', 'b', 'c']} pinned={['c']} />);

    expect(playedByRow()).toMatchObject({ c: [glide(200)], a: [glide(-100)], b: [glide(-100)] });
    expect(playedByRow()['(left)']).toBeUndefined();
  });

  it('plays nothing when no row in view stays: the list shows something else', () => {
    const { rerender } = render(<List order={['a', 'b']} />);
    rerender(<List order={['x', 'y']} />);

    expect(played).toEqual([]);
    expect(screen.getByTestId('list').querySelectorAll('[aria-hidden]')).toHaveLength(0);
  });

  it('leaves rows out of view alone', () => {
    // The page is 768 pixels high: the ninth row and those after it are below it.
    const rows = Array.from({ length: 12 }, (_, index) => `row${index}`);
    const { rerender } = render(<List order={rows} />);
    const swapped = [...rows.slice(0, 10), 'row11', 'row10'];
    rerender(<List order={swapped} />);

    expect(played).toEqual([]);
  });

  it('measures nothing while the order stays', () => {
    const { rerender } = render(<List order={['a', 'b']} />);
    rects.mockClear();
    rerender(<List order={['a', 'b']} />);

    expect(rects).not.toHaveBeenCalled();
  });

  it('ends the moves still running when the order changes again', () => {
    const { rerender } = render(<List order={['a', 'b']} />);
    rerender(<List order={['b', 'a']} />);
    expect(cancel).not.toHaveBeenCalled();
    const running = played.length;

    rerender(<List order={['a', 'b']} />);

    expect(cancel).toHaveBeenCalledTimes(running);
  });

  it('plays nothing with reduced motion', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query.includes('prefers-reduced-motion') }),
    });
    const { rerender } = render(<List order={['a', 'b']} />);
    rerender(<List order={['b', 'a']} />);

    expect(played).toEqual([]);
  });

  it('plays nothing in a page nobody sees, where a move would never end', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const { rerender } = render(<List order={['a', 'b', 'c']} />);
    rerender(<List order={['a', 'c']} />);

    expect(played).toEqual([]);
    expect(screen.getByTestId('list').querySelectorAll('[aria-hidden]')).toHaveLength(0);
  });

  it('does nothing where the browser has no Web Animations', () => {
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    const { rerender } = render(<List order={['a', 'b']} />);

    expect(() => rerender(<List order={['b', 'a']} />)).not.toThrow();
  });
});
