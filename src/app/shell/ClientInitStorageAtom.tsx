import { ReactNode, useMemo } from 'react';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { ClosedNavCategoriesProvider } from '../ui/nav/useClosedNavCategories';
import { NavToActivePathProvider } from '../routes/useNavToActivePath';
import { makeClosedNavCategoriesAtom } from '../ui/nav/closedNavCategories';
import { makeNavToActivePathAtom } from '../routes/navToActivePath';
import { RECENTLY_OPENED_NAV_CATEGORY_ID } from '../sidebar/threads/recentlyOpenedCategory';
import { THREAD_NAV_CATEGORY_ID } from '../sidebar/threads/ThreadNavCategory';

/**
 * The account's stored navigation state on this device: which sidebar categories are collapsed
 * (THREADS and Recently Opened start collapsed until the person opens them) and the last page of
 * each section.
 */
export function ClientInitStorageAtom({ children }: { children: ReactNode }) {
  const userId = useMatrixClient().getSafeUserId();
  // Both atoms belong to one account, so they are rebuilt together when the account changes.
  const stored = useMemo(
    () => ({
      closedCategories: makeClosedNavCategoriesAtom(userId, [
        RECENTLY_OPENED_NAV_CATEGORY_ID,
        THREAD_NAV_CATEGORY_ID,
      ]),
      lastPaths: makeNavToActivePathAtom(userId),
    }),
    [userId]
  );

  return (
    <ClosedNavCategoriesProvider value={stored.closedCategories}>
      <NavToActivePathProvider value={stored.lastPaths}>{children}</NavToActivePathProvider>
    </ClosedNavCategoriesProvider>
  );
}
