import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MobileFriendlyPageNav } from './MobileFriendly';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useMindroomDesktopPageNav } from './desktopPageNavState';
import { ResizablePanel } from '../ui/panels/ResizablePanel';

export function ResizablePageNav({
  children,
  onCollapse,
}: {
  children: ReactNode;
  onCollapse?: () => void;
}) {
  const { t } = useTranslation();
  const userId = useMatrixClient().getSafeUserId();
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  return (
    <ResizablePanel
      storageKey={`mindroom.pageNav.width:${userId}`}
      fullWidth={mobile}
      resizeLabel={t('mindroomUi.sidebar.resizeNavigationPanel')}
      collapseLabel={t('sharedUi.mindroomNavigation.collapseNavigationPanel')}
      onCollapse={onCollapse}
      testId="resizable-page-nav"
    >
      {children}
    </ResizablePanel>
  );
}

export function MindroomPageNav({ path, children }: { path: string; children: ReactNode }) {
  const { canCollapse, setCollapsed } = useMindroomDesktopPageNav();
  return (
    <MobileFriendlyPageNav path={path}>
      <ResizablePageNav onCollapse={canCollapse ? () => setCollapsed(true) : undefined}>
        {children}
      </ResizablePageNav>
    </MobileFriendlyPageNav>
  );
}
