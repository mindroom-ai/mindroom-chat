// @vitest-environment jsdom
import { useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockMedia, restoreMedia } from './__tests__/media';
import { GLIDE_EASING, GLIDE_MS } from './tourMotion';
import { useFlipList } from './useFlipList';

const ROW_HEIGHT = 100;

function List({ order, extra = '' }: { order: string[]; extra?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFlipList(ref, order.join(',') + extra);
  return (
    <div ref={ref}>
      {order.map((key) => (
        <div key={key} data-flip-key={key} />
      ))}
    </div>
  );
}

const animate = vi.fn();
const animated = () =>
  Object.fromEntries(
    animate.mock.contexts.map((element, call) => [
      (element as HTMLElement).dataset.flipKey,
      animate.mock.calls[call]?.[0] as Keyframe[],
    ])
  );

beforeEach(() => {
  // jsdom lays nothing out: a row's place is its place among its siblings.
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return Array.from(this.parentElement?.children ?? []).indexOf(this) * ROW_HEIGHT;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: animate,
  });
});

afterEach(() => {
  cleanup();
  animate.mockReset();
  restoreMedia();
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetTop');
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});

describe('useFlipList', () => {
  it('moves each row from its old place to its new one when the order changes', () => {
    const { rerender } = render(<List order={['a', 'b', 'c']} />);
    expect(animate).not.toHaveBeenCalled();

    rerender(<List order={['c', 'a', 'b']} />);

    // Each starts where it was: the last row two rows down, the others one row up.
    expect(animated()).toEqual({
      c: [{ transform: 'translateY(200px)' }, { transform: 'translateY(0)' }],
      a: [{ transform: 'translateY(-100px)' }, { transform: 'translateY(0)' }],
      b: [{ transform: 'translateY(-100px)' }, { transform: 'translateY(0)' }],
    });
    expect(animate.mock.calls[0]?.[1]).toEqual({ duration: GLIDE_MS, easing: GLIDE_EASING });
  });

  it('leaves a row that stays, and a row that is new, where they are', () => {
    const { rerender } = render(<List order={['a', 'b']} />);
    rerender(<List order={['a', 'new', 'b']} />);
    expect(Object.keys(animated())).toEqual(['b']);
  });

  it('closes the gap a removed row leaves', () => {
    const { rerender } = render(<List order={['a', 'b', 'c']} />);
    rerender(<List order={['b', 'c']} />);
    expect(Object.keys(animated())).toEqual(['b', 'c']);
  });

  it('moves nothing while the order stays', () => {
    const { rerender } = render(<List order={['a', 'b']} />);
    rerender(<List order={['a', 'b']} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('moves nothing with reduced motion', () => {
    mockMedia({ reducedMotion: true });
    const { rerender } = render(<List order={['a', 'b']} />);
    rerender(<List order={['b', 'a']} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('does nothing where the browser has no Web Animations', () => {
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    const { rerender } = render(<List order={['a', 'b']} />);
    expect(() => rerender(<List order={['b', 'a']} />)).not.toThrow();
  });
});
