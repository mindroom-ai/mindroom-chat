import { useCallback, useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Icons, Text } from 'folds';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import { archivedRoomsAtom, isRoomVisible } from '../../matrix/state/archivedRooms';
import {
  buildSidebarThreadEntries,
  buildSidebarThreadSections,
  MAX_SIDEBAR_THREADS,
  type SidebarThreadSectionId,
} from './threadNavCategoryUtils';
import { useSnoozeNow } from '../../threads/tags/useSnoozeNow';
import { useMinuteClock } from '../../lib/hooks/useMinuteClock';
import {
  makeThreadSidebarPreferencesAtom,
  type ThreadSidebarLayout,
} from '../../threads/cross-room/threadSidebarPreferences';
import { getThreadSignalsReader } from '../../threads/cross-room/threadSignalsReader';
import { ThreadNavItem } from './ThreadNavItem';
import * as css from './threadNav.css';
import * as threadsNavCss from '../../threads/page/ThreadsNav.css';
import { NavCategory } from '../../ui/nav/NavItem';
import { NavCategoryHeader } from '../../ui/nav/NavCategoryHeader';
import { RoomNavCategoryButton } from '../room-nav/RoomNavCategoryButton';
import { useSelectedRoom } from '../../navigation/useSelectedRoom';
import { useCategoryHandler } from '../../ui/nav/useCategoryHandler';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import { isInSpace } from '../../matrix/state/spaceAncestors';
import { makeNavCategoryId } from '../../ui/nav/closedNavCategories';
import { useClosedNavCategoriesAtom } from '../../ui/nav/useClosedNavCategories';

export const THREAD_NAV_CATEGORY_ID = makeNavCategoryId('mindroom', 'threads');
/** The fold of one section of the Sections layout, kept with the sidebar's other categories. */
export const threadNavSectionCategoryId = (id: SidebarThreadSectionId): string =>
  makeNavCategoryId('mindroom', 'threads', id);

const LAYOUTS: ThreadSidebarLayout[] = ['recent', 'sections'];
const LAYOUT_LABEL_KEYS = {
  recent: 'threadNav.layoutRecent',
  sections: 'threadNav.layoutSections',
} as const;

type ThreadNavCategoryProps = {
  /** Shows only the threads of rooms in this space, nested ones included. */
  spaceId?: string;
};

/**
 * The sidebar's THREADS category: threads across rooms that are neither resolved nor snoozed, by
 * latest activity, the user's pinned ones first; or, in the Sections layout the header switches
 * to, every thread in Working, Snoozed, Idle and Resolved (`buildSidebarThreadSections`), each
 * section folding on its own. Direct messages and archived rooms are left out. It collapses like
 * the ROOMS category, but starts collapsed until the person opens it (`ClientInitStorageAtom`).
 */
