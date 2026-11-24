import type React from 'react';
import { useId, useMemo } from 'react';
import { IconArrowDown, IconCheck, IconFilter } from '@tabler/icons-react';
import classNames from 'classnames';
import { Button, Spinner, Text } from 'folds';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useTranslation } from 'react-i18next';
import type { ThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import { isSnoozedAt } from '../../event-store/threads/threadSnooze';
import type { ThreadRecord } from '../../event-store/threads/types';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { useRelativeTime } from '../../i18n/useRelativeTime';
import { ownDirectionLine } from '../../ui/directional';
import { motionAllowed } from '../../ui/listMotion';
import * as css from './CompactRoomEmptyState.css';
import {
  COMPACT_THREAD_TITLE_LIMIT,
  getCompactThreadTitleText,
  truncateCompactThreadText,
} from './compactThreadCardUtils';

const MAX_RECENTLY_RESOLVED = 2;

export type CompactRoomEmptyStateConfig = {
  filterState: ThreadFilterState;
  now: number;
  canCompose: boolean;
  onReset: () => void;
  onToggleForMe?: () => void;
  onShowSnoozed: () => void;
};

export type CompactRoomEmptyStateModel = {
  kind: 'inboxZero' | 'filtered';
  totalCount: number;
  openCount: number;
  resolvedCount: number;
  snoozedCount: number;
  recentlyResolved: ThreadRecord[];
};

const hasNonForMeNarrowingFilter = (filterState: ThreadFilterState): boolean =>
  (filterState.freeText ?? '').trim() !== '' ||
  (filterState.unsupportedQuery ?? '').trim() !== '' ||
  filterState.tags.size > 0 ||
  (filterState.people?.length ?? 0) > 0 ||
  filterState.streaming !== 'any' ||
  filterState.scheduled !== 'any' ||
  filterState.unread !== 'any' ||
  filterState.idle !== 'any';

const hasExtraNarrowingFilter = (filterState: ThreadFilterState): boolean =>
  filterState.forMe === true || hasNonForMeNarrowingFilter(filterState);

const isForMeOnlyOpenFilter = (filterState: ThreadFilterState): boolean =>
  filterState.forMe === true &&
  (filterState.tab === undefined || filterState.tab === 'all') &&
  filterState.resolved !== 'include' &&
  filterState.snoozed !== 'include' &&
  !hasNonForMeNarrowingFilter(filterState);

const isViewingOpenThreads = (filterState: ThreadFilterState): boolean => {
  if (filterState.tab === 'needsYou' || filterState.tab === 'working') {
    return filterState.resolved !== 'include' && filterState.snoozed !== 'include';
  }
  return (
    (filterState.tab === undefined || filterState.tab === 'all') &&
    filterState.resolved === 'exclude' &&
    filterState.snoozed !== 'include'
  );
};

const isKeyboardActivated = (event: React.MouseEvent<HTMLButtonElement>): boolean => {
  if (event.detail === 0) return true;
  try {
    return event.currentTarget.matches(':focus-visible');
  } catch {
    return false;
  }
};

export const classifyCompactRoomEmptyState = (
  threadRecordMap: ReadonlyMap<string, ThreadRecord>,
  filterState: ThreadFilterState,
  now: number
): CompactRoomEmptyStateModel => {
  let resolvedCount = 0;
  let snoozedCount = 0;
  const resolvedRecords: ThreadRecord[] = [];

  threadRecordMap.forEach((record) => {
    if (record.status.isResolved) {
      resolvedCount += 1;
      resolvedRecords.push(record);
    } else if (isSnoozedAt(record.status.snoozedUntilTs, now)) {
      snoozedCount += 1;
    }
  });

  resolvedRecords.sort((a, b) => {
    const activityDiff = (b.status.lastActivityTs ?? 0) - (a.status.lastActivityTs ?? 0);
    if (activityDiff !== 0) return activityDiff;
    const rootDiff = (b.cache.oldestTs ?? 0) - (a.cache.oldestTs ?? 0);
    if (rootDiff !== 0) return rootDiff;
    return a.threadRootId.localeCompare(b.threadRootId);
  });

  const totalCount = threadRecordMap.size;
  const openCount = totalCount - resolvedCount - snoozedCount;
  const kind =
    totalCount > 0 &&
    openCount === 0 &&
    isViewingOpenThreads(filterState) &&
    !hasExtraNarrowingFilter(filterState)
      ? 'inboxZero'
      : 'filtered';

  return {
    kind,
    totalCount,
    openCount,
    resolvedCount,
    snoozedCount,
    recentlyResolved: resolvedRecords.slice(0, MAX_RECENTLY_RESOLVED),
  };
};

type RecentlyResolvedRowProps = {
  room: Room;
  record: ThreadRecord;
  canToggle: boolean;
  updating: boolean;
  onThreadClick: (threadRootId: string, summaryText?: string) => void;
  onSetResolved: (threadRootId: string, resolved: boolean) => void;
  onRestoreFocus?: () => void;
};

function RecentlyResolvedRow({
  room,
  record,
  canToggle,
  updating,
  onThreadClick,
  onSetResolved,
  onRestoreFocus,
}: RecentlyResolvedRowProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const displayTitle = truncateCompactThreadText(
    getCompactThreadTitleText(room, record.presentation, t),
    COMPACT_THREAD_TITLE_LIMIT
  );
  const lastActivityTs = record.status.lastActivityTs;
  const relativeTime = useRelativeTime(lastActivityTs, 'compact');
  const lastActivityTitle =
    lastActivityTs !== undefined ? new Date(lastActivityTs).toLocaleString(language) : undefined;
  const reopenLabel = t('threadActions.reopen');
  const reopenDisabled = updating || !isConfirmedMatrixEventId(record.threadRootId);

  return (
    <li className={css.PeekRow} data-recent-resolved-row={record.threadRootId}>
      <button
        type="button"
        className={css.PeekThreadButton}
        onClick={() =>
          onThreadClick(record.threadRootId, record.presentation.recentThreadSummaryText)
        }
      >
        <span className={css.PeekCheckIcon} aria-hidden="true">
          <IconCheck size={12} stroke={2.4} />
        </span>
        <Text as="span" size="T200" className={css.PeekTitle} {...ownDirectionLine}>
          {displayTitle}
        </Text>
        {relativeTime && (
          <Text
            as="span"
            size="T200"
            priority="400"
            className={css.PeekTime}
            title={lastActivityTitle}
          >
            {relativeTime}
          </Text>
        )}
      </button>
      {canToggle && (
        <button
          type="button"
          className={css.ReopenButton}
          disabled={reopenDisabled}
          aria-label={`${reopenLabel}: ${displayTitle}`}
          onClick={(event) => {
            if (isKeyboardActivated(event)) onRestoreFocus?.();
            onSetResolved(record.threadRootId, false);
          }}
        >
          {reopenLabel}
        </button>
      )}
    </li>
  );
}

export type CompactRoomEmptyStateProps = CompactRoomEmptyStateConfig & {
  room: Room;
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  indexPending?: boolean;
  canToggle: boolean;
  updatingThreadRootIds: ReadonlySet<string>;
  onThreadClick: (threadRootId: string, summaryText?: string) => void;
  onSetResolved: (threadRootId: string, resolved: boolean) => void;
  onRestoreFocus?: () => void;
};

export function CompactRoomEmptyState({
  room,
  threadRecordMap,
  filterState,
  now,
  canCompose,
  indexPending = false,
  canToggle,
  updatingThreadRootIds,
  onThreadClick,
  onSetResolved,
  onReset,
  onToggleForMe,
  onShowSnoozed,
  onRestoreFocus,
}: CompactRoomEmptyStateProps) {
  const { t } = useTranslation();
  const recentlyResolvedHeadingId = useId();
  const model = useMemo(
    () => classifyCompactRoomEmptyState(threadRecordMap, filterState, now),
    [threadRecordMap, filterState, now]
  );

  const activateWithFocusRestore = (
    event: React.MouseEvent<HTMLButtonElement>,
    action: () => void
  ) => {
    if (isKeyboardActivated(event)) onRestoreFocus?.();
    action();
  };

  if (indexPending) {
    return (
      <div key="loading" className={css.Root} data-compact-room-empty-state="loading" role="status">
        <div className={css.LoadingState}>
          <Spinner size="400" variant="Secondary" />
          <Text as="span" size="T200" priority="400">
            {t('sharedUi.threadsView.loadingThreads')}
          </Text>
        </div>
      </div>
    );
  }

  if (model.kind === 'inboxZero') {
    const animateRing = motionAllowed();
    const summaryParts: string[] = [];
    if (model.resolvedCount > 0) {
      summaryParts.push(
        t('mindroomUi.threads.compactRoomEmptyState.resolvedCount', {
          count: model.resolvedCount,
        })
      );
    }
    if (model.snoozedCount > 0) {
      summaryParts.push(
        t('mindroomUi.threads.compactRoomEmptyState.snoozedCount', {
          count: model.snoozedCount,
        })
      );
    }

    return (
      <div key="inboxZero" className={css.Root} data-compact-room-empty-state="inboxZero">
        <div
          className={classNames(
            css.IconRing,
            css.IconRingSuccess,
            animateRing && css.IconRingSuccessAnimated
          )}
          data-empty-state-ring="success"
          aria-hidden="true"
        >
          <IconCheck size={20} stroke={2.1} />
        </div>
        <Text as="h2" size="H4" className={css.Heading}>
          {t('mindroomUi.threads.compactRoomEmptyState.allCaughtUp')}
        </Text>
        <div className={css.SummaryRow}>
          {summaryParts.length > 0 && (
            <>
              <Text as="span" size="T300" priority="400">
                {summaryParts.join(' · ')}
              </Text>
              <span className={css.Separator} aria-hidden="true">
                ·
              </span>
            </>
          )}
          <button
            type="button"
            className={css.InlineLink}
            onClick={(event) => activateWithFocusRestore(event, onReset)}
          >
            {t('mindroomUi.threads.compactRoomEmptyState.showAll')}
          </button>
        </div>
        {model.resolvedCount > 0 && model.recentlyResolved.length > 0 && (
          <section className={css.PeekSection} aria-labelledby={recentlyResolvedHeadingId}>
            <div className={css.PeekHeader}>
              <Text
                id={recentlyResolvedHeadingId}
                as="h3"
                size="L400"
                priority="400"
                className={css.PeekLabel}
              >
                {t('mindroomUi.threads.compactRoomEmptyState.recentlyResolved')}
              </Text>
              {model.snoozedCount > 0 && (
                <button
                  type="button"
                  className={css.PeekSnoozedLink}
                  onClick={(event) => activateWithFocusRestore(event, onShowSnoozed)}
                >
                  {t('mindroomUi.threads.compactRoomEmptyState.snoozedCount', {
                    count: model.snoozedCount,
                  })}
                </button>
              )}
            </div>
            <ul className={css.PeekList}>
              {model.recentlyResolved.map((record) => (
                <RecentlyResolvedRow
                  key={record.threadRootId}
                  room={room}
                  record={record}
                  canToggle={canToggle}
                  updating={updatingThreadRootIds.has(record.threadRootId)}
                  onThreadClick={onThreadClick}
                  onSetResolved={onSetResolved}
                  onRestoreFocus={onRestoreFocus}
                />
              ))}
            </ul>
          </section>
        )}
        {canCompose && (
          <div className={css.WhisperRow}>
            <IconArrowDown size={14} stroke={1.8} className={css.WhisperIcon} aria-hidden="true" />
            <Text as="span" size="T200" priority="400">
              {t('mindroomUi.threads.compactRoomEmptyState.startNewThreadBelow')}
            </Text>
          </div>
        )}
      </div>
    );
  }

  const subtitle =
    model.openCount > 0 && isForMeOnlyOpenFilter(filterState)
      ? t('mindroomUi.threads.compactRoomEmptyState.hiddenByForMe', { count: model.openCount })
      : model.openCount > 0 && filterState.tab !== 'done' && filterState.tab !== 'later'
        ? t('mindroomUi.threads.compactRoomEmptyState.hiddenByFilters', {
            count: model.openCount,
          })
        : t('mindroomUi.threads.compactRoomEmptyState.adjustOrResetFilters');

  return (
    <div key="filtered" className={css.Root} data-compact-room-empty-state="filtered">
      <div className={css.IconRing} data-empty-state-ring="neutral" aria-hidden="true">
        <IconFilter size={19} stroke={1.8} />
      </div>
      <Text as="h2" size="H4" className={css.Heading}>
        {t('mindroomUi.threads.compactRoomEmptyState.noMatchHeading')}
      </Text>
      <Text as="p" size="T300" priority="400" className={css.Subtitle}>
        {subtitle}
      </Text>
      <div className={css.Actions}>
        {filterState.forMe && onToggleForMe ? (
          <>
            <Button
              type="button"
              size="300"
              radii="300"
              variant="Primary"
              fill="Soft"
              outlined
              onClick={(event) => activateWithFocusRestore(event, onToggleForMe)}
            >
              <Text as="span" size="B300">
                {t('mindroomUi.threads.compactRoomEmptyState.turnOffForMe')}
              </Text>
            </Button>
            <Button
              type="button"
              size="300"
              radii="300"
              variant="Secondary"
              fill="None"
              outlined
              className={css.SecondaryActionButton}
              onClick={(event) => activateWithFocusRestore(event, onReset)}
            >
              <Text as="span" size="B300">
                {t('mindroomUi.threads.compactRoomEmptyState.resetAll')}
              </Text>
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="300"
            radii="300"
            variant="Primary"
            fill="Soft"
            outlined
            onClick={(event) => activateWithFocusRestore(event, onReset)}
          >
            <Text as="span" size="B300">
              {t('mindroomUi.threads.compactRoomEmptyState.resetFilters')}
            </Text>
          </Button>
        )}
      </div>
    </div>
  );
}
