import React, { useCallback, useRef, useState } from 'react';
import { Box, Icon, Icons, Text, Tooltip, TooltipProvider, toRem } from 'folds';
import { IconCalendarEvent, IconZzz } from '@tabler/icons-react';
import classNames from 'classnames';
import * as css from './RoomThreadOverview.css';
import * as replyCss from '../../components/message/Reply.css';
import type {
  ThreadFilterState,
  ThreadFilterKey,
  TriState,
  StatusCounts,
} from './roomThreadOverviewModel';
import { hasActiveThreadFilters } from './roomThreadOverviewModel';

export type { ThreadFilterState, ThreadFilterKey };

// ─── Tooltip text helpers ────────────────────────────────────────────────────

const FILTER_LABELS: Record<ThreadFilterKey, string> = {
  resolved: 'Resolved',
  streaming: 'Streaming',
  scheduled: 'Scheduled',
  unread: 'Unread',
  idle: 'Idle (resolved, not streaming, no tasks)',
};

const getTooltipText = (key: ThreadFilterKey, state: TriState): string => {
  const label = FILTER_LABELS[key];
  switch (state) {
    case 'any':
      return `${label}: showing all. Click to show only.`;
    case 'include':
      return `${label}: show only. Click to hide.`;
    case 'exclude':
      return `${label}: hiding. Click to clear filter.`;
    default:
      return label;
  }
};

const getAriaValueText = (state: TriState): string => {
  switch (state) {
    case 'any':
      return 'showing all';
    case 'include':
      return 'show only';
    case 'exclude':
      return 'hiding';
    default:
      return state;
  }
};

const getTagTooltipText = (tag: string, state: TriState): string => {
  switch (state) {
    case 'include':
      return `Tag "${tag}": show only. Click to hide.`;
    case 'exclude':
      return `Tag "${tag}": hiding. Click to clear filter.`;
    default:
      return `Tag "${tag}"`;
  }
};

// ─── TriStateIconToggle ──────────────────────────────────────────────────────

function TriStateIconToggle({
  filterKey,
  state,
  count,
  onToggle,
  children,
}: {
  filterKey: ThreadFilterKey;
  state: TriState;
  count?: number;
  onToggle: (key: ThreadFilterKey) => void;
  children: React.ReactNode;
}) {
  const tooltipText = getTooltipText(filterKey, state);

  return (
    <span className={css.ToggleButtonWrap}>
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
              state === 'include' && css.ToggleInclude,
              state === 'exclude' && css.ToggleExclude
            )}
            onClick={() => onToggle(filterKey)}
            aria-roledescription="tri-state toggle"
            aria-valuetext={getAriaValueText(state)}
            aria-label={tooltipText}
            data-filter-key={filterKey}
            data-filter-state={state}
          >
            {children}
          </button>
        )}
      </TooltipProvider>
      {count !== undefined && (
        <span
          className={classNames(
            css.ToggleCount,
            state !== 'any' && css.ToggleCountActive
          )}
          data-status-count={filterKey}
        >
          {count}
        </span>
      )}
    </span>
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
  const tooltipText = getTagTooltipText(tag, state);

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
            aria-valuetext={getAriaValueText(state)}
            aria-label={tooltipText}
          >
            <Text size="T200">{tag}</Text>
          </button>
          <button
            type="button"
            className={css.TagPillRemove}
            onClick={() => onRemove(tag)}
            aria-label={`Remove ${tag} filter`}
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

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
        setOpen(false);
        setFocusedIndex(-1);
      }
    },
    []
  );

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

// ─── RoomThreadOverview ──────────────────────────────────────────────────────

