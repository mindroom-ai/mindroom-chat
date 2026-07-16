import React, { useMemo } from 'react';
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
import { crossRoomThreadIndexAtom } from '../cross-room-threads/crossRoomThreadIndex';
import { buildSidebarThreadEntries } from './threadNavCategoryUtils';
import { ThreadNavItem } from './ThreadNavItem';
import { makeThreadSidebarPreferencesAtom } from './threadSidebarPreferences';
import * as css from './threadNav.css';

export const THREAD_NAV_CATEGORY_ID = makeNavCategoryId('mindroom', 'threads');

export function ThreadNavCategory() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const selectedRoomId = useSelectedRoom();
  const [searchParams] = useSearchParams();
  const selectedThreadId = searchParams.get('threadId');
  const indexSnapshot = useAtomValue(crossRoomThreadIndexAtom);
  const directRoomIds = useAtomValue(mDirectAtom);
  const [closedCategories, setClosedCategories] = useAtom(useClosedNavCategoriesAtom());
  const preferencesAtom = useMemo(() => makeThreadSidebarPreferencesAtom(userId), [userId]);
  const [preferences, setPreferences] = useAtom(preferencesAtom);
  const entries = useMemo(
    () =>
      buildSidebarThreadEntries(
        indexSnapshot.entries.values(),
        preferences.pinnedThreadKeys,
        directRoomIds
      ),
    [directRoomIds, indexSnapshot.entries, preferences.pinnedThreadKeys]
  );
  const closed = closedCategories.has(THREAD_NAV_CATEGORY_ID);
  const handleCategoryClick = useCategoryHandler(setClosedCategories, (categoryId) =>
    closedCategories.has(categoryId)
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
          {!indexSnapshot.bootstrapped ? (
            <Text className={css.CategoryState} as="p" size="T200">
              {t('threadNav.loading')}
            </Text>
          ) : entries.length === 0 ? (
            <Text className={css.CategoryState} as="p" size="T200">
              {t('threadNav.empty')}
            </Text>
          ) : (
            entries.map((entry) => (
              <ThreadNavItem
                key={entry.key}
                entry={entry}
                pinned={preferences.pinnedThreadKeys.includes(entry.key)}
                selected={
                  selectedRoomId === entry.roomId && selectedThreadId === entry.threadRootId
                }
                onTogglePin={() => setPreferences({ type: 'TOGGLE_PIN', threadKey: entry.key })}
              />
            ))
          )}
        </div>
      )}
    </NavCategory>
  );
}
