import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Icon, Icons, Text, Tooltip, toRem } from 'folds';
import { TooltipProvider } from '../../ui/directional';
import { useTranslation } from 'react-i18next';
import { type TFunction } from 'i18next';
import {
  IconCalendarEvent,
  IconChevronDown,
  IconClock,
  IconFilter,
  IconInfoCircle,
  IconLock,
  IconLockOpen,
  IconMessages,
  IconSortAscending,
  IconSortDescending,
  IconZzz,
} from '@tabler/icons-react';
import classNames from 'classnames';
import { Surface } from '../../ui/glass/GlassPrimitives';
import { useLiquidGlass } from '../../ui/glass/liquid/useLiquidGlass';
import { useSetting } from '../../preferences/useSetting';
import { settingsAtom } from '../../preferences/settings';
import * as css from './RoomThreadOverview.css';
import * as threadIndicatorCss from '../../messages/ThreadIndicator.css';
import { ThreadStreamingDot } from '../ThreadStreamingDot';
import { ThreadTagFilter } from './ThreadTagFilter';
import { useKeepInsideToolbar } from './useKeepInsideToolbar';
import { localDigits } from '../../lib/localDigits';
import type {
  ThreadFilterState,
  ThreadFilterKey,
  TriState,
  StatusCounts,
  FilterPreset,
} from '../../event-store/threads/roomThreadOverviewModel';
import {
  hasActiveThreadFilters,
  FILTER_PRESETS,
  isOrModeStatusChip,
  normalizeThreadSearchText,
} from '../../event-store/threads/roomThreadOverviewModel';
import {
  applyParsedThreadFilterQuery,
  parseThreadFilterQuery,
  serializeThreadFilterQuery,
} from '../../event-store/threads/threadFilterDsl';

// How long a filter change's summary stays in the live region.
const SPOKEN_SUMMARY_MS = 5_000;
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
} as const;

export type { ThreadFilterState, ThreadFilterKey };

// ─── Tooltip text helpers ────────────────────────────────────────────────────

