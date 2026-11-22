// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';
import { RoomSchedulesDialog, useScheduleCancelState } from './RoomSchedulesDialog';

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
  RowHeading: 'row-heading',
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
  NoticeBar: 'notice-bar',
  ActionsRow: 'actions-row',
  ActionsPrimary: 'actions-primary',
  ActionsSecondary: 'actions-secondary',
  CompactAction: 'compact-action',
  IconAction: 'icon-action',
  CopiedStatus: 'copied-status',
  CancelBarButton: 'cancel-bar-button',
  IconMuted: 'icon-muted',
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

describe('RoomSchedulesDialog destinations and heading semantics', () => {
  const threadId = '$orchard:example.org';
  const local = makeTask({ taskId: 'saplings', description: 'Check the saplings', threadId });
  const elsewhere = [
    makeTask({ taskId: 'seedlings', description: 'Check the seedlings', threadId: null }),
    makeTask({
      taskId: 'planting-log',
      description: 'Start a new planting log',
      threadId,
      newThread: true,
    }),
    makeTask({ taskId: 'herbs', description: 'Check the herbs', threadId: '$garden:example.org' }),
  ];

  const headings = (tasks: ParsedScheduledTask[], openThreadId?: string) => {
    const { host, unmount } = mountDialog({
      roomId: '!room:example.org',
      tasks,
      openThreadId,
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    // Headings wrap accordion buttons cleanly and never sit inside buttons.
    expect(host.querySelectorAll('button [role="heading"], button h3, button h4')).toHaveLength(0);
    expect(host.querySelectorAll('article > [role="heading"] > button')).toHaveLength(tasks.length);
    const result = [...host.querySelectorAll('h3, h4, [role="heading"]')].map(
      (el) => el.querySelector('.row-title')?.textContent ?? el.textContent ?? ''
    );
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
    'keeps row toggle button focused when grouped flips false -> true -> false (local first: %s)',
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
        const toggleBtn = host.querySelector<HTMLButtonElement>('button[data-schedule-toggle]')!;
        const headingEl = toggleBtn.parentElement!;
        expect(headingEl.getAttribute('role')).toBe('heading');
        expect(headingEl.getAttribute('aria-level')).toBe('3');
        toggleBtn.focus();
        expect(document.activeElement).toBe(toggleBtn);

        rerender({ ...base, tasks: [first, next] });
        expect(host.textContent).toContain('Elsewhere in this room');
        expect(headingEl.getAttribute('aria-level')).toBe('4');
        expect(document.activeElement).toBe(toggleBtn);

        rerender({ ...base, tasks: [first] });
        expect(headingEl.getAttribute('aria-level')).toBe('3');
        expect(document.activeElement).toBe(toggleBtn);
      } finally {
        unmount();
      }
    }
  );

  it.each([true, false])(
    'keeps a single auto-expanded card open and Open thread focused when the other group arrives (local first: %s)',
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
        const openThreadBtn = findButtonByText(host, 'Open thread')!;
        expect(openThreadBtn).toBeDefined();
        openThreadBtn.focus();
        expect(document.activeElement).toBe(openThreadBtn);

        rerender({ ...base, tasks: [first, next] });
        expect(host.textContent).toContain('Elsewhere in this room');
        expect(document.activeElement).toBe(openThreadBtn);
        expect(
          openThreadBtn
            .closest('article')
            ?.querySelector<HTMLButtonElement>('button.row-header')
            ?.getAttribute('aria-expanded')
        ).toBe('true');
      } finally {
        unmount();
      }
    }
  );

  it('omits group headings outside threads or when only one group has tasks', () => {
    expect(headings([elsewhere[0]!, local])).toEqual(['Check the seedlings', 'Check the saplings']);
    expect(headings([local], threadId)).toEqual(['Check the saplings']);
    expect(headings(elsewhere, threadId)).toEqual(elsewhere.map(({ description }) => description));
  });
});

