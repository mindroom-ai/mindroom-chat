import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomThreadOverview } from './RoomThreadOverview';

const { passthrough, threadListState, resolutionMap } = vi.hoisted(() => ({
  passthrough: 'div',
  threadListState: {
    threads: [],
    loading: false,
    fullyLoaded: false,
    error: new Error('boom') as Error | undefined,
    retry: vi.fn(),
  },
  resolutionMap: new Map<string, { isResolved: boolean }>(),
}));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();

  return {
    ...actual,
    Box: passthrough,
    Chip: passthrough,
    Spinner: passthrough,
    Text: passthrough,
    color: {
      ...actual.color,
      Critical: {
        ...actual.color.Critical,
        Main: '#f00',
      },
    },
  };
});

vi.mock('./RoomThreadOverview.css', () => ({
  Overview: 'Overview',
  FilterRow: 'FilterRow',
}));

vi.mock('./useRoomThreadList', () => ({
  useRoomThreadList: () => threadListState,
}));

vi.mock('./useRoomThreadResolution', () => ({
  useRoomThreadResolutionMap: () => resolutionMap,
}));

describe('RoomThreadOverview', () => {
  beforeEach(() => {
    threadListState.threads = [];
    threadListState.loading = false;
    threadListState.fullyLoaded = false;
    threadListState.error = new Error('boom');
    threadListState.retry = vi.fn();
    resolutionMap.clear();
  });

  it('uses the controlled filter state for chip selection and callbacks', () => {
    threadListState.threads = [{ id: '$a' }, { id: '$b' }] as never[];
    threadListState.fullyLoaded = true;
    threadListState.error = undefined;
    resolutionMap.set('$b', { isResolved: true });

    const room = {
      roomId: '!room:example.org',
    };
    const onFilterChange = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        room: room as never,
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

  it('shows placeholder counts while the thread list is still loading', () => {
    threadListState.loading = true;
    threadListState.error = undefined;

    const room = {
      roomId: '!room:example.org',
    };

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        room: room as never,
        filter: 'all',
        onFilterChange: vi.fn(),
      })
    );

    expect(renderer.root.findAll((node) => node.children.includes('Unresolved (-)'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Resolved (-)'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('All (-)'))).toHaveLength(1);

    renderer.unmount();
  });

  it('shows retry UI when the thread list fails to load', () => {
    const room = {
      roomId: '!room:example.org',
    };

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        room: room as never,
        filter: 'all',
        onFilterChange: vi.fn(),
      })
    );

    const renderedText = JSON.stringify(renderer.toJSON());

    expect(renderedText).toContain('boom');
    expect(renderedText).toContain('Retry');

    renderer.unmount();
  });
});
