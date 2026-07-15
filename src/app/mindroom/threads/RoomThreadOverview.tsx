import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Icon, Icons, Text, Tooltip, TooltipProvider, toRem } from 'folds';
import { useTranslation } from 'react-i18next';
import { type TFunction } from 'i18next';
import {
  IconCalendarEvent,
  IconChevronDown,
  IconInfoCircle,
  IconLayoutList,
  IconLayoutRows,
  IconLock,
  IconLockOpen,
  IconMessages,
  IconSortAscending,
  IconSortDescending,
  IconZzz,
} from '@tabler/icons-react';
import classNames from 'classnames';
import * as css from './RoomThreadOverview.css';
import * as threadIndicatorCss from './ThreadIndicator.css';
import type {
  ThreadFilterState,
  ThreadFilterKey,
  TriState,
  StatusCounts,
  FilterPreset,
} from './roomThreadOverviewModel';
import {
  hasActiveThreadFilters,
  FILTER_PRESETS,
  isOrModeStatusChip,
  normalizeThreadSearchText,
} from './roomThreadOverviewModel';
import { type RoomViewMode } from './roomViewMode';
import { useSimpleMode } from '../settings/useMindroomAccountSettings';
import {
  applyParsedThreadFilterQuery,
  parseThreadFilterQuery,
  serializeThreadFilterQuery,
} from './threadFilterDsl';

export type { ThreadFilterState, ThreadFilterKey };

// ─── Tooltip text helpers ────────────────────────────────────────────────────

const FILTER_LABEL_KEYS = {
  resolved: 'thread.status.resolved',
  streaming: 'thread.status.streaming',
  scheduled: 'thread.status.scheduled',
  unread: 'thread.status.unread',
  idle: 'thread.status.idleFilter',
} as const satisfies Record<ThreadFilterKey, string>;

const getTooltipText = (t: TFunction, key: ThreadFilterKey, state: TriState): string => {
  const label = t(FILTER_LABEL_KEYS[key]);
  switch (state) {
    case 'any':
      return t('thread.filterTooltip.any', { label });
    case 'include':
      return t('thread.filterTooltip.include', { label });
    case 'exclude':
      return t('thread.filterTooltip.exclude', { label });
    default:
      return label;
  }
};

const getAriaValueText = (t: TFunction, state: TriState): string => {
  switch (state) {
    case 'any':
      return t('thread.filterTooltip.stateAny');
    case 'include':
      return t('thread.filterTooltip.stateInclude');
    case 'exclude':
      return t('thread.filterTooltip.stateExclude');
    default:
      return state;
  }
};

const getTagTooltipText = (t: TFunction, tag: string, state: TriState): string => {
  switch (state) {
    case 'include':
      return t('thread.filterTooltip.tagInclude', { tag });
    case 'exclude':
      return t('thread.filterTooltip.tagExclude', { tag });
    default:
      return t('thread.filterTooltip.tagAny', { tag });
  }
};

// ─── TriStateIconToggle ──────────────────────────────────────────────────────

function TriStateIconToggle({
  filterKey,
  state,
  isOrMode,
  onToggle,
  children,
}: {
  filterKey: ThreadFilterKey;
  state: TriState;
  isOrMode: boolean;
  onToggle: (key: ThreadFilterKey) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const tooltipText = getTooltipText(t, filterKey, state);

  return (
    <TooltipProvider
      position="Bottom"
      align="Center"
      tooltip={
        <Tooltip style={{ maxWidth: toRem(280) }}>
          <Text size="T200">{tooltipText}</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <button
          ref={triggerRef}
          type="button"
          className={classNames(
            css.ToggleButton,
            state === 'include' && (isOrMode ? css.ToggleIncludeOr : css.ToggleInclude),
            state === 'exclude' && css.ToggleExclude
          )}
          onClick={() => onToggle(filterKey)}
          aria-roledescription="tri-state toggle"
          aria-valuetext={getAriaValueText(t, state)}
          aria-label={tooltipText}
          data-filter-key={filterKey}
          data-filter-state={state}
        >
          {children}
        </button>
      )}
    </TooltipProvider>
  );
}

// ─── TagPill ─────────────────────────────────────────────────────────────────

