// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useListEndClamp } from './useListEndClamp';

// The composer's inset shrinking (its typing line going) in the frame a row shrank: the list
// keeps its rendered height until React renders it, so the browser's own clamp stops short of
// where the list will end, leaving a band above the composer for a frame.

let resize: (() => void) | undefined;
let renderer: ReactTestRenderer | undefined;
let pending = 0;
const content = {} as HTMLElement;
const probe = {} as HTMLElement;
const scroll = { scrollTop: 900, scrollHeight: 1500, clientHeight: 600 };

function Harness() {
  useListEndClamp(
    scroll as unknown as HTMLElement,
    { current: content },
    { current: probe },
    () => pending
  );
  return null;
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }

      observe = vi.fn();

      disconnect = vi.fn();
    }
  );
  Object.assign(scroll, { scrollTop: 900, scrollHeight: 1500 });
  pending = 0;
  act(() => {
    renderer = create(<Harness />);
  });
});

afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it('clamps the reader to where the list will end', () => {
  // A row shrank by 62 px that React has not rendered; the inset shrank by 36 px and the browser
  // clamped to the end the old list height allows.
  pending = 62;
  Object.assign(scroll, { scrollHeight: 1464, scrollTop: 864 });
  resize?.();
  expect(scroll.scrollTop).toBe(802);
});

it('leaves a reader above that end where they are', () => {
  pending = 62;
  Object.assign(scroll, { scrollHeight: 1464, scrollTop: 500 });
  resize?.();
  expect(scroll.scrollTop).toBe(500);
});