const FILTER_LABEL_KEYS = {
  resolved: 'thread.status.resolved',
  snoozed: 'thread.status.snoozed',
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
      {(toggleAnchor) => (
        <button
          type="button"
          ref={toggleAnchor}
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

// ─── ThreadPresetDropdown ───────────────────────────────────────────────────

function ThreadPresetDropdown({
  onApplyPreset,
  activePresetLabel,
}: {
  onApplyPreset: (preset: FilterPreset) => void;
  activePresetLabel: string | null;
}) {
  const { t } = useTranslation();
  const filterPresets = FILTER_PRESETS.map((preset) => {
    switch (preset.id) {
      case 'needs-attention':
        return {
          ...preset,
          label: t('mindroomUi.threads.roomThreadOverview.presets.needs-attention.label'),
          description: t(
            'mindroomUi.threads.roomThreadOverview.presets.needs-attention.description'
          ),
        };
      case 'working':
        return {
          ...preset,
          label: t('mindroomUi.threads.roomThreadOverview.presets.working.label'),
          description: t('mindroomUi.threads.roomThreadOverview.presets.working.description'),
        };
      case 'review-queue':
        return {
          ...preset,
          label: t('mindroomUi.threads.roomThreadOverview.presets.review-queue.label'),
          description: t('mindroomUi.threads.roomThreadOverview.presets.review-queue.description'),
        };
      case 'snoozed':
        return {
          ...preset,
          label: t('mindroomUi.threads.roomThreadOverview.presets.snoozed.label'),
          description: t('mindroomUi.threads.roomThreadOverview.presets.snoozed.description'),
        };
      case 'archived':
        return {
          ...preset,
          label: t('mindroomUi.threads.roomThreadOverview.presets.archived.label'),
          description: t('mindroomUi.threads.roomThreadOverview.presets.archived.description'),
        };
      case 'all':
        return {
          ...preset,
          label: t('mindroomUi.threads.roomThreadOverview.presets.all.label'),
          description: t('mindroomUi.threads.roomThreadOverview.presets.all.description'),
        };
      default:
        return preset;
    }
  });
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useKeepInsideToolbar(panelRef);

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
          setFocusedIndex((prev) => (prev + 1) % filterPresets.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => (prev - 1 + filterPresets.length) % filterPresets.length);
          break;
        case 'Enter': {
          e.preventDefault();
          const preset = filterPresets[focusedIndex];
          if (preset) handleSelect(preset);
          break;
        }
        case 'Escape':
          // Escape closes the list only: the room's own Escape (focus the composer, which
          // reads the room and every thread in it) must not run as well.
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setFocusedIndex(-1);
          containerRef.current?.querySelector<HTMLElement>('[data-preset-button]')?.focus();
          break;
        default:
          break;
      }
    },
    [filterPresets, open, focusedIndex, handleSelect]
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
        onMouseDown={(e) => {
          // Safari focuses no button on a press: the open list would lose the focus to nothing
          // and close, and the click would open it again. The button takes the focus instead.
          if (open) {
            e.preventDefault();
            e.currentTarget.focus();
          }
        }}
        onClick={handleToggle}
        aria-label={t('mindroomUi.threads.roomThreadOverview.filterPresets')}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-preset-button="true"
      >
        <Text size="T200">
          {activePresetLabel ?? t('mindroomUi.threads.roomThreadOverview.preset')}
        </Text>
        <IconChevronDown size={14} stroke={1.8} aria-hidden="true" />
      </button>
      {open && (
        <Surface
          ref={panelRef}
          level="overlay"
          variant="SurfaceVariant"
          className={css.PresetDropdown}
          role="listbox"
          aria-label={t('mindroomUi.threads.roomThreadOverview.filterPresets')}
          data-preset-dropdown="true"
        >
          {filterPresets.map((preset, index) => (
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
        </Surface>
      )}
    </div>
  );
}

// ─── ThreadInfoPopover ──────────────────────────────────────────────────────

const STATUS_LABEL_KEYS = {
  resolved: 'thread.status.resolved',
  snoozed: 'thread.status.snoozed',
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
  const { t, i18n } = useTranslation();
  const digits = (count: number) => localDigits(String(count), i18n.language);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useKeepInsideToolbar(panelRef);

  const tooltipText = statusCounts
    ? (Object.keys(STATUS_LABEL_KEYS) as ThreadFilterKey[])
        // Lowercasing works for en/de/nl alike here: the labels read as
        // adjectives in the count summary ("3 gel\u00F6st"), not as nouns.
        .map((key) => `${digits(statusCounts[key])} ${t(STATUS_LABEL_KEYS[key]).toLowerCase()}`)
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
    <div
      ref={containerRef}
      className={css.InfoContainer}
      onBlur={handleBlur}
      onKeyDown={(event) => {
        // Escape closes the statistics, as it does the other panels of the bar, and nothing else.
        if (!open || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        containerRef.current?.querySelector<HTMLElement>('[data-info-button]')?.focus();
      }}
    >
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
        <Surface
          ref={panelRef}
          level="overlay"
          variant="SurfaceVariant"
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
                <Text size="T200">{digits(statusCounts[key])}</Text>
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
                  <Text size="T200">{digits(count)}</Text>
                </div>
              ))}
            </>
          )}
        </Surface>
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
  const { t } = useTranslation();
  // Collapsed until asked for, even while a query filters; the sort button shows active filters.
  const [expanded, setExpanded] = useState(false);
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
            <Text size="T200">{t('mindroomUi.threads.roomThreadOverview.searchThreads')}</Text>
          </Tooltip>
        }
      >
        {(triggerRef) => (
          <button
            ref={triggerRef}
            type="button"
            className={css.InfoButton}
            onClick={handleToggle}
            aria-label={t('mindroomUi.threads.roomThreadOverview.searchThreads')}
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
          placeholder={t('mindroomUi.threads.roomThreadOverview.searchThreads2')}
          aria-label={t('mindroomUi.threads.roomThreadOverview.searchThreads')}
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
  isThreadSortFrozen?: boolean;
  onToggle: (key: ThreadFilterKey) => void;
  onSortDirectionChange: () => void;
  onToggleThreadSortFreeze: () => void;
  /** Simple mode's one filter: hide resolved threads or show them all. */
  onToggleUnresolvedOnly?: () => void;
  onReset: () => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  /** The Tags dropdown's Clear: drops every tag filter. */
  onClearTags: () => void;
  onApplyPreset: (preset: FilterPreset) => void;
  onSearchQueryChange: (query: string) => void;
  /** The People dropdown (ThreadPeopleFilter), shown with the advanced filters. */
  peopleFilter?: React.ReactNode;
};

function ThreadSortControl({
  state,
  active = false,
  onChange,
}: {
  state: ThreadFilterState;
  active?: boolean;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const sortLabel =
    state.sortBy === 'natural'
      ? t('mindroomUi.threads.roomThreadOverview.natural')
      : t('mindroomUi.threads.roomThreadOverview.lastReply');

  return (
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
          className={classNames(css.SortButton, active && css.SortButtonActive)}
          onClick={onChange}
          aria-label={sortLabel}
          data-sort-by={state.sortBy}
          data-sort-direction={state.sortDirection}
        >
          {state.sortBy === 'natural' ? (
            <Text size="T200">{t('mindroomUi.threads.roomThreadOverview.natural')}</Text>
          ) : (
            <>
              <Text size="T200">{t('mindroomUi.threads.roomThreadOverview.lastReply')}</Text>
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
  isThreadSortFrozen = false,
  onToggle,
  onSortDirectionChange,
  onToggleThreadSortFreeze,
  onToggleUnresolvedOnly,
  onReset,
  onAddTag,
  onRemoveTag,
  onClearTags,
  onApplyPreset,
  onSearchQueryChange,
  peopleFilter,
}: RoomThreadOverviewProps) {
  const [lastAppliedPreset, setLastAppliedPreset] = useState<string | null>(null);
  const glassRef = useLiquidGlass<HTMLDivElement>();
  const { t, i18n } = useTranslation();
  const [simpleMode, setSimpleMode] = useSetting(settingsAtom, 'simpleThreadFilters');
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

  const handleClearTagsWithPresetClear = useCallback(() => {
    setLastAppliedPreset(null);
    onClearTags();
  }, [onClearTags]);

  const filterSummary = filtersActive
    ? t('mindroomUi.threads.roomThreadOverview.showingFilteredThreads', {
        count: threadCount,
        total: totalThreadCount,
      })
    : t('mindroomUi.threads.roomThreadOverview.showingAllThreads', {
        count: threadCount,
      });
  const liveSummary = isThreadSortFrozen
    ? t('mindroomUi.threads.roomThreadOverview.sortLockedSummary', {
        summary: filterSummary,
      })
    : filterSummary;
  // The live region speaks when the person changes the filters or the sort, not each time a
  // message moves the count, and empties again after a while; the summary itself stays readable.
  const filterKey = JSON.stringify([state, isThreadSortFrozen, simpleMode]);
  const spokenFilterKey = useRef(filterKey);
  const [spokenSummary, setSpokenSummary] = useState('');
  useEffect(() => {
    if (spokenFilterKey.current === filterKey) return;
    spokenFilterKey.current = filterKey;
    setSpokenSummary(liveSummary);
  }, [filterKey, liveSummary]);
  useEffect(() => {
    if (!spokenSummary) return undefined;
    const timer = setTimeout(() => setSpokenSummary(''), SPOKEN_SUMMARY_MS);
    return () => clearTimeout(timer);
  }, [spokenSummary]);
  const freezeLabel = isThreadSortFrozen
    ? t('mindroomUi.threads.roomThreadOverview.unlockSortOrder', {
        sort:
          state.sortBy === 'natural'
            ? t('mindroomUi.threads.roomThreadOverview.natural')
            : t('mindroomUi.threads.roomThreadOverview.lastReply'),
      })
    : t('mindroomUi.threads.roomThreadOverview.lockSortOrder', {
        sort:
          state.sortBy === 'natural'
            ? t('mindroomUi.threads.roomThreadOverview.natural')
            : t('mindroomUi.threads.roomThreadOverview.lastReply'),
      });

  const liveRegion = (
    <>
      <div style={VISUALLY_HIDDEN}>{liveSummary}</div>
      <div aria-live="polite" aria-atomic="true" style={VISUALLY_HIDDEN}>
        {spokenSummary}
      </div>
    </>
  );

  const countBadge = (
    <TooltipProvider
      position="Bottom"
      align="Center"
      tooltip={
        <Tooltip style={{ maxWidth: toRem(200) }}>
          <Text size="T200">
            {t('mindroomUi.threads.roomThreadOverview.threadCount', { count: threadCount })}
          </Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <span ref={triggerRef} className={css.CompactCount} data-thread-count="true">
          <IconMessages size={14} stroke={1.8} aria-hidden="true" />
          <Text size="T200">{localDigits(String(threadCount), i18n.language)}</Text>
        </span>
      )}
    </TooltipProvider>
  );

  // Only when a filter hides threads: a Compact room with none yet has its Unresolved filter on.
  const emptyFilteredState = threadCount === 0 && totalThreadCount > 0 && filtersActive && (
    <div className={css.EmptyState}>
      <Text size="T200">
        {t('mindroomUi.threads.roomThreadOverview.noThreadsMatchCurrentFilters')}
      </Text>
      <button
        type="button"
        className={css.ResetLink}
        onClick={onReset}
        aria-label={t('mindroomUi.threads.roomThreadOverview.resetAllThreadFilters')}
      >
        <Text size="T200">{t('mindroomUi.threads.roomThreadOverview.reset')}</Text>
      </button>
    </div>
  );

  // Switches the bar between its simple controls and all of them; the stored filter keeps both.
  const advancedFiltersLabel = t('mindroomUi.threads.roomThreadOverview.advancedFilters');
  const filterModeSwitch = (
    <TooltipProvider
      position="Bottom"
      align="Center"
      tooltip={
        <Tooltip style={{ maxWidth: toRem(220) }}>
          <Text size="T200">{advancedFiltersLabel}</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <button
          ref={triggerRef}
          type="button"
          className={classNames(css.ToggleButton, !simpleMode && css.PauseButtonActive)}
          aria-label={advancedFiltersLabel}
          aria-pressed={!simpleMode}
          onClick={() => setSimpleMode(!simpleMode)}
          data-thread-filter-mode-switch="true"
        >
          <IconFilter size={14} stroke={1.8} aria-hidden="true" />
        </button>
      )}
    </TooltipProvider>
  );

  // Simple mode keeps the sorting choice plus one agent-room filter: hide
  // resolved threads or show everything. The upstream filter state is already
  // projected onto this visible subspace.
  if (simpleMode) {
    const unresolvedOnly = state.resolved === 'exclude';
    return (
      <Box
        ref={glassRef}
        className={css.Overview}
        direction="Column"
        gap="200"
        data-room-thread-overview="true"
      >
        {liveRegion}
        <div
          className={css.ToolbarHeader}
          role="toolbar"
          aria-label={t('mindroomUi.threads.roomThreadOverview.threadFilters')}
        >
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
          <ThreadSortControl state={state} onChange={handleSortWithPresetClear} />
          {filterModeSwitch}
        </div>
        {hasMindroomAgents && emptyFilteredState}
      </Box>
    );
  }

  return (
    <Box
      ref={glassRef}
      className={css.Overview}
      direction="Column"
      gap="200"
      data-room-thread-overview="true"
    >
      {liveRegion}
      {/* Single-line toolbar */}
      <div
        className={css.ToolbarHeader}
        role="toolbar"
        aria-label={t('mindroomUi.threads.roomThreadOverview.threadFilters')}
      >
        {/* Count */}
        {hasMindroomAgents && countBadge}

        {/* Status toggles */}
        {hasMindroomAgents && (
          <div
            className={css.ToggleGroup}
            role="group"
            aria-label={t('mindroomUi.threads.roomThreadOverview.statusFilters')}
          >
            <TriStateIconToggle
              filterKey="resolved"
              state={state.resolved}
              isOrMode={isOrModeStatusChip(state, 'resolved')}
              onToggle={handleToggleWithPresetClear}
            >
              <Icon size="50" src={Icons.CheckTwice} />
            </TriStateIconToggle>

            <TriStateIconToggle
              filterKey="snoozed"
              state={state.snoozed}
              isOrMode={isOrModeStatusChip(state, 'snoozed')}
              onToggle={handleToggleWithPresetClear}
            >
              <IconClock size={14} stroke={1.8} aria-hidden="true" />
            </TriStateIconToggle>

            <TriStateIconToggle
              filterKey="streaming"
              state={state.streaming}
              isOrMode={isOrModeStatusChip(state, 'streaming')}
              onToggle={handleToggleWithPresetClear}
            >
              <ThreadStreamingDot aria-hidden="true" />
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
        {peopleFilter}
        {hasMindroomAgents && (state.tags.size > 0 || availableTags.length > 0) && (
          <ThreadTagFilter
            tags={availableTags}
            counts={tagCounts}
            selected={state.tags}
            onAdd={handleAddTagWithPresetClear}
            onRemove={handleRemoveTagWithPresetClear}
            onClear={handleClearTagsWithPresetClear}
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

        <ThreadSortControl
          state={state}
          active={filtersActive}
          onChange={handleSortWithPresetClear}
        />
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
            {(lockAnchor) => (
              <button
                type="button"
                ref={lockAnchor}
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
        {filterModeSwitch}
      </div>

      {emptyFilteredState}
    </Box>
  );
}
