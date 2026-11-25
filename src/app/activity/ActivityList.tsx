import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Button, Icon, Icons, Spinner, Text } from 'folds';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { allInvitesAtom } from '../matrix/state/inviteList';
import { useLoadedRoomMembers } from '../matrix/hooks/useLoadedRoomMembers';
import { getCanonicalAliasOrRoomId } from '../matrix/matrix';
import { getViewedPlace } from '../navigation/viewedPlace';
import { settingsAtom } from '../preferences/settings';
import { useSetting } from '../preferences/useSetting';
import { getActivityInvitesPath, getActivityRoomPath, withSearchParam } from '../routes/pathUtils';
import { useListMotion } from '../ui/listMotion';
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
import { ACTIVITY_TABS, ActivityListHeader, ActivityListTabs } from './ActivityListChrome';
import { ActivityRowItem } from './ActivityRowItem';
import { ActivityInvitesRow, INVITES_GATHERED_FROM } from './ActivityInvitesRow';
import * as css from './ActivityList.css';

const PAGE_SIZE = 40;
const SENTINEL_MARGIN = '400px 0px';

const findScrollParent = (element: HTMLElement): HTMLElement | null => {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return parent;
  }
  return null;
};

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
  const result = useActivityRows();
  const { rows, hiddenAutomations, loading = false } = result;
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
        ACTIVITY_TABS.map((id) => [id, unreadCount(filterActivityRows(rows, id, true))])
      ) as Record<ActivityTab, number>,
    [rows]
  );
  // The window over the ordinary rows belongs to one filter: a tab or Unread change, automation
  // runs shown or hidden, and the loaded index each start it again at one page, from the first
  // render on. The last two come with the rows, which arrive a commit after their switch.
  const filterKey = `${tab}:${unreadOnly}:${result.showAutomations}:${loading}`;
  const [paged, setPaged] = useState({ filterKey, limit: PAGE_SIZE });
  if (paged.filterKey !== filterKey) setPaged({ filterKey, limit: PAGE_SIZE });
  const limit = paged.filterKey === filterKey ? paged.limit : PAGE_SIZE;

  const open = useCallback(
    (row: ActivityRow) => {
      const roomId = row.type === 'thread' ? row.entry.roomId : row.roomId;
      void navigate(rowPath(getCanonicalAliasOrRoomId(mx, roomId), row));
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

  const rowsRef = useRef<HTMLDivElement>(null);
  // Waiting rows are never capped. The ordinary rows end at the last one this filter already
  // showed, so a live update never unmounts a row, or at the page limit where that is further.
  // While the index still fills in, the limit alone holds: its rows arrive by the hundred.
  const mountedRef = useRef({ filterKey, keys: new Set<string>() });
  const { keys: mounted } = mountedRef.current;
  const anchored = !loading && mountedRef.current.filterKey === filterKey;
  const lastMounted = anchored ? rest.findLastIndex((row) => mounted.has(row.key)) : -1;
  const visibleRest = rest.slice(0, Math.max(limit, lastMounted + 1));
  useLayoutEffect(() => {
    mountedRef.current = { filterKey, keys: new Set(visibleRest.map((row) => row.key)) };
  });
  const visibleRows = [...waitingRows, ...visibleRest];
  const hasMore = visibleRest.length < rest.length;

  // Senders are named from the member lists, which a room the user has not opened lacks.
  const namesVersion = useLoadedRoomMembers(
    mx,
    visibleRows.map((row) => (row.type === 'thread' ? row.entry.roomId : row.roomId))
  );

  // Show more appends a page when it is activated and when it nears the view. Its focus then
  // goes to the first new row: the page mounts before it, and the last page takes it away.
  const moreRef = useRef<HTMLDivElement>(null);
  const focusKeyRef = useRef<string>(undefined);
  const appendPage = () => {
    if (moreRef.current?.contains(document.activeElement)) {
      focusKeyRef.current = rest[visibleRest.length]?.key;
    }
    setPaged({ filterKey, limit: visibleRest.length + PAGE_SIZE });
  };
  const appendRef = useRef(appendPage);
  appendRef.current = appendPage;
  // An update can take away what has focus: Show more when a live one shows the last rows, a
  // row when one moves it past the window while the index loads. The other of the two gets it.
  const active = document.activeElement;
  const focused = rowsRef.current?.contains(active)
    ? active?.closest<HTMLElement>('[data-motion-row]')?.dataset.motionRow
    : undefined;
  if (!hasMore && moreRef.current?.contains(active)) {
    focusKeyRef.current ??= visibleRest.at(-1)?.key;
  } else if (focused && rest.findIndex((row) => row.key === focused) >= visibleRest.length) {
    focusKeyRef.current ??= focused;
  }
  useLayoutEffect(() => {
    const key = focusKeyRef.current;
    focusKeyRef.current = undefined;
    if (!key) return;
    const row = [
      ...(rowsRef.current?.querySelectorAll<HTMLElement>('[data-motion-row]') ?? []),
    ].find((element) => element.dataset.motionRow === key);
    // A row that is not mounted is past the window: Show more stands for it.
    (row ?? moreRef.current)?.querySelector('button')?.focus();
  });

  // A row that was answered or read fades where it stood, a new one fades in, the rest glide.
  // The rows that wait come first, so their number tells when one moves under the day's divider
  // while the order stays.
  const offWindow = hasMore
    ? new Set(
        rest
          .slice(visibleRest.length)
          .flatMap((row) => [row.key, `day:${activityDay(row.ts, now)}`])
      )
    : undefined;
  const listMotion = useListMotion(
    rowsRef,
    `${waiting.length}|${gathered}|${visibleRows.map((row) => row.key).join(',')}`,
    offWindow
  );

  useEffect(() => {
    const target = moreRef.current;
    if (!hasMore || !target || typeof IntersectionObserver === 'undefined') return undefined;
    // What it measured for an earlier filter or page may still arrive after the cleanup.
    let live = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (live && entries.some((entry) => entry.isIntersecting)) appendRef.current();
      },
      { root: findScrollParent(target), rootMargin: SENTINEL_MARGIN }
    );
    observer.observe(target);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [hasMore, filterKey, limit]);
  const openInvites = () => {
    void navigate(getActivityInvitesPath());
    onNavigate?.();
  };
  return (
    <div className={css.List} data-activity-list={variant}>
      <ActivityListHeader
        variant={variant}
        unreadOnly={unreadOnly}
        onUnreadOnlyChange={setUnreadOnly}
        onMarkAllRead={() => void markActivityRowsRead(mx, rows, hideActivity)}
        onExpand={onExpand}
      />
      <ActivityListTabs tab={tab} unreadByTab={unreadByTab} onSelectTab={setTab} />
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
        <>
          <div ref={rowsRef} role="list" className={css.Rows}>
            {listMotion}
            {waitingRows.map((row) => (
              <div role="listitem" key={row.key} data-motion-row={row.key}>
                <ActivityRowItem
                  row={row}
                  onOpen={open}
                  namesVersion={namesVersion}
                  current={isCurrent(row)}
                />
              </div>
            ))}
            {gathered && (
              <div role="listitem" data-motion-row="invites">
                <ActivityInvitesRow invites={invites} onOpen={openInvites} />
              </div>
            )}
            {visibleRest.map((row, index) => {
              const day = activityDay(row.ts, now);
              const previous = visibleRest[index - 1];
              const divider = !previous || activityDay(previous.ts, now) !== day;
              return (
                <Fragment key={row.key}>
                  {divider && (
                    <Text
                      size="L400"
                      priority="300"
                      className={css.Divider}
                      role="presentation"
                      data-motion-row={`day:${day}`}
                    >
                      {t(`activity.days.${day}`)}
                    </Text>
                  )}
                  <div role="listitem" data-motion-row={row.key}>
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
          {hasMore && (
            <div ref={moreRef} className={css.ShowMore}>
              <Button size="300" variant="Secondary" fill="None" radii="300" onClick={appendPage}>
                <Text size="B300">{t('threadsPage.showMore')}</Text>
              </Button>
            </div>
          )}
        </>
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
              className={css.ActionButton}
              onClick={() => setShowAutomations(false)}
            >
              <Text size="B300">{t('activity.hideAutomations')}</Text>
            </Button>
          ) : (
            <>
              <Text size="T200" className={css.FooterText}>
                {t('activity.automationsHidden', { count: hiddenAutomations })}
              </Text>
              <Button
                size="300"
                variant="Primary"
                fill="None"
                radii="300"
                className={css.ActionButton}
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
          <Button
            size="300"
            variant="Secondary"
            fill="None"
            radii="300"
            className={css.ActionButton}
            onClick={openInvites}
          >
            <Text size="B300">{t('activity.allInvites')}</Text>
          </Button>
        </div>
      )}
    </div>
  );
}
