import React, { ReactNode, useRef } from 'react';
import { Scroll } from 'folds';
import { useTranslation } from 'react-i18next';
import {
  Sidebar,
  SidebarContent,
  SidebarStack,
  SidebarStackSeparator,
} from '../../components/sidebar';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useShowCanvasesInSidebar } from '../../mindroom/settings/useMindroomAccountSettings';
import { useShowLocalMindroom } from '../../mindroom/local-mindroom/useShowLocalMindroom';
import { MindroomTab } from '../../mindroom/sidebar/MindroomTab';
import {
  CanvasesTab,
  DirectTab,
  ExploreTab,
  HomeTab,
  InboxTab,
  SearchTab,
  SettingsTab,
  SpaceTabs,
  ThreadsTab,
  UnverifiedTab,
} from './sidebar';
import { CreateTab } from './sidebar/CreateTab';
import { CallTab } from '../../features/calls/CallTab';

type SidebarNavProps = {
  /** Shown under a rule below the account controls, such as the panel collapse toggle. */
  footer?: ReactNode;
  /**
   * Called when a section button is pressed, with whether that section is
   * already shown; returning true means the click was handled (the page
   * navigation toggled) and the tab does not navigate.
   */
  onPageNavSelect?: (selected: boolean) => boolean;
};

/**
 * The icon rail. On top: Home, Direct Messages and the optional sections, then the joined spaces
 * and, where communities are on, Explore and Create Space. Pinned to the foot: the call this device
 * is in, the command palette, device and Local MindRoom notices when they apply, the Inbox, the
 * account, and the footer.
 */
export function SidebarNav({ footer, onPageNavSelect }: SidebarNavProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { sidebar, mindroom } = useClientConfig();
  const showCanvasesSetting = useShowCanvasesInSidebar();
  const showLocalMindroom = useShowLocalMindroom();

  const showThreads = sidebar?.showThreads ?? true;
  const showCanvases = !!mindroom?.canvas?.enabled && showCanvasesSetting;
  const showCommunities = sidebar?.showExploreCommunity ?? true;

  return (
    <Sidebar aria-label={t('sharedUi.a11y.mainNavigation')}>
      <SidebarContent
        scrollable={
          <Scroll ref={scrollRef} hideTrack size="0" visibility="Hover" variant="Background">
            <SidebarStack>
              <HomeTab onSelect={onPageNavSelect} />
              <DirectTab onSelect={onPageNavSelect} />
              {showThreads && <ThreadsTab onSelect={onPageNavSelect} />}
              {showCanvases && <CanvasesTab />}
            </SidebarStack>
            <SpaceTabs onSelect={onPageNavSelect} />
            {showCommunities && (
              <>
                <SidebarStackSeparator />
                <SidebarStack>
                  <ExploreTab onSelect={onPageNavSelect} />
                  <CreateTab />
                </SidebarStack>
              </>
            )}
          </Scroll>
        }
        sticky={
          <>
            <SidebarStackSeparator />
            <SidebarStack>
              <CallTab />
              <SearchTab />
              <UnverifiedTab />
              {showLocalMindroom && <MindroomTab />}
              <InboxTab />
              <SettingsTab />
            </SidebarStack>
            {footer && (
              <>
                <SidebarStackSeparator />
                <SidebarStack>{footer}</SidebarStack>
              </>
            )}
          </>
        }
      />
    </Sidebar>
  );
}
