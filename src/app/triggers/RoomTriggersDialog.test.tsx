// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { RoomTriggersDialog } from './RoomTriggersDialog';
import type { RoomTrigger } from './roomTriggersApi';

const ROOM_ID = '!design:example.org';
const NOW = Date.now();

const mx = {
  getUserId: () => '@alice:example.org',
  on: vi.fn(),
  removeListener: vi.fn(),
  getRoom: () => ({
    roomId: ROOM_ID,
    name: 'Design',
    getMember: () => null,
    loadMembersIfNeeded: async () => true,
  }),
} as unknown as MatrixClient;

const makeTrigger = (overrides: Partial<RoomTrigger> = {}): RoomTrigger => ({
  triggerId: 'tr_watch',
  kind: 'room_message',
  relation: 'target',
  description: 'Design triage',
  prompt: 'Summarize new issues in the `design` channel for @alice.',
  targetRoomId: ROOM_ID,
  targetThreadId: '$triage-thread',
  threadMode: 'thread',
  enabled: true,
  disabledReason: null,
  lastFiredAt: NOW - 5 * 60_000,
  ownerUserId: '@alice:example.org',
  canManage: true,
  ...overrides,
});

const renderDialog = (initialProps: Partial<ComponentProps<typeof RoomTriggersDialog>> = {}) => {
  const defaults: ComponentProps<typeof RoomTriggersDialog> = {
    roomId: ROOM_ID,
    triggers: [makeTrigger()],
    onClose: vi.fn(),
    onOpenThread: vi.fn(),
    onToggleTrigger: vi.fn(async () => undefined),
    onDeleteTrigger: vi.fn(async () => undefined),
    ...initialProps,
  };
  const tree = (props: ComponentProps<typeof RoomTriggersDialog>) => (
    <MatrixClientProvider value={mx}>
      <MemoryRouter>
        <RoomTriggersDialog {...props} />
      </MemoryRouter>
    </MatrixClientProvider>
  );
  const view = render(tree(defaults));
  const rerenderDialog = (next: Partial<ComponentProps<typeof RoomTriggersDialog>>) =>
    view.rerender(tree({ ...defaults, ...next }));
  return { ...view, ...defaults, rerenderDialog };
};

afterEach(() => {
  cleanup();
});