describe('RoomSchedulesDialog accordion, filters, and focus recovery', () => {
  it('auto-expands a single initial task, collapses multiple tasks, and sets aria-controls only when open', async () => {
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
      expect(headerBtn.getAttribute('aria-controls')).toBeTruthy();
      expect(single.host.textContent).toContain('First prompt');
      const detailsBtn = findButtonByText(single.host, 'Details')!;
      expect(detailsBtn.getAttribute('aria-controls')).toBeNull();
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
      expect(headers.map((btn) => btn.getAttribute('aria-controls'))).toEqual([null, null]);
      expect(multi.host.querySelector('.drawer')).toBeNull();

      await click(headers[1]!);
      expect(headers[0]!.getAttribute('aria-expanded')).toBe('false');
      expect(headers[1]!.getAttribute('aria-expanded')).toBe('true');
      expect(headers[1]!.getAttribute('aria-controls')).toBeTruthy();
      expect(multi.host.textContent).toContain('Second prompt');

      await click(headers[1]!);
      expect(headers[1]!.getAttribute('aria-expanded')).toBe('false');
      expect(headers[1]!.getAttribute('aria-controls')).toBeNull();
    } finally {
      multi.unmount();
    }
  });

  it('auto-expands when clicking a filter pill that narrows to 1 task, persists reset, and recovers focus cleanly', async () => {
    const onceTask = makeTask({
      taskId: 'once-1',
      description: 'One-off check',
      scheduleType: 'once',
    });
    const cronTask = makeTask({
      taskId: 'cron-1',
      description: 'Weekly digest',
      message: 'Summarize the week',
      scheduleType: 'cron',
      cronDescription: 'Every Monday',
    });

    const base = {
      roomId: '!room:example.org',
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    };
    const mixed = mountDialog({ ...base, tasks: [onceTask, cronTask] });
    try {
      const filterBar = mixed.host.querySelector('.filter-bar')!;
      const pills = [...filterBar.querySelectorAll<HTMLButtonElement>('button')];
      expect(pills.map((btn) => btn.textContent)).toEqual(['All2', 'One-time1', 'Recurring1']);
      expect(pills.map((btn) => btn.querySelectorAll('svg').length)).toEqual([1, 0, 0]);

      // Clicking Recurring narrows to 1 task and auto-expands it.
      pills[2]!.focus();
      await click(pills[2]!);
      expect(mixed.host.querySelectorAll('article')).toHaveLength(1);
      expect(mixed.host.textContent).toContain('Summarize the week');
      expect(
        mixed.host
          .querySelector<HTMLButtonElement>('button[data-schedule-toggle]')
          ?.getAttribute('aria-expanded')
      ).toBe('true');

      // Live sync removes the recurring task: filter resets to All and focus recovers inside dialog.
      mixed.rerender({ ...base, tasks: [onceTask] });
      expect(mixed.host.querySelector('.filter-bar')).toBeNull();
      expect(mixed.host.querySelectorAll('article')).toHaveLength(1);
      expect(document.activeElement).toBe(
        mixed.host.querySelector<HTMLButtonElement>('button[data-schedule-toggle]')
      );

      // When a recurring task returns later, the persisted reset keeps All active.
      mixed.rerender({ ...base, tasks: [onceTask, cronTask] });
      const returnedPills = [
        ...mixed.host.querySelectorAll<HTMLButtonElement>('.filter-bar button'),
      ];
      expect(returnedPills.map((btn) => btn.getAttribute('aria-pressed'))).toEqual([
        'true',
        'false',
        'false',
      ]);
      expect(mixed.host.querySelectorAll('article')).toHaveLength(2);

      // When a focused task row unmounts because it was cancelled, focus moves to the next toggle, then Close.
      const firstToggle = mixed.host.querySelector<HTMLButtonElement>(
        'button[data-schedule-toggle]'
      )!;
      firstToggle.focus();
      mixed.rerender({ ...base, tasks: [cronTask] });
      const remainingToggle = mixed.host.querySelector<HTMLButtonElement>(
        'button[data-schedule-toggle]'
      )!;
      expect(document.activeElement).toBe(remainingToggle);

      mixed.rerender({ ...base, tasks: [] });
      expect(document.activeElement).toBe(findButtonByAriaLabel(mixed.host, 'Close'));
    } finally {
      mixed.unmount();
    }
  });

  it('ticks every 1s for imminent one-time tasks so countdown transitions promptly to Awaiting', () => {
    vi.useFakeTimers();
    const baseNow = new Date('2026-09-15T12:00:00.000Z').getTime();
    vi.setSystemTime(baseNow);
    const imminent = makeTask({
      taskId: 'soon',
      description: 'Imminent task',
      executeAt: new Date(baseNow + 2_000).toISOString(),
    });
    const { host, unmount } = mountDialog({
      roomId: '!room:example.org',
      tasks: [imminent],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    try {
      expect(host.querySelector('.status-pill')?.textContent).toBe('in 2s');
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(host.querySelector('.status-pill')?.textContent).toBe('in 1s');
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(host.querySelector('.status-pill')?.textContent).toBe('Awaiting');
    } finally {
      unmount();
    }
  });
});

describe('RoomSchedulesDialog prompt formatting and details', () => {
  it('names the prompt region, renders code/mentions with exact textContent, and clamps long prompts', async () => {
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
      const region = shortView.host.querySelector('[role="region"][aria-label="Prompt"]');
      expect(region).not.toBeNull();
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
      expect(findButtonByText(host, 'Hide details')?.getAttribute('aria-controls')).toBeTruthy();

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

describe('RoomSchedulesDialog actions and keyboard focus', () => {
  it('copies the task ID, resets after 2s, and opens Details with a status notice on failure', async () => {
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
      expect(copyBtn.textContent?.trim()).toBe('Copy ID');
      const liveRegion = host.querySelector('span[role="status"][aria-live="polite"]');
      expect(liveRegion?.className).toBe('copied-status');
      expect(liveRegion?.textContent).toBe('Copied');

      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(copyBtn.textContent?.trim()).toBe('Copy ID');
      expect(liveRegion?.className).toBe('sr-only');
      expect(liveRegion?.textContent).toBe('');

      mocks.copyToClipboard.mockResolvedValueOnce(false);
      expect(host.querySelector('dl')).toBeNull();
      await click(copyBtn);
      expect(host.querySelector('dl')).not.toBeNull();
      const actionStatus = host.querySelector(
        '[data-schedule-action-status][role="status"][aria-live="polite"]'
      );
      expect(actionStatus?.textContent).toBe('Could not copy. Select the Task ID in Details.');
    } finally {
      unmount();
    }
  });

  it('hides Cancel and Edit buttons for unsafe task IDs and shows draft-busy notice on Edit', async () => {
    const unsafe = makeTask({ taskId: 'all', description: 'Reserved keyword ID' });
    const unsafeView = mountDialog({
      roomId: '!room:example.org',
      tasks: [unsafe],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onCancelTask: vi.fn(async () => undefined),
      onEditTask: vi.fn(),
    });
    try {
      expect(findButtonByAriaLabel(unsafeView.host, 'Edit')).toBeUndefined();
      expect(findButtonByAriaLabel(unsafeView.host, 'Cancel')).toBeUndefined();
    } finally {
      unsafeView.unmount();
    }

    const safe = makeTask({ taskId: 'sched_7', description: 'Editable task' });
    const onEditTask = vi.fn(() => 'draft-busy' as const);
    const safeView = mountDialog({
      roomId: '!room:example.org',
      tasks: [safe],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onEditTask,
    });
    try {
      await click(findButtonByAriaLabel(safeView.host, 'Edit')!);
      expect(onEditTask).toHaveBeenCalledWith(safe);
      expect(safeView.host.textContent).toContain(
        'Clear your current draft before editing this schedule.'
      );
    } finally {
      safeView.unmount();
    }
  });

  it('manages cancel focus, aria-controls, alert role, filter remount guard, and 6s sent auto-clear', async () => {
    vi.useFakeTimers();
    const onceTask = makeTask({
      taskId: 'sched-99',
      description: 'Actionable task',
      scheduleType: 'once',
    });
    const cronTask = makeTask({
      taskId: 'cron-1',
      description: 'Weekly task',
      scheduleType: 'cron',
    });
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

    const { host, unmount } = mountDialog({
      roomId: '!room:example.org',
      tasks: [onceTask, cronTask],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onCancelTask,
    });
    try {
      const rowToggle = host.querySelector<HTMLButtonElement>('article button.row-header')!;
      await click(rowToggle);

      const cancelIcon = findButtonByAriaLabel(host, 'Cancel')!;
      expect(cancelIcon.getAttribute('aria-controls')).toBeNull();

      // Opening cancel sets aria-controls and moves focus to Keep; Keep returns focus to Cancel.
      await click(cancelIcon);
      const confirmBar = host.querySelector('.cancel-bar')!;
      expect(cancelIcon.getAttribute('aria-controls')).toBe(confirmBar.id);
      const keepBtn = findButtonByText(host, 'Keep')!;
      expect(document.activeElement).toBe(keepBtn);

      await click(keepBtn);
      expect(host.textContent).not.toContain('Cancel this scheduled task?');
      expect(document.activeElement).toBe(cancelIcon);

      // Re-open -> first attempt fails and displays role="alert" error.
      await click(cancelIcon);
      await click(findButtonByText(host, 'Cancel task')!);
      expect(onCancelTask).toHaveBeenCalledTimes(1);
      const alert = host.querySelector('[role="alert"]');
      expect(alert?.textContent).toBe('Could not cancel task. Try again.');

      // Retry -> button uses aria-disabled (not HTML disabled) so focus stays on it.
      const retryBtn = findButtonByText(host, 'Cancel task')!;
      retryBtn.focus();
      await click(retryBtn);
      const pendingBtn = findButtonByText(host, 'Cancelling...')!;
      expect(pendingBtn.getAttribute('aria-disabled')).toBe('true');
      expect(pendingBtn.disabled).toBe(false);
      expect(document.activeElement).toBe(pendingBtn);

      // Switching filter away and back remounts the row, but lifted pending state still blocks double-submit.
      const filterButtons = [...host.querySelectorAll<HTMLButtonElement>('.filter-bar button')];
      await click(filterButtons[2]!); // Recurring (hides onceTask)
      await click(filterButtons[0]!); // All (remounts onceTask, still expanded)
      // Re-focus the pending cancel button so focus is inside the confirm bar before resolve.
      const onceArticle = host.querySelectorAll('article')[0]!;
      await click(onceArticle.querySelector('button.row-header')!);
      const stillPending = findButtonByText(onceArticle, 'Cancelling...')!;
      expect(stillPending.getAttribute('aria-disabled')).toBe('true');
      stillPending.focus();
      await click(stillPending);
      expect(onCancelTask).toHaveBeenCalledTimes(2);

      // Resolving cancel while focus is in confirm bar closes bar and focuses row toggle.
      await act(async () => {
        resolveCancel?.();
      });
      expect(host.textContent).toContain('Cancellation sent');
      expect(document.activeElement).toBe(
        onceArticle.querySelector<HTMLButtonElement>('button.row-header')
      );

      // Sent status auto-clears after 6 seconds so Cancel is usable again if backend rejected it.
      act(() => {
        vi.advanceTimersByTime(6_000);
      });
      expect(host.textContent).not.toContain('Cancellation sent');
      expect(
        findButtonByAriaLabel(onceArticle, 'Cancel')?.getAttribute('aria-disabled')
      ).toBeNull();
    } finally {
      unmount();
    }
  });

  it('does not steal focus on cancel completion when the user moved focus to Details or Close', async () => {
    let resolveCancel: (() => void) | undefined;
    const onCancelTask = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve;
        })
    );
    const task = makeTask({ taskId: 'sched-55', description: 'Background cancel' });
    const { host, unmount } = mountDialog({
      roomId: '!room:example.org',
      tasks: [task],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onCancelTask,
    });
    try {
      await click(findButtonByAriaLabel(host, 'Cancel')!);
      await click(findButtonByText(host, 'Cancel task')!);

      // User moves focus to Details while cancellation is still in-flight.
      const detailsBtn = findButtonByText(host, 'Details')!;
      detailsBtn.focus();
      expect(document.activeElement).toBe(detailsBtn);

      await act(async () => {
        resolveCancel?.();
      });
      expect(host.textContent).toContain('Cancellation sent');
      expect(document.activeElement).toBe(detailsBtn);
    } finally {
      unmount();
    }
  });

  it('does not jump focus on live updates when the previously focused control is still connected', () => {
    const first = makeTask({ taskId: 'keep-1', description: 'First task' });
    const second = makeTask({ taskId: 'keep-2', description: 'Second task' });
    const base = {
      roomId: '!room:example.org',
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    };
    const { host, rerender, unmount } = mountDialog({ ...base, tasks: [first] });
    try {
      const toggle = host.querySelector<HTMLButtonElement>('button[data-schedule-toggle]')!;
      toggle.focus();
      expect(document.activeElement).toBe(toggle);
      // Simulate clicking plain text so activeElement falls to body while toggle stays in the DOM.
      toggle.blur();
      expect(document.activeElement).toBe(document.body);

      rerender({ ...base, tasks: [first, second] });
      expect(document.activeElement).toBe(document.body);
    } finally {
      unmount();
    }
  });

  it('dismisses an open cancel confirmation when the row collapses', async () => {
    const first = makeTask({ taskId: 'collapse-1', description: 'Collapsible task' });
    const second = makeTask({ taskId: 'collapse-2', description: 'Other task' });
    const { host, unmount } = mountDialog({
      roomId: '!room:example.org',
      tasks: [first, second],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onCancelTask: vi.fn(async () => undefined),
    });
    try {
      const toggle = host.querySelector<HTMLButtonElement>('button[data-schedule-toggle]')!;
      await click(toggle);
      await click(findButtonByAriaLabel(host, 'Cancel')!);
      expect(host.textContent).toContain('Cancel this scheduled task?');

      // Collapsing and re-opening should not leave the stale confirmation bar open.
      await click(toggle);
      await click(toggle);
      expect(host.textContent).not.toContain('Cancel this scheduled task?');
    } finally {
      unmount();
    }
  });

  it('hides Edit while keeping Cancel for preApprovedCall tasks', () => {
    const preApproved = makeTask({
      taskId: 'call-1',
      description: 'Pre-approved call',
      preApprovedCall: true,
    });
    const { host, unmount } = mountDialog({
      roomId: '!room:example.org',
      tasks: [preApproved],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onCancelTask: vi.fn(async () => undefined),
      onEditTask: vi.fn(),
    });
    try {
      expect(findButtonByAriaLabel(host, 'Edit')).toBeUndefined();
      expect(findButtonByAriaLabel(host, 'Cancel')).toBeDefined();
    } finally {
      unmount();
    }
  });

  it('dismisses an open cancel confirmation and returns focus to row toggle when onCancelTask disappears', async () => {
    const task = makeTask({ taskId: 'revoke-1', description: 'Revoked permission task' });
    const base = {
      roomId: '!room:example.org',
      tasks: [task],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    };
    const { host, rerender, unmount } = mountDialog({
      ...base,
      onCancelTask: vi.fn(async () => undefined),
    });
    try {
      await click(findButtonByAriaLabel(host, 'Cancel')!);
      const keepBtn = findButtonByText(host, 'Keep')!;
      expect(document.activeElement).toBe(keepBtn);

      rerender({ ...base, onCancelTask: undefined });
      expect(host.textContent).not.toContain('Cancel this scheduled task?');
      expect(document.activeElement).toBe(
        host.querySelector<HTMLButtonElement>('button[data-schedule-toggle]')
      );
    } finally {
      unmount();
    }
  });

  it('hides the cancel error bar and restores focus to the row toggle when onCancelTask disappears', async () => {
    const task = makeTask({ taskId: 'revoke-err', description: 'Revoked during error' });
    const base = {
      roomId: '!room:example.org',
      tasks: [task],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    };
    const { host, rerender, unmount } = mountDialog({
      ...base,
      onCancelTask: vi.fn(async () => {
        throw new Error('network failed');
      }),
    });
    try {
      await click(findButtonByAriaLabel(host, 'Cancel')!);
      const cancelTaskBtn = findButtonByText(host, 'Cancel task')!;
      cancelTaskBtn.focus();
      await click(cancelTaskBtn);

      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        'Could not cancel task. Try again.'
      );
      expect(document.activeElement).toBe(cancelTaskBtn);

      rerender({ ...base, onCancelTask: undefined });
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(findButtonByText(host, 'Cancel task')).toBeUndefined();
      expect(document.activeElement).toBe(
        host.querySelector<HTMLButtonElement>('button[data-schedule-toggle]')
      );
    } finally {
      unmount();
    }
  });

  it('recovers focus to the row toggle when onEditTask disappears while Edit has focus', async () => {
    const task = makeTask({ taskId: 'revoke-edit', description: 'Revoked edit task' });
    const base = {
      roomId: '!room:example.org',
      tasks: [task],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    };
    const { host, rerender, unmount } = mountDialog({
      ...base,
      onEditTask: vi.fn(),
    });
    try {
      const editBtn = findButtonByAriaLabel(host, 'Edit')!;
      act(() => {
        editBtn.focus();
      });
      expect(document.activeElement).toBe(editBtn);

      rerender({ ...base, onEditTask: undefined });
      expect(findButtonByAriaLabel(host, 'Edit')).toBeUndefined();
      expect(document.activeElement).toBe(
        host.querySelector<HTMLButtonElement>('button[data-schedule-toggle]')
      );
    } finally {
      unmount();
    }
  });

  it('keeps the forwarded modal ref stable across 1-second countdown ticks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
    const refSpy = vi.fn();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      act(() => {
        root.render(
          <RoomSchedulesDialog
            ref={refSpy}
            roomId="!room:example.org"
            tasks={[
              makeTask({
                taskId: 'tick-1',
                description: 'Imminent task',
                executeAt: '2026-11-21T12:00:30Z',
              }),
            ]}
            onClose={vi.fn()}
            onOpenThread={vi.fn()}
          />
        );
      });
      expect(refSpy).toHaveBeenCalledTimes(1);
      expect(refSpy.mock.calls[0]?.[0]).toBeInstanceOf(HTMLDivElement);

      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(refSpy).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('resets cancel state on roomId change and ignores late completion from the previous room', async () => {
    let rejectRoomA!: (error: Error) => void;
    const onCancel = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRoomA = reject;
        })
    );
    let latestState: ReturnType<typeof useScheduleCancelState> | undefined;

    function Harness({ roomId }: { roomId: string }) {
      latestState = useScheduleCancelState(roomId, onCancel);
      return null;
    }

    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      act(() => {
        root.render(<Harness roomId="!room-a:example.org" />);
      });

      let cancelPromise!: Promise<boolean>;
      act(() => {
        cancelPromise = latestState!.handleCancelTask(makeTask({ taskId: 'shared-id' }));
      });
      expect(latestState!.pendingCancelIds.has('shared-id')).toBe(true);

      act(() => {
        root.render(<Harness roomId="!room-b:example.org" />);
      });
      expect(latestState!.pendingCancelIds.size).toBe(0);
      expect(latestState!.cancelErrors.size).toBe(0);

      await act(async () => {
        rejectRoomA(new Error('stale room failure'));
        await cancelPromise;
      });
      expect(latestState!.cancelErrors.size).toBe(0);
    } finally {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it('keeps the action status live region mounted before Edit busy or Copy failure and updates it in place', async () => {
    const task = makeTask({ taskId: 'live-status-1', description: 'Live status task' });
    const { host, unmount } = mountDialog({
      roomId: '!room:example.org',
      tasks: [task],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onEditTask: () => 'draft-busy',
    });
    try {
      const initialStatusNode = host.querySelector(
        '[data-schedule-action-status][role="status"][aria-live="polite"]'
      );
      expect(initialStatusNode).not.toBeNull();
      expect(initialStatusNode?.textContent).toBe('');
      expect(initialStatusNode?.className).toBe('sr-only');
      const initialStatusCount = host.querySelectorAll('[role="status"]').length;

      await click(findButtonByAriaLabel(host, 'Edit')!);
      expect(host.querySelectorAll('[role="status"]').length).toBe(initialStatusCount);
      expect(
        host.querySelector('[data-schedule-action-status][role="status"][aria-live="polite"]')
      ).toBe(initialStatusNode);
      expect(initialStatusNode?.className).toBe('notice-bar');
      expect(initialStatusNode?.textContent).toBe(
        'Clear your current draft before editing this schedule.'
      );

      mocks.copyToClipboard.mockResolvedValueOnce(false);
      await click(findButtonByText(host, 'Copy ID')!);
      expect(host.querySelectorAll('[role="status"]').length).toBe(initialStatusCount);
      expect(
        host.querySelector('[data-schedule-action-status][role="status"][aria-live="polite"]')
      ).toBe(initialStatusNode);
      expect(initialStatusNode?.className).toBe('notice-bar');
      expect(initialStatusNode?.textContent).toBe('Could not copy. Select the Task ID in Details.');
    } finally {
      unmount();
    }
  });

  it('shows blocked Edit and failed Copy ID notices even while Cancellation sent is active, and keeps Cancel focused when toggled off', async () => {
    const task = makeTask({ taskId: 'status-split-1', description: 'Status split task' });
    const { host, unmount } = mountDialog({
      roomId: '!room:example.org',
      tasks: [task],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onCancelTask: vi.fn(async () => undefined),
      onEditTask: () => 'draft-busy',
    });
    try {
      const cancelBtn = findButtonByAriaLabel(host, 'Cancel')!;
      // Toggling the Cancel icon off returns focus to the Cancel button.
      await click(cancelBtn);
      expect(findButtonByText(host, 'Keep')).toBeDefined();
      await click(cancelBtn);
      expect(findButtonByText(host, 'Keep')).toBeUndefined();
      expect(document.activeElement).toBe(cancelBtn);

      // Confirm cancellation so Cancellation sent is active in its own persistent status region.
      await click(cancelBtn);
      await click(findButtonByText(host, 'Cancel task')!);
      const cancelStatus = host.querySelector(
        '[data-schedule-cancel-status][role="status"][aria-live="polite"]'
      );
      const actionStatus = host.querySelector(
        '[data-schedule-action-status][role="status"][aria-live="polite"]'
      );
      expect(cancelStatus?.textContent).toBe('Cancellation sent');
      expect(cancelStatus?.className).toBe('cancel-sent-bar');
      expect(actionStatus?.textContent).toBe('');

      // Blocked Edit still surfaces and announces in the action status region without being masked.
      await click(findButtonByAriaLabel(host, 'Edit')!);
      expect(cancelStatus?.textContent).toBe('Cancellation sent');
      expect(actionStatus?.className).toBe('notice-bar');
      expect(actionStatus?.textContent).toBe(
        'Clear your current draft before editing this schedule.'
      );

      // Failed Copy ID also surfaces without being masked by Cancellation sent.
      mocks.copyToClipboard.mockResolvedValueOnce(false);
      await click(findButtonByText(host, 'Copy ID')!);
      expect(cancelStatus?.textContent).toBe('Cancellation sent');
      expect(actionStatus?.className).toBe('notice-bar');
      expect(actionStatus?.textContent).toBe('Could not copy. Select the Task ID in Details.');
    } finally {
      unmount();
    }
  });

  it('recovers focus cleanly when collapsing Details or a row on Safari without dropping focus to body', async () => {
    mocks.renderMatrixMention.mockImplementation(() => <a href="#alice">@Alice</a>);
    const firstTask = makeTask({ taskId: 'safari-1', description: 'First task' });
    const secondTask = makeTask({
      taskId: 'safari-2',
      description: 'Second task',
      createdBy: '@alice:example.org',
    });
    const { host, unmount } = mountDialog({
      roomId: '!room:example.org',
      tasks: [firstTask, secondTask],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    try {
      const toggles = host.querySelectorAll<HTMLButtonElement>('button[data-schedule-toggle]');
      const secondToggle = toggles[1]!;
      await click(secondToggle);

      // Open Details, focus the link inside <dl>, then click Hide details without pre-focusing it (Safari behavior).
      await click(findButtonByText(host, 'Details')!);
      const creatorLink = host.querySelector<HTMLAnchorElement>('dl a')!;
      act(() => {
        creatorLink.focus();
      });
      expect(document.activeElement).toBe(creatorLink);
      await click(findButtonByText(host, 'Hide details')!);
      expect(host.querySelector('dl')).toBeNull();
      expect(document.activeElement).toBe(findButtonByText(host, 'Details'));

      // Focus Copy ID inside row 2's drawer, then click row 2's toggle without pre-focusing it (Safari behavior).
      const copyBtn = findButtonByText(host, 'Copy ID')!;
      act(() => {
        copyBtn.focus();
      });
      expect(document.activeElement).toBe(copyBtn);
      await click(secondToggle);
      expect(document.activeElement).toBe(secondToggle);
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
