// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import type FocusTrap from 'focus-trap-react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThreadActionsMenu } from './ThreadActionsMenu';

vi.mock('./ThreadContextBanner.css', () => ({ TagPickerInput: 'i', TagPickerInputContainer: 'c' }));
vi.mock('../../styles/Motion.css', () => ({
  motion: { duration: { Normal: '0ms', Fast: '0ms' }, easing: { Standard: 'linear' } },
}));
vi.mock('./useThreadTags', () => ({
  useThreadTags: () => ({ displayTags: [], availableTags: [], canEdit: false, isResolved: false }),
}));
vi.mock('./useMutateThreadTags', () => ({ useMutateThreadTags: () => ({ updating: false }) }));
vi.mock('./useThreadPinning', () => ({
  useThreadPinning: () => ({ pinnedEventIds: [], canPin: false, updating: false }),
}));
vi.mock('./threadSummaryActions', () => ({
  getThreadSummaryActionError: () => 'unavailable',
  requestThreadSummary: vi.fn(),
  saveThreadSummary: vi.fn(),
  SUMMARY_MAX_LENGTH: 300,
}));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../hooks/useRoomMembers', () => ({ useRoomMembers: () => [] }));
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
