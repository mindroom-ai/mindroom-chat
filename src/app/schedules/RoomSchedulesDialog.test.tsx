// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';
import { RoomSchedulesDialog } from './RoomSchedulesDialog';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(async () => true),
  renderMatrixMention: vi.fn<(...args: unknown[]) => React.ReactNode>(() => undefined),
}));

vi.mock('./roomSchedules.css', () => ({
  Dialog: 'dialog',
  Header: 'header',
  HeaderCount: 'header-count',
  Content: 'content',
  Empty: 'empty',
  FilterBar: 'filter-bar',
  FilterPill: 'filter-pill',
  FilterPillActive: 'filter-pill-active',
  FilterCount: 'filter-count',
  GroupHeading: 'group-heading',
  Item: 'item',
  RowHeader: 'row-header',
  IconTile: 'icon-tile',
  IconTilePrimary: 'icon-tile-primary',
  IconTileSuccess: 'icon-tile-success',
  IconTileWarning: 'icon-tile-warning',
  RowBody: 'row-body',
  RowTopLine: 'row-top-line',
  RowTitle: 'row-title',
  StatusPill: 'status-pill',
  StatusPillPrimary: 'status-pill-primary',
  StatusPillSuccess: 'status-pill-success',
  StatusPillWarning: 'status-pill-warning',
  RowSubtitle: 'row-subtitle',
  SubtitleDot: 'subtitle-dot',
  Chevron: 'chevron',
  ChevronOpen: 'chevron-open',
  Drawer: 'drawer',
  ChipRow: 'chip-row',
  Chip: 'chip',
  PromptWell: 'prompt-well',
  Wrap: 'wrap',
  Prompt: 'prompt',
  PromptClamped: 'prompt-clamped',
  InlineCode: 'inline-code',
  PromptMention: 'prompt-mention',
  PromptToggle: 'prompt-toggle',
  CancelBar: 'cancel-bar',
  CancelBarActions: 'cancel-bar-actions',
  CancelError: 'cancel-error',
  CancelSentBar: 'cancel-sent-bar',
  ActionsRow: 'actions-row',
  ActionsPrimary: 'actions-primary',
  ActionsSecondary: 'actions-secondary',
  Metadata: 'metadata',
  TaskId: 'task-id',
  Awaiting: 'awaiting',
  SrOnly: 'sr-only',
}));
vi.mock('../lib/dom', () => ({ copyToClipboard: mocks.copyToClipboard }));
vi.mock('../ui/page/PageScroll', () => ({
  PageScroll: ({ header, children }: React.PropsWithChildren<{ header?: React.ReactNode }>) =>
    React.createElement('div', null, header, children),
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../messages/useMentionClickHandler', () => ({ useMentionClickHandler: () => vi.fn() }));
vi.mock('../messages/html/react-custom-html-parser', () => ({
  makeMentionCustomProps: () => ({}),
  renderMatrixMention: (...args: unknown[]) => mocks.renderMatrixMention(...args),
}));

const makeTask = (overrides: Partial<ParsedScheduledTask> = {}): ParsedScheduledTask => ({
  taskId: 'task-1',
  status: 'pending',
  threadId: null,
  newThread: false,
  executeAt: null,
  scheduleType: 'once',
  ...overrides,
});

const mountDialog = (props: React.ComponentProps<typeof RoomSchedulesDialog>) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = (nextProps: React.ComponentProps<typeof RoomSchedulesDialog>) => {
    act(() => {
      root.render(<RoomSchedulesDialog {...nextProps} />);
    });
  };
  render(props);
  return {
    host,
    rerender: render,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
};

const findButtonByText = (container: Element, label: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (btn) => btn.textContent?.trim() === label
  );

const findButtonByAriaLabel = (container: Element, label: string): HTMLButtonElement | undefined =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? undefined;

const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

beforeEach(() => {
  mocks.copyToClipboard.mockReset();
  mocks.copyToClipboard.mockResolvedValue(true);
  mocks.renderMatrixMention.mockReset();
  mocks.renderMatrixMention.mockReturnValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RoomSchedulesDialog destinations', () => {
  const threadId = '$orchard:example.org';
  const local = makeTask({ taskId: 'Check the saplings', threadId });
  const elsewhere = [
    makeTask({ taskId: 'Check the seedlings', threadId: null }),
    makeTask({ taskId: 'Start a new planting log', threadId, newThread: true }),
    makeTask({ taskId: 'Check the herbs', threadId: '$garden:example.org' }),
  ];

  const headings = (tasks: ParsedScheduledTask[], openThreadId?: string) => {
    const { host, unmount } = mountDialog({
      roomId: '!room:example.org',
      tasks,
      openThreadId,
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    const result = [...host.querySelectorAll('h3, h4')].map((el) => el.textContent ?? '');
    unmount();
    return result;
  };

  it('puts the open thread first without dropping room tasks or tasks that start a new thread', () => {
    expect(headings([elsewhere[0]!, local, ...elsewhere.slice(1)], threadId)).toEqual([
      'This thread',
      'Check the saplings',
      'Elsewhere in this room',
      'Check the seedlings',
      'Start a new planting log',
      'Check the herbs',
    ]);
  });

  it.each([true, false])(
    'keeps a card button focused when the other group arrives (local first: %s)',
    (localFirst) => {
      const first = localFirst ? local : elsewhere[2]!;
      const next = localFirst ? elsewhere[2]! : local;
      const base = {
        roomId: '!room:example.org',
        openThreadId: threadId,
        onClose: vi.fn(),
        onOpenThread: vi.fn(),
      };
      const { host, rerender, unmount } = mountDialog({ ...base, tasks: [first] });
      try {
        const button = host.querySelector<HTMLButtonElement>('article button')!;
        button.focus();
        expect(document.activeElement).toBe(button);
        rerender({ ...base, tasks: [first, next] });
        expect(host.textContent).toContain('Elsewhere in this room');
        expect(document.activeElement).toBe(button);
      } finally {
        unmount();
      }
    }
  );

  it('omits group headings outside threads or when only one group has tasks', () => {
    expect(headings([elsewhere[0]!, local])).toEqual(['Check the seedlings', 'Check the saplings']);
    expect(headings([local], threadId)).toEqual(['Check the saplings']);
    expect(headings(elsewhere, threadId)).toEqual(elsewhere.map(({ taskId }) => taskId));
  });
});

describe('RoomSchedulesDialog accordion and filters', () => {
  it('auto-expands a single task and collapses multiple tasks by default', async () => {
    const first = makeTask({ taskId: 'one', description: 'First task', message: 'First prompt' });
    const second = makeTask({
      taskId: 'two',
      description: 'Second task',
      message: 'Second prompt',
    });

    const single = mountDialog({
      roomId: '!room:example.org',
      tasks: [first],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    try {
      const headerBtn = single.host.querySelector<HTMLButtonElement>('article button.row-header')!;
      expect(headerBtn.getAttribute('aria-expanded')).toBe('true');
      expect(single.host.textContent).toContain('First prompt');
    } finally {
      single.unmount();
    }

    const multi = mountDialog({
      roomId: '!room:example.org',
      tasks: [first, second],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    try {
      const headers = [
        ...multi.host.querySelectorAll<HTMLButtonElement>('article button.row-header'),
      ];
      expect(headers).toHaveLength(2);
      expect(headers.map((btn) => btn.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
      expect(multi.host.querySelector('.drawer')).toBeNull();

      await click(headers[1]!);
      expect(headers[0]!.getAttribute('aria-expanded')).toBe('false');
      expect(headers[1]!.getAttribute('aria-expanded')).toBe('true');
      expect(multi.host.textContent).toContain('Second prompt');

      await click(headers[1]!);
      expect(headers[1]!.getAttribute('aria-expanded')).toBe('false');
    } finally {
      multi.unmount();
    }
  });

  it('shows type filter pills only when both types exist and resets to All if the active category empties', async () => {
    const onceTask = makeTask({
      taskId: 'once-1',
      description: 'One-off check',
      scheduleType: 'once',
    });
    const cronTask = makeTask({
      taskId: 'cron-1',
      description: 'Weekly digest',
      scheduleType: 'cron',
      cronDescription: 'Every Monday',
    });

    const singleType = mountDialog({
      roomId: '!room:example.org',
      tasks: [onceTask],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    try {
      expect(singleType.host.querySelector('.filter-bar')).toBeNull();
    } finally {
      singleType.unmount();
    }

    const base = {
      roomId: '!room:example.org',
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    };
    const mixed = mountDialog({ ...base, tasks: [onceTask, cronTask] });
    try {
      const filterBar = mixed.host.querySelector('.filter-bar')!;
      expect(filterBar).not.toBeNull();
      const pills = [...filterBar.querySelectorAll<HTMLButtonElement>('button')];
      expect(pills.map((btn) => btn.textContent)).toEqual(['All2', 'One-time1', 'Recurring1']);
      expect(pills.map((btn) => btn.getAttribute('aria-pressed'))).toEqual([
        'true',
        'false',
        'false',
      ]);

      await click(pills[2]!);
      expect(mixed.host.querySelectorAll('article')).toHaveLength(1);
      expect(mixed.host.textContent).toContain('Weekly digest');
      expect(mixed.host.textContent).not.toContain('One-off check');

      // When live sync removes the recurring task, effective filter resets to All.
      mixed.rerender({ ...base, tasks: [onceTask] });
      expect(mixed.host.querySelector('.filter-bar')).toBeNull();
      expect(mixed.host.querySelectorAll('article')).toHaveLength(1);
      expect(mixed.host.textContent).toContain('One-off check');
    } finally {
      mixed.unmount();
    }
  });
});

describe('RoomSchedulesDialog prompt formatting and details', () => {
  it('renders inline code and mentions with exact textContent and clamps long prompts', async () => {
    const shortTask = makeTask({
      taskId: 'stretch',
      description: 'Stretch reminder',
      message: '@helper remind me to stretch',
    });
    const shortView = mountDialog({
      roomId: '!room:example.org',
      tasks: [shortTask],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    try {
      const promptEl = shortView.host.querySelector('p.prompt')!;
      expect(promptEl.textContent).toBe('@helper remind me to stretch');
      expect(promptEl.querySelector('.prompt-mention')?.textContent).toBe('@helper');
      expect(promptEl.className).not.toContain('prompt-clamped');
      expect(findButtonByText(shortView.host, 'Show full prompt')).toBeUndefined();
    } finally {
      shortView.unmount();
    }

    const longTask = makeTask({
      taskId: 'long',
      description: 'Detailed check',
      message: 'Run `status-check`\nLine two\nLine three\nLine four with @helper',
    });
    const longView = mountDialog({
      roomId: '!room:example.org',
      tasks: [longTask],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    try {
      const promptEl = longView.host.querySelector('p.prompt')!;
      expect(promptEl.className).toContain('prompt-clamped');
      expect(promptEl.querySelector('code.inline-code')?.textContent).toBe('status-check');
      const toggle = findButtonByText(longView.host, 'Show full prompt')!;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');

      await click(toggle);
      expect(longView.host.querySelector('p.prompt')!.className).not.toContain('prompt-clamped');
      expect(findButtonByText(longView.host, 'Show less')?.getAttribute('aria-expanded')).toBe(
        'true'
      );
    } finally {
      longView.unmount();
    }
  });

  it('hides metadata until Details is opened and omits Updated when equal to Created', async () => {
    mocks.renderMatrixMention.mockReturnValue(
      React.createElement('a', { href: 'https://matrix.to/#/@alice:example.org' }, '@Alice')
    );
    const sameTimestamps = makeTask({
      taskId: 'task-same',
      description: 'Same timestamps',
      createdBy: '@alice:example.org',
      createdAt: '2026-09-15T12:00:00Z',
      updatedAt: '2026-09-15T12:00:00Z',
    });
    const differentTimestamps = makeTask({
      ...sameTimestamps,
      updatedAt: '2026-09-16T12:00:00Z',
    });
    const base = {
      roomId: '!room:example.org',
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    };
    const { host, rerender, unmount } = mountDialog({ ...base, tasks: [sameTimestamps] });
    try {
      expect(host.querySelector('dl')).toBeNull();
      const detailsBtn = findButtonByText(host, 'Details')!;
      await click(detailsBtn);

      const dl = host.querySelector('dl')!;
      expect(dl).not.toBeNull();
      expect(dl.textContent).toContain('task-same');
      expect(dl.querySelector('a')?.textContent).toBe('@Alice');
      expect(dl.textContent).toContain('Created');
      expect(dl.textContent).not.toContain('Updated');

      rerender({ ...base, tasks: [differentTimestamps] });
      expect(host.querySelector('dl')?.textContent).toContain('Updated');
    } finally {
      unmount();
    }
  });
});

describe('RoomSchedulesDialog actions', () => {
  it('copies the task ID, shows Copied for 2s, and opens Details if clipboard copy fails', async () => {
    vi.useFakeTimers();
    const task = makeTask({ taskId: 'sched-42', description: 'Copy target' });
    const { host, unmount } = mountDialog({
      roomId: '!room:example.org',
      tasks: [task],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    try {
      const copyBtn = findButtonByText(host, 'Copy ID')!;
      await click(copyBtn);
      expect(mocks.copyToClipboard).toHaveBeenCalledWith('sched-42');
      expect(findButtonByText(host, 'Copied')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(findButtonByText(host, 'Copy ID')).toBeDefined();

      mocks.copyToClipboard.mockResolvedValueOnce(false);
      expect(host.querySelector('dl')).toBeNull();
      await click(findButtonByText(host, 'Copy ID')!);
      expect(host.querySelector('dl')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it('supports inline cancel confirmation, pending state, error retry, and edit callback', async () => {
    const task = makeTask({ taskId: 'sched-99', description: 'Actionable task' });
    let resolveCancel: (() => void) | undefined;
    const onCancelTask = vi
      .fn<(t: ParsedScheduledTask) => Promise<void>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveCancel = resolve;
          })
      );
    const onEditTask = vi.fn();

    const { host, unmount } = mountDialog({
      roomId: '!room:example.org',
      tasks: [task],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onCancelTask,
      onEditTask,
    });
    try {
      const editBtn = findButtonByAriaLabel(host, 'Edit')!;
      await click(editBtn);
      expect(onEditTask).toHaveBeenCalledWith(task);

      const cancelIcon = findButtonByAriaLabel(host, 'Cancel')!;
      await click(cancelIcon);
      expect(host.textContent).toContain('Cancel this scheduled task?');

      // Clicking Keep dismisses confirmation without calling onCancelTask.
      await click(findButtonByText(host, 'Keep')!);
      expect(host.textContent).not.toContain('Cancel this scheduled task?');
      expect(onCancelTask).not.toHaveBeenCalled();

      // Re-open and confirm -> first attempt fails and displays inline error.
      await click(cancelIcon);
      await click(findButtonByText(host, 'Cancel task')!);
      expect(onCancelTask).toHaveBeenCalledTimes(1);
      expect(host.textContent).toContain('Could not cancel task. Try again.');

      // Retry -> shows pending disabled state, then Cancellation sent on resolve.
      const retryBtn = findButtonByText(host, 'Cancel task')!;
      await click(retryBtn);
      const pendingBtn = findButtonByText(host, 'Cancelling...')!;
      expect(pendingBtn.disabled).toBe(true);

      await act(async () => {
        resolveCancel?.();
      });
      expect(host.textContent).toContain('Cancellation sent');
    } finally {
      unmount();
    }
  });

  it('omits Edit and Cancel buttons when callbacks are not passed', () => {
    const task = makeTask({ taskId: 'read-only', description: 'Read-only task' });
    const { host, unmount } = mountDialog({
      roomId: '!room:example.org',
      tasks: [task],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    try {
      expect(findButtonByAriaLabel(host, 'Edit')).toBeUndefined();
      expect(findButtonByAriaLabel(host, 'Cancel')).toBeUndefined();
      expect(findButtonByText(host, 'Copy ID')).toBeDefined();
    } finally {
      unmount();
    }
  });
});

describe('RoomSchedulesDialog recurrence', () => {
  const recurrenceDetailsText = async (task: Partial<ParsedScheduledTask>): Promise<string> => {
    const { host, unmount } = mountDialog({
      roomId: '!room:example.org',
      tasks: [makeTask({ scheduleType: 'cron', ...task })],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    try {
      await click(findButtonByText(host, 'Details')!);
      const dts = [...host.querySelectorAll('dl dt')];
      const recurrenceDt = dts.find((dt) => dt.textContent === 'Recurrence')!;
      return recurrenceDt.nextElementSibling?.textContent ?? '';
    } finally {
      unmount();
    }
  };

  it('shows the description as the runtime wrote it and marks the cron expression as UTC', async () => {
    expect(
      await recurrenceDetailsText({
        cronDescription: 'At 12:00, only on Monday (America/Los_Angeles)',
        cronExpression: '0 19 * * 1',
      })
    ).toBe('At 12:00, only on Monday (America/Los_Angeles)0 19 * * 1 (UTC)');
  });

  it('does not add a zone to a description from a runtime that names none', async () => {
    expect(
      await recurrenceDetailsText({
        cronDescription: 'At 12:00, only on Monday',
        cronExpression: '0 19 * * 1',
      })
    ).toBe('At 12:00, only on Monday0 19 * * 1 (UTC)');
  });

  it('marks the cron expression as UTC when it is the only recurrence line', async () => {
    expect(await recurrenceDetailsText({ cronExpression: '0 19 * * 1' })).toBe('0 19 * * 1 (UTC)');
  });

  it('shows no zone without a description or cron expression', async () => {
    expect(await recurrenceDetailsText({})).toBe('Execution time unavailable');
  });
});
