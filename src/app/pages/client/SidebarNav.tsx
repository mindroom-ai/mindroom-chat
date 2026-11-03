import React, { ReactNode, useRef } from 'react';
import { Scroll } from 'folds';
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

type SidebarNavProps = {
  /** Shown below the account controls, such as the panel collapse toggle. */
  footer?: ReactNode;
  /**
   * Called when a section button is pressed, with whether that section is
   * already shown; returning true means the click was handled (the page
   * navigation toggled) and the tab does not navigate.
   */
  onPageNavSelect?: (selected: boolean) => boolean;
};

/** The icon rail: sections and spaces on top, search, inbox and the account at the foot. */
export function SidebarNav({ footer, onPageNavSelect }: SidebarNavProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { sidebar, mindroom } = useClientConfig();
  const showCanvasesSetting = useShowCanvasesInSidebar();
  const showLocalMindroom = useShowLocalMindroom();

  const showThreads = sidebar?.showThreads ?? true;
  const showCanvases = !!mindroom?.canvas?.enabled && showCanvasesSetting;
  const showExplore = sidebar?.showExploreCommunity ?? true;

  return (
    <Sidebar>
      <SidebarContent
        scrollable={
          <Scroll ref={scrollRef} hideTrack size="0" visibility="Hover" variant="Background">
            <SidebarStack>
              <HomeTab onSelect={onPageNavSelect} />
              <DirectTab onSelect={onPageNavSelect} />
              {showThreads && <ThreadsTab />}
              {showCanvases && <CanvasesTab />}
            </SidebarStack>
            <SpaceTabs />
            <SidebarStackSeparator />
            <SidebarStack>
              <CreateTab />
            </SidebarStack>
          </Scroll>
        }
        sticky={
          <>
            <SidebarStackSeparator />
            <SidebarStack>
              {showExplore && <ExploreTab onSelect={onPageNavSelect} />}
              <SearchTab />
              <InboxTab />
              {showLocalMindroom && <MindroomTab />}
              <UnverifiedTab />
              <SettingsTab />
            </SidebarStack>
            {footer}
          </>
        }
      />
    </Sidebar>
  );
}
