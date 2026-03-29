import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { CompactRoomView } from './CompactRoomView';
import type { ThreadOverviewMetadata } from './roomThreadOverviewModel';

const { passthrough } = vi.hoisted(() => ({
  passthrough: 'div',
}));

const makeMetadata = (overrides: Partial<ThreadOverviewMetadata> = {}): ThreadOverviewMetadata => ({
  isResolved: false,
  isUnread: false,
  isStreaming: false,
  scheduledTaskCount: 0,
  lastActivityTs: 1000,
  absoluteIndex: 0,
  lastSenderId: undefined,
  lastSenderDisplayName: undefined,
  participantDisplayName: undefined,
  summaryText: undefined,
  rootPreviewText: undefined,
  messageCount: 0,
  ...overrides,
});

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();

  return {
    ...actual,
    Badge: passthrough,
    Box: passthrough,
    Icon: passthrough,
    Icons: {
      CheckTwice: 'CheckTwice',
    },
    Text: passthrough,
  };
});

vi.mock('../../hooks/useRelativeTime', () => ({
  useRelativeTime: () => '3h ago',
}));

vi.mock('./CompactRoomView.css', () => ({
  View: 'View',
  EmptyState: 'EmptyState',
  Card: 'Card',
  Row: 'Row',
  SummaryRow: 'SummaryRow',
  SummaryLead: 'SummaryLead',
  SummaryText: 'SummaryText',
  TimeText: 'TimeText',
  MetaText: 'MetaText',
  MetaTruncate: 'MetaTruncate',
  MetaSpacer: 'MetaSpacer',
  ScreenReaderText: 'ScreenReaderText',
  AttentionDot: ({ state }: { state: string }) => `AttentionDot-${state}`,
}));

const makeRoom = () =>
  ({
    client: {
      getUserId: () => '@alice:example.org',
    },
    getThread: vi.fn(() => {
      throw new Error('CompactRoomView should not call room.getThread()');
    }),
  } as never);

describe('CompactRoomView', () => {
  it('renders compact thread card content with summary, agent, time, and resolved badge', () => {
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$thread-1'],
        metadataMap: new Map([
          [
            '$thread-1',
            makeMetadata({
              isResolved: true,
              summaryText: 'Plan is ready',
              messageCount: 12,
              lastSenderId: '@agent:example.org',
              lastSenderDisplayName: 'Planner Agent',
              participantDisplayName: 'Planner Agent',
            }),
          ],
        ]),
        onThreadClick: vi.fn(),
      })
    );

    expect(renderer.root.findAll((node) => node.children.includes('Plan is ready'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Planner Agent'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('12 msgs'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Resolved'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('3h ago'))).toHaveLength(1);

    const attentionDot = renderer.root.find(
      (node) => node.props['data-attention-state'] === 'resolved'
    );
    expect(attentionDot.props.className).toContain('AttentionDot-resolved');

    const button = renderer.root.findByProps({ 'data-thread-root-id': '$thread-1' });
    expect(button.props['aria-label']).toContain('Plan is ready');
    expect(button.props['aria-label']).toContain('Resolved');
    expect(button.props['aria-label']).not.toContain('$thread-1');
  });

  it('renders fallback-only loaded thread metadata without consulting room.getThread()', () => {
    const room = makeRoom();
    const renderer = create(
      React.createElement(CompactRoomView, {
        room,
        threadRootIds: ['$fallback-thread'],
        metadataMap: new Map([
          [
            '$fallback-thread',
            makeMetadata({
              rootPreviewText: 'Loaded replies exist for this fallback root',
              messageCount: 2,
              lastSenderId: '@agent:example.org',
              lastSenderDisplayName: 'Planner Agent',
              participantDisplayName: 'Planner Agent',
            }),
          ],
        ]),
        onThreadClick: vi.fn(),
      })
    );

    expect(
      renderer.root.findAll((node) =>
        node.children.includes('Loaded replies exist for this fallback root')
      )
    ).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Planner Agent'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('2 msgs'))).toHaveLength(1);

    const button = renderer.root.findByProps({ 'data-thread-root-id': '$fallback-thread' });
    expect(button.props['aria-label']).toContain('Needs attention');
    expect(button.props['aria-label']).toContain('Planner Agent');
    expect(button.props['aria-label']).toContain('2 msgs');
    expect(room.getThread).not.toHaveBeenCalled();
  });

  it('clicking a compact thread card forwards the thread root id', () => {
    const onThreadClick = vi.fn();
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$thread-1'],
        metadataMap: new Map([
          [
            '$thread-1',
            makeMetadata({
              summaryText: 'Plan is ready',
              lastSenderId: '@alice:example.org',
            }),
          ],
        ]),
        onThreadClick,
      })
    );

    const button = renderer.root.findByProps({ 'data-thread-root-id': '$thread-1' });

    act(() => {
      button.props.onClick();
    });

    expect(onThreadClick).toHaveBeenCalledWith('$thread-1');
  });

  it('falls back to the root preview, explicit zero count, idle state, and no agent label', () => {
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$thread-2'],
        metadataMap: new Map([
          [
            '$thread-2',
            makeMetadata({
              rootPreviewText: 'Drafting a new plan for the room overview',
            }),
          ],
        ]),
        onThreadClick: vi.fn(),
      })
    );

    expect(
      renderer.root.findAll((node) =>
        node.children.includes('Drafting a new plan for the room overview')
      )
    ).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('0 msgs'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Unknown agent'))).toHaveLength(
      0
    );
    expect(
      renderer.root.findAll((node) => node.children.includes('Thread status: Idle.'))
    ).toHaveLength(1);

    const attentionDot = renderer.root.find(
      (node) => node.props['data-attention-state'] === 'idle'
    );
    expect(attentionDot.props.className).toContain('AttentionDot-idle');

    const button = renderer.root.findByProps({ 'data-thread-root-id': '$thread-2' });
    expect(button.props['aria-label']).toContain('Drafting a new plan for the room overview');
    expect(button.props['aria-label']).toContain('Idle');
    expect(button.props['aria-label']).toContain('0 msgs');
  });

  it('renders an empty state when there are no thread roots', () => {
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: [],
        metadataMap: new Map(),
        onThreadClick: vi.fn(),
      })
    );

    expect(renderer.root.findAll((node) => node.children.includes('No threads'))).toHaveLength(1);
  });
});
