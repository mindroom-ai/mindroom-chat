import { Fragment, useCallback, useMemo, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Button, Chip, Icon, IconButton, Icons, Spinner, Switch, Text, Tooltip } from 'folds';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { allInvitesAtom } from '../matrix/state/inviteList';
import { crossRoomThreadIndexBootstrappedAtom } from '../threads/cross-room/crossRoomThreadIndex';
import { useLoadedRoomMembers } from '../matrix/hooks/useLoadedRoomMembers';
import { getCanonicalAliasOrRoomId } from '../matrix/matrix';
import { getViewedPlace } from '../navigation/viewedPlace';
import { settingsAtom } from '../preferences/settings';
import { useSetting } from '../preferences/useSetting';
import { getActivityInvitesPath, getActivityRoomPath, withSearchParam } from '../routes/pathUtils';
import { TooltipProvider } from '../ui/directional';
import {
  activityDay,
  filterActivityRows,
  needsYou,
  unreadCount,
  type ActivityRow,
  type ActivityTab,
} from './activityRows';
import { markActivityRowsRead } from './activityActions';
import { activityShowAutomationsAtom, activityUnreadOnlyAtom } from './activityState';
import { useActivityRows } from './useActivityRows';
import { ActivityRowItem } from './ActivityRowItem';
import { ActivityInvitesRow, INVITES_GATHERED_FROM } from './ActivityInvitesRow';
import * as css from './ActivityList.css';

const TABS: ActivityTab[] = ['all', 'mentions', 'replies', 'needsYou'];

type ActivityListProps = {
  /** Where the list shows: the rail's popover, the Activity page, or the phone sheet. */
  variant: 'popover' | 'page' | 'sheet';
  /** Called after the list opened a thread, a room or the invite list, so a popover or sheet can close. */
  onNavigate?: () => void;
  /** Opens the Activity page; offered by the popover. */
  onExpand?: () => void;
};

/** Where a row opens: its thread, or the invited room, beside the Activity list. */
const rowPath = (roomSegment: string, row: ActivityRow): string =>
  row.type === 'thread'
    ? withSearchParam(getActivityRoomPath(roomSegment), { threadId: row.entry.threadRootId })
    : getActivityRoomPath(roomSegment);

/**
 * Activity's list: tabs, the Unread switch and Mark all read, then the rows, what waits for an
 * answer first and the rest under day dividers, and how many automation runs it leaves out.
 */
