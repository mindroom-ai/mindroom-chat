import React, { ReactNode, useRef } from 'react';
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
  ThreadsTab,
} from './sidebar';
import { CreateTab } from './sidebar/CreateTab';
import { useClientConfig } from '../../hooks/useClientConfig';
import { MindroomTab } from '../../mindroom/sidebar/MindroomTab';
import { useSimpleMode } from '../../mindroom/settings/useMindroomAccountSettings';

export function SidebarNav({ footer }: { footer?: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { sidebar } = useClientConfig();
  // Simple mode keeps the essentials: Home, Direct, existing spaces, and the
  // sticky Inbox/Settings stack below.
  const simpleMode = useSimpleMode();
  // Allow deployments to hide optional sidebar entry points.
  const showThreads = !simpleMode && (sidebar?.showThreads ?? true);
  const showExploreCommunity = !simpleMode && (sidebar?.showExploreCommunity ?? true);
  const showAddSpace = !simpleMode && (sidebar?.showAddSpace ?? true);
  const showMindRoom = !simpleMode && (sidebar?.showMindRoom ?? true);
  const showSecondStack = showExploreCommunity || showMindRoom || showAddSpace;

  return (
    <Sidebar>
      <SidebarContent
        scrollable={
          <Scroll ref={scrollRef} variant="Background" size="0">
            <SidebarStack>
              <HomeTab />
              <DirectTab />
              {showThreads && <ThreadsTab />}
            </SidebarStack>
            <SpaceTabs scrollRef={scrollRef} />
            {showSecondStack && (
              <>
                <SidebarStackSeparator />
                <SidebarStack>
                  {showExploreCommunity && <ExploreTab />}
                  {showMindRoom && <MindroomTab />}
                  {showAddSpace && <CreateTab />}
                </SidebarStack>
              </>
            )}
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
