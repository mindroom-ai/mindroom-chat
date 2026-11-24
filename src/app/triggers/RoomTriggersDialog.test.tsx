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
  getRoom: (id: string) =>
    id === '!other:example.org'
      ? {
          roomId: id,
          name: 'Release Ops',
          getMember: () => null,
          loadMembersIfNeeded: async () => true,
        }
      : {
          roomId: ROOM_ID,
          name: 'Design',
          getMember: () => null,
          loadMembersIfNeeded: async () => true,
        },
} as unknown as MatrixClient;

const makeTrigger = (overrides: Partial<RoomTrigger> = {}): RoomTrigger => ({
  triggerId: 'tr_watch',
  kind: 'room_message',
  relation: 'target',
  description: 'Design triage',
  prompt: 'Summarize new issues in the `design` channel for @alice.',
  agent: 'assistant',
  targetRoomId: ROOM_ID,
  targetThreadId: '$triage-thread',
  threadMode: 'thread',
  enabled: true,
  disabledReason: null,
  once: false,
  expiresAt: null,
  lastFiredAt: NOW - 5 * 60_000,
  ownerUserId: '@alice:example.org',
  canManage: true,
  ...overrides,
});

const renderDialog = (
  props: Partial<React.ComponentProps<typeof RoomTriggersDialog>> = {}
) => {
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
  it('renders rows of every kind with thread link, prompt, state, last fired, and details', () => {
    const triggers: RoomTrigger[] = [
      makeTrigger(),
      makeTrigger({
        triggerId: 'tr_hook',
        kind: 'webhook',
        description: 'Release webhook',
        prompt: null,
        targetThreadId: null,
        threadMode: 'room',
        lastFiredAt: null,
      }),
      makeTrigger({
        triggerId: 'tr_event',
        kind: 'external_event',
        description: '',
        prompt: 'Report staging alerts',
        targetThreadId: null,
        threadMode: 'new_thread',
        ownerUserId: '@bob:example.org',
        canManage: false,
      }),
      makeTrigger({
        triggerId: 'tr_tag',
        kind: 'thread_tag',
        relation: 'watch',
        description: 'Urgent watch',
        prompt: 'Flag urgent threads',
        targetRoomId: '!other:example.org',
        targetThreadId: null,
        threadMode: 'origin',
        enabled: false,
        disabledReason: 'expired',
        once: true,
        expiresAt: NOW + 3_600_000,
      }),
    ];

    const { onOpenThread } = renderDialog({ triggers });
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(4);

    // Room watch row: kind, prompt with inline code, On state, relative last fired, Open thread.
    const watchCard = cards[0]!;
    expect(watchCard.textContent).toContain('Design triage');
    expect(watchCard.textContent).toContain('Room watch');
    expect(watchCard.textContent).toContain('On');
    expect(watchCard.textContent).toContain('Last fired');
    expect(watchCard.querySelector('code')?.textContent).toBe('design');
    fireEvent.click(within(watchCard).getByRole('button', { name: 'Open thread' }));
    expect(onOpenThread).toHaveBeenCalledWith('$triage-thread', ROOM_ID);

    // Webhook row: Webhook kind, Never fired, no prompt box.
    const hookCard = cards[1]!;
    expect(hookCard.textContent).toContain('Release webhook');
    expect(hookCard.textContent).toContain('Webhook');
    expect(hookCard.textContent).toContain('Never fired');
    expect(within(hookCard).queryByRole('region', { name: 'Prompt' })).toBeNull();

    // Non-owner event subscription row: kind as title when description empty, NO manage buttons.
    const eventCard = cards[2]!;
    expect(eventCard.textContent).toContain('Event subscription');
    expect(eventCard.textContent).toContain('Report staging alerts');
    expect(within(eventCard).queryByRole('button', { name: /Enable|Disable/ })).toBeNull();
    expect(within(eventCard).queryByRole('button', { name: 'Delete' })).toBeNull();

    // Thread tag watch row: Off, Expired, Watching this room, Details reveals metadata.
    const tagCard = cards[3]!;
    expect(tagCard.textContent).toContain('Thread tag');
    expect(tagCard.textContent).toContain('Watching this room');
    expect(tagCard.textContent).toContain('Off');
    expect(tagCard.textContent).toContain('Expired');
    fireEvent.click(within(tagCard).getByRole('button', { name: 'Details' }));
    expect(tagCard.textContent).toContain('tr_tag');
    expect(tagCard.textContent).toContain('Release Ops');
    expect(tagCard.textContent).toContain('Runs once');
  });

  it('lets the owner toggle enable/disable and confirm-delete, reporting errors cleanly', async () => {
    const onToggleTrigger = vi
      .fn<(...args: [string, boolean]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    const onDeleteTrigger = vi.fn(async () => undefined);

    renderDialog({ onToggleTrigger, onDeleteTrigger });

    // Failed toggle shows alert, then retry succeeds.
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not update'));
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(onToggleTrigger).toHaveBeenCalledWith('tr_watch', false));

    // Delete requires confirmation: Keep cancels without deleting.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const keepButton = screen.getByRole('button', { name: 'Keep' });
    expect(document.activeElement).toBe(keepButton);
    fireEvent.click(keepButton);
    expect(onDeleteTrigger).not.toHaveBeenCalled();

    // Confirming Delete trigger calls onDeleteTrigger.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete trigger' }));
    await waitFor(() => expect(onDeleteTrigger).toHaveBeenCalledWith('tr_watch'));
  });

  it('highlights and focuses a wake-pill target row, or explains when it is gone', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const { rerender } = renderDialog({
      triggers: [
        makeTrigger({ triggerId: 'tr_first', description: 'First' }),
        makeTrigger({ triggerId: 'tr_target', description: 'Target' }),
      ],
      highlightTriggerId: 'tr_target',
      highlightRequest: {},
    });

    const targetCard = document.querySelector('[data-trigger-id="tr_target"]');
    expect(targetCard?.getAttribute('data-highlighted')).toBe('true');
    expect(scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(targetCard);
    expect(document.querySelector('[data-trigger-missing]')).toBeNull();

    // While loading, do not prematurely claim a missing trigger is gone.
    rerender(
      <MatrixClientProvider value={mx}>
        <MemoryRouter>
          <RoomTriggersDialog
            roomId={ROOM_ID}
            triggers={[]}
            loading
            highlightTriggerId="tr_gone"
            highlightRequest={{}}
            onClose={vi.fn()}
            onOpenThread={vi.fn()}
            onToggleTrigger={vi.fn(async () => undefined)}
            onDeleteTrigger={vi.fn(async () => undefined)}
          />
        </MemoryRouter>
      </MatrixClientProvider>
    );
    expect(document.querySelector('[data-trigger-missing]')).toBeNull();

    // Once loaded without the trigger, show the missing notice.
    rerender(
      <MatrixClientProvider value={mx}>
        <MemoryRouter>
          <RoomTriggersDialog
            roomId={ROOM_ID}
            triggers={[]}
            loading={false}
            highlightTriggerId="tr_gone"
            highlightRequest={{}}
            onClose={vi.fn()}
            onOpenThread={vi.fn()}
            onToggleTrigger={vi.fn(async () => undefined)}
            onDeleteTrigger={vi.fn(async () => undefined)}
          />
        </MemoryRouter>
      </MatrixClientProvider>
    );
    expect(document.querySelector('[data-trigger-missing]')?.textContent).toContain('tr_gone');
  });
});