function TagPill({
  tag,
  state,
  onCycle,
  onRemove,
}: {
  tag: string;
  state: TriState;
  onCycle: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const { t } = useTranslation();
  const tooltipText = getTagTooltipText(t, tag, state);

  return (
    <TooltipProvider
      position="Bottom"
      align="Center"
      tooltip={
        <Tooltip style={{ maxWidth: toRem(280) }}>
          <Text size="T200">{tooltipText}</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <span
          ref={triggerRef}
          className={classNames(
            css.TagPill,
            state === 'include' && css.TagPillInclude,
            state === 'exclude' && css.TagPillExclude
          )}
          data-tag-name={tag}
          data-tag-state={state}
        >
          <button
            type="button"
            className={css.TagPillLabel}
            onClick={() => onCycle(tag)}
            aria-roledescription="tri-state toggle"
            aria-valuetext={getAriaValueText(t, state)}
            aria-label={tooltipText}
          >
            <Text size="T200">{tag}</Text>
          </button>
          <button
            type="button"
            className={css.TagPillRemove}
            onClick={() => onRemove(tag)}
            aria-label={t('thread.aria.removeTagFilter', { tag })}
          >
            <Text size="T200">&times;</Text>
          </button>
        </span>
      )}
    </TooltipProvider>
  );
}

// ─── AddTagDropdown ──────────────────────────────────────────────────────────

