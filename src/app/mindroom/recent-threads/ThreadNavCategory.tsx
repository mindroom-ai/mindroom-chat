import React, { useCallback, useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Text } from 'folds';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../cross-room-threads/crossRoomThreadIndex';
import { archivedRoomsAtom, isRoomVisible } from '../rooms/archivedRooms';
import { buildSidebarThreadEntries } from './threadNavCategoryUtils';
import { makeThreadSidebarPreferencesAtom } from './threadSidebarPreferences';
import { ThreadNavItem } from './ThreadNavItem';
import * as css from './threadNav.css';
import { NavCategory, NavCategoryHeader } from '../../components/nav';
import { RoomNavCategoryButton } from '../../features/room-nav';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { useCategoryHandler } from '../../hooks/useCategoryHandler';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { mDirectAtom } from '../../state/mDirectList';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { makeNavCategoryId } from '../../state/closedNavCategories';
import { useClosedNavCategoriesAtom } from '../../state/hooks/closedNavCategories';

export const THREAD_NAV_CATEGORY_ID = makeNavCategoryId('mindroom', 'threads');

/** Whether `roomId` sits in `spaceId`, directly or through nested spaces. */
const isInSpace = (
  roomId: string,
  spaceId: string,
  roomToParents: ReadonlyMap<string, ReadonlySet<string>>
): boolean => {
  const seen = new Set<string>();
  const pending = [roomId];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    const parents = roomToParents.get(current);
    if (parents) {
      for (const parent of parents) {
        if (parent === spaceId) return true;
        if (!seen.has(parent)) {
          seen.add(parent);
          pending.push(parent);
        }
      }
    }
  }
  return false;
};

type ThreadNavCategoryProps = {
  /** Shows only the threads of rooms in this space, nested ones included. */
  spaceId?: string;
};

/**
 * The sidebar's THREADS category: unresolved threads across rooms by latest activity, the
 * user's pinned ones first. Direct messages and archived rooms are left out. It collapses like
 * the ROOMS category.
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

  const entries = useMemo(
    () =>
      buildSidebarThreadEntries(
        Array.from(index.entries.values()).filter(
          (entry) =>
            isRoomVisible(entry.roomId, archivedRooms) &&
            (!spaceId || isInSpace(entry.roomId, spaceId, roomToParents))
        ),
        preferences.pinnedThreadKeys,
        directRoomIds
      ),
    [
      archivedRooms,
      directRoomIds,
      index.entries,
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
