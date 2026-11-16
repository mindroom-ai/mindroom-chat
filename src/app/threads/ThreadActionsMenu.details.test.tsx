// @vitest-environment jsdom
import React, { lazy, useState, type ComponentType } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadActionsMenu } from './ThreadActionsMenu';
import * as css from './ThreadActionsMenu.css';
import type { RegisteredPlugin } from '../plugins/registry';
import type { ThreadDetailProps } from '../plugins/threadDetails';

vi.mock('./ThreadContextBanner.css', () => ({ TagPickerInput: 'i', TagPickerInputContainer: 'c' }));
vi.mock('./fork/useStartThreadFork', () => ({ useStartThreadFork: () => () => undefined }));
vi.mock('../ui/styles/Motion.css', () => ({
  motion: { duration: { Normal: '0ms', Fast: '0ms' }, easing: { Standard: 'linear' } },
}));
vi.mock('../matrix/hooks/useRoomThreadMode', () => ({ useRoomThreadMode: () => undefined }));
vi.mock('./tags/useThreadTags', () => ({
  useThreadTags: () => ({
    displayTags: [],
    availableTags: [],
    canEdit: true,
    isResolved: false,
    snoozedUntilTs: undefined,
  }),
}));
vi.mock('./tags/useMutateThreadTags', () => ({ useMutateThreadTags: () => ({ updating: false }) }));
vi.mock('../event-store/threads/useThreadPinning', () => ({
  useThreadPinning: () => ({ pinnedEventIds: [], canPin: true, updating: false }),
}));
vi.mock('./summary/threadSummaryActions', () => ({
  getThreadSummaryActionError: () => undefined,
  requestThreadSummary: vi.fn(),
  saveThreadSummary: vi.fn(),
  SUMMARY_MAX_LENGTH: 300,
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => [] }));
vi.mock('../bug-reports/error-reporting/errorReporting', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportBoundaryError: () => undefined,
}));
// The real folds PopOut positions the menu; only the focus trap is left out.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

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
const resizeSurfaces = () =>
  act(() => {
    for (const observer of observers) observer.resize();
  });

const rootEvent = new MatrixEvent({
  event_id: '$root',
  room_id: '!room:test',
  type: 'm.room.message',
  sender: '@me:test',
  origin_server_ts: 1,
  content: { msgtype: 'm.text', body: 'Thread root' },
});
const room = {
  roomId: '!room:test',
  getThread: () => undefined,
  findEventById: () => rootEvent,
} as unknown as Room;

const pluginWith = (Component: ComponentType<ThreadDetailProps>): RegisteredPlugin => ({
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
  threadDetails: [{ Component }],
});

/** A detail whose code loads when the test resolves it. */
const deferredDetail = (Loaded: ComponentType<ThreadDetailProps>) => {
  let resolveDetail: ((module: { default: ComponentType<ThreadDetailProps> }) => void) | undefined;
  const module = new Promise<{ default: ComponentType<ThreadDetailProps> }>((resolve) => {
    resolveDetail = resolve;
  });
  return {
    Detail: lazy(() => module),
    load: () =>
      act(async () => {
        resolveDetail?.({ default: Loaded });
        await module;
      }),
  };
};

const renderMenu = (Component: ComponentType<ThreadDetailProps>) =>
  render(
    <ThreadActionsMenu
      room={room}
      rootId="$root"
      // A trigger whose bottom edge is at y350, its end edge at x724.
      anchor={{ x: 700, y: 326, width: 24, height: 24 }}
      onClose={() => undefined}
      plugins={[pluginWith(Component)]}
    />
  );
const menu = () => {
  const found = document.querySelector<HTMLElement>('[role="menu"]');
  if (!found) throw new Error('The menu did not open');
  return found;
};

afterEach(() => {
  cleanup();
  observers.clear();
  Reflect.deleteProperty(document.documentElement, 'clientWidth');
  Reflect.deleteProperty(document.documentElement, 'clientHeight');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ThreadActionsMenu's thread details", () => {
  it('repositions inside the viewport when a lazy detail grows the open menu', async () => {
    vi.stubGlobal('ResizeObserver', SurfaceResizeObserver);
    // An own value, removed after the test; a restored getter spy here recurses in later tests.
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: 768,
    });
    // jsdom has no layout. Model a 200px menu that grows to 600px once its detail loads.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const loaded = this.querySelector('[data-loaded-detail]');
      return new DOMRect(0, 0, 240, loaded ? 600 : 200);
    });
    const Loaded = () => <div data-loaded-detail>Loaded details</div>;
    const { Detail, load } = deferredDetail(Loaded);
    renderMenu(Detail);
    const positioned = menu().parentElement;
    if (!positioned) throw new Error('The menu has no pop-out');
    expect(positioned.style.top).toBe('354px');

    await load();
    expect(positioned.textContent).toContain('Loaded details');
    resizeSurfaces();
    // Below the trigger the 600px menu would end at y954, past the 768px viewport.
    expect(positioned.style.top).toBe('38px');
  });

  it.each([
    ['renders nothing', () => null],
    [
      'is still loading',
      lazy<ComponentType<ThreadDetailProps>>(() => new Promise(() => undefined)),
    ],
    [
      'fails',
      (): never => {
        throw new Error('boom');
      },
    ],
  ] as const)(
    'hides the padded group and its divider and describes nothing when the only detail %s',
    (_, Component) => {
      vi.stubGlobal('ResizeObserver', SurfaceResizeObserver);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      renderMenu(Component);
      resizeSurfaces();
      const group = document.querySelector('[data-thread-details]');
      expect(group?.querySelector('[data-thread-detail]:not(:empty)')).toBeNull();
      // The group and its divider share the wrapper that hides when no detail has content.
      expect(group?.parentElement?.classList.contains(css.ThreadMenuDetails)).toBe(true);
      expect(group?.parentElement?.querySelector('[data-thread-details] + *')).not.toBeNull();
      expect(menu().hasAttribute('aria-describedby')).toBe(false);
    }
  );

  it('updates its description when details change inside a height-capped menu without resizing', async () => {
    vi.stubGlobal('ResizeObserver', SurfaceResizeObserver);
    let setVisible: React.Dispatch<React.SetStateAction<boolean>> | undefined;
    const Detail = () => {
      const [visible, updateVisible] = useState(true);
      setVisible = updateVisible;
      return visible ? <span>Branch main</span> : null;
    };
    renderMenu(Detail);
    expect(menu().hasAttribute('aria-describedby')).toBe(true);
    await act(async () => {
      setVisible?.(false);
    });
    expect(menu().hasAttribute('aria-describedby')).toBe(false);
    await act(async () => {
      setVisible?.(true);
    });
    expect(menu().getAttribute('aria-describedby')).toBe(
      document.querySelector('[data-thread-details]')?.id
    );
  });

  it('describes the menu with its details once a detail that loaded late shows content', async () => {
    vi.stubGlobal('ResizeObserver', SurfaceResizeObserver);
    const Loaded = () => <span>Branch main</span>;
    const { Detail, load } = deferredDetail(Loaded);
    renderMenu(Detail);
    resizeSurfaces();
    expect(menu().hasAttribute('aria-describedby')).toBe(false);

    await load();
    resizeSurfaces();
    const group = document.querySelector('[data-thread-details]');
    expect(group?.textContent).toBe('Branch main');
    expect(menu().getAttribute('aria-describedby')).toBe(group?.id);
  });
});
