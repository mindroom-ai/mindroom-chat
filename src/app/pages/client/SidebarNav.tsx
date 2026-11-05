import { ReactNode, useRef } from 'react';
import { Scroll } from 'folds';
import { useTranslation } from 'react-i18next';
import {
  Sidebar,
  SidebarContent,
  SidebarStack,
  SidebarStackSeparator,
} from '../../components/sidebar';
import { SidebarScroll } from '../../components/sidebar/SidebarItem.css';
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
import { useRailButtons } from './sidebar/railButtons';
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
 * The icon rail. On top: Home, Direct Messages, Threads and Canvases, then the joined spaces,
 * Explore and Create Space. Pinned to the foot: the call this device is in, the command palette,
 * device and Local MindRoom notices when they apply, the Inbox, the account, and the footer.
 * Threads, Canvases, Explore, Create Space, the command palette and Local MindRoom show where the
 * deployment offers them and the person has not hidden them in Settings (`useRailButtons`).
 */
export function SidebarNav({ footer, onPageNavSelect }: SidebarNavProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const shown = useRailButtons();

  return (
    <Sidebar aria-label={t('sharedUi.a11y.mainNavigation')}>
      <SidebarContent
        scrollable={
          <Scroll
            ref={scrollRef}
            className={SidebarScroll}
            hideTrack
            size="0"
            visibility="Hover"
            variant="Background"
          >
            <SidebarStack>
              <HomeTab onSelect={onPageNavSelect} />
              <DirectTab onSelect={onPageNavSelect} />
              {shown.threads && <ThreadsTab onSelect={onPageNavSelect} />}
              {shown.canvases && <CanvasesTab />}
            </SidebarStack>
            <SpaceTabs onSelect={onPageNavSelect} />
            {(shown.explore || shown.createSpace) && (
              <>
                <SidebarStackSeparator />
                <SidebarStack>
                  {shown.explore && <ExploreTab onSelect={onPageNavSelect} />}
                  {shown.createSpace && <CreateTab />}
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
              {shown.search && <SearchTab />}
              <UnverifiedTab />
              {shown.localMindroom && <MindroomTab />}
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
