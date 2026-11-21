// @vitest-environment jsdom
import React from 'react';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';
import { RoomSchedulesDialog } from './RoomSchedulesDialog';

vi.mock('./roomSchedules.css', () => ({
  Dialog: 'dialog',
  Header: 'header',
  Content: 'content',
  Empty: 'empty',
  Card: 'card',
  Wrap: 'wrap',
  Prompt: 'prompt',
  Metadata: 'metadata',
  Awaiting: 'awaiting',
}));
vi.mock('../ui/page/PageScroll', () => ({
  PageScroll: ({ header, children }: React.PropsWithChildren<{ header?: React.ReactNode }>) =>
    React.createElement('div', null, header, children),
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../messages/useMentionClickHandler', () => ({ useMentionClickHandler: () => vi.fn() }));
vi.mock('../messages/html/react-custom-html-parser', () => ({
  makeMentionCustomProps: () => ({}),
  renderMatrixMention: () => undefined,
}));

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

const recurrenceLines = (task: Partial<ParsedScheduledTask>): string[] => {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(
      <RoomSchedulesDialog
        roomId="!room:example.org"
        tasks={[
          {
            taskId: 'task',
            status: 'pending',
            threadId: null,
            newThread: false,
            executeAt: null,
            scheduleType: 'cron',
            ...task,
          },
        ]}
        onClose={vi.fn()}
        onOpenThread={vi.fn()}
      />
    );
  });
  const lines = renderer!.root
    .findAll((node) => node.type === 'p')
    .map(textOf)
    .filter(Boolean);
  act(() => renderer!.unmount());
  const start = lines.indexOf('Recurrence') + 1;
  return lines.slice(start, lines.indexOf('Prompt'));
};

describe('RoomSchedulesDialog destinations', () => {
  const threadId = '$orchard:example.org';
  const task = (
    taskId: string,
    destination: string | null,
    newThread = false
  ): ParsedScheduledTask => ({
    taskId,
    status: 'pending',
    threadId: destination,
    newThread,
    executeAt: null,
    scheduleType: 'once',
  });
  const local = task('Check the saplings', threadId);
  const elsewhere = [
    task('Check the seedlings', null),
    task('Start a new planting log', threadId, true),
    task('Check the herbs', '$garden:example.org'),
  ];

  const headings = (tasks: ParsedScheduledTask[], openThreadId?: string) => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <RoomSchedulesDialog
          roomId="!room:example.org"
          tasks={tasks}
          openThreadId={openThreadId}
          onClose={vi.fn()}
          onOpenThread={vi.fn()}
        />
      );
    });
    const result = renderer.root.findAll((node) => /^h[34]$/.test(String(node.type))).map(textOf);
    act(() => renderer.unmount());
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

  it('omits group headings outside threads or when only one group has tasks', () => {
    expect(headings([elsewhere[0]!, local])).toEqual(['Check the seedlings', 'Check the saplings']);
    expect(headings([local], threadId)).toEqual(['Check the saplings']);
    expect(headings(elsewhere, threadId)).toEqual(elsewhere.map(({ taskId }) => taskId));
  });
});

describe('RoomSchedulesDialog recurrence', () => {
  it('shows the description as the runtime wrote it and marks the cron expression as UTC', () => {
    expect(
      recurrenceLines({
        cronDescription: 'At 12:00, only on Monday (America/Los_Angeles)',
        cronExpression: '0 19 * * 1',
      })
    ).toEqual(['At 12:00, only on Monday (America/Los_Angeles)', '0 19 * * 1 (UTC)']);
  });

  it('does not add a zone to a description from a runtime that names none', () => {
    expect(
      recurrenceLines({ cronDescription: 'At 12:00, only on Monday', cronExpression: '0 19 * * 1' })
    ).toEqual(['At 12:00, only on Monday', '0 19 * * 1 (UTC)']);
  });

  it('marks the cron expression as UTC when it is the only recurrence line', () => {
    expect(recurrenceLines({ cronExpression: '0 19 * * 1' })).toEqual(['0 19 * * 1 (UTC)']);
  });

  it('shows no zone without a description or cron expression', () => {
    expect(recurrenceLines({})).toEqual(['Execution time unavailable']);
  });
});
