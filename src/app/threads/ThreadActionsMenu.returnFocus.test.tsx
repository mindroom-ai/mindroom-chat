// @vitest-environment jsdom
import React, { useState } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import type FocusTrap from 'focus-trap-react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RegisteredPlugin } from '../plugins/registry';
import type { ThreadDetailProps } from '../plugins/threadDetails';
import { ThreadActionsMenu } from './ThreadActionsMenu';

vi.mock('./ThreadContextBanner.css', () => ({ TagPickerInput: 'i', TagPickerInputContainer: 'c' }));
vi.mock('./fork/useStartThreadFork', () => ({ useStartThreadFork: () => () => undefined }));
vi.mock('../matrix/hooks/useRoomThreadMode', () => ({ useRoomThreadMode: () => undefined }));
vi.mock('../ui/styles/Motion.css', () => ({
  motion: { duration: { Normal: '0ms', Fast: '0ms' }, easing: { Standard: 'linear' } },
}));
vi.mock('./tags/useThreadTags', () => ({
  useThreadTags: () => ({ displayTags: [], availableTags: [], canEdit: false, isResolved: false }),
}));
vi.mock('./tags/useMutateThreadTags', () => ({ useMutateThreadTags: () => ({ updating: false }) }));
vi.mock('../event-store/threads/useThreadPinning', () => ({
  useThreadPinning: () => ({ pinnedEventIds: [], canPin: false, updating: false }),
}));
vi.mock('./summary/threadSummaryActions', () => ({
  getThreadSummaryActionError: () => 'unavailable',
  requestThreadSummary: vi.fn(),
  saveThreadSummary: vi.fn(),
  SUMMARY_MAX_LENGTH: 300,
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => [] }));
vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  PopOut: ({ content }: { content: React.ReactNode }) => content,
}));
// JSDOM lays nothing out, so every element counts as shown for the trap.
vi.mock('focus-trap-react', async (original) => {
  const { default: RealTrap } = await original<{ default: typeof FocusTrap }>();
  return {
    default: ({ focusTrapOptions, ...props }: React.ComponentProps<typeof FocusTrap>) => (
      <RealTrap
        {...props}
        focusTrapOptions={{ ...focusTrapOptions, tabbableOptions: { displayCheck: 'none' } }}
      />
    ),
  };
});

const room = {
  roomId: '!room:test',
  getThread: () => undefined,
  findEventById: () => undefined,
} as unknown as Room;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('closes on Escape only after its focus trap lets go, so focus can go back to the trigger', async () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  const onClose = vi.fn(() => trigger.focus());
  act(() =>
    root.render(
      <ThreadActionsMenu
        room={room}
        rootId="$root"
        anchor={{ x: 0, y: 0, width: 0, height: 0 }}
        onClose={onClose}
        onOpenThread={() => undefined}
      />
    )
  );
  const item = host.querySelector<HTMLElement>('[data-thread-action="open"]')!;
  act(() => item.focus());
  expect(document.activeElement).toBe(item);

  await act(async () => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await Promise.resolve();
  });

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});

it('returns focus to the trigger when a thread detail calls onClose', async () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  const onClose = vi.fn();
  function InteractiveDetail({ onClose: close }: ThreadDetailProps) {
    return (
      <button type="button" role="menuitem" onClick={close}>
        Open pull request
      </button>
    );
  }
  const plugin: RegisteredPlugin = {
    id: 'test',
    tag: 'test@1.0.0',
    displayName: 'Test',
    defaultEnabled: true,
    conversationCovers: [],
    messageRenderers: [],
    pages: [],
    roomHeaderSlot: [],
    threadHeaderSlot: [],
    sidePanels: [],
    headerActions: [],
    slashCommands: [],
    roomActions: [],
    messageLinks: [],
    threadCardBadges: [],
    threadDetails: [{ Component: InteractiveDetail }],
  };
  function Harness() {
    const [open, setOpen] = useState(true);
    if (!open) return null;
    return (
      <ThreadActionsMenu
        room={room}
        rootId="$root"
        anchor={{ x: 0, y: 0, width: 0, height: 0 }}
        onClose={() => {
          onClose();
          setOpen(false);
          trigger.focus();
        }}
        plugins={[plugin]}
      />
    );
  }
  try {
    act(() => root.render(<Harness />));
    const button = host.querySelector<HTMLButtonElement>(
      '[data-thread-details] [role="menuitem"]'
    )!;
    act(() => button.focus());
    expect(document.activeElement).toBe(button);

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  } finally {
    trigger.remove();
  }
});
