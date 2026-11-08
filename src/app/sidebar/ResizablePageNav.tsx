import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MobileFriendlyPageNav } from './MobileFriendly';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useDesktopPageNav } from './desktopPageNavState';
import { ResizablePanel } from '../ui/panels/ResizablePanel';
import { NoticeSlot } from '../ui/noticeSlots';

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
      overlay={mobile ? undefined : <NoticeSlot place="list" />}
    >
      {children}
    </ResizablePanel>
  );
}

export function CollapsiblePageNav({ children }: { children: ReactNode }) {
  const { canCollapse, setCollapsed } = useDesktopPageNav();
  return (
    <MobileFriendlyPageNav>
      <ResizablePageNav onCollapse={canCollapse ? () => setCollapsed(true) : undefined}>
        {children}
      </ResizablePageNav>
    </MobileFriendlyPageNav>
  );
}
