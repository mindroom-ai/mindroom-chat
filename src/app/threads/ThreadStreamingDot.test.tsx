// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreadStreamingDot } from './ThreadStreamingDot';

vi.mock('../messages/ThreadIndicator.css', () => ({
  ThreadStreamingDot: 'thread-streaming-dot',
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  vi.unstubAllGlobals();
});

it('keeps initial animation running on mount and pauses or resumes from IntersectionObserver', () => {
  let notify: IntersectionObserverCallback | undefined;
  const observed: Element[] = [];
  class FakeIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      notify = callback;
    }
    observe = (target: Element) => observed.push(target);
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

  container = document.createElement('div');
  document.body.append(container);
  act(() => {
    root = createRoot(container!);
    root.render(<ThreadStreamingDot aria-hidden="true" />);
  });

  const dot = container.querySelector<HTMLSpanElement>('.thread-streaming-dot');
  expect(dot).not.toBeNull();
  expect(observed).toEqual([dot]);
  expect(dot?.style.animationPlayState).toBe('');

  notify?.(
    [{ target: dot!, isIntersecting: false } as unknown as IntersectionObserverEntry],
    {} as IntersectionObserver
  );
  expect(dot?.style.animationPlayState).toBe('paused');

  notify?.(
    [{ target: dot!, isIntersecting: true } as unknown as IntersectionObserverEntry],
    {} as IntersectionObserver
  );
  expect(dot?.style.animationPlayState).toBe('running');
});
