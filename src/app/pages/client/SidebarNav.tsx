import React, { useRef } from 'react';
import { Scroll } from 'folds';

import {
  Sidebar,
  SidebarContent,
  SidebarStackSeparator,
  SidebarStack,
} from '../../components/sidebar';
import {
  DirectTab,
  HomeTab,
  SpaceTabs,
  InboxTab,
  ExploreTab,
  SettingsTab,
  UnverifiedTab,
  SearchTab,
} from './sidebar';
import { CreateTab } from './sidebar/CreateTab';
import { useClientConfig } from '../../hooks/useClientConfig';
import { MindroomTab } from '../../mindroom/sidebar/MindroomTab';

export function SidebarNav() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { sidebar } = useClientConfig();
  // Allow deployments to hide optional sidebar entry points.
  const showExploreCommunity = sidebar?.showExploreCommunity ?? true;
  const showAddSpace = sidebar?.showAddSpace ?? true;
  const showMindRoom = sidebar?.showMindRoom ?? true;

  return (
    <Sidebar>
      <SidebarContent
        scrollable={
          <Scroll ref={scrollRef} variant="Background" size="0">
            <SidebarStack>
              <HomeTab />
              <DirectTab />
            </SidebarStack>
            <SpaceTabs scrollRef={scrollRef} />
            <SidebarStackSeparator />
            <SidebarStack>
              {showExploreCommunity && <ExploreTab />}
              {showMindRoom && <MindroomTab />}
              {showAddSpace && <CreateTab />}
            </SidebarStack>
          </Scroll>
        }
        sticky={
          <>
            <SidebarStackSeparator />
            <SidebarStack>
              <SearchTab />
              <UnverifiedTab />
              <InboxTab />
              <SettingsTab />
            </SidebarStack>
          </>
        }
      />
    </Sidebar>
  );
}
