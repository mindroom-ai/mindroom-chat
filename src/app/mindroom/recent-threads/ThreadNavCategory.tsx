import React, { useCallback, useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Text } from 'folds';
import { NavCategory, NavCategoryHeader } from '../../components/nav';
import { RoomNavCategoryButton } from '../../features/room-nav';
import { useCategoryHandler } from '../../hooks/useCategoryHandler';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { makeNavCategoryId } from '../../state/closedNavCategories';
import { useClosedNavCategoriesAtom } from '../../state/hooks/closedNavCategories';
import { mDirectAtom } from '../../state/mDirectList';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { archivedRoomsAtom, isRoomVisible } from '../rooms/archivedRooms';
import { crossRoomThreadIndexAtom } from '../cross-room-threads/crossRoomThreadIndex';
import { buildSidebarThreadEntries } from './threadNavCategoryUtils';
import { makeThreadSidebarPreferencesAtom } from './threadSidebarPreferences';
import { ThreadNavItem } from './ThreadNavItem';
import * as css from './threadNav.css';

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

  return (
    <NavCategory data-testid="thread-nav-category">
      <NavCategoryHeader>
        <RoomNavCategoryButton
          closed={closed}
          data-category-id={THREAD_NAV_CATEGORY_ID}
          onClick={handleCategoryClick}
        >
          {t('threadNav.title')}
        </RoomNavCategoryButton>
      </NavCategoryHeader>
      {!closed && (
        <div data-testid="thread-nav-list">
          {entries.length === 0 ? (
            <Text as="p" size="T200" priority="300" className={css.CategoryState}>
              {t('threadNav.empty')}
            </Text>
          ) : (
            entries.map((entry) => (
              <ThreadNavItem
                key={entry.key}
                entry={entry}
                pinned={pinned.has(entry.key)}
                selected={
                  entry.roomId === selectedRoomId && entry.threadRootId === selectedThreadId
                }
                onTogglePin={() => togglePin(entry.key)}
              />
            ))
          )}
        </div>
      )}
    </NavCategory>
  );
}
