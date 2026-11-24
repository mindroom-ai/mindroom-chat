// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
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
  RowHeading: 'row-heading',
  RowHeader: 'row-header',
  IconTile: { primary: 'icon-primary', success: 'icon-success', warning: 'icon-warning' },
  RowBody: 'row-body',
  RowTopLine: 'row-top-line',
  RowTitle: 'row-title',
  StatusPill: { primary: 'pill-primary', success: 'pill-success', warning: 'pill-warning' },
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
  MetaLabel: 'meta-label',
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
  const rerender = (nextProps: React.ComponentProps<typeof RoomSchedulesDialog>) => {
    act(() => root.render(<RoomSchedulesDialog {...nextProps} />));
  };
  rerender(props);
  return {
    host,
    rerender,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
};

const btnText = (container: Element, label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (btn) => btn.textContent?.trim() === label
  );
const btnAria = (container: Element, label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? undefined;
const click = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

let cleanup: (() => void) | undefined;
beforeEach(() => {
  mocks.copyToClipboard.mockReset();
  mocks.copyToClipboard.mockResolvedValue(true);
  mocks.renderMatrixMention.mockReset();
  mocks.renderMatrixMention.mockReturnValue(undefined);
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

describe('RoomSchedulesDialog', () => {
  it('renders empty state, single-task auto-expand, and thread vs room grouping with proper heading levels', async () => {
    const view = mountDialog({
      roomId: '!r:example.org',
      tasks: [],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    cleanup = view.unmount;
    expect(view.host.textContent).toContain('No scheduled tasks in this room.');
    expect(view.host.querySelector('.header-count')?.textContent).toBe('0');
    view.unmount();

    const single = mountDialog({
      roomId: '!r:example.org',
      tasks: [makeTask({ taskId: 'solo', description: 'Solo task', message: 'Check `db` @bot' })],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    cleanup = single.unmount;
    expect(single.host.querySelector('article')?.getAttribute('data-expanded')).toBe('true');
    expect(single.host.querySelector('[role="heading"]')?.getAttribute('aria-level')).toBe('3');
    expect(single.host.querySelector('code.inline-code')?.textContent).toBe('db');
    expect(single.host.querySelector('bdi.prompt-mention')?.textContent).toBe('@bot');
    single.unmount();

    const grouped = mountDialog({
      roomId: '!r:example.org',
      openThreadId: '$t1',
      tasks: [
        makeTask({ taskId: 'in-t', threadId: '$t1', description: 'In thread' }),
        makeTask({ taskId: 'in-r', threadId: null, description: 'In room' }),
      ],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    cleanup = grouped.unmount;
    expect([...grouped.host.querySelectorAll('h3')].map((h) => h.textContent)).toEqual([
      'This thread',
      'Elsewhere in this room',
    ]);
    expect(grouped.host.querySelector('[role="heading"]')?.getAttribute('aria-level')).toBe('4');
  });

  it('filters by type, auto-expands single filtered match, and resets filter when a category disappears', async () => {
    const once = makeTask({
      taskId: 'o1',
      description: 'Once task',
      executeAt: '2099-01-01T10:00:00Z',
    });
    const cron = makeTask({
      taskId: 'c1',
      scheduleType: 'cron',
      description: 'Cron task',
      cronDescription: 'Daily at 09:00',
    });
    const view = mountDialog({
      roomId: '!r:example.org',
      tasks: [once, cron],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    cleanup = view.unmount;

    const filterBar = view.host.querySelector(
      '[role="group"][aria-label="Filter scheduled tasks"]'
    )!;
    expect(filterBar).toBeTruthy();
    const recurringBtn = [...filterBar.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Recurring')
    )!;
    await click(recurringBtn);
    expect(view.host.querySelectorAll('article')).toHaveLength(1);
    expect(view.host.querySelector('article')?.getAttribute('data-expanded')).toBe('true');

    // Removing the only recurring task hides the filter bar and shows the remaining once task.
    view.rerender({
      roomId: '!r:example.org',
      tasks: [once],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    expect(view.host.querySelector('[aria-label="Filter scheduled tasks"]')).toBeNull();
    expect(view.host.querySelectorAll('article')).toHaveLength(1);
    expect(view.host.textContent).toContain('Once task');
  });

  it('toggles Show full prompt / Show less and renders Details metadata while hiding equal Updated time', async () => {
    mocks.renderMatrixMention.mockReturnValue(
      React.createElement('a', { href: '#alice' }, '@Alice')
    );
    const longPrompt = 'line 1\nline 2\nline 3\nline 4';
    const baseProps = {
      roomId: '!r:example.org',
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    };
    const task = makeTask({
      taskId: 'detail-1',
      scheduleType: 'cron',
      cronDescription: 'Every weekday',
      cronExpression: '0 9 * * 1-5',
      message: longPrompt,
      createdBy: '@alice:example.org',
      model: 'fast',
      historyLimit: 0,
      createdAt: '2026-09-15T12:00:00Z',
      updatedAt: '2026-09-15T12:00:00Z',
      threadId: '$t1',
    });
    const view = mountDialog({ ...baseProps, tasks: [task] });
    cleanup = view.unmount;

    const promptEl = view.host.querySelector('p.prompt')!;
    expect(promptEl.className).toContain('prompt-clamped');
    await click(btnText(view.host, 'Show full prompt')!);
    expect(promptEl.className).not.toContain('prompt-clamped');
    await click(btnText(view.host, 'Show less')!);
    expect(promptEl.className).toContain('prompt-clamped');

    // Shorter prompts without a toggle are never clamped.
    view.rerender({ ...baseProps, tasks: [{ ...task, message: 'x'.repeat(146) }] });
    expect(view.host.querySelector('p.prompt')!.className).not.toContain('prompt-clamped');
    expect(btnText(view.host, 'Show full prompt')).toBeUndefined();
    view.rerender({ ...baseProps, tasks: [task] });

    expect(view.host.querySelector('dl')).toBeNull();
    await click(btnText(view.host, 'Details')!);
    const dl = view.host.querySelector('dl')!;
    expect(dl.textContent).toContain('detail-1');
    expect(dl.textContent).toContain('@Alice');
    expect(dl.textContent).toContain('fast');
    expect(dl.textContent).toContain('0 9 * * 1-5 (UTC)');
    expect(dl.textContent).toContain('Created');
    expect(dl.textContent).not.toContain('Updated');

    // Open thread calls callback with threadId.
    await click(btnText(view.host, 'Open thread')!);
    expect(baseProps.onOpenThread).toHaveBeenCalledWith('$t1');

    // Updated appears when distinct from Created.
    view.rerender({
      ...baseProps,
      tasks: [{ ...task, updatedAt: '2026-09-16T12:00:00Z' }],
    });
    expect(view.host.querySelector('dl')?.textContent).toContain('Updated');
  });

  it('copies task ID with status feedback and opens Details with notice on clipboard failure', async () => {
    vi.useFakeTimers();
    const view = mountDialog({
      roomId: '!r:example.org',
      tasks: [makeTask({ taskId: 'copy-me' })],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    cleanup = view.unmount;

    const copyBtn = btnText(view.host, 'Copy ID')!;
    await click(copyBtn);
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('copy-me', copyBtn);
    expect(view.host.querySelector('.copied-status')?.textContent).toBe('Copied');
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    expect(view.host.querySelector('.copied-status')).toBeNull();

    mocks.copyToClipboard.mockResolvedValueOnce(false);
    await click(copyBtn);
    expect(view.host.querySelector('dl code.task-id')?.textContent).toBe('copy-me');
    expect(view.host.querySelector('[data-schedule-action-status]')?.textContent).toBe(
      'Could not copy. Select the Task ID in Details.'
    );
  });

  it('handles cancel confirm, keep, pending double-submit guard, error, sent acknowledgement, and unsafe/unconfirmed hiding', async () => {
    vi.useFakeTimers();
    let resolveCancel!: () => void;
    const onCancelTask = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveCancel = resolve;
          })
      );
    const view = mountDialog({
      roomId: '!r:example.org',
      tasks: [makeTask({ taskId: 'c-task', threadId: '$confirmed' })],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onCancelTask,
    });
    cleanup = view.unmount;

    // Open cancel bar -> Keep focuses cancel button.
    const cancelBtn = btnAria(view.host, 'Cancel')!;
    await click(cancelBtn);
    const keepBtn = btnText(view.host, 'Keep')!;
    expect(document.activeElement).toBe(keepBtn);
    await click(keepBtn);
    expect(document.activeElement).toBe(cancelBtn);

    // Failed cancel shows alert error; Keep clears error.
    await click(cancelBtn);
    await click(btnText(view.host, 'Cancel task')!);
    expect(view.host.querySelector('[role="alert"]')?.textContent).toBe(
      'Could not cancel task. Try again.'
    );
    await click(btnText(view.host, 'Keep')!);
    expect(view.host.querySelector('[role="alert"]')).toBeNull();

    // Pending cancel blocks duplicate clicks, then resolves to Cancellation sent and focuses toggle.
    await click(cancelBtn);
    await click(btnText(view.host, 'Cancel task')!);
    expect(btnText(view.host, 'Cancelling...')).toBeTruthy();
    await click(btnText(view.host, 'Cancelling...')!);
    expect(onCancelTask).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveCancel();
    });
    expect(view.host.querySelector('[data-schedule-cancel-status]')?.textContent).toBe(
      'Cancellation sent'
    );
    expect(document.activeElement).toBe(view.host.querySelector('button[data-schedule-toggle]'));
    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(view.host.querySelector('[data-schedule-cancel-status]')?.textContent).toBe('');

    // Unsafe IDs and unconfirmed thread destinations hide the Cancel button.
    view.rerender({
      roomId: '!r:example.org',
      tasks: [
        makeTask({ taskId: 'all' }),
        makeTask({ taskId: 'pending-thread', threadId: '~local', newThread: false }),
      ],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onCancelTask,
    });
    for (const toggle of view.host.querySelectorAll('button[data-schedule-toggle]')) {
      await click(toggle);
      expect(btnAria(view.host, 'Cancel')).toBeUndefined();
    }
  });

  it('handles edit click, draft-busy notice, and hides edit for preApprovedCall tasks', async () => {
    const onEditTask = vi.fn(() => 'draft-busy' as const);
    const view = mountDialog({
      roomId: '!r:example.org',
      tasks: [makeTask({ taskId: 'editable' })],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onEditTask,
    });
    cleanup = view.unmount;

    await click(btnAria(view.host, 'Edit')!);
    expect(onEditTask).toHaveBeenCalledTimes(1);
    expect(view.host.querySelector('[data-schedule-action-status]')?.textContent).toBe(
      'Clear your current draft before editing this schedule.'
    );

    // Keep the row expanded when switching to preApprovedCall so the guard itself is tested.
    view.rerender({
      roomId: '!r:example.org',
      tasks: [makeTask({ taskId: 'editable', preApprovedCall: true })],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onEditTask,
    });
    expect(btnText(view.host, 'Copy ID')).toBeTruthy();
    expect(btnAria(view.host, 'Edit')).toBeUndefined();
  });

  it('does not steal focus when a pending cancel completes after focus moved to another task', async () => {
    let resolveCancel!: () => void;
    const onCancelTask = vi.fn(() => new Promise<void>((r) => (resolveCancel = r)));
    const view = mountDialog({
      roomId: '!r:example.org',
      tasks: [
        makeTask({ taskId: 'task-a', description: 'Task A' }),
        makeTask({ taskId: 'task-b', description: 'Task B' }),
      ],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onCancelTask,
    });
    cleanup = view.unmount;

    const toggles = view.host.querySelectorAll<HTMLButtonElement>('button[data-schedule-toggle]');
    await click(toggles[0]!);
    await click(btnAria(view.host, 'Cancel')!);
    await click(btnText(view.host, 'Cancel task')!);

    // Move to Task B and focus its Copy ID button while Task A's cancel is still in flight.
    await click(toggles[1]!);
    const copyB = btnText(view.host, 'Copy ID')!;
    copyB.focus();
    expect(document.activeElement).toBe(copyB);

    await act(async () => {
      resolveCancel();
    });
    expect(document.activeElement).toBe(copyB);
  });

  it('keeps focus on the clicked row when switching rows from an open cancel bar', async () => {
    const view = mountDialog({
      roomId: '!r:example.org',
      tasks: [
        makeTask({ taskId: 'task-1', description: 'Task 1' }),
        makeTask({ taskId: 'task-2', description: 'Task 2' }),
        makeTask({ taskId: 'task-3', description: 'Task 3' }),
      ],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onCancelTask: vi.fn(async () => undefined),
    });
    cleanup = view.unmount;

    const toggles = view.host.querySelectorAll<HTMLButtonElement>('button[data-schedule-toggle]');
    await click(toggles[1]!);
    await click(btnAria(view.host, 'Cancel')!);
    expect(document.activeElement).toBe(btnText(view.host, 'Keep'));

    // Simulate Safari tapping row 3 without blurring Keep beforehand.
    await click(toggles[2]!);
    expect(document.activeElement).toBe(toggles[2]);
  });

  it('recovers focus to the expanded row when a pending cancel finishes after filter remount', async () => {
    let resolveCancel!: () => void;
    const onCancelTask = vi.fn(() => new Promise<void>((r) => (resolveCancel = r)));
    const view = mountDialog({
      roomId: '!r:example.org',
      tasks: [
        makeTask({ taskId: 'rec-1', description: 'Recurring 1', scheduleType: 'cron' }),
        makeTask({ taskId: 'rec-2', description: 'Recurring 2', scheduleType: 'cron' }),
        makeTask({ taskId: 'once-1', description: 'One-time task', scheduleType: 'once' }),
      ],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
      onCancelTask,
    });
    cleanup = view.unmount;

    const onceToggle = view.host.querySelector<HTMLButtonElement>(
      '[data-schedule-task-id="once-1"] button[data-schedule-toggle]'
    )!;
    await click(onceToggle);
    await click(btnAria(view.host, 'Cancel')!);
    await click(btnText(view.host, 'Cancel task')!);

    // Filter the row out and back in, then focus its remounted Cancelling button.
    const filterButtons = [
      ...view.host.querySelectorAll<HTMLButtonElement>(
        '[role="group"][aria-label="Filter scheduled tasks"] button'
      ),
    ];
    await click(filterButtons.find((b) => b.textContent?.includes('Recurring'))!);
    await click(filterButtons.find((b) => b.textContent?.includes('All'))!);
    const cancellingBtn = btnText(view.host, 'Cancelling...')!;
    cancellingBtn.focus();
    expect(document.activeElement).toBe(cancellingBtn);

    await act(async () => {
      resolveCancel();
    });
    expect(document.activeElement).toBe(
      view.host.querySelector('[data-schedule-task-id="once-1"] button[data-schedule-toggle]')
    );
  });

  it('recovers focus when cancel permission is revoked while Keep is focused', async () => {
    const tasks = [makeTask({ taskId: 'perm-1', description: 'Perm task' })];
    const base = { roomId: '!r:example.org', tasks, onClose: vi.fn(), onOpenThread: vi.fn() };
    const view = mountDialog({ ...base, onCancelTask: vi.fn(async () => undefined) });
    cleanup = view.unmount;

    await click(btnAria(view.host, 'Cancel')!);
    expect(document.activeElement).toBe(btnText(view.host, 'Keep'));

    view.rerender({ ...base, onCancelTask: undefined });
    expect(document.activeElement).toBe(view.host.querySelector('button[data-schedule-toggle]'));
  });

  it('recovers focus when a focused task row unmounts and ticks imminent countdowns every second', () => {
    vi.useFakeTimers();
    const baseNow = new Date('2026-09-15T10:00:00Z').getTime();
    vi.setSystemTime(baseNow);
    const first = makeTask({
      taskId: 'first',
      description: 'First',
      executeAt: new Date(baseNow + 10_000).toISOString(),
    });
    const second = makeTask({ taskId: 'second', description: 'Second' });
    const view = mountDialog({
      roomId: '!r:example.org',
      tasks: [first, second],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    cleanup = view.unmount;

    // Countdown ticks after 1 second when imminent.
    expect(view.host.textContent).toContain('in 10s');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(view.host.textContent).toContain('Awaiting');

    // Removing the focused row moves focus to the remaining toggle button, then Close when empty.
    const firstToggle = view.host.querySelector<HTMLButtonElement>(
      'button[data-schedule-toggle][data-schedule-task-id="first"]'
    )!;
    firstToggle.focus();
    expect(document.activeElement).toBe(firstToggle);

    view.rerender({
      roomId: '!r:example.org',
      tasks: [second],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    expect(document.activeElement).toBe(
      view.host.querySelector('button[data-schedule-toggle][data-schedule-task-id="second"]')
    );

    view.rerender({
      roomId: '!r:example.org',
      tasks: [],
      onClose: vi.fn(),
      onOpenThread: vi.fn(),
    });
    expect(document.activeElement).toBe(btnAria(view.host, 'Close'));
  });
});
