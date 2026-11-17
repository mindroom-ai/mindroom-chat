// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSlidingPill } from './useSlidingPill';

// Frames run only when a test says so, at 60 Hz.
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let clock: number;
const runFrame = () => {
  clock += 1000 / 60;
  const due = [...frames.values()];
  frames.clear();
  due.forEach((callback) => callback(clock));
};
const runUntilStill = () => {
  for (let count = 0; count < 120 && frames.size > 0; count += 1) runFrame();
};

let resize: () => void;
let disconnected: boolean;

// A group of two tabs whose boxes the test sets; jsdom lays nothing out.
const boxes = new Map<HTMLElement, { left: number; width: number }>();
const tab = (left: number, width: number) => {
  const button = document.createElement('button');
  boxes.set(button, { left, width });
  Object.defineProperty(button, 'offsetLeft', { get: () => boxes.get(button)!.left });
  Object.defineProperty(button, 'offsetWidth', { get: () => boxes.get(button)!.width });
  return button;
};
let group: HTMLDivElement;
let pill: HTMLSpanElement;
let a: HTMLButtonElement;
let b: HTMLButtonElement;
const press = (pressed: HTMLButtonElement) =>
  [a, b].forEach((button) => button.setAttribute('aria-pressed', String(button === pressed)));
const reduceMotion = (reduce: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('reduce'),
  })) as never;
};

function Harness({ selected }: { selected: string }) {
  useSlidingPill(groupRef, pillRef, selected);
  return null;
}
const groupRef: { current: HTMLElement | null } = { current: null };
const pillRef: { current: HTMLElement | null } = { current: null };

let renderer: ReactTestRenderer | undefined;
const mount = (selected: string) => {
  act(() => {
    if (renderer) renderer.update(<Harness selected={selected} />);
    else renderer = create(<Harness selected={selected} />);
  });
};
const placed = () => ({ transform: pill.style.transform, width: pill.style.width });

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  clock = 0;
  disconnected = false;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame;
    nextFrame += 1;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    }
  );
  group = document.createElement('div');
  pill = document.createElement('span');
  // jsdom has no Web Animations; the pill only moves where the browser could animate.
  pill.animate = (() => undefined) as never;
  a = tab(10, 50);
  b = tab(120, 80);
  group.append(pill, a, b);
  groupRef.current = group;
  pillRef.current = pill;
  press(a);
  reduceMotion(false);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe('useSlidingPill', () => {
  it('snaps onto the pressed tab on mount', () => {
    mount('a');
    expect(placed()).toEqual({ transform: 'translateX(10px)', width: '50px' });
    runUntilStill();
    expect(placed()).toEqual({ transform: 'translateX(10px)', width: '50px' });
  });

  it('springs to a newly pressed tab and stops drawing once settled', () => {
    mount('a');
    runUntilStill();
    press(b);
    mount('b');
    runFrame();
    const x = Number(/translateX\((.+)px\)/.exec(pill.style.transform)![1]);
    expect(x).toBeGreaterThan(10);
    expect(x).toBeLessThan(120);
    runUntilStill();
    expect(placed()).toEqual({ transform: 'translateX(120px)', width: '80px' });
    expect(frames.size).toBe(0);
    // A tab that grows later starts it again.
    boxes.get(b)!.width = 96;
    resize();
    expect(frames.size).toBe(1);
    runUntilStill();
    expect(placed().width).toBe('96px');
  });

  it('snaps with reduced motion, at once when a tab resizes', () => {
    reduceMotion(true);
    mount('a');
    press(b);
    mount('b');
    runFrame();
    expect(placed()).toEqual({ transform: 'translateX(120px)', width: '80px' });
    boxes.get(b)!.width = 90;
    resize();
    expect(placed().width).toBe('90px');
    expect(frames.size).toBe(0);
  });

  it('leaves no frame behind: a snap cancels the pending one, and so does unmount', () => {
    mount('a');
    runUntilStill();
    press(b);
    mount('b');
    runFrame();
    expect(frames.size).toBe(1);
    // Motion turned off mid-glide: the resize snaps and the glide's next frame is gone.
    reduceMotion(true);
    resize();
    expect(frames.size).toBe(0);
    expect(placed()).toEqual({ transform: 'translateX(120px)', width: '80px' });

    reduceMotion(false);
    press(a);
    mount('a');
    runFrame();
    expect(frames.size).toBe(1);
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(frames.size).toBe(0);
    expect(disconnected).toBe(true);
    const after = placed();
    runUntilStill();
    expect(placed()).toEqual(after);
  });
});
