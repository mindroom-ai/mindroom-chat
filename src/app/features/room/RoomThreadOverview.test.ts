import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { RoomThreadOverview } from './RoomThreadOverview';
import type { ThreadFilterState, ThreadFilterKey } from './RoomThreadOverview';

const { passthrough } = vi.hoisted(() => ({
  passthrough: 'div',
}));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();

  return {
    ...actual,
    Box: passthrough,
    Chip: passthrough,
    Icon: passthrough,
    Text: passthrough,
    Tooltip: passthrough,
    TooltipProvider: ({ children }: { children: (ref: null) => React.ReactNode }) =>
      children(null),
  };
});

vi.mock('./RoomThreadOverview.css', () => ({
  Overview: 'Overview',
  ToolbarHeader: 'ToolbarHeader',
  ToolbarControls: 'ToolbarControls',
  ToggleGroup: 'ToggleGroup',
  ToggleButtonWrap: 'ToggleButtonWrap',
  ToggleButton: 'ToggleButton',
  ToggleInclude: 'ToggleInclude',
  ToggleExclude: 'ToggleExclude',
  ToggleCount: 'ToggleCount',
  ToggleCountActive: 'ToggleCountActive',
  ToggleSortSeparator: 'ToggleSortSeparator',
  SortButton: 'SortButton',
  SortButtonActive: 'SortButtonActive',
  EmptyState: 'EmptyState',
  ResetLink: 'ResetLink',
  TagRow: 'TagRow',
  TagList: 'TagList',
  TagPill: 'TagPill',
  TagPillInclude: 'TagPillInclude',
  TagPillExclude: 'TagPillExclude',
  TagPillLabel: 'TagPillLabel',
  TagPillRemove: 'TagPillRemove',
  AddTagContainer: 'AddTagContainer',
  AddTagButton: 'AddTagButton',
  AddTagDropdown: 'AddTagDropdown',
  AddTagOption: 'AddTagOption',
}));

vi.mock('../../components/message/Reply.css', () => ({
  ThreadStreamingDot: 'ThreadStreamingDot',
  ThreadScheduledIcon: 'ThreadScheduledIcon',
}));

vi.mock('@tabler/icons-react', () => ({
  IconCalendarEvent: passthrough,
  IconZzz: passthrough,
}));

vi.mock('classnames', () => ({
  default: (...args: (string | boolean | undefined | null)[]) =>
    args.filter(Boolean).join(' '),
}));

const makeDefaultState = (overrides?: Partial<ThreadFilterState>): ThreadFilterState => ({
  resolved: 'any',
  streaming: 'any',
  scheduled: 'any',
  unread: 'any',
  idle: 'any',
  sortBy: 'natural',
  sortDirection: 'desc',
  tags: new Map(),
  ...overrides,
});

const defaultProps = {
  threadCount: 5,
  state: makeDefaultState(),
  availableTags: [] as string[],
  onToggle: vi.fn(),
  onSortDirectionChange: vi.fn(),
  onReset: vi.fn(),
  onCycleTag: vi.fn(),
  onAddTag: vi.fn(),
  onRemoveTag: vi.fn(),
};

