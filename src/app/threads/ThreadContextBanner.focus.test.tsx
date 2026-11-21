// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadContextBanner } from './ThreadContextBanner';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';

// The banner in a real DOM with real focus: its layout waits while a control of it has the focus,
// and follows once the focus leaves or the focused control goes, which sends no focus event in
// Firefox or WebKit (nor in JSDOM).

const state = vi.hoisted(() => ({
  canPin: true,
  menuOpen: vi.fn(),
  menuClose: undefined as (() => void) | undefined,
}));
vi.mock('./ThreadActionsMenu', () => ({
  ThreadActionsMenu: ({ onClose, tagsAtTop }: { onClose: () => void; tagsAtTop: boolean }) => {
    state.menuClose = onClose;
    state.menuOpen(tagsAtTop);
    return <div role="menu" />;
  },
}));
vi.mock('./ThreadHeaderSlot', () => ({ ThreadHeaderSlot: () => null }));
vi.mock('../approvals/ThreadApprovalControls', () => ({ ThreadApprovalPermissions: () => null }));
vi.mock('../approvals/auto-approve/AutoApproveChip', () => ({ AutoApproveChip: () => null }));
vi.mock('../ui/glass/liquid/useLiquidGlass', () => ({ useLiquidGlass: (ref?: unknown) => ref }));
vi.mock('../event-store/threads/useThreadPinning', () => ({
  useThreadPinning: () => ({
    pinnedEventIds: [],
    canPin: state.canPin,
    setPinned: vi.fn(),
    updating: false,
    error: undefined,
  }),
}));
vi.mock('./useThreadRootEvent', () => ({ useThreadRootEvent: () => '$root' }));
vi.mock('../event-store/sdk/cachedThreadRoots', () => ({ useCachedThreadRoot: () => undefined }));
vi.mock('./tags/useThreadTags', () => ({
  useThreadTags: () => ({
    tags: { alpha: { set_by: '@me:test', set_at: '2026-01-01T00:00:00.000Z' } },
    displayTags: ['alpha'],
    isResolved: false,
    canEdit: false,
    availableTags: [],
  }),
}));
vi.mock('./tags/useMutateThreadTags', () => ({
  useMutateThreadTags: () => ({
    addTag: vi.fn(),
    removeTag: vi.fn(),
    setResolved: vi.fn(),
    unsnooze: vi.fn(),
    updating: false,
    error: undefined,
  }),
}));
vi.mock('./useThreadHeaderInfo', () => ({
  useThreadHeaderInfo: () => ({ scheduledTaskCount: 0 }),
}));

const room = {
  roomId: '!room:test',
  getThread: () => undefined,
  findEventById: () => undefined,
  getUnfilteredTimelineSet: () => undefined,
  getMember: () => undefined,
  hasEncryptionStateEvent: () => false,
  on: vi.fn(),
  removeListener: vi.fn(),
} as unknown as Room;

describe('ThreadContextBanner layout while in use', () => {
  let container: HTMLDivElement;
  let root: Root;
  let slotWidth = 646;
  const resized: (() => void)[] = [];

  const render = () =>
    act(() => {
      root.render(
        <ScreenSizeProvider value={ScreenSize.Desktop}>
          <ThreadContextBanner
            room={room}
            threadId="$root"
            summaryInfo={{ summaryText: '🧪 Example thread with a long title that wraps' }}
            onExitThread={vi.fn()}
          />
        </ScreenSizeProvider>
      );
    });
  const resizeTo = (width: number) => {
    slotWidth = width;
    act(() => resized.forEach((measure) => measure()));
  };
  const button = (name: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  const tagShown = () => container.textContent?.includes('alpha') ?? false;
  // A turn of the event loop, for what the banner waits on after a focus change.
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve)));
  // Turns of the event loop until `done()` or ten have passed: the page's change is seen a turn
  // after it, and the banner looks a turn after that.
  const settleUntil = async (done: () => boolean) => {
    for (let turn = 0; turn < 10 && !done(); turn += 1) {
      // eslint-disable-next-line no-await-in-loop
      await settle();
    }
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    state.canPin = true;
    slotWidth = 646;
    resized.length = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: () => void) {}

        observe() {
          resized.push(this.callback);
        }

        disconnect() {
          resized.splice(resized.indexOf(this.callback), 1);
        }
      }
    );
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { get: () => slotWidth });
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('waits while a control has the focus, and follows once it blurs', async () => {
    render();
    expect(tagShown()).toBe(true);
    act(() => button('Pin thread')!.focus());
    resizeTo(330);
    await settle();
    expect(document.activeElement).toBe(button('Pin thread'));
    expect(tagShown()).toBe(true);
    act(() => button('Pin thread')!.blur());
    await settle();
    expect(tagShown()).toBe(false);
    expect(button('Pin thread')).toBeNull();
  });

  it('follows once the focused control goes, with no focus event', async () => {
    render();
    act(() => button('Pin thread')!.focus());
    resizeTo(330);
    expect(tagShown()).toBe(true);
    const focusEvents = vi.fn();
    document.addEventListener('focusout', focusEvents);
    document.addEventListener('focusin', focusEvents);
    // Pinning goes away (the account lost the right): Pin leaves with the focus.
    state.canPin = false;
    render();
    // The page's change, then the banner's look a turn later.
    await settleUntil(() => !tagShown());
    expect(tagShown()).toBe(false);
    expect(focusEvents).not.toHaveBeenCalled();
    document.removeEventListener('focusout', focusEvents);
    document.removeEventListener('focusin', focusEvents);
  });

  it('follows once the focus left before the layout began to wait', async () => {
    render();
    const outside = document.createElement('input');
    document.body.append(outside);
    // Pin, then an input outside the banner, in the same turn; the pane narrows after.
    act(() => {
      button('Pin thread')!.focus();
      outside.focus();
    });
    resizeTo(330);
    await settleUntil(() => !tagShown());
    expect(tagShown()).toBe(false);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('waits while its menu is open, and after it while More has the focus back', async () => {
    render();
    resizeTo(330);
    expect(tagShown()).toBe(false);
    act(() => button('Thread options')!.click());
    // The menu's module loads lazily.
    await settle();
    expect(state.menuOpen).toHaveBeenLastCalledWith(true);
    resizeTo(646);
    await settle();
    expect(tagShown()).toBe(false);
    // Closed, the menu gives More the focus, which keeps the layout until it leaves.
    act(() => state.menuClose!());
    await settle();
    expect(document.activeElement).toBe(button('Thread options'));
    expect(tagShown()).toBe(false);
    act(() => button('Thread options')!.blur());
    await settle();
    expect(tagShown()).toBe(true);
  });
});