export type RoomThreadOverviewProps = {
  threadCount: number;
  statusCounts?: StatusCounts;
  state: ThreadFilterState;
  availableTags: string[];
  onToggle: (key: ThreadFilterKey) => void;
  onSortDirectionChange: () => void;
  onReset: () => void;
  onCycleTag: (tag: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
};

export function RoomThreadOverview({
  threadCount,
  statusCounts,
  state,
  availableTags,
  onToggle,
  onSortDirectionChange,
  onReset,
  onCycleTag,
  onAddTag,
  onRemoveTag,
}: RoomThreadOverviewProps) {
  const filtersActive = hasActiveThreadFilters(state);
  const sortLabel =
    state.sortBy === 'natural'
      ? 'Threads in timeline order'
      : state.sortDirection === 'desc'
        ? 'Sort threads by last reply, newest first'
        : 'Sort threads by last reply, oldest first';

  const activeTagEntries = [...state.tags.entries()];

  const filterSummary = filtersActive
    ? `Showing ${threadCount} thread${threadCount !== 1 ? 's' : ''} with active filters.`
    : `Showing all ${threadCount} thread${threadCount !== 1 ? 's' : ''}.`;

  return (
    <Box className={css.Overview} direction="Column" gap="200" data-room-thread-overview="true">
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        {filterSummary}
      </div>
      {/* Row 1: Status toggles */}
      <div className={css.ToolbarHeader}>
        <Text size="B300">{`Threads (${threadCount})`}</Text>

        <div className={css.ToolbarControls}>
          <div className={css.ToggleGroup} role="group" aria-label="Thread filters">
            <TriStateIconToggle
              filterKey="resolved"
              state={state.resolved}
              count={statusCounts?.resolved}
              onToggle={onToggle}
            >
              <Icon size="50" src={Icons.CheckTwice} />
            </TriStateIconToggle>

            <TriStateIconToggle
              filterKey="streaming"
              state={state.streaming}
              count={statusCounts?.streaming}
              onToggle={onToggle}
            >
              <span className={replyCss.ThreadStreamingDot} aria-hidden="true" />
            </TriStateIconToggle>

            <TriStateIconToggle
              filterKey="scheduled"
              state={state.scheduled}
              count={statusCounts?.scheduled}
              onToggle={onToggle}
            >
              <IconCalendarEvent
                size={14}
                stroke={1.8}
                className={replyCss.ThreadScheduledIcon}
                aria-hidden="true"
              />
            </TriStateIconToggle>

            <TriStateIconToggle
              filterKey="unread"
              state={state.unread}
              count={statusCounts?.unread}
              onToggle={onToggle}
            >
              <Icon size="50" src={Icons.MessageUnread} />
            </TriStateIconToggle>

            <TriStateIconToggle
              filterKey="idle"
              state={state.idle}
              count={statusCounts?.idle}
              onToggle={onToggle}
            >
              <IconZzz size={14} stroke={1.8} aria-hidden="true" />
            </TriStateIconToggle>
          </div>

          <div className={css.ToggleSortSeparator} aria-hidden="true" />

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
                className={classNames(
                  css.SortButton,
                  filtersActive && css.SortButtonActive
                )}
                onClick={onSortDirectionChange}
                aria-label={sortLabel}
                data-sort-by={state.sortBy}
                data-sort-direction={state.sortDirection}
              >
                {state.sortBy === 'natural' ? (
                  <Text size="T200">Natural</Text>
                ) : (
                  <>
                    <Text size="T200">Last Reply</Text>
                    <Text size="T200" aria-hidden="true">
                      {state.sortDirection === 'desc' ? '\u25BE' : '\u25B4'}
                    </Text>
                  </>
                )}
              </button>
            )}
          </TooltipProvider>
        </div>
      </div>

      {/* Row 2: Tag filters */}
      {(activeTagEntries.length > 0 || availableTags.length > 0) && (
        <div className={css.TagRow} role="group" aria-label="Tag filters" data-tag-filter-row="true">
          <div className={css.TagList}>
            {activeTagEntries.map(([tag, tagState]) => (
              <TagPill
                key={tag}
                tag={tag}
                state={tagState}
                onCycle={onCycleTag}
                onRemove={onRemoveTag}
              />
            ))}
          </div>
          <AddTagDropdown
            availableTags={availableTags}
            activeTags={state.tags}
            onAddTag={onAddTag}
          />
        </div>
      )}

      {threadCount === 0 && filtersActive && (
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
      )}
    </Box>
  );
}
