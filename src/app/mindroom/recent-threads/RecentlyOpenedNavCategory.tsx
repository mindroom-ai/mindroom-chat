import React, { useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Text } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { NavCategory, NavCategoryHeader } from '../../components/nav';
import { RoomNavCategoryButton } from '../../features/room-nav';
import { useCategoryHandler } from '../../hooks/useCategoryHandler';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { makeNavCategoryId } from '../../state/closedNavCategories';
import { useClosedNavCategoriesAtom } from '../../state/hooks/closedNavCategories';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { makeRecentThreadsAtom, type RecentThreadItem } from './recentThreads';
import { RecentThreadEntry } from './RecentThreadEntry';
import * as css from './threadNav.css';

export const RECENTLY_OPENED_NAV_CATEGORY_ID = makeNavCategoryId('mindroom', 'recently-opened');
export const DEFAULT_RECENTLY_OPENED_THREAD_LIMIT = 10;

type VisibleRecentThreadItem = RecentThreadItem & {
  room: Room;
};

type RecentlyOpenedNavCategoryProps = {
  limit?: number;
};

export function RecentlyOpenedNavCategory({
  limit = DEFAULT_RECENTLY_OPENED_THREAD_LIMIT,
}: RecentlyOpenedNavCategoryProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const recentThreadsAtom = useMemo(() => makeRecentThreadsAtom(userId), [userId]);
  const recentThreads = useAtomValue(recentThreadsAtom);
  const allRoomIds = useAtomValue(allRoomsAtom);
  const [closedCategories, setClosedCategories] = useAtom(useClosedNavCategoriesAtom());
  const closed = closedCategories.has(RECENTLY_OPENED_NAV_CATEGORY_ID);
  const handleCategoryClick = useCategoryHandler(setClosedCategories, (categoryId) =>
    closedCategories.has(categoryId)
  );
  const visibleLimit = Number.isFinite(limit)
    ? Math.max(0, Math.floor(limit))
    : DEFAULT_RECENTLY_OPENED_THREAD_LIMIT;
  const entries = useMemo(() => {
    // allRoomsAtom makes joined-room membership changes reactive; mx.getRoom alone is not.
    void allRoomIds;
    return recentThreads.reduce<VisibleRecentThreadItem[]>((visibleEntries, recentThread) => {
      if (visibleEntries.length >= visibleLimit) return visibleEntries;

      const room = mx.getRoom(recentThread.roomId);
      if (!room || room.getMyMembership() !== 'join') return visibleEntries;

      visibleEntries.push({ ...recentThread, room });
      return visibleEntries;
    }, []);
  }, [allRoomIds, mx, recentThreads, visibleLimit]);

  return (
    <NavCategory data-testid="recently-opened-nav-category">
      <NavCategoryHeader>
        <RoomNavCategoryButton
          closed={closed}
          data-category-id={RECENTLY_OPENED_NAV_CATEGORY_ID}
          onClick={handleCategoryClick}
        >
          {t('recentThreads.title')}
        </RoomNavCategoryButton>
      </NavCategoryHeader>
      {!closed && (
        <div data-testid="recently-opened-nav-list">
          {entries.length === 0 ? (
            <Text className={css.CategoryState} as="p" size="T200">
              {t('recentThreads.empty')}
            </Text>
          ) : (
            entries.map((entry) => (
              <RecentThreadEntry
                key={`${entry.roomId}|${entry.threadId}`}
                room={entry.room}
                threadId={entry.threadId}
                openedAt={entry.openedAt}
                summaryText={entry.summaryText}
              />
            ))
          )}
        </div>
      )}
    </NavCategory>
  );
}
