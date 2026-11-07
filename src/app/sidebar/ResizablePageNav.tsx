import React, { ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import { MobileFriendlyPageNav } from './MobileFriendly';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useDesktopPageNav } from './desktopPageNavState';
import { ResizablePanel } from '../ui/panels/ResizablePanel';
import { pageNavNoticeSlotAtom } from './pageNavNoticeSlot';
import * as css from './ResizablePageNav.css';

/** Offers the list's notice place while it is shown, and takes it back when it goes. */
function NoticeSlot() {
  const setSlot = useSetAtom(pageNavNoticeSlotAtom);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!element) return undefined;
    setSlot(element);
    return () => setSlot((current) => (current === element ? null : current));
  }, [element, setSlot]);
  // A live region of its own, so the notice is announced when it appears here.
  return <div ref={setElement} className={css.NoticeSlot} aria-live="polite" />;
}

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
      overlay={mobile ? undefined : <NoticeSlot />}
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
