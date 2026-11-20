// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import type FocusTrap from 'focus-trap-react';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadActionsMenu } from './ThreadActionsMenu';

// A phone's thread menu holds the tags at its top. A tag write there does not hold the menu open,
// and removing the focused tag hands the focus on within the menu.

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
  const { default: RealFocusTrap } = await original<{ default: typeof FocusTrap }>();
  return {
    default: ({ focusTrapOptions, ...props }: React.ComponentProps<typeof FocusTrap>) => (
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

  it('keeps the focus on the ✕ while the removal is saved, then moves it to the next tag', async () => {
    removeFocused('uploads');
    expect(document.activeElement).toBe(removeButton('uploads'));
    await settle(['flaky', 'networking']);
    expect(document.activeElement).toBe(removeButton('networking'));
  });

  it('moves the focus to the next tag as soon as the tag goes, while the save is still pending', async () => {
    removeFocused('uploads');
    // The client shows the pending removal at once.
    state.displayTags = ['flaky', 'networking'];
    renderMenu();
    expect(document.activeElement).toBe(removeButton('networking'));
    expect(removeButton('networking')!.getAttribute('aria-disabled')).toBe('true');
    await settle(['flaky', 'networking']);
    expect(document.activeElement).toBe(removeButton('networking'));
  });

  it('moves the focus to the previous tag after removing the last one', async () => {
    removeFocused('networking');
    await settle(['flaky', 'uploads']);
    expect(document.activeElement).toBe(removeButton('uploads'));
  });

  it('moves the focus to the tag picker after removing the only tag', async () => {
    state.displayTags = ['flaky'];
    removeFocused('flaky');
    await settle([]);
    expect(document.activeElement).toBe(
      host.querySelector('[data-thread-menu-tags] button[aria-haspopup="menu"]')
    );
  });

  it('keeps the focus in the menu while the only tag is gone and its save is still pending', async () => {
    state.displayTags = ['flaky'];
    removeFocused('flaky');
    // The client shows the pending removal at once; the picker waits for the save.
    state.displayTags = [];
    renderMenu();
    const focused = document.activeElement!;
    expect(focused).not.toBe(document.body);
    expect(host.querySelector('[role="menu"]')!.contains(focused)).toBe(true);
    expect(focused.getAttribute('role')).toMatch(/^menuitem/);
    await settle([]);
    expect(host.querySelector('[role="menu"]')!.contains(document.activeElement)).toBe(true);
  });

  it('gives the focus back to the ✕ when a removal shown at once fails', async () => {
    removeFocused('uploads');
    state.displayTags = ['flaky', 'networking'];
    renderMenu();
    expect(document.activeElement).toBe(removeButton('networking'));
    // The save fails: the tag comes back.
    await settle(['flaky', 'uploads', 'networking']);
    expect(document.activeElement).toBe(removeButton('uploads'));
  });

  it('leaves the focus where the user moved it when a removal shown at once fails', async () => {
    removeFocused('uploads');
    state.displayTags = ['flaky', 'networking'];
    renderMenu();
    const copy = host.querySelector<HTMLButtonElement>('[data-thread-action="copy"]')!;
    act(() => copy.focus());
    await settle(['flaky', 'uploads', 'networking']);
    expect(document.activeElement).toBe(copy);
  });

  it('leaves the focus on the ✕ when the removal fails', async () => {
    removeFocused('uploads');
    await settle(['flaky', 'uploads', 'networking']);
    expect(document.activeElement).toBe(removeButton('uploads'));
  });
});
