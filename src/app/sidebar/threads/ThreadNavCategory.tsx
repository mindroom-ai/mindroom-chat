import { useCallback, useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Text } from 'folds';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import { archivedRoomsAtom, isRoomVisible } from '../../matrix/state/archivedRooms';
import { buildSidebarThreadEntries, MAX_SIDEBAR_THREADS } from './threadNavCategoryUtils';
import { useSnoozeNow } from '../../threads/tags/useSnoozeNow';
import { makeThreadSidebarPreferencesAtom } from '../../threads/cross-room/threadSidebarPreferences';
import { ThreadNavItem } from './ThreadNavItem';
import * as css from './threadNav.css';
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

type ThreadNavCategoryProps = {
  /** Shows only the threads of rooms in this space, nested ones included. */
  spaceId?: string;
};

/**
 * The sidebar's THREADS category: threads across rooms that are neither resolved nor snoozed, by
 * latest activity, the user's pinned ones first. Direct messages and archived rooms are left out.
 * It collapses like the ROOMS category, but starts collapsed until the person opens it
 * (`ClientInitStorageAtom`).
 */
export function ThreadNavCategory({ spaceId }: ThreadNavCategoryProps) {
  const { t } = useTranslation();
  const userId = useMatrixClient().getSafeUserId();
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

  // Renewed when a snooze ends, so its thread comes back.
  const now = useSnoozeNow(
    useMemo(
      () => Array.from(index.entries.values(), (entry) => entry.snoozedUntilTs),
      [index.entries]
    )
  );
  const entries = useMemo(
    () =>
      buildSidebarThreadEntries(
        Array.from(index.entries.values()).filter(
          (entry) =>
            isRoomVisible(entry.roomId, archivedRooms) &&
            (!spaceId || isInSpace(roomToParents, entry.roomId, spaceId))
        ),
        preferences.pinnedThreadKeys,
        directRoomIds,
        MAX_SIDEBAR_THREADS,
        now
      ),
    [
      archivedRooms,
      directRoomIds,
      index.entries,
      now,
      preferences.pinnedThreadKeys,
      roomToParents,
      spaceId,
    ]
  );
  const pinned = useMemo(
    () => new Set(preferences.pinnedThreadKeys),
    [preferences.pinnedThreadKeys]
  );
  const togglePin = useCallback(
    (threadKey: string) => updatePreferences({ type: 'TOGGLE_PIN', threadKey }),
    [updatePreferences]
  );
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

  return (
    <NavCategory data-testid="thread-nav-category">
      <NavCategoryHeader>{toggle}</NavCategoryHeader>
      {closed ? null : (
        <ThreadNavList
          entries={entries}
          pinnedKeys={pinned}
          isOpen={isOpen}
          onTogglePin={togglePin}
        />
      )}
    </NavCategory>
  );
}

type ThreadNavListProps = {
  entries: CrossRoomThreadIndexEntry[];
  pinnedKeys: ReadonlySet<string>;
  /** Whether the entry is the thread shown in the main view. */
  isOpen: (entry: CrossRoomThreadIndexEntry) => boolean;
  onTogglePin: (threadKey: string) => void;
};

/** The expanded category's rows, or a short note when no thread qualifies. */
function ThreadNavList({ entries, pinnedKeys, isOpen, onTogglePin }: ThreadNavListProps) {
  const { t } = useTranslation();
  const rows = entries.map((entry) => (
    <ThreadNavItem
      key={entry.key}
      entry={entry}
      selected={isOpen(entry)}
      pinned={pinnedKeys.has(entry.key)}
      onTogglePin={() => onTogglePin(entry.key)}
    />
  ));
  return (
    <div data-testid="thread-nav-list">
      {rows.length > 0 ? (
        rows
      ) : (
        <Text className={css.CategoryState} as="p" priority="300" size="T200">
          {t('threadNav.empty')}
        </Text>
      )}
    </div>
  );
}
