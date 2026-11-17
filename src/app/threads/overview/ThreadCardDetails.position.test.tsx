// @vitest-environment jsdom
import { lazy, useRef, type ComponentType } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import type { RegisteredPlugin } from '../../plugins/registry';
import type { ThreadDetailProps } from '../../plugins/threadDetails';
import { ThreadCardDetails, THREAD_CARD_DETAILS_DELAY_MS } from './ThreadCardDetails';

const observers = new Set<SurfaceResizeObserver>();
class SurfaceResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe() {
    observers.add(this);
  }

  unobserve() {
    observers.delete(this);
  }

  disconnect() {
    observers.delete(this);
  }

  resize() {
    this.callback([], this);
  }
}

const room = { roomId: '!room:example.org' } as Room;
function Harness({ plugins }: { plugins: RegisteredPlugin[] }) {
  const listRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={listRef}>
        <div data-scroll-anchor="$a" data-testid="card">
          A
        </div>
      </div>
      <ThreadCardDetails room={room} listRef={listRef} menuOpen={false} plugins={plugins} />
    </>
  );
}

afterEach(() => {
  cleanup();
  observers.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('repositions inside the viewport when a lazy-only detail grows after opening near the right edge', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('innerHeight', 768);
  vi.stubGlobal('ResizeObserver', SurfaceResizeObserver);
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(768);
  // jsdom has no layout. Model the real surface's zero-sized suspense fallback and loaded size.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const loaded = this.querySelector('[data-loaded-detail]');
    return new DOMRect(0, 0, loaded ? 300 : 0, loaded ? 240 : 0);
  });
  const Loaded = () => <div data-loaded-detail>Loaded details</div>;
  let resolveDetail: ((module: { default: ComponentType<ThreadDetailProps> }) => void) | undefined;
  const module = new Promise<{ default: ComponentType<ThreadDetailProps> }>((resolve) => {
    resolveDetail = resolve;
  });
  const LazyDetail = lazy(() => module);
  const plugins: RegisteredPlugin[] = [
    {
      id: 'test',
      tag: 'test@1.0.0',
      conversationCovers: [],
      messageRenderers: [],
      pages: [],
      roomHeaderSlot: [],
      sidePanels: [],
      headerActions: [],
      slashCommands: [],
      roomActions: [],
      messageLinks: [],
      threadCardBadges: [],
      threadDetails: [{ Component: LazyDetail }],
    },
  ];
  const { getByTestId } = render(<Harness plugins={plugins} />);
  act(() => {
    const event = new MouseEvent('pointermove', { bubbles: true, clientX: 970, clientY: 50 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    getByTestId('card').dispatchEvent(event);
    vi.advanceTimersByTime(THREAD_CARD_DETAILS_DELAY_MS);
  });
  const layer = document.querySelector('[data-thread-card-details]');
  const positioned = layer?.firstElementChild;
  if (!(positioned instanceof HTMLElement)) throw new Error('Details did not open');
  expect(positioned.textContent).toBe('');
  expect(positioned.style.left).toBe('970px');

  await act(async () => {
    resolveDetail?.({ default: Loaded });
    await module;
  });
  expect(positioned.textContent).toBe('Loaded details');
  act(() => {
    for (const observer of observers) observer.resize();
  });
  // The 300px surface now ends at x970, instead of overflowing to x1270.
  // jsdom's CSS parser rejects left: unset, so check the new right-edge alignment.
  expect(positioned.style.right).toBe('30px');
  expect(positioned.style.top).toBe('66px');
});
