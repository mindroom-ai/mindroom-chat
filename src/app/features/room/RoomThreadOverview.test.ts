import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { RoomThreadOverview } from './RoomThreadOverview';

const { passthrough } = vi.hoisted(() => ({
  passthrough: 'div',
}));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();

  return {
    ...actual,
    Box: passthrough,
    Chip: passthrough,
    Text: passthrough,
  };
});

vi.mock('./RoomThreadOverview.css', () => ({
  Overview: 'Overview',
  FilterRow: 'FilterRow',
  SortRow: 'SortRow',
}));

vi.mock('../../components/message/Reply.css', () => ({
  ThreadStreamingDot: 'ThreadStreamingDot',
  ThreadScheduledIcon: 'ThreadScheduledIcon',
}));

vi.mock('@tabler/icons-react', () => ({
  IconCalendarEvent: passthrough,
}));

const defaultProps = {
  counts: {
    unresolved: 1,
    resolved: 1,
    unread: 0,
    all: 2,
  },
  filter: 'all' as const,
  onFilterChange: vi.fn(),
  sort: 'default' as const,
  onSortChange: vi.fn(),
};

describe('RoomThreadOverview', () => {
  it('uses the controlled filter state for chip selection and callbacks', () => {
    const onFilterChange = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        filter: 'resolved',
        onFilterChange,
      })
    );

    const unresolvedChip = renderer.root.find(
      (node) => node.props['aria-label'] === 'Show unresolved threads (1)'
    );
    const resolvedChip = renderer.root.find(
      (node) => node.props['aria-label'] === 'Show resolved threads (1)'
    );
    const allChip = renderer.root.find((node) => node.props['aria-label'] === 'Show all threads (2)');

    expect(unresolvedChip.props['aria-pressed']).toBe(false);
    expect(resolvedChip.props['aria-pressed']).toBe(true);
    expect(allChip.props['aria-pressed']).toBe(false);

    act(() => {
      unresolvedChip.props.onClick();
    });

    expect(onFilterChange).toHaveBeenCalledWith('unresolved');

    renderer.unmount();
  });

  it('shows the provided visible thread counts', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        counts: {
          unresolved: 0,
          resolved: 0,
          unread: 0,
          all: 0,
        },
      })
    );

    expect(renderer.root.findAll((node) => node.children.includes('Unresolved (0)'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Resolved (0)'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('All (0)'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Unread (0)'))).toHaveLength(1);
    expect(
      renderer.root.findAll((node) => node.children.includes('Filter the room timeline by thread status.'))
    ).toHaveLength(1);

    renderer.unmount();
  });

  it('renders unread chip and sort chips', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        counts: { ...defaultProps.counts, unread: 3 },
      })
    );

    expect(
      renderer.root.findAll((node) => node.props['aria-label'] === 'Show unread threads (3)')
    ).toHaveLength(1);

    expect(
      renderer.root.findAll((node) => node.props['aria-label'] === 'Sort threads by last reply')
    ).toHaveLength(1);
    expect(
      renderer.root.findAll(
        (node) => node.props['aria-label'] === 'Sort threads by streaming activity'
      )
    ).toHaveLength(1);
    expect(
      renderer.root.findAll(
        (node) => node.props['aria-label'] === 'Sort threads by scheduled tasks'
      )
    ).toHaveLength(1);

    renderer.unmount();
  });

  it('keeps controlled sort state in sync with chip selection', () => {
    const onSortChange = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        sort: 'default',
        onSortChange,
      })
    );

    const lastReplyChip = renderer.root.find(
      (node) => node.props['aria-label'] === 'Sort threads by last reply'
    );

    expect(lastReplyChip.props['aria-pressed']).toBe(false);

    act(() => {
      lastReplyChip.props.onClick();
    });

    expect(onSortChange).toHaveBeenCalledWith('last-reply');

    renderer.unmount();
  });

  it('clicking an active sort chip clears back to default', () => {
    const onSortChange = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        sort: 'streaming',
        onSortChange,
      })
    );

    const streamingChip = renderer.root.find(
      (node) => node.props['aria-label'] === 'Sort threads by streaming activity'
    );

    expect(streamingChip.props['aria-pressed']).toBe(true);

    act(() => {
      streamingChip.props.onClick();
    });

    expect(onSortChange).toHaveBeenCalledWith('default');

    renderer.unmount();
  });

  it('exposes expected accessibility labels for sort controls', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, defaultProps)
    );

    expect(
      renderer.root.find(
        (node) => node.props['aria-label'] === 'Sort threads by last reply'
      )
    ).toBeTruthy();
    expect(
      renderer.root.find(
        (node) => node.props['aria-label'] === 'Sort threads by streaming activity'
      )
    ).toBeTruthy();
    expect(
      renderer.root.find(
        (node) => node.props['aria-label'] === 'Sort threads by scheduled tasks'
      )
    ).toBeTruthy();

    renderer.unmount();
  });
});
