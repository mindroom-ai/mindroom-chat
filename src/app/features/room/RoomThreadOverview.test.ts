import React from 'react';
import { create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomThreadOverview } from './RoomThreadOverview';

const { passthrough, threadListState, toggleState } = vi.hoisted(() => ({
  passthrough: 'div',
  threadListState: {
    threads: [],
    loading: false,
    fullyLoaded: false,
    error: new Error('boom') as Error | undefined,
    retry: vi.fn(),
  },
  toggleState: {
    canToggle: true,
    setResolved: vi.fn(),
    updating: false,
    error: undefined as Error | undefined,
  },
}));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();

  return {
    ...actual,
    Badge: passthrough,
    Box: passthrough,
    Chip: passthrough,
    Icon: passthrough,
    Icons: {
      Check: 'Check',
      CheckTwice: 'CheckTwice',
    },
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

vi.mock('../../components/message', () => ({
  ThreadIndicator: passthrough,
  Time: passthrough,
}));

vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoomThread: vi.fn(),
  }),
}));

vi.mock('./RoomThreadOverview.css', () => ({
  Overview: 'Overview',
  FilterRow: 'FilterRow',
  ThreadList: 'ThreadList',
  ThreadRow: 'ThreadRow',
  ThreadRowResolved: 'ThreadRowResolved',
  ActionRow: 'ActionRow',
  ThreadPreview: 'ThreadPreview',
}));

vi.mock('./useRoomThreadList', () => ({
  useRoomThreadList: () => threadListState,
}));

vi.mock('./useRoomThreadResolution', () => ({
  useRoomThreadResolutionMap: () => new Map(),
  useToggleThreadResolution: () => toggleState,
}));

describe('RoomThreadOverview', () => {
  beforeEach(() => {
    threadListState.threads = [];
    threadListState.loading = false;
    threadListState.fullyLoaded = false;
    threadListState.error = new Error('boom');
    threadListState.retry = vi.fn();
    toggleState.canToggle = true;
    toggleState.setResolved = vi.fn();
    toggleState.updating = false;
    toggleState.error = undefined;
  });

  it('shows an error-aware empty state after a failed initial thread-list load', () => {
    const room = {
      roomId: '!room:example.org',
    };

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        room: room as never,
        hour24Clock: true,
        dateFormatString: 'MMM D',
      })
    );

    const renderedText = JSON.stringify(renderer.toJSON());

    expect(renderedText).toContain('Unable to load threads right now.');
    expect(renderedText).not.toContain('Loading threads.');

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
        hour24Clock: true,
        dateFormatString: 'MMM D',
      })
    );

    expect(renderer.root.findAll((node) => node.children.includes('Unresolved (-)'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Resolved (-)'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('All (-)'))).toHaveLength(1);

    renderer.unmount();
  });
});
