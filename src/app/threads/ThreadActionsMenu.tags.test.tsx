// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FocusTrap } from 'focus-trap-react';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadActionsMenu } from './ThreadActionsMenu';

// A phone's thread menu holds the tags at its top. A tag write there does not hold the menu open,
// and removing a tag with its focused ✕ leaves the focus on the tags section.

vi.mock('./ThreadContextBanner.css', () => ({
  TagPickerInput: 'input',
  TagPickerInputContainer: 'container',
}));
vi.mock('./fork/useStartThreadFork', () => ({ useStartThreadFork: () => () => undefined }));
vi.mock('../matrix/hooks/useRoomThreadMode', () => ({ useRoomThreadMode: () => undefined }));
vi.mock('../ui/styles/Motion.css', () => ({
  motion: { duration: { Normal: '0ms', Fast: '0ms' }, easing: { Standard: 'linear' } },
}));

const state = vi.hoisted(() => ({
  displayTags: ['flaky', 'uploads', 'networking'],
  updating: false,
  finish: (): void => undefined,
  removeTag: vi.fn(),
}));
vi.mock('./tags/useThreadTags', () => ({
  useThreadTags: () => ({
    displayTags: state.displayTags,
    availableTags: ['urgent'],
    canEdit: true,
    isResolved: false,
  }),
}));
vi.mock('./tags/useMutateThreadTags', () => ({
  useMutateThreadTags: () => ({
    updating: state.updating,
    error: null,
    removeTag: state.removeTag,
    addTag: vi.fn(),
  }),
}));
vi.mock('../event-store/threads/useThreadPinning', () => ({
  useThreadPinning: () => ({ pinnedEventIds: [], canPin: false, updating: false }),
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:test' }),
}));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => [] }));
vi.mock('focus-trap-react', async (original) => {
  const { FocusTrap: RealFocusTrap } = await original<{ FocusTrap: typeof FocusTrap }>();
  return {
    FocusTrap: ({ focusTrapOptions, ...props }: React.ComponentProps<typeof FocusTrap>) => (
      <RealFocusTrap
        {...props}
        focusTrapOptions={{
          ...focusTrapOptions,
          delayInitialFocus: false,
          // JSDOM has no layout; retain the real keyboard and focus behavior.
          tabbableOptions: { displayCheck: 'none' },
        }}
      />
    ),
  };
});
vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  PopOut: ({ content, anchor }: { content: React.ReactNode; anchor: unknown }) =>
    anchor ? content : null,
  Overlay: ({ children }: { children: React.ReactNode }) => children,
}));

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
  getMyMembership: () => 'join',
  getThread: () => undefined,
  findEventById: () => rootEvent,
  currentState: { maySendEvent: () => true },
} as unknown as Room;

describe('ThreadActionsMenu tags at its top', () => {
  let root: Root;
  let host: HTMLDivElement;
  const onClose = vi.fn();
  const renderMenu = () =>
    act(() =>
      root.render(
        <ThreadActionsMenu
          room={room}
          rootId="$root"
          tagsAtTop
          anchor={{ x: 1, y: 1, width: 1, height: 1 }}
          onClose={onClose}
        />
      )
    );
  const removeButton = (tag: string) =>
    host.querySelector<HTMLButtonElement>(`[data-thread-menu-tags] [title="${tag}"] button`);
  /** Removes `tag` with its focused ✕; the write stays pending until `settle`. */
  const removeFocused = (tag: string) => {
    renderMenu();
    const button = removeButton(tag)!;
    act(() => button.focus());
    act(() => button.click());
    expect(state.removeTag).toHaveBeenCalledWith('$root', tag);
    renderMenu();
  };
  const settle = async (left: string[]) => {
    state.displayTags = left;
    state.updating = false;
    renderMenu();
    await act(async () => state.finish());
  };

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    state.displayTags = ['flaky', 'uploads', 'networking'];
    state.updating = false;
    state.removeTag.mockImplementation(() => {
      state.updating = true;
      return new Promise<void>((resolve) => {
        state.finish = resolve;
      });
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('closes on Escape while a tag removal is still being saved', async () => {
    removeFocused('uploads');
    expect(state.updating).toBe(true);
    // Escape comes from the tags section, which holds the focus while the save runs.
    expect(document.activeElement).toBe(tagSection());
    act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });
    await act(async () => undefined);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on a press outside while a tag removal is still being saved', async () => {
    removeFocused('uploads');
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    await act(async () => undefined);
    expect(onClose).toHaveBeenCalledOnce();
  });

  const tagSection = () => host.querySelector<HTMLElement>('[data-thread-menu-tags]');

  it('moves the focus to the tags section when its focused ✕ is pressed, and keeps it there', async () => {
    removeFocused('uploads');
    expect(document.activeElement).toBe(tagSection());
    expect(tagSection()!.getAttribute('role')).toBe('group');
    expect(tagSection()!.tabIndex).toBe(-1);
    // The client shows the pending removal at once.
    state.displayTags = ['flaky', 'networking'];
    renderMenu();
    expect(document.activeElement).toBe(tagSection());
    // The other ✕es stay while the save runs, and wait for it.
    expect(removeButton('networking')!.getAttribute('aria-disabled')).toBe('true');
    await settle(['flaky', 'networking']);
    expect(document.activeElement).toBe(tagSection());
  });

  it('keeps the focus on the tags section after removing the only tag', async () => {
    state.displayTags = ['flaky'];
    removeFocused('flaky');
    state.displayTags = [];
    renderMenu();
    expect(document.activeElement).toBe(tagSection());
    await settle([]);
    expect(document.activeElement).toBe(tagSection());
  });

  it('keeps the focus on the tags section when the removal fails', async () => {
    removeFocused('uploads');
    state.displayTags = ['flaky', 'networking'];
    renderMenu();
    // The save fails: the tag comes back.
    await settle(['flaky', 'uploads', 'networking']);
    expect(document.activeElement).toBe(tagSection());
  });

  it('leaves a focus outside the tags section where it is', async () => {
    renderMenu();
    const copy = host.querySelector<HTMLButtonElement>('[data-thread-action="copy"]')!;
    act(() => copy.focus());
    act(() => removeButton('uploads')!.click());
    renderMenu();
    expect(document.activeElement).toBe(copy);
    await settle(['flaky', 'networking']);
    expect(document.activeElement).toBe(copy);
  });
});