describe('RoomTriggersDialog', () => {
  it('renders rows with trigger IDs, unknown kind/thread_mode fallbacks, aria-describedby, and non-owner subtitle', () => {
    const triggers: RoomTrigger[] = [
      makeTrigger(),
      makeTrigger({
        triggerId: 'tr_future',
        kind: 'cron_v2',
        description: '',
        prompt: null,
        targetThreadId: null,
        threadMode: 'dm_thread',
        enabled: false,
        disabledReason: 'once_consumed',
        lastFiredAt: null,
        ownerUserId: '@bob:example.org',
        canManage: false,
      }),
      makeTrigger({
        triggerId: 'tr_tag',
        kind: 'thread_tag',
        relation: 'watch',
        description: 'Urgent watch',
        prompt: 'Flag urgent threads',
        targetThreadId: null,
        threadMode: 'origin',
        enabled: false,
        disabledReason: 'expired',
      }),
    ];

    const { onOpenThread } = renderDialog({ triggers });
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(3);

    // Focus lands on Close when opened without a matched highlighted row.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));

    // Described row shows description as title, trigger ID in subtitle, prompt, thread link, and aria-describedby.
    const watchCard = cards[0]!;
    const watchTitle = within(watchCard).getByRole('heading', { name: 'Design triage' });
    expect(watchTitle.id).toBeTruthy();
    expect(
      within(watchCard).getByRole('button', { name: 'Disable' }).getAttribute('aria-describedby')
    ).toBe(watchTitle.id);
    expect(
      within(watchCard).getByRole('button', { name: 'Delete' }).getAttribute('aria-describedby')
    ).toBe(watchTitle.id);
    expect(watchCard.textContent).toContain('Room watch');
    expect(watchCard.textContent).toContain('tr_watch');
    expect(watchCard.textContent).toContain('Thread');
    expect(watchCard.querySelector('[data-mention-id]')).toBeNull();
    fireEvent.click(within(watchCard).getByRole('button', { name: 'Open thread' }));
    expect(onOpenThread).toHaveBeenCalledWith('$triage-thread', ROOM_ID);

    // Undescribed unknown-kind non-owner row: trigger ID as title, Trigger label, no dest text, Used, owner, no manage buttons.
    const futureCard = cards[1]!;
    expect(within(futureCard).getByRole('heading', { name: 'tr_future' })).toBeTruthy();
    expect(futureCard.textContent).toContain('Trigger');
    expect(futureCard.textContent).toContain('Used');
    expect(futureCard.textContent).toContain('No recorded firing');
    expect(futureCard.textContent).not.toContain('Room timeline');
    expect(futureCard.querySelector('[data-mention-id="@bob:example.org"]')).toBeTruthy();
    expect(within(futureCard).queryByRole('button', { name: /Enable|Disable/ })).toBeNull();
    expect(within(futureCard).queryByRole('button', { name: 'Delete' })).toBeNull();

    // Watch row: Expired, Watching this room, trigger ID shown.
    const tagCard = cards[2]!;
    expect(tagCard.textContent).toContain('Thread tag');
    expect(tagCard.textContent).toContain('tr_tag');
    expect(tagCard.textContent).toContain('Watching this room');
    expect(tagCard.textContent).toContain('Expired');
  });

  it('lets the owner toggle, keep (restoring Delete focus), see inline delete errors in ConfirmBar, and delete (restoring Close focus)', async () => {
    const onToggleTrigger = vi
      .fn<(...args: [string, boolean]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    const onDeleteTrigger = vi
      .fn<(...args: [string]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('delete failed'))
      .mockResolvedValueOnce(undefined);

    const { rerenderDialog } = renderDialog({
      highlightTriggerId: 'tr_watch',
      onToggleTrigger,
      onDeleteTrigger,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Could not update')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(onToggleTrigger).toHaveBeenCalledWith('tr_watch', false));

    const deleteIconBtn = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(deleteIconBtn);
    const confirmBar = screen.getByRole('group', { name: 'Delete this trigger?' });
    expect(deleteIconBtn.getAttribute('aria-controls')).toBe(confirmBar.id);
    const keepButton = within(confirmBar).getByRole('button', { name: 'Keep' });
    expect(document.activeElement).toBe(keepButton);
    fireEvent.click(keepButton);
    expect(onDeleteTrigger).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(deleteIconBtn);

    // Failed delete shows the alert inside ConfirmBar; retry succeeds.
    fireEvent.click(deleteIconBtn);
    const confirmGroup = screen.getByRole('group', { name: 'Delete this trigger?' });
    const confirmDeleteBtn = within(confirmGroup).getByRole('button', {
      name: 'Delete trigger',
    });
    confirmDeleteBtn.focus();
    fireEvent.click(confirmDeleteBtn);
    await waitFor(() =>
      expect(within(confirmGroup).getByRole('alert').textContent).toContain('Could not delete')
    );
    fireEvent.click(confirmDeleteBtn);
    await waitFor(() => expect(onDeleteTrigger).toHaveBeenCalledTimes(2));

    // Removing the deleted highlighted row moves lost focus back to Close and reflects the settled empty list.
    rerenderDialog({ triggers: [], highlightTriggerId: 'tr_watch' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    expect(document.querySelector('[data-trigger-missing]')?.textContent).toContain('tr_watch');
  });

  it('focuses matched target row, shows loading state, loadError on failure, and missing notice only when never matched', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const { rerenderDialog } = renderDialog({
      triggers: [
        makeTrigger({ triggerId: 'tr_first', description: 'First' }),
        makeTrigger({ triggerId: 'tr_target', description: 'Target' }),
      ],
      highlightTriggerId: 'tr_target',
    });

    const targetCard = document.querySelector('[data-trigger-id="tr_target"]');
    expect(targetCard?.getAttribute('data-highlighted')).toBe('true');
    expect(scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(targetCard);
    expect(document.querySelector('[data-trigger-missing]')).toBeNull();

    // Loading with no rows yet shows Loading… with aria-busy.
    rerenderDialog({ triggers: [], loading: true, highlightTriggerId: 'tr_gone' });
    const loadingStatus = screen.getByRole('status');
    expect(loadingStatus.getAttribute('aria-busy')).toBe('true');
    expect(loadingStatus.textContent).toBe('Loading…');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));

    // Focus a row button, then flip loadFailed -> true with cached rows still present:
    // shows only the error alert (no stale rows or missing notice) and moves lost focus to Close.
    const cachedRow = makeTrigger({
      triggerId: 'tr_target',
      description: 'Target',
      enabled: false,
    });
    rerenderDialog({ triggers: [cachedRow], loading: false, loadFailed: false });
    const enableBtn = screen.getByRole('button', { name: 'Enable' });
    enableBtn.focus();
    expect(document.activeElement).toBe(enableBtn);

    rerenderDialog({
      triggers: [cachedRow],
      loadFailed: true,
      highlightTriggerId: 'tr_gone',
    });
    expect(screen.getByRole('alert').textContent).toBe("Couldn't load triggers.");
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(document.querySelector('[data-trigger-missing]')).toBeNull();
    expect(screen.queryByText('No triggers in this room.')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));

    // Successful empty load for a never-matched ID: show missing notice + empty state.
    rerenderDialog({
      triggers: [],
      loading: false,
      loadFailed: false,
      highlightTriggerId: 'tr_gone',
    });
    expect(document.querySelector('[data-trigger-missing]')?.textContent).toContain('tr_gone');
    expect(screen.getByText('No triggers in this room.')).toBeTruthy();
  });

  it('keeps focus on busy action buttons with aria-disabled and avoids stealing focus on row updates', async () => {
    let resolveToggle!: () => void;
    let resolveDelete!: () => void;
    const onToggleTrigger = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveToggle = resolve;
        })
    );
    const onDeleteTrigger = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        })
    );
    const first = makeTrigger({ triggerId: 'tr_watch', description: 'Design triage' });
    const { rerenderDialog } = renderDialog({
      triggers: [first],
      highlightTriggerId: 'tr_watch',
      onToggleTrigger,
      onDeleteTrigger,
    });

    // Open confirm bar first so we also verify Keep and Delete trigger reflect aria-disabled while toggling.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const toggleBtn = screen.getByRole('button', { name: 'Disable' });
    toggleBtn.focus();
    fireEvent.click(toggleBtn);
    expect(document.activeElement).toBe(toggleBtn);
    expect(toggleBtn.hasAttribute('disabled')).toBe(false);
    expect(toggleBtn.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Keep' }).getAttribute('aria-disabled')).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Delete trigger' }).getAttribute('aria-disabled')
    ).toBe('true');
    fireEvent.click(toggleBtn);
    expect(onToggleTrigger).toHaveBeenCalledTimes(1);

    // Updating rows while focus is on a button inside the dialog does not steal focus back to the card.
    rerenderDialog({
      triggers: [first, makeTrigger({ triggerId: 'tr_other', description: 'Other' })],
      highlightTriggerId: 'tr_watch',
    });
    expect(document.activeElement).toBe(toggleBtn);

    resolveToggle();
    await waitFor(() => expect(toggleBtn.getAttribute('aria-disabled')).toBeNull());

    const confirmDeleteBtn = screen.getByRole('button', { name: 'Delete trigger' });
    confirmDeleteBtn.focus();
    fireEvent.click(confirmDeleteBtn);
    expect(document.activeElement).toBe(confirmDeleteBtn);
    expect(confirmDeleteBtn.hasAttribute('disabled')).toBe(false);
    expect(confirmDeleteBtn.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(confirmDeleteBtn);
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onDeleteTrigger).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Deleting...' })).toBe(confirmDeleteBtn);

    resolveDelete();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull());
  });
});
