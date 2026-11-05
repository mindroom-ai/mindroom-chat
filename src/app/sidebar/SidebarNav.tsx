import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sidebar,
  SidebarContent,
  SidebarStack,
  SidebarStackSeparator,
} from '../ui/sidebar';
import { MindroomTab } from './rail/LocalMindroomTab';
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
} from './rail';
import { CreateTab } from './rail/CreateTab';
import { RailScrollArea } from './rail/RailScrollArea';
import { useRailButtons } from '../settings/railButtons';
import { CallTab } from '../calls/CallTab';

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
 * Explore and Create Space; while the window leaves room for enough spaces, the top group stays
 * put and only the spaces scroll (`RailScrollArea`). Pinned to the foot: the call this device is
 * in, the command palette, device and Local MindRoom notices when they apply, the Inbox, the
 * account, and the footer. Threads, Canvases, Explore, Create Space, the command palette and
 * Local MindRoom show where the deployment offers them and the person has not hidden them in
 * Settings (`useRailButtons`).
 */
export function SidebarNav({ footer, onPageNavSelect }: SidebarNavProps) {
  const { t } = useTranslation();
  const shown = useRailButtons();

  return (
    <Sidebar aria-label={t('sharedUi.a11y.mainNavigation')}>
      <SidebarContent
        scrollable={
          <RailScrollArea
            top={
              <SidebarStack>
                <HomeTab onSelect={onPageNavSelect} />
                <DirectTab onSelect={onPageNavSelect} />
                {shown.threads && <ThreadsTab onSelect={onPageNavSelect} />}
                {shown.canvases && <CanvasesTab />}
              </SidebarStack>
            }
          >
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
          </RailScrollArea>
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
