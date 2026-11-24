import { useMemo } from 'react';
import { IconArrowDown, IconCheck, IconFilter } from '@tabler/icons-react';
import classNames from 'classnames';
import { Button, Text } from 'folds';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useTranslation } from 'react-i18next';
import type { ThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import { isSnoozedAt } from '../../event-store/threads/threadSnooze';
import type { ThreadRecord } from '../../event-store/threads/types';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { useRelativeTime } from '../../i18n/useRelativeTime';
import { motionAllowed } from '../../ui/listMotion';
import * as css from './CompactRoomEmptyState.css';
import { getCompactThreadTitleText } from './compactThreadCardUtils';

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

const hasExtraNarrowingFilter = (filterState: ThreadFilterState): boolean =>
  filterState.forMe === true ||
  (filterState.freeText ?? '').trim() !== '' ||
  (filterState.unsupportedQuery ?? '').trim() !== '' ||
  filterState.tags.size > 0 ||
  (filterState.people?.length ?? 0) > 0 ||
  filterState.streaming !== 'any' ||
  filterState.scheduled !== 'any' ||
  filterState.unread !== 'any' ||
  filterState.idle !== 'any';

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
};

function RecentlyResolvedRow({
  room,
  record,
  canToggle,
  updating,
  onThreadClick,
  onSetResolved,
}: RecentlyResolvedRowProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const title = getCompactThreadTitleText(room, record.presentation, t);
  const lastActivityTs = record.status.lastActivityTs;
  const relativeTime = useRelativeTime(lastActivityTs, 'compact');
  const lastActivityTitle =
    lastActivityTs !== undefined ? new Date(lastActivityTs).toLocaleString(language) : undefined;
  const reopenText = t('mindroomUi.threads.compactRoomEmptyState.reopen');
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
        <Text as="span" size="T200" className={css.PeekTitle}>
          {title}
        </Text>
        {relativeTime && (
          <Text
            as="span"
            size="T200"
            priority="300"
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
          title={t('threadActions.reopen')}
          aria-label={`${reopenText}: ${title}`}
          onClick={() => onSetResolved(record.threadRootId, false)}
        >
          {reopenText}
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
}: CompactRoomEmptyStateProps) {
  const { t } = useTranslation();
  const model = useMemo(
    () => classifyCompactRoomEmptyState(threadRecordMap, filterState, now),
    [threadRecordMap, filterState, now]
  );

  if (model.kind === 'inboxZero') {
    const animateRing = !indexPending && motionAllowed();
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
      <div className={css.Root} data-compact-room-empty-state="inboxZero">
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
              <Text as="span" size="T300" priority="300">
                {summaryParts.join(' · ')}
              </Text>
              <span className={css.Separator} aria-hidden="true">
                ·
              </span>
            </>
          )}
          <button type="button" className={css.InlineLink} onClick={onReset}>
            {t('mindroomUi.threads.compactRoomEmptyState.showAll')}
          </button>
        </div>
        {model.resolvedCount > 0 && model.recentlyResolved.length > 0 && (
          <section
            className={css.PeekSection}
            aria-label={t('mindroomUi.threads.compactRoomEmptyState.recentlyResolved')}
          >
            <div className={css.PeekHeader}>
              <Text as="h3" size="L400" priority="300" className={css.PeekLabel}>
                {t('mindroomUi.threads.compactRoomEmptyState.recentlyResolved')}
              </Text>
              {model.snoozedCount > 0 && (
                <button type="button" className={css.PeekSnoozedLink} onClick={onShowSnoozed}>
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
                />
              ))}
            </ul>
          </section>
        )}
        {canCompose && (
          <div className={css.WhisperRow}>
            <IconArrowDown size={14} stroke={1.8} className={css.WhisperIcon} aria-hidden="true" />
            <Text as="span" size="T200" priority="300">
              {t('mindroomUi.threads.compactRoomEmptyState.startNewThreadBelow')}
            </Text>
          </div>
        )}
      </div>
    );
  }

  const subtitle =
    filterState.forMe && model.openCount > 0
      ? t('mindroomUi.threads.compactRoomEmptyState.hiddenByForMe', { count: model.openCount })
      : model.openCount > 0
        ? t('mindroomUi.threads.compactRoomEmptyState.hiddenByFilters', {
            count: model.openCount,
          })
        : t('mindroomUi.threads.compactRoomEmptyState.adjustOrResetFilters');

  return (
    <div className={css.Root} data-compact-room-empty-state="filtered">
      <div className={css.IconRing} data-empty-state-ring="neutral" aria-hidden="true">
        <IconFilter size={19} stroke={1.8} />
      </div>
      <Text as="h2" size="H4" className={css.Heading}>
        {t('mindroomUi.threads.compactRoomEmptyState.noMatchHeading')}
      </Text>
      <Text as="p" size="T300" priority="300" className={css.Subtitle}>
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
              onClick={onToggleForMe}
            >
              <Text size="B300">{t('mindroomUi.threads.compactRoomEmptyState.turnOffForMe')}</Text>
            </Button>
            <Button
              type="button"
              size="300"
              radii="300"
              variant="Secondary"
              fill="None"
              outlined
              onClick={onReset}
            >
              <Text size="B300">{t('mindroomUi.threads.compactRoomEmptyState.resetAll')}</Text>
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
            onClick={onReset}
          >
            <Text size="B300">{t('mindroomUi.threads.compactRoomEmptyState.resetFilters')}</Text>
          </Button>
        )}
      </div>
    </div>
  );
}