export function ActivityList({ variant, onNavigate, onExpand }: ActivityListProps) {
  const { rows, hiddenAutomations } = useActivityRows();
  const { t } = useTranslation();
  const [tab, setTab] = useState<ActivityTab>('all');
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useAtom(activityUnreadOnlyAtom);
  const [showAutomations, setShowAutomations] = useAtom(activityShowAutomationsAtom);
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const now = Date.now();

  // Every pending invite, also those Activity leaves out as spam: the list sorts them.
  const hasInvites = useAtomValue(allInvitesAtom).length > 0;
  const loading = !useAtomValue(crossRoomThreadIndexBootstrappedAtom);
  const place = getViewedPlace(mx, useLocation());
  // The row of the thread, or the invite's room, that the page shows beside the list.
  const { roomId: shownRoomId, threadId: shownThreadId } = place;
  const isCurrent = useCallback(
    (row: ActivityRow) =>
      row.type === 'thread'
        ? shownRoomId === row.entry.roomId && shownThreadId === row.entry.threadRootId
        : shownRoomId === row.roomId && !shownThreadId,
    [shownRoomId, shownThreadId]
  );
  // The row beside the list stays while it is read, so the list does not shift under the reader.
  const shown = useMemo(
    () => filterActivityRows(rows, tab, unreadOnly, isCurrent),
    [rows, tab, unreadOnly, isCurrent]
  );
  const unreadByTab = useMemo(
    () =>
      Object.fromEntries(
        TABS.map((id) => [id, unreadCount(filterActivityRows(rows, id, true))])
      ) as Record<ActivityTab, number>,
    [rows]
  );
  // Senders are named from the member lists, which a room the user has not opened lacks.
  const namesVersion = useLoadedRoomMembers(
    mx,
    shown.map((row) => (row.type === 'thread' ? row.entry.roomId : row.roomId))
  );

  const open = useCallback(
    (row: ActivityRow) => {
      const roomId = row.type === 'thread' ? row.entry.roomId : row.roomId;
      navigate(rowPath(getCanonicalAliasOrRoomId(mx, roomId), row));
      onNavigate?.();
    },
    [mx, navigate, onNavigate]
  );

  const waiting = shown.filter(needsYou);
  const rest = shown.filter((row) => !needsYou(row));
  // Many invites, often a bridge's stale ones, show as one row after what else waits.
  const invites = waiting.flatMap((row) => (row.type === 'invite' ? [row] : []));
  const gathered = invites.length >= INVITES_GATHERED_FROM;
  const waitingRows = gathered ? waiting.filter((row) => row.type !== 'invite') : waiting;
  const openInvites = () => {
    navigate(getActivityInvitesPath());
    onNavigate?.();
  };
  const tooltip = (label: string) => (
    <Tooltip>
      <Text size="T200">{label}</Text>
    </Tooltip>
  );

  return (
    <div className={css.List} data-activity-list={variant}>
      <div className={css.Header}>
        {/* The sheet's own header names it already. */}
        {variant === 'sheet' ? (
          <span className={css.Grow} />
        ) : (
          <Text as="h2" size="H4" className={css.Grow}>
            {t('activity.title')}
          </Text>
        )}
        {/* The label names the switch and toggles it too; the tooltip says what it does. */}
        <TooltipProvider
          position="Bottom"
          offset={4}
          tooltip={tooltip(t('activity.unreadOnlyHint'))}
        >
          {(triggerRef) => (
            <label ref={triggerRef} className={css.Toggle}>
              <Text as="span" size="T200">
                {t('activity.unreadOnly')}
              </Text>
              <Switch value={unreadOnly} onChange={setUnreadOnly} />
            </label>
          )}
        </TooltipProvider>
        <TooltipProvider position="Bottom" offset={4} tooltip={tooltip(t('activity.markAllRead'))}>
          {(triggerRef) => (
            <IconButton
              ref={triggerRef}
              size="300"
              radii="300"
              aria-label={t('activity.markAllRead')}
              onClick={() => void markActivityRowsRead(mx, rows, hideActivity)}
            >
              <Icon size="100" src={Icons.CheckTwice} />
            </IconButton>
          )}
        </TooltipProvider>
        {onExpand && (
          <TooltipProvider position="Bottom" offset={4} tooltip={tooltip(t('activity.openAsPage'))}>
            {(triggerRef) => (
              <IconButton
                ref={triggerRef}
                size="300"
                radii="300"
                aria-label={t('activity.openAsPage')}
                onClick={onExpand}
              >
                <Icon size="100" src={Icons.External} />
              </IconButton>
            )}
          </TooltipProvider>
        )}
      </div>
      <div className={css.Tabs} role="tablist" aria-label={t('activity.tabsLabel')}>
        {TABS.map((id) => (
          <Chip
            key={id}
            role="tab"
            aria-selected={tab === id}
            variant={tab === id ? 'Primary' : 'Background'}
            radii="Pill"
            onClick={() => setTab(id)}
          >
            <Text size="T200">{t(`activity.tabs.${id}`)}</Text>
            {unreadByTab[id] > 0 && (
              <Text as="span" size="L400" aria-hidden>
                {unreadByTab[id]}
              </Text>
            )}
          </Chip>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className={css.Empty}>
          {/* Before the index scanned the rooms, an empty list says nothing yet. */}
          {loading ? (
            <>
              <Spinner size="400" variant="Secondary" />
              <Text size="T200" priority="300">
                {t('sharedUi.threadsView.loadingThreads')}
              </Text>
            </>
          ) : (
            <>
              <Icon size="400" src={Icons.Bell} />
              <Text size="H6">{t('activity.caughtUp')}</Text>
              <Text size="T200" priority="300">
                {t('activity.caughtUpDescription')}
              </Text>
            </>
          )}
        </div>
      ) : (
        <div role="list" className={css.Rows}>
          {waitingRows.map((row) => (
            <div role="listitem" key={row.key}>
              <ActivityRowItem
                row={row}
                onOpen={open}
                namesVersion={namesVersion}
                current={isCurrent(row)}
              />
            </div>
          ))}
          {gathered && (
            <div role="listitem">
              <ActivityInvitesRow invites={invites} onOpen={openInvites} />
            </div>
          )}
          {rest.map((row, index) => {
            const day = activityDay(row.ts, now);
            const previous = rest[index - 1];
            const divider = !previous || activityDay(previous.ts, now) !== day;
            return (
              <Fragment key={row.key}>
                {divider && (
                  <Text size="L400" priority="300" className={css.Divider} role="presentation">
                    {t(`activity.days.${day}`)}
                  </Text>
                )}
                <div role="listitem">
                  <ActivityRowItem
                    row={row}
                    onOpen={open}
                    namesVersion={namesVersion}
                    current={isCurrent(row)}
                  />
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
      {(hiddenAutomations > 0 || showAutomations) && (
        <div className={css.Footer}>
          <Icon size="100" src={Icons.Thread} />
          {showAutomations ? (
            <Button
              size="300"
              variant="Secondary"
              fill="None"
              radii="300"
              onClick={() => setShowAutomations(false)}
            >
              <Text size="B300">{t('activity.hideAutomations')}</Text>
            </Button>
          ) : (
            <>
              <Text size="T200" className={css.Grow}>
                {t('activity.automationsHidden', { count: hiddenAutomations })}
              </Text>
              <Button
                size="300"
                variant="Primary"
                fill="None"
                radii="300"
                onClick={() => setShowAutomations(true)}
              >
                <Text size="B300">{t('activity.showAutomations')}</Text>
              </Button>
            </>
          )}
        </div>
      )}
      {hasInvites && (
        <div className={css.Footer}>
          <Button size="300" variant="Secondary" fill="None" radii="300" onClick={openInvites}>
            <Text size="B300">{t('activity.allInvites')}</Text>
          </Button>
        </div>
      )}
    </div>
  );
}