export function ThreadNavCategory({ spaceId }: ThreadNavCategoryProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const index = useAtomValue(crossRoomThreadIndexAtom);
  const archivedRooms = useAtomValue(archivedRoomsAtom);
  const directRoomIds = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const preferencesAtom = useMemo(() => makeThreadSidebarPreferencesAtom(userId), [userId]);
  const [preferences, updatePreferences] = useAtom(preferencesAtom);
  const [closedCategories, setClosedCategories] = useAtom(useClosedNavCategoriesAtom());
  const handleCategoryClick = useCategoryHandler(setClosedCategories, (categoryId: string) =>
    closedCategories.has(categoryId)
  );
  const closed = closedCategories.has(THREAD_NAV_CATEGORY_ID);
  const selectedRoomId = useSelectedRoom();
  const [searchParams] = useSearchParams();
  const selectedThreadId = searchParams.get('threadId') ?? undefined;

  // Renewed every minute and when a snooze ends, so its thread comes back then; the signals read
  // at it go into the cache Activity shares, which reads them at the same clock.
  const minuteNow = useMinuteClock();
  const snoozeNow = useSnoozeNow(
    useMemo(
      () => Array.from(index.entries.values(), (entry) => entry.snoozedUntilTs),
      [index.entries]
    )
  );
  const now = Math.max(minuteNow, snoozeNow);
  const { layout } = preferences;
  const visible = useMemo(
    () =>
      Array.from(index.entries.values()).filter(
        (entry) =>
          isRoomVisible(entry.roomId, archivedRooms) &&
          (!spaceId || isInSpace(roomToParents, entry.roomId, spaceId))
      ),
    [archivedRooms, index.entries, roomToParents, spaceId]
  );
  const entries = useMemo(
    () =>
      layout === 'recent'
        ? buildSidebarThreadEntries(
            visible,
            preferences.pinnedThreadKeys,
            directRoomIds,
            MAX_SIDEBAR_THREADS,
            now
          )
        : [],
    [directRoomIds, layout, now, preferences.pinnedThreadKeys, visible]
  );
  const sections = useMemo(() => {
    if (layout !== 'sections') return [];
    // The client's shared signals cache, which Activity keeps filled for every thread.
    const reader = getThreadSignalsReader(mx);
    return buildSidebarThreadSections(
      visible,
      preferences.pinnedThreadKeys,
      directRoomIds,
      now,
      (entry) => {
        const room = mx.getRoom(entry.roomId);
        return room ? reader.read(room, entry, userId, now) : undefined;
      }
    );
  }, [directRoomIds, layout, mx, now, preferences.pinnedThreadKeys, userId, visible]);
  const pinned = useMemo(
    () => new Set(preferences.pinnedThreadKeys),
    [preferences.pinnedThreadKeys]
  );
  const togglePin = useCallback(
    (threadKey: string) => updatePreferences({ type: 'TOGGLE_PIN', threadKey }),
    [updatePreferences]
  );
  const isSectionClosed = (id: SidebarThreadSectionId) =>
    closedCategories.has(threadNavSectionCategoryId(id));
  const isOpen = (entry: CrossRoomThreadIndexEntry) =>
    entry.roomId === selectedRoomId && entry.threadRootId === selectedThreadId;

  const toggle = (
    <RoomNavCategoryButton
      data-category-id={THREAD_NAV_CATEGORY_ID}
      closed={closed}
      onClick={handleCategoryClick}
    >
      {t('threadNav.title')}
    </RoomNavCategoryButton>
  );

  const rowsProps = { pinnedKeys: pinned, isOpen, onTogglePin: togglePin };

  return (
    <NavCategory data-testid="thread-nav-category">
      <NavCategoryHeader>
        {toggle}
        {!closed && (
          <div
            className={threadsNavCss.Scopes}
            role="radiogroup"
            aria-label={t('threadNav.layout')}
          >
            {LAYOUTS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={layout === id}
                className={threadsNavCss.Scope}
                onClick={() => updatePreferences({ type: 'SET_LAYOUT', layout: id })}
              >
                {t(LAYOUT_LABEL_KEYS[id])}
              </button>
            ))}
          </div>
        )}
      </NavCategoryHeader>
      {closed ? null : (
        <div data-testid="thread-nav-list">
          {entries.length === 0 && sections.length === 0 && (
            <Text className={css.CategoryState} as="p" priority="300" size="T200">
              {t('threadNav.empty')}
            </Text>
          )}
          <ThreadNavRows entries={entries} {...rowsProps} />
          {sections.map(({ id, entries: sectionEntries, total }) => {
            const sectionClosed = isSectionClosed(id);
            return (
              <section key={id} aria-label={t(`threadNav.sections.${id}`)}>
                <Button
                  size="300"
                  variant="Secondary"
                  fill="None"
                  radii="300"
                  data-category-id={threadNavSectionCategoryId(id)}
                  aria-expanded={!sectionClosed}
                  onClick={handleCategoryClick}
                  before={
                    <Icon
                      size="100"
                      src={sectionClosed ? Icons.ChevronRight : Icons.ChevronBottom}
                      data-directional={sectionClosed || undefined}
                    />
                  }
                >
                  <Text size="B300">{`${t(`threadNav.sections.${id}`)} · ${total}`}</Text>
                </Button>
                {!sectionClosed && <ThreadNavRows entries={sectionEntries} {...rowsProps} />}
              </section>
            );
          })}
        </div>
      )}
    </NavCategory>
  );
}

type ThreadNavRowsProps = {
  entries: CrossRoomThreadIndexEntry[];
  pinnedKeys: ReadonlySet<string>;
  /** Whether the entry is the thread shown in the main view. */
  isOpen: (entry: CrossRoomThreadIndexEntry) => boolean;
  onTogglePin: (threadKey: string) => void;
};

/** The rows of a list of threads. */
function ThreadNavRows({ entries, pinnedKeys, isOpen, onTogglePin }: ThreadNavRowsProps) {
  return entries.map((entry) => (
    <ThreadNavItem
      key={entry.key}
      entry={entry}
      selected={isOpen(entry)}
      pinned={pinnedKeys.has(entry.key)}
      onTogglePin={() => onTogglePin(entry.key)}
    />
  ));
}
