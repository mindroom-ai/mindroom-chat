// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { RoomTriggersDialog } from './RoomTriggersDialog';
import type { RoomTrigger } from './roomTriggersApi';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return {
    useTranslation: () => ({
      t: translateFromEn,
      i18n: { language: 'en', resolvedLanguage: 'en' },
    }),
  };
});

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

const renderDialog = (props: Partial<React.ComponentProps<typeof RoomTriggersDialog>> = {}) => {
  const onClose = vi.fn();
  const onOpenThread = vi.fn();
  const onToggleTrigger = vi.fn(async () => undefined);
  const onDeleteTrigger = vi.fn(async () => undefined);
  const view = render(
    <MatrixClientProvider value={mx}>
      <MemoryRouter>
        <RoomTriggersDialog
          roomId={ROOM_ID}
          triggers={[makeTrigger()]}
          onClose={onClose}
          onOpenThread={onOpenThread}
          onToggleTrigger={onToggleTrigger}
          onDeleteTrigger={onDeleteTrigger}
          {...props}
        />
      </MemoryRouter>
    </MatrixClientProvider>
  );
  return { ...view, onClose, onOpenThread, onToggleTrigger, onDeleteTrigger };
};

afterEach(() => {
  cleanup();
});

describe('RoomTriggersDialog', () => {
  it('renders rows with trigger IDs, unknown kind/thread_mode fallbacks, disabled reasons, and non-owner subtitle', () => {
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

    // Described row shows description as title, trigger ID in subtitle, prompt, thread link.
    const watchCard = cards[0]!;
    expect(within(watchCard).getByRole('heading', { name: 'Design triage' })).toBeTruthy();
    expect(watchCard.textContent).toContain('Room watch');
    expect(watchCard.textContent).toContain('tr_watch');
    expect(watchCard.textContent).toContain('Thread');
    expect(watchCard.querySelector('[data-mention-id]')).toBeNull();
    fireEvent.click(within(watchCard).getByRole('button', { name: 'Open thread' }));
    expect(onOpenThread).toHaveBeenCalledWith('$triage-thread', ROOM_ID);

    // Undescribed unknown-kind non-owner row: trigger ID as title, generic Trigger label, no dest text, Used, owner, no manage buttons.
    const futureCard = cards[1]!;
    expect(within(futureCard).getByRole('heading', { name: 'tr_future' })).toBeTruthy();
    expect(futureCard.textContent).toContain('Trigger');
    expect(futureCard.textContent).toContain('Used');
    expect(futureCard.textContent).toContain('Never fired');
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

  it('lets the owner toggle enable/disable and confirm-delete, reporting errors cleanly', async () => {
    const onToggleTrigger = vi
      .fn<(...args: [string, boolean]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    const onDeleteTrigger = vi.fn(async () => undefined);

    renderDialog({ onToggleTrigger, onDeleteTrigger });

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Could not update')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(onToggleTrigger).toHaveBeenCalledWith('tr_watch', false));

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const keepButton = screen.getByRole('button', { name: 'Keep' });
    expect(document.activeElement).toBe(keepButton);
    fireEvent.click(keepButton);
    expect(onDeleteTrigger).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete trigger' }));
    await waitFor(() => expect(onDeleteTrigger).toHaveBeenCalledWith('tr_watch'));
  });

  it('highlights a target row, shows missing notice on empty success, and shows loadError on failure', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const { rerender } = renderDialog({
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

    // Failed load: show only the single error line, not empty state or missing notice.
    rerender(
      <MatrixClientProvider value={mx}>
        <MemoryRouter>
          <RoomTriggersDialog
            roomId={ROOM_ID}
            triggers={[]}
            loadFailed
            highlightTriggerId="tr_gone"
            onClose={vi.fn()}
            onOpenThread={vi.fn()}
            onToggleTrigger={vi.fn(async () => undefined)}
            onDeleteTrigger={vi.fn(async () => undefined)}
          />
        </MemoryRouter>
      </MatrixClientProvider>
    );
    expect(document.querySelector('[data-triggers-error]')?.textContent).toBe(
      "Couldn't load triggers."
    );
    expect(document.querySelector('[data-trigger-missing]')).toBeNull();
    expect(screen.queryByText('No triggers in this room.')).toBeNull();

    // Successful empty load: show missing notice + empty state.
    rerender(
      <MatrixClientProvider value={mx}>
        <MemoryRouter>
          <RoomTriggersDialog
            roomId={ROOM_ID}
            triggers={[]}
            loading={false}
            loadFailed={false}
            highlightTriggerId="tr_gone"
            onClose={vi.fn()}
            onOpenThread={vi.fn()}
            onToggleTrigger={vi.fn(async () => undefined)}
            onDeleteTrigger={vi.fn(async () => undefined)}
          />
        </MemoryRouter>
      </MatrixClientProvider>
    );
    expect(document.querySelector('[data-trigger-missing]')?.textContent).toContain('tr_gone');
    expect(screen.getByText('No triggers in this room.')).toBeTruthy();
  });
});
