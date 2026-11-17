import {
  type ThreadWorkflowTab,
  type ThreadWorkflowCounts,
} from '../../event-store/threads/threadWorkflow';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Icon, Icons, Text, Tooltip, toRem } from 'folds';
import { TooltipProvider } from '../../ui/directional';
import { useTranslation } from 'react-i18next';
import {
  IconFilter,
  IconInfoCircle,
  IconLock,
  IconLockOpen,
  IconMessages,
  IconSortAscending,
  IconSortDescending,
} from '@tabler/icons-react';
import classNames from 'classnames';
import { Surface } from '../../ui/glass/GlassPrimitives';
import { useLiquidGlass } from '../../ui/glass/liquid/useLiquidGlass';
import { useSetting } from '../../preferences/useSetting';
import { settingsAtom } from '../../preferences/settings';
import * as css from './RoomThreadOverview.css';
import { ThreadTagFilter } from './ThreadTagFilter';
import { useKeepInsideToolbar } from './useKeepInsideToolbar';
import { WorkflowTabs } from './WorkflowTabs';
import { GroupThreadsIcon } from './GroupThreadsIcon';
import { localDigits } from '../../lib/localDigits';
import type {
  ThreadFilterState,
  ThreadFilterKey,
  StatusCounts,
} from '../../event-store/threads/roomThreadOverviewModel';
import {
  hasActiveThreadFilters,
  hasSearchOnlyThreadFilters,
  THREAD_FILTER_KEYS,
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
  filtering,
  onSearchQueryChange,
}: {
  searchQuery: string;
  /** The query filters by something no other control shows, so the button lights up. */
  filtering: boolean;
  onSearchQueryChange: (query: string) => void;
}) {
  const { t } = useTranslation();
  // Collapsed until asked for, even while a query filters; the button then shows that it does.
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
            className={classNames(css.InfoButton, filtering && css.SearchButtonFiltering)}
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
  /** The room shown: a new one starts the workflow tabs afresh, without motion. */
  roomId?: string;
  hasMindroomAgents: boolean;
  threadCount: number;
  totalThreadCount: number;
  statusCounts?: StatusCounts;
  bucketCounts?: ThreadWorkflowCounts;
  /** Whether `bucketCounts` stopped loading, so their changes may move (WorkflowTabs). */
  countsSettled?: boolean;
  onSelectTab?: (tab: ThreadWorkflowTab) => void;
  tagCounts?: Record<string, number>;
  state: ThreadFilterState;
  availableTags: string[];
  isThreadSortFrozen?: boolean;
  onSortDirectionChange: () => void;
  onToggleThreadSortFreeze: () => void;
  /** Simple mode's one filter: hide resolved threads or show them all. */
  onToggleUnresolvedOnly?: () => void;
  onReset: () => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  /** The Tags dropdown's Clear: drops every tag filter. */
  onClearTags: () => void;
  onSearchQueryChange: (query: string) => void;
  /** The People dropdown (ThreadPeopleFilter), shown with the advanced filters. */
  peopleFilter?: React.ReactNode;
  /** The cards show in sections (Working, Needs you, Later, Done), each in its own order. */
  threadSections?: boolean;
  /** Turns the sections on or off; the switch shows beside the sort only when given (Compact). */
  onToggleThreadSections?: () => void;
};

/**
 * Compact's Group switch between the sorted cards and their sections, beside the sort. A narrow
 * bar shows only its icon, as the workflow tabs do.
 */
function ThreadSectionsSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const label = t('threadNav.group');
  return (
    <TooltipProvider
      position="Bottom"
      align="Center"
      tooltip={
        <Tooltip style={{ maxWidth: toRem(220) }}>
          <Text size="T200">{t('threadNav.groupHint')}</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <button
          ref={triggerRef}
          type="button"
          className={classNames(css.SortButton, on && css.SortButtonActive)}
          aria-pressed={on}
          onClick={onToggle}
          aria-label={label}
          data-thread-sections="true"
        >
          <Icon size="100" src={GroupThreadsIcon} aria-hidden="true" />
          <Text size="T200" className={css.SectionsSwitchLabel}>
            {label}
          </Text>
        </button>
      )}
    </TooltipProvider>
  );
}

function ThreadSortControl({
  state,
  onChange,
}: {
  state: ThreadFilterState;
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
          className={css.SortButton}
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
  roomId,
  hasMindroomAgents,
  threadCount,
  totalThreadCount,
  statusCounts,
  bucketCounts,
  countsSettled = false,
  onSelectTab,
  tagCounts,
  state,
  availableTags,
  isThreadSortFrozen = false,
  onSortDirectionChange,
  onToggleThreadSortFreeze,
  onToggleUnresolvedOnly,
  onReset,
  onAddTag,
  onRemoveTag,
  onClearTags,
  onSearchQueryChange,
  peopleFilter,
  threadSections = false,
  onToggleThreadSections,
}: RoomThreadOverviewProps) {
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
  const handleSort = useCallback(() => {
    onSortDirectionChange();
  }, [onSortDirectionChange]);

  const handleSearch = useCallback(
    (query: string) => {
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
          <Text
            size="T200"
            className={css.CompactCountValue}
            data-reserve={localDigits(String(totalThreadCount), i18n.language)}
          >
            {localDigits(String(threadCount), i18n.language)}
          </Text>
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

  // Sections order their cards themselves, so the sort and its lock make way for the switch.
  const sectionsSwitch = onToggleThreadSections && (
    <ThreadSectionsSwitch on={threadSections} onToggle={onToggleThreadSections} />
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
          {!threadSections && <ThreadSortControl state={state} onChange={handleSort} />}
          {sectionsSwitch}
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

        {hasMindroomAgents && (
          <WorkflowTabs
            key={roomId}
            active={
              state.tab ??
              (THREAD_FILTER_KEYS.some((key) => state[key] !== 'any') ? undefined : 'all')
            }
            counts={bucketCounts}
            countsSettled={countsSettled}
            onSelect={onSelectTab}
          />
        )}
        {/* Info */}
        {hasMindroomAgents && (
          <ThreadInfoPopover
            statusCounts={statusCounts}
            tagCounts={tagCounts}
            threadCount={threadCount}
            totalThreadCount={totalThreadCount}
          />
        )}
        {peopleFilter}
        {hasMindroomAgents && (state.tags.size > 0 || availableTags.length > 0) && (
          <ThreadTagFilter
            tags={availableTags}
            counts={tagCounts}
            selected={state.tags}
            onAdd={onAddTag}
            onRemove={onRemoveTag}
            onClear={onClearTags}
          />
        )}

        {!threadSections && <ThreadSortControl state={state} onChange={handleSort} />}
        {sectionsSwitch}
        <ThreadSearchBar
          searchQuery={searchQueryDraft}
          filtering={hasSearchOnlyThreadFilters(state)}
          onSearchQueryChange={handleSearch}
        />
        {hasMindroomAgents && !threadSections && state.sortBy !== 'natural' && (
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
