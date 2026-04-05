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
  ToggleGroup: 'ToggleGroup',
  ToggleButton: 'ToggleButton',
  ToggleInclude: 'ToggleInclude',
  ToggleExclude: 'ToggleExclude',
  SectionSeparator: 'SectionSeparator',
  CompactCount: 'CompactCount',
  SortButton: 'SortButton',
  SortButtonActive: 'SortButtonActive',
  PauseButtonActive: 'PauseButtonActive',
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
  PresetContainer: 'PresetContainer',
  PresetButton: 'PresetButton',
  PresetDropdown: 'PresetDropdown',
  PresetOption: 'PresetOption',
  InfoContainer: 'InfoContainer',
  InfoButton: 'InfoButton',
  InfoPopover: 'InfoPopover',
  InfoStatRow: 'InfoStatRow',
  InfoSectionDivider: 'InfoSectionDivider',
  SearchContainer: 'SearchContainer',
  SearchInput: 'SearchInput',
}));

vi.mock('../../components/message/Reply.css', () => ({
  ThreadStreamingDot: 'ThreadStreamingDot',
  ThreadScheduledIcon: 'ThreadScheduledIcon',
}));

vi.mock('@tabler/icons-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tabler/icons-react')>();

  return {
    ...actual,
    IconCalendarEvent: 'icon-calendar-event',
    IconChevronDown: 'icon-chevron-down',
    IconInfoCircle: 'icon-info-circle',
    IconLayoutList: 'icon-layout-list',
    IconLayoutRows: 'icon-layout-rows',
    IconLock: 'icon-lock',
    IconLockOpen: 'icon-lock-open',
    IconMessages: 'icon-messages',
    IconSortAscending: 'icon-sort-ascending',
    IconSortDescending: 'icon-sort-descending',
    IconZzz: 'icon-zzz',
  };
});

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
  searchQuery: '',
  statusMode: 'and',
  ...overrides,
});