describe('RoomThreadOverview', () => {
  it('renders five icon toggles', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, defaultProps)
    );

    const buttons = renderer.root.findAll(
      (node) => node.type === 'button' && node.props['data-filter-key']
    );
    expect(buttons).toHaveLength(5);

    const keys = buttons.map((b) => b.props['data-filter-key']);
    expect(keys).toEqual(['resolved', 'streaming', 'scheduled', 'unread', 'idle']);

    renderer.unmount();
  });

  it('reflects controlled visual state via data-filter-state', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ resolved: 'include', streaming: 'exclude' }),
      })
    );

    const resolvedBtn = renderer.root.find(
      (node) => node.props['data-filter-key'] === 'resolved'
    );
    expect(resolvedBtn.props['data-filter-state']).toBe('include');
    expect(resolvedBtn.props.className).toContain('ToggleInclude');

    const streamingBtn = renderer.root.find(
      (node) => node.props['data-filter-key'] === 'streaming'
    );
    expect(streamingBtn.props['data-filter-state']).toBe('exclude');
    expect(streamingBtn.props.className).toContain('ToggleExclude');

    renderer.unmount();
  });

  it('cycles state on click: any -> include -> exclude -> any', () => {
    const onToggle = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onToggle,
      })
    );

    const resolvedBtn = renderer.root.find(
      (node) => node.props['data-filter-key'] === 'resolved'
    );

    act(() => {
      resolvedBtn.props.onClick();
    });

    expect(onToggle).toHaveBeenCalledWith('resolved');

    renderer.unmount();
  });

  it('shows aria-valuetext matching state', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ resolved: 'include' }),
      })
    );

    const resolvedBtn = renderer.root.find(
      (node) => node.props['data-filter-key'] === 'resolved'
    );
    expect(resolvedBtn.props['aria-valuetext']).toBe('show only');

    renderer.unmount();
  });

  it('sort button shows Natural by default', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, defaultProps)
    );

    const sortBtn = renderer.root.find(
      (node) => node.props['data-sort-by'] !== undefined
    );
    expect(sortBtn.props['data-sort-by']).toBe('natural');

    renderer.unmount();
  });

  it('sort button shows Last Reply when sortBy is lastReply', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ sortBy: 'lastReply', sortDirection: 'desc' }),
      })
    );

    const sortBtn = renderer.root.find(
      (node) => node.props['data-sort-by'] !== undefined
    );
    expect(sortBtn.props['data-sort-by']).toBe('lastReply');
    expect(sortBtn.props['data-sort-direction']).toBe('desc');

    renderer.unmount();
  });

  it('sort button calls onSortDirectionChange on click', () => {
    const onSortDirectionChange = vi.fn();
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onSortDirectionChange,
      })
    );

    const sortBtn = renderer.root.find(
      (node) => node.props['data-sort-by'] !== undefined
    );

    act(() => {
      sortBtn.props.onClick();
    });

    expect(onSortDirectionChange).toHaveBeenCalled();

    renderer.unmount();
  });

  it('sort button uses active style when filters are active', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ resolved: 'include' }),
      })
    );

    const sortBtn = renderer.root.find(
      (node) => node.props['data-sort-by'] !== undefined
    );
    expect(sortBtn.props.className).toContain('SortButtonActive');

    renderer.unmount();
  });

  it('renders thread count in title', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        threadCount: 42,
      })
    );

    const titleNodes = renderer.root.findAll(
      (node) => typeof node.children[0] === 'string' && node.children[0] === 'Threads (42)'
    );
    expect(titleNodes.length).toBeGreaterThan(0);

    renderer.unmount();
  });

  it('shows zero-results empty state with reset link', () => {
    const onReset = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        threadCount: 0,
        state: makeDefaultState({ resolved: 'include' }),
        onReset,
      })
    );

    const resetBtn = renderer.root.find(
      (node) => node.props['aria-label'] === 'Reset all thread filters'
    );
    expect(resetBtn).toBeTruthy();

    act(() => {
      resetBtn.props.onClick();
    });

    expect(onReset).toHaveBeenCalled();

    renderer.unmount();
  });

  it('does NOT show empty state when threadCount > 0', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        threadCount: 3,
        state: makeDefaultState({ resolved: 'include' }),
      })
    );

    const resetBtns = renderer.root.findAll(
      (node) => node.props['aria-label'] === 'Reset all thread filters'
    );
    expect(resetBtns).toHaveLength(0);

    renderer.unmount();
  });

  it('does NOT show empty state when no filters active', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        threadCount: 0,
      })
    );

    const resetBtns = renderer.root.findAll(
      (node) => node.props['aria-label'] === 'Reset all thread filters'
    );
    expect(resetBtns).toHaveLength(0);

    renderer.unmount();
  });

  // ═══ Status counts ═════════════════════════════════════════════════════

  it('renders status counts next to each toggle when provided', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        statusCounts: { resolved: 42, streaming: 3, scheduled: 5, unread: 12, idle: 28 },
      })
    );

    const countNodes = renderer.root.findAll(
      (node) => node.props['data-status-count'] !== undefined
    );
    expect(countNodes).toHaveLength(5);

    const countMap = Object.fromEntries(
      countNodes.map((n) => [n.props['data-status-count'], n.children[0]])
    );
    expect(countMap).toEqual({
      resolved: '42',
      streaming: '3',
      scheduled: '5',
      unread: '12',
      idle: '28',
    });

    renderer.unmount();
  });

  it('does not render count badges when statusCounts is not provided', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, defaultProps)
    );

    const countNodes = renderer.root.findAll(
      (node) => node.props['data-status-count'] !== undefined
    );
    expect(countNodes).toHaveLength(0);

    renderer.unmount();
  });

  it('uses active count style when filter is not any', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        statusCounts: { resolved: 10, streaming: 0, scheduled: 0, unread: 0, idle: 0 },
        state: makeDefaultState({ resolved: 'include' }),
      })
    );

    const resolvedCount = renderer.root.find(
      (node) => node.props['data-status-count'] === 'resolved'
    );
    expect(resolvedCount.props.className).toContain('ToggleCountActive');

    const streamingCount = renderer.root.find(
      (node) => node.props['data-status-count'] === 'streaming'
    );
    expect(streamingCount.props.className).not.toContain('ToggleCountActive');

    renderer.unmount();
  });

  // ═══ Tag pills ═════════════════════════════════════════════════════════

  it('renders tag pills with correct state', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        availableTags: ['resolved', 'blocked', 'priority'],
        state: makeDefaultState({
          tags: new Map([
            ['resolved', 'include'],
            ['blocked', 'exclude'],
          ]),
        }),
      })
    );

    const resolvedPill = renderer.root.find(
      (node) => node.props['data-tag-name'] === 'resolved'
    );
    expect(resolvedPill.props['data-tag-state']).toBe('include');
    expect(resolvedPill.props.className).toContain('TagPillInclude');

    const blockedPill = renderer.root.find(
      (node) => node.props['data-tag-name'] === 'blocked'
    );
    expect(blockedPill.props['data-tag-state']).toBe('exclude');
    expect(blockedPill.props.className).toContain('TagPillExclude');

    renderer.unmount();
  });

  it('calls onCycleTag when tag pill label is clicked', () => {
    const onCycleTag = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onCycleTag,
        availableTags: ['resolved'],
        state: makeDefaultState({
          tags: new Map([['resolved', 'include']]),
        }),
      })
    );

    const labelBtn = renderer.root.find(
      (node) =>
        node.type === 'button' &&
        node.props.className === 'TagPillLabel'
    );

    act(() => {
      labelBtn.props.onClick();
    });

    expect(onCycleTag).toHaveBeenCalledWith('resolved');

    renderer.unmount();
  });

  it('calls onRemoveTag when tag pill remove button is clicked', () => {
    const onRemoveTag = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onRemoveTag,
        availableTags: ['resolved'],
        state: makeDefaultState({
          tags: new Map([['resolved', 'include']]),
        }),
      })
    );

    const removeBtn = renderer.root.find(
      (node) =>
        node.type === 'button' &&
        node.props['aria-label'] === 'Remove resolved filter'
    );

    act(() => {
      removeBtn.props.onClick();
    });

    expect(onRemoveTag).toHaveBeenCalledWith('resolved');

    renderer.unmount();
  });

  // ═══ AddTagDropdown ════════════════════════════════════════════════════

  it('shows add-tag button when unselected tags are available', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        availableTags: ['resolved', 'blocked'],
      })
    );

    const addBtn = renderer.root.findAll(
      (node) => node.props['data-add-tag-button'] === 'true'
    );
    expect(addBtn).toHaveLength(1);

    renderer.unmount();
  });

  it('hides add-tag button when all tags are already selected', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        availableTags: ['resolved'],
        state: makeDefaultState({
          tags: new Map([['resolved', 'include']]),
        }),
      })
    );

    const addBtns = renderer.root.findAll(
      (node) => node.props['data-add-tag-button'] === 'true'
    );
    expect(addBtns).toHaveLength(0);

    renderer.unmount();
  });

  it('opens dropdown on click and shows unselected tags', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        availableTags: ['resolved', 'blocked', 'priority'],
        state: makeDefaultState({
          tags: new Map([['resolved', 'include']]),
        }),
      })
    );

    // Dropdown should not be visible initially
    let options = renderer.root.findAll(
      (node) => node.props['data-tag-option'] !== undefined
    );
    expect(options).toHaveLength(0);

    // Click the add-tag button
    const addBtn = renderer.root.find(
      (node) => node.props['data-add-tag-button'] === 'true'
    );
    act(() => {
      addBtn.props.onClick();
    });

    // Now dropdown should show unselected tags
    options = renderer.root.findAll(
      (node) => node.props['data-tag-option'] !== undefined
    );
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.props['data-tag-option'])).toEqual(['blocked', 'priority']);

    renderer.unmount();
  });

  it('calls onAddTag via onMouseDown (pointer path) exactly once', () => {
    const onAddTag = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onAddTag,
        availableTags: ['resolved', 'blocked'],
      })
    );

    // Open dropdown
    const addBtn = renderer.root.find(
      (node) => node.props['data-add-tag-button'] === 'true'
    );
    act(() => {
      addBtn.props.onClick();
    });

    // Verify no onClick handler exists on the option (check before selecting,
    // since selection closes the dropdown and unmounts the node)
    const blockedOption = renderer.root.find(
      (node) => node.props['data-tag-option'] === 'blocked'
    );
    expect(blockedOption.props.onClick).toBeUndefined();

    // Select via onMouseDown (the only pointer handler)
    act(() => {
      blockedOption.props.onMouseDown({ preventDefault: vi.fn() });
    });

    expect(onAddTag).toHaveBeenCalledTimes(1);
    expect(onAddTag).toHaveBeenCalledWith('blocked');

    renderer.unmount();
  });

  it('supports arrow key navigation in dropdown', () => {
    const onAddTag = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onAddTag,
        availableTags: ['alpha', 'beta', 'gamma'],
      })
    );

    // Open dropdown
    const addBtn = renderer.root.find(
      (node) => node.props['data-add-tag-button'] === 'true'
    );
    act(() => {
      addBtn.props.onClick();
    });

    // Find the container that has onKeyDown
    const container = renderer.root.find(
      (node) => node.props.className === 'AddTagContainer'
    );

    // Press ArrowDown to move to second option
    act(() => {
      container.props.onKeyDown({
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      });
    });

    // Press Enter to select
    act(() => {
      container.props.onKeyDown({
        key: 'Enter',
        preventDefault: vi.fn(),
      });
    });

    expect(onAddTag).toHaveBeenCalledWith('beta');

    renderer.unmount();
  });

  it('renders tag filter row when tags are available', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        availableTags: ['resolved', 'blocked'],
      })
    );

    const tagRow = renderer.root.findAll(
      (node) => node.props['data-tag-filter-row'] === 'true'
    );
    expect(tagRow).toHaveLength(1);

    renderer.unmount();
  });

  it('hides tag filter row when no tags available and none active', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        availableTags: [],
      })
    );

    const tagRows = renderer.root.findAll(
      (node) => node.props['data-tag-filter-row'] === 'true'
    );
    expect(tagRows).toHaveLength(0);

    renderer.unmount();
  });
});
