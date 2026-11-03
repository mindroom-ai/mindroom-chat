import React, { ReactNode, useMemo } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { ClosedNavCategoriesProvider } from '../../state/hooks/closedNavCategories';
import { NavToActivePathProvider } from '../../state/hooks/navToActivePath';
import { makeClosedNavCategoriesAtom } from '../../state/closedNavCategories';
import { makeNavToActivePathAtom } from '../../state/navToActivePath';
import { RECENTLY_OPENED_NAV_CATEGORY_ID } from '../../mindroom/recent-threads/recentlyOpenedCategory';

/**
 * The account's stored navigation state: which sidebar categories are
 * collapsed (Recently opened starts collapsed) and the last page of each section.
 */
export function ClientInitStorageAtom({ children }: { children: ReactNode }) {
  const userId = useMatrixClient().getSafeUserId();
  const closedNavCategoriesAtom = useMemo(
    () => makeClosedNavCategoriesAtom(userId, [RECENTLY_OPENED_NAV_CATEGORY_ID]),






      <NavToActivePathProvider value={navToActivePathAtom}>{children}</NavToActivePathProvider>
    </ClosedNavCategoriesProvider>
  );
}