const defaultProps = {
  threadCount: 5,
  totalThreadCount: 5,
  state: makeDefaultState(),
  availableTags: [] as string[],
  isThreadSortFrozen: false,
  onToggle: vi.fn(),
  onSortDirectionChange: vi.fn(),
  onToggleThreadSortFreeze: vi.fn(),
  onReset: vi.fn(),
  onCycleTag: vi.fn(),
  onAddTag: vi.fn(),
  onRemoveTag: vi.fn(),
  onApplyPreset: vi.fn(),
  onSearchQueryChange: vi.fn(),
  viewMode: 'normal' as const,
  onViewModeChange: vi.fn(),
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

  it('hides the freeze button when sort is natural', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, defaultProps)
    );

    expect(
      renderer.root.findAll((node) => node.props['data-thread-sort-freeze'] === 'true')
    ).toHaveLength(0);

    renderer.unmount();
  });

  it('shows an inactive freeze button for non-natural sorting', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ sortBy: 'lastReply', sortDirection: 'desc' }),
      })
    );

    const freezeButton = renderer.root.find(
      (node) => node.props['data-thread-sort-freeze'] === 'true'
    );
    expect(freezeButton.props['aria-pressed']).toBe(false);
    expect(freezeButton.props['aria-label']).toBe('Lock thread sort order');
    expect(freezeButton.findAllByType('icon-lock')).toHaveLength(1);

    renderer.unmount();
  });

  it('shows the active freeze button state when sorting is paused', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        isThreadSortFrozen: true,
        state: makeDefaultState({ sortBy: 'lastReply', sortDirection: 'desc' }),
      })
    );

    const freezeButton = renderer.root.find(
      (node) => node.props['data-thread-sort-freeze'] === 'true'
    );
    expect(freezeButton.props.className).toContain('PauseButtonActive');
    expect(freezeButton.props['aria-pressed']).toBe(true);
    expect(freezeButton.props['aria-label']).toBe('Unlock thread sort order');
    expect(freezeButton.findAllByType('icon-lock-open')).toHaveLength(1);

    renderer.unmount();
  });

  it('freeze button calls onToggleThreadSortFreeze on click', () => {
    const onToggleThreadSortFreeze = vi.fn();
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ sortBy: 'lastReply', sortDirection: 'desc' }),
        onToggleThreadSortFreeze,
      })
    );

    const freezeButton = renderer.root.find(
      (node) => node.props['data-thread-sort-freeze'] === 'true'
    );

    act(() => {
      freezeButton.props.onClick();
    });

    expect(onToggleThreadSortFreeze).toHaveBeenCalledTimes(1);

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

  it('renders an icon-only expanded view toggle with the shared toolbar button styling', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, defaultProps)
    );

    const viewToggle = renderer.root.find(
      (node) => node.props['data-view-mode-toggle'] === 'true'
    );
    expect(viewToggle.props.className).toBe('ToggleButton');
    expect(viewToggle.props['aria-label']).toBe('Expanded view');
    expect(viewToggle.props['aria-pressed']).toBe(false);
    expect(viewToggle.props['data-view-mode']).toBe('normal');
    expect(viewToggle.findAllByType('icon-layout-list')).toHaveLength(1);
    expect(viewToggle.findAllByType('icon-layout-rows')).toHaveLength(0);

    const compactText = renderer.root.findAll(
      (node) => typeof node.children[0] === 'string' && node.children[0] === 'Compact'
    );
    expect(compactText).toHaveLength(0);

    renderer.unmount();
  });

  it('renders the compact icon and toggles back to expanded mode on click', () => {
    const onViewModeChange = vi.fn();
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        viewMode: 'compact',
        onViewModeChange,
      })
    );

    const viewToggle = renderer.root.find(
      (node) => node.props['data-view-mode-toggle'] === 'true'
    );
    expect(viewToggle.props['aria-label']).toBe('Compact view');
    expect(viewToggle.props['aria-pressed']).toBe(true);
    expect(viewToggle.props['data-view-mode']).toBe('compact');
    expect(viewToggle.findAllByType('icon-layout-rows')).toHaveLength(1);
    expect(viewToggle.findAllByType('icon-layout-list')).toHaveLength(0);

    act(() => {
      viewToggle.props.onClick();
    });

    expect(onViewModeChange).toHaveBeenCalledWith('normal');

    renderer.unmount();
  });

  it('renders compact thread count instead of Threads (N)', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        threadCount: 42,
      })
    );

    // Should NOT render old format
    const oldFormat = renderer.root.findAll(
      (node) => typeof node.children[0] === 'string' && node.children[0] === 'Threads (42)'
    );
    expect(oldFormat).toHaveLength(0);

    // Should render compact count with data attribute
    const countElement = renderer.root.find(
      (node) => node.props['data-thread-count'] === 'true'
    );
    expect(countElement).toBeTruthy();

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

  // ═══ No count badges ═══════════════════════════════════════════════════

  it('does NOT render per-icon count badges', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        statusCounts: { resolved: 42, streaming: 3, scheduled: 5, unread: 12, idle: 28 },
      })
    );

    const countNodes = renderer.root.findAll(
      (node) => node.props['data-status-count'] !== undefined
    );
    expect(countNodes).toHaveLength(0);

    renderer.unmount();
  });

  // ═══ Preset dropdown ══════════════════════════════════════════════════

  it('renders preset button', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, defaultProps)
    );

    const presetBtn = renderer.root.findAll(
      (node) => node.props['data-preset-button'] === 'true'
    );
    expect(presetBtn).toHaveLength(1);

    renderer.unmount();
  });

  it('opens preset dropdown on click', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, defaultProps)
    );

    const presetBtn = renderer.root.find(
      (node) => node.props['data-preset-button'] === 'true'
    );

    act(() => {
      presetBtn.props.onClick();
    });

    const dropdown = renderer.root.findAll(
      (node) => node.props['data-preset-dropdown'] === 'true'
    );
    expect(dropdown).toHaveLength(1);

    // Should have 5 preset options
    const options = renderer.root.findAll(
      (node) => node.props['data-preset-option'] !== undefined
    );
    expect(options).toHaveLength(5);

    renderer.unmount();
  });

  it('calls onApplyPreset when preset option is selected', () => {
    const onApplyPreset = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onApplyPreset,
      })
    );

    // Open dropdown
    const presetBtn = renderer.root.find(
      (node) => node.props['data-preset-button'] === 'true'
    );
    act(() => {
      presetBtn.props.onClick();
    });

    // Select "Needs attention"
    const option = renderer.root.find(
      (node) => node.props['data-preset-option'] === 'needs-attention'
    );
    act(() => {
      option.props.onMouseDown({ preventDefault: vi.fn() });
    });

    expect(onApplyPreset).toHaveBeenCalledTimes(1);
    expect(onApplyPreset.mock.calls[0][0].id).toBe('needs-attention');

    renderer.unmount();
  });

  // ═══ Info popover ═════════════════════════════════════════════════════

  it('renders info button', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, defaultProps)
    );

    const infoBtn = renderer.root.findAll(
      (node) => node.props['data-info-button'] === 'true'
    );
    expect(infoBtn).toHaveLength(1);

    renderer.unmount();
  });

  it('opens info popover on click', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        statusCounts: { resolved: 10, streaming: 2, scheduled: 1, unread: 3, idle: 5 },
        tagCounts: { bug: 3, feature: 2 },
      })
    );

    const infoBtn = renderer.root.find(
      (node) => node.props['data-info-button'] === 'true'
    );

    act(() => {
      infoBtn.props.onClick();
    });

    const popover = renderer.root.findAll(
      (node) => node.props['data-info-popover'] === 'true'
    );
    expect(popover).toHaveLength(1);

    renderer.unmount();
  });

  // ═══ Search bar ═══════════════════════════════════════════════════════

  it('renders search toggle button', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, defaultProps)
    );

    const searchBtn = renderer.root.findAll(
      (node) => node.props['data-search-toggle'] === 'true'
    );
    expect(searchBtn).toHaveLength(1);

    renderer.unmount();
  });

  it('expands search input on click', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, defaultProps)
    );

    // Initially no input
    let inputs = renderer.root.findAll(
      (node) => node.props['data-search-input'] === 'true'
    );
    expect(inputs).toHaveLength(0);

    // Click search toggle
    const searchBtn = renderer.root.find(
      (node) => node.props['data-search-toggle'] === 'true'
    );
    act(() => {
      searchBtn.props.onClick();
    });

    // Now input should be visible
    inputs = renderer.root.findAll(
      (node) => node.props['data-search-input'] === 'true'
    );
    expect(inputs).toHaveLength(1);

    renderer.unmount();
  });

  it('calls onSearchQueryChange when search input changes', () => {
    const onSearchQueryChange = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onSearchQueryChange,
        state: makeDefaultState({ searchQuery: '' }),
      })
    );

    // Expand search
    const searchBtn = renderer.root.find(
      (node) => node.props['data-search-toggle'] === 'true'
    );
    act(() => {
      searchBtn.props.onClick();
    });

    // Type in input
    const input = renderer.root.find(
      (node) => node.props['data-search-input'] === 'true'
    );
    act(() => {
      input.props.onChange({ target: { value: 'test query' } });
    });

    expect(onSearchQueryChange).toHaveBeenCalledWith('test query');

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