function AddTagDropdown({
  availableTags,
  activeTags,
  onAddTag,
}: {
  availableTags: string[];
  activeTags: Map<string, TriState>;
  onAddTag: (tag: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const unselectedTags = availableTags.filter((tag) => !activeTags.has(tag));

  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      if (!prev) setFocusedIndex(0);
      return !prev;
    });
  }, []);

  const handleSelect = useCallback(
    (tag: string) => {
      onAddTag(tag);
      setOpen(false);
      setFocusedIndex(-1);
    },
    [onAddTag]
  );

  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
      setOpen(false);
      setFocusedIndex(-1);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => (prev + 1) % unselectedTags.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => (prev - 1 + unselectedTags.length) % unselectedTags.length);
          break;
        case 'Enter': {
          e.preventDefault();
          const tag = unselectedTags[focusedIndex];
          if (tag) handleSelect(tag);
          break;
        }
        case 'Escape':
          e.preventDefault();
          setOpen(false);
          setFocusedIndex(-1);
          break;
        default:
          break;
      }
    },
    [open, unselectedTags, focusedIndex, handleSelect]
  );

  if (unselectedTags.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className={css.AddTagContainer}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className={css.AddTagButton}
        onClick={handleToggle}
        aria-label="Add tag filter"
        aria-expanded={open}
        aria-haspopup="listbox"
        data-add-tag-button="true"
      >
        <Text size="T200">+ tag</Text>
      </button>
      {open && (
        <div className={css.AddTagDropdown} role="listbox" aria-label="Available tags">
          {unselectedTags.map((tag, index) => (
            <button
              key={tag}
              type="button"
              className={css.AddTagOption}
              role="option"
              aria-selected={index === focusedIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(tag);
              }}
              data-tag-option={tag}
              data-focused={index === focusedIndex || undefined}
              ref={(el) => {
                if (index === focusedIndex) el?.focus();
              }}
            >
              <Text size="T200">{tag}</Text>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ThreadPresetDropdown ───────────────────────────────────────────────────

function ThreadPresetDropdown({
  onApplyPreset,
  activePresetLabel,
}: {
  onApplyPreset: (preset: FilterPreset) => void;
  activePresetLabel: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      if (!prev) setFocusedIndex(0);
      return !prev;
    });
  }, []);

  const handleSelect = useCallback(
    (preset: FilterPreset) => {
      onApplyPreset(preset);
      setOpen(false);
      setFocusedIndex(-1);
    },
    [onApplyPreset]
  );

  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
      setOpen(false);
      setFocusedIndex(-1);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => (prev + 1) % FILTER_PRESETS.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => (prev - 1 + FILTER_PRESETS.length) % FILTER_PRESETS.length);
          break;
        case 'Enter': {
          e.preventDefault();
          const preset = FILTER_PRESETS[focusedIndex];
          if (preset) handleSelect(preset);
          break;
        }
        case 'Escape':
          e.preventDefault();
          setOpen(false);
          setFocusedIndex(-1);
          break;
        default:
          break;
      }
    },
    [open, focusedIndex, handleSelect]
  );

  return (
    <div
      ref={containerRef}
      className={css.PresetContainer}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className={css.PresetButton}
        onClick={handleToggle}
        aria-label="Filter presets"
        aria-expanded={open}
        aria-haspopup="listbox"
        data-preset-button="true"
      >
        <Text size="T200">{activePresetLabel ?? 'Preset'}</Text>
        <IconChevronDown size={14} stroke={1.8} aria-hidden="true" />
      </button>
      {open && (
        <div
          className={css.PresetDropdown}
          role="listbox"
          aria-label="Filter presets"
          data-preset-dropdown="true"
        >
          {FILTER_PRESETS.map((preset, index) => (
            <TooltipProvider
              key={preset.id}
              position="Right"
              align="Center"
              tooltip={
                <Tooltip style={{ maxWidth: toRem(220) }}>
                  <Text size="T200">{preset.description}</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <button
                  ref={(el) => {
                    if (index === focusedIndex) el?.focus();
                    if (typeof triggerRef === 'function') triggerRef(el);
                  }}
                  type="button"
                  className={css.PresetOption}
                  role="option"
                  aria-selected={index === focusedIndex}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(preset);
                  }}
                  data-preset-option={preset.id}
                  data-focused={index === focusedIndex || undefined}
                >
                  <Text size="T200">{preset.label}</Text>
                </button>
              )}
            </TooltipProvider>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ThreadInfoPopover ──────────────────────────────────────────────────────

const STATUS_LABEL_KEYS = {
  resolved: 'thread.status.resolved',
  streaming: 'thread.status.streaming',
  scheduled: 'thread.status.scheduled',
  unread: 'thread.status.unread',
  idle: 'thread.status.idle',
} as const satisfies Record<ThreadFilterKey, string>;

function ThreadInfoPopover({
  statusCounts,
  tagCounts,
  threadCount,
  totalThreadCount,
}: {
  statusCounts?: StatusCounts;
  tagCounts?: Record<string, number>;
  threadCount: number;
  totalThreadCount: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const tooltipText = statusCounts
    ? (Object.keys(STATUS_LABEL_KEYS) as ThreadFilterKey[])
        // Lowercasing works for en/de/nl alike here: the labels read as
        // adjectives in the count summary ("3 gel\u00F6st"), not as nouns.
        .map((key) => `${statusCounts[key]} ${t(STATUS_LABEL_KEYS[key]).toLowerCase()}`)
        .join(' \u00B7 ')
    : t('thread.stats.threadCount', { count: totalThreadCount });

  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
      setOpen(false);
    }
  }, []);

  const tagEntries = tagCounts ? Object.entries(tagCounts).sort((a, b) => b[1] - a[1]) : [];
  const isFiltered = threadCount !== totalThreadCount;

  return (
    <div ref={containerRef} className={css.InfoContainer} onBlur={handleBlur}>
      <TooltipProvider
        position="Bottom"
        align="Center"
        tooltip={
          <Tooltip style={{ maxWidth: toRem(320) }}>
            <Text size="T200">{tooltipText}</Text>
          </Tooltip>
        }
      >
        {(triggerRef) => (
          <button
            ref={triggerRef}
            type="button"
            className={css.InfoButton}
            onClick={() => setOpen((prev) => !prev)}
            aria-label={t('thread.stats.aria')}
            aria-expanded={open}
            aria-haspopup="dialog"
            data-info-button="true"
          >
            <IconInfoCircle size={16} stroke={1.8} aria-hidden="true" />
          </button>
        )}
      </TooltipProvider>
      {open && (
        <div
          className={css.InfoPopover}
          role="dialog"
          aria-label={t('thread.stats.aria')}
          data-info-popover="true"
        >
          <Text size="T200" style={{ fontWeight: 600, marginBottom: toRem(4) }}>
            {isFiltered
              ? t('thread.stats.showing', { shown: threadCount, total: totalThreadCount })
              : t('thread.stats.threadCount', { count: totalThreadCount })}
          </Text>
          {statusCounts &&
            (Object.keys(STATUS_LABEL_KEYS) as ThreadFilterKey[]).map((key) => (
              <div key={key} className={css.InfoStatRow}>
                <Text size="T200">{t(STATUS_LABEL_KEYS[key])}</Text>
                <Text size="T200">{statusCounts[key]}</Text>
              </div>
            ))}
          {tagEntries.length > 0 && (
            <>
              <div className={css.InfoSectionDivider} />
              <Text size="T200" style={{ fontWeight: 600, marginBottom: toRem(2) }}>
                {t('thread.stats.tags')}
              </Text>
              {tagEntries.map(([tag, count]) => (
                <div key={tag} className={css.InfoStatRow}>
                  <Text size="T200">{tag}</Text>
                  <Text size="T200">{count}</Text>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ThreadSearchBar ────────────────────────────────────────────────────────

function ThreadSearchBar({
  searchQuery,
  onSearchQueryChange,
}: {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
}) {
  const [expanded, setExpanded] = useState(() => searchQuery.length > 0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => {
      if (!prev) {
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      return !prev;
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchQuery.length === 0) {
          setExpanded(false);
        }
      }
    },
    [searchQuery]
  );

  return (
    <div className={css.SearchContainer} data-search-bar="true">
      <TooltipProvider
        position="Bottom"
        align="Center"
        tooltip={
          <Tooltip style={{ maxWidth: toRem(160) }}>
            <Text size="T200">Search threads</Text>
          </Tooltip>
        }
      >
        {(triggerRef) => (
          <button
            ref={triggerRef}
            type="button"
            className={css.InfoButton}
            onClick={handleToggle}
            aria-label="Search threads"
            aria-expanded={expanded}
            data-search-toggle="true"
          >
            <Icon size="50" src={Icons.Search} />
          </button>
        )}
      </TooltipProvider>
      {expanded && (
        <input
          ref={inputRef}
          type="text"
          className={css.SearchInput}
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search threads..."
          aria-label="Search threads"
          data-search-input="true"
        />
      )}
    </div>
  );
}

// ─── RoomThreadOverview ──────────────────────────────────────────────────────

export type RoomThreadOverviewProps = {
  hasMindroomAgents: boolean;
  threadCount: number;
  totalThreadCount: number;
  statusCounts?: StatusCounts;
  tagCounts?: Record<string, number>;
  state: ThreadFilterState;
  availableTags: string[];
  viewMode?: RoomViewMode;
  onViewModeChange?: (mode: RoomViewMode) => void;
  isThreadSortFrozen?: boolean;
  onToggle: (key: ThreadFilterKey) => void;
  onSortDirectionChange: () => void;
  onToggleThreadSortFreeze: () => void;
  onToggleUnresolvedOnly: () => void;
  onReset: () => void;
  onCycleTag: (tag: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onApplyPreset: (preset: FilterPreset) => void;
  onSearchQueryChange: (query: string) => void;
};

const ROOM_VIEW_MODE_LABELS: Record<RoomViewMode, string> = {
  compact: 'Compact view',
  threaded: 'Threaded view',
  classic: 'Classic view',
};

function RoomViewModeButton({
  mode,
  active,
  onChange,
  children,
}: {
  mode: RoomViewMode;
  active: boolean;
  onChange?: (mode: RoomViewMode) => void;
  children: React.ReactNode;
}) {
  const label = ROOM_VIEW_MODE_LABELS[mode];

  return (
    <TooltipProvider
      position="Bottom"
      align="Center"
      tooltip={
        <Tooltip style={{ maxWidth: toRem(220) }}>
          <Text size="T200">{label}</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <button
          ref={triggerRef}
          type="button"
          className={classNames(css.ToggleButton, active && css.SortButtonActive)}
          aria-label={label}
          aria-pressed={active}
          onClick={() => onChange?.(mode)}
          data-view-mode-toggle="true"
          data-view-mode={mode}
        >
          {children}
        </button>
      )}
    </TooltipProvider>
  );
}

function RoomViewModeControls({
  viewMode,
  onViewModeChange,
  showClassic = true,
}: {
  viewMode?: RoomViewMode;
  onViewModeChange?: (mode: RoomViewMode) => void;
  showClassic?: boolean;
}) {
  return (
    <div className={css.ToggleGroup} role="group" aria-label="Room view mode">
      <RoomViewModeButton
        mode="compact"
        active={viewMode === 'compact'}
        onChange={onViewModeChange}
      >
        <IconLayoutRows size={14} stroke={1.8} aria-hidden="true" />
      </RoomViewModeButton>
      <RoomViewModeButton
        mode="threaded"
        active={viewMode === 'threaded'}
        onChange={onViewModeChange}
      >
        <Icon size="50" src={Icons.Thread} />
      </RoomViewModeButton>
      {showClassic && (
        <RoomViewModeButton
          mode="classic"
          active={viewMode === 'classic'}
          onChange={onViewModeChange}
        >
          <IconLayoutList size={14} stroke={1.8} aria-hidden="true" />
        </RoomViewModeButton>
      )}
    </div>
  );
}

export function RoomThreadOverview({
  hasMindroomAgents,
  threadCount,
  totalThreadCount,
  statusCounts,
  tagCounts,
  state,
  availableTags,
  viewMode,
  onViewModeChange,
  isThreadSortFrozen = false,
  onToggle,
  onSortDirectionChange,
  onToggleThreadSortFreeze,
  onToggleUnresolvedOnly,
  onReset,
  onCycleTag,
  onAddTag,
  onRemoveTag,
  onApplyPreset,
  onSearchQueryChange,
}: RoomThreadOverviewProps) {
  const [lastAppliedPreset, setLastAppliedPreset] = useState<string | null>(null);
  const simpleMode = useSimpleMode();
  const { t } = useTranslation();
  const filtersActive = hasActiveThreadFilters(state);
  const canonicalSearchQuery = serializeThreadFilterQuery(state);
  const [searchQueryDraft, setSearchQueryDraft] = useState(canonicalSearchQuery);
  const pendingSearchCanonicalRef = useRef<string>();

  useEffect(() => {
    if (pendingSearchCanonicalRef.current === canonicalSearchQuery) {
      pendingSearchCanonicalRef.current = undefined;
      return;
    }
    pendingSearchCanonicalRef.current = undefined;
    setSearchQueryDraft(canonicalSearchQuery);
  }, [canonicalSearchQuery]);
  const sortLabel =
    state.sortBy === 'natural'
      ? 'Threads in timeline order'
      : state.sortDirection === 'desc'
      ? 'Sort threads by last reply, newest first'
      : 'Sort threads by last reply, oldest first';

  const handleToggleWithPresetClear = useCallback(
    (key: ThreadFilterKey) => {
      setLastAppliedPreset(null);
      onToggle(key);
    },
    [onToggle]
  );

  const handlePresetApply = useCallback(
    (preset: FilterPreset) => {
      setLastAppliedPreset(preset.id === 'all' ? null : preset.label);
      onApplyPreset(preset);
    },
    [onApplyPreset]
  );

  const handleSortWithPresetClear = useCallback(() => {
    setLastAppliedPreset(null);
    onSortDirectionChange();
  }, [onSortDirectionChange]);

  const handleSearchWithPresetClear = useCallback(
    (query: string) => {
      setLastAppliedPreset(null);
      setSearchQueryDraft(query);
      pendingSearchCanonicalRef.current = hasMindroomAgents
        ? serializeThreadFilterQuery(
            applyParsedThreadFilterQuery(state, parseThreadFilterQuery(query))
          )
        : normalizeThreadSearchText(query);
      onSearchQueryChange(query);
    },
    [hasMindroomAgents, onSearchQueryChange, state]
  );

  const handleCycleTagWithPresetClear = useCallback(
    (tag: string) => {
      setLastAppliedPreset(null);
      onCycleTag(tag);
    },
    [onCycleTag]
  );

  const handleAddTagWithPresetClear = useCallback(
    (tag: string) => {
      setLastAppliedPreset(null);
      onAddTag(tag);
    },
    [onAddTag]
  );

  const handleRemoveTagWithPresetClear = useCallback(
    (tag: string) => {
      setLastAppliedPreset(null);
      onRemoveTag(tag);
    },
    [onRemoveTag]
  );

  const activeTagEntries = [...state.tags.entries()];

  const filterSummary = filtersActive
    ? `Showing ${threadCount} thread${threadCount !== 1 ? 's' : ''} with active filters.`
    : `Showing all ${threadCount} thread${threadCount !== 1 ? 's' : ''}.`;
  const liveSummary = isThreadSortFrozen
    ? `${filterSummary} Thread sort order locked.`
    : filterSummary;
  const freezeLabel = isThreadSortFrozen ? 'Unlock thread sort order' : 'Lock thread sort order';

  const liveRegion = (
    <div
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        overflow: 'hidden',
        clip: 'rect(0,0,0,0)',
      }}
    >
      {liveSummary}
    </div>
  );

  const countBadge = (
    <TooltipProvider
      position="Bottom"
      align="Center"
      tooltip={
        <Tooltip style={{ maxWidth: toRem(200) }}>
          <Text size="T200">{`${threadCount} thread${threadCount !== 1 ? 's' : ''}`}</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <span ref={triggerRef} className={css.CompactCount} data-thread-count="true">
          <IconMessages size={14} stroke={1.8} aria-hidden="true" />
          <Text size="T200">{threadCount}</Text>
        </span>
      )}
    </TooltipProvider>
  );

  const emptyFilteredState = threadCount === 0 && filtersActive && (
    <div className={css.EmptyState}>
      <Text size="T200">No threads match current filters.</Text>
      <button
        type="button"
        className={css.ResetLink}
        onClick={onReset}
        aria-label="Reset all thread filters"
      >
        <Text size="T200">Reset</Text>
      </button>
    </div>
  );

  // Simple mode keeps only the compact/threaded view choice plus one agent-room
  // filter: hide resolved threads or show everything. The upstream filter state
  // is already projected onto this subspace, so state.resolved is the only
  // dimension that can be active here.
  if (simpleMode) {
    const unresolvedOnly = state.resolved === 'exclude';
    return (
      <Box className={css.Overview} direction="Column" gap="200" data-room-thread-overview="true">
        {liveRegion}
        <div className={css.ToolbarHeader} role="toolbar" aria-label="Thread filters">
          {hasMindroomAgents && (
            <>
              {countBadge}
              <TooltipProvider
                position="Bottom"
                align="Center"
                tooltip={
                  <Tooltip style={{ maxWidth: toRem(220) }}>
                    <Text size="T200">
                      {unresolvedOnly
                        ? t('thread.simpleFilter.showingUnresolved')
                        : t('thread.simpleFilter.showingAll')}
                    </Text>
                  </Tooltip>
                }
              >
                {(triggerRef) => (
                  <button
                    ref={triggerRef}
                    type="button"
                    className={classNames(css.SortButton, unresolvedOnly && css.SortButtonActive)}
                    aria-pressed={unresolvedOnly}
                    onClick={onToggleUnresolvedOnly}
                    data-simple-unresolved-toggle="true"
                  >
                    <Text size="T200">{t('thread.simpleFilter.unresolved')}</Text>
                  </button>
                )}
              </TooltipProvider>
            </>
          )}
          <RoomViewModeControls
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            showClassic={false}
          />
        </div>
        {hasMindroomAgents && emptyFilteredState}
      </Box>
    );
  }

  return (
    <Box className={css.Overview} direction="Column" gap="200" data-room-thread-overview="true">
      {liveRegion}
      {/* Single-line toolbar */}
      <div className={css.ToolbarHeader} role="toolbar" aria-label="Thread filters">
        {/* Count */}
        {hasMindroomAgents && countBadge}

        {/* Status toggles */}
        {hasMindroomAgents && (
          <div className={css.ToggleGroup} role="group" aria-label="Status filters">
            <TriStateIconToggle
              filterKey="resolved"
              state={state.resolved}
              isOrMode={isOrModeStatusChip(state, 'resolved')}
              onToggle={handleToggleWithPresetClear}
            >
              <Icon size="50" src={Icons.CheckTwice} />
            </TriStateIconToggle>

            <TriStateIconToggle
              filterKey="streaming"
              state={state.streaming}
              isOrMode={isOrModeStatusChip(state, 'streaming')}
              onToggle={handleToggleWithPresetClear}
            >
              <span className={threadIndicatorCss.ThreadStreamingDot} aria-hidden="true" />
            </TriStateIconToggle>

            <TriStateIconToggle
              filterKey="scheduled"
              state={state.scheduled}
              isOrMode={isOrModeStatusChip(state, 'scheduled')}
              onToggle={handleToggleWithPresetClear}
            >
              <IconCalendarEvent
                size={14}
                stroke={1.8}
                className={threadIndicatorCss.ThreadScheduledIcon}
                aria-hidden="true"
              />
            </TriStateIconToggle>

            <TriStateIconToggle
              filterKey="unread"
              state={state.unread}
              isOrMode={isOrModeStatusChip(state, 'unread')}
              onToggle={handleToggleWithPresetClear}
            >
              <Icon size="50" src={Icons.MessageUnread} />
            </TriStateIconToggle>

            <TriStateIconToggle
              filterKey="idle"
              state={state.idle}
              isOrMode={isOrModeStatusChip(state, 'idle')}
              onToggle={handleToggleWithPresetClear}
            >
              <IconZzz size={14} stroke={1.8} aria-hidden="true" />
            </TriStateIconToggle>
          </div>
        )}

        {/* Preset dropdown */}
        {hasMindroomAgents && (
          <ThreadPresetDropdown
            onApplyPreset={handlePresetApply}
            activePresetLabel={lastAppliedPreset}
          />
        )}

        {/* Info + Search */}
        {hasMindroomAgents && (
          <ThreadInfoPopover
            statusCounts={statusCounts}
            tagCounts={tagCounts}
            threadCount={threadCount}
            totalThreadCount={totalThreadCount}
          />
        )}
        <ThreadSearchBar
          searchQuery={searchQueryDraft}
          onSearchQueryChange={handleSearchWithPresetClear}
        />

        {/* View mode */}
        <RoomViewModeControls viewMode={viewMode} onViewModeChange={onViewModeChange} />
        <TooltipProvider
          position="Bottom"
          align="Center"
          tooltip={
            <Tooltip style={{ maxWidth: toRem(220) }}>
              <Text size="T200">{sortLabel}</Text>
            </Tooltip>
          }
        >
          {(triggerRef) => (
            <button
              ref={triggerRef}
              type="button"
              className={classNames(css.SortButton, filtersActive && css.SortButtonActive)}
              onClick={handleSortWithPresetClear}
              aria-label={sortLabel}
              data-sort-by={state.sortBy}
              data-sort-direction={state.sortDirection}
            >
              {state.sortBy === 'natural' ? (
                <Text size="T200">Natural</Text>
              ) : (
                <>
                  <Text size="T200">Last Reply</Text>
                  {state.sortDirection === 'desc' ? (
                    <IconSortDescending size={14} stroke={1.8} aria-hidden="true" />
                  ) : (
                    <IconSortAscending size={14} stroke={1.8} aria-hidden="true" />
                  )}
                </>
              )}
            </button>
          )}
        </TooltipProvider>
        {hasMindroomAgents && state.sortBy !== 'natural' && (
          <TooltipProvider
            position="Bottom"
            align="Center"
            tooltip={
              <Tooltip style={{ maxWidth: toRem(220) }}>
                <Text size="T200">{freezeLabel}</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <button
                ref={triggerRef}
                type="button"
                className={classNames(
                  css.ToggleButton,
                  isThreadSortFrozen && css.PauseButtonActive
                )}
                aria-label={freezeLabel}
                aria-pressed={isThreadSortFrozen}
                onClick={onToggleThreadSortFreeze}
                data-thread-sort-freeze="true"
              >
                {isThreadSortFrozen ? (
                  <IconLockOpen size={14} stroke={1.8} aria-hidden="true" />
                ) : (
                  <IconLock size={14} stroke={1.8} aria-hidden="true" />
                )}
              </button>
            )}
          </TooltipProvider>
        )}

        {/* Tag filters (right-aligned) */}
        {hasMindroomAgents && (activeTagEntries.length > 0 || availableTags.length > 0) && (
          <div
            className={css.TagRow}
            role="group"
            aria-label="Tag filters"
            data-tag-filter-row="true"
          >
            <div className={css.TagList}>
              {activeTagEntries.map(([tag, tagState]) => (
                <TagPill
                  key={tag}
                  tag={tag}
                  state={tagState}
                  onCycle={handleCycleTagWithPresetClear}
                  onRemove={handleRemoveTagWithPresetClear}
                />
              ))}
            </div>
            <AddTagDropdown
              availableTags={availableTags}
              activeTags={state.tags}
              onAddTag={handleAddTagWithPresetClear}
            />
          </div>
        )}
      </div>

      {emptyFilteredState}
    </Box>
  );
}
