import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Sidebar, SidebarStack, SidebarStackSeparator } from '../ui/sidebar/SidebarItem';
import { SidebarContent } from '../ui/sidebar/SidebarContent';
import { LocalMindroomTab } from './rail/LocalMindroomTab';
import { CanvasesTab } from './rail/CanvasesTab';
import { DirectTab } from './rail/DirectTab';
import { ExploreTab } from './rail/ExploreTab';
import { HomeTab } from './rail/HomeTab';
import { ActivityTab } from './rail/ActivityTab';
import { SearchTab } from '../command-palette/CommandPaletteSidebarTab';
import { SettingsTab } from './rail/SettingsTab';
import { SpaceTabs } from './rail/SpaceTabs';
import { ThreadsTab } from './rail/ThreadsTab';
import { UnverifiedTab } from '../account/switcher/UnverifiedTab';
import { CreateTab } from './rail/CreateTab';
import { RailScrollArea } from './rail/RailScrollArea';
import { useRailButtons } from '../settings/railButtons';
import { CallTab } from '../calls/CallTab';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';

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
 * in, the command palette, device and Local MindRoom notices when they apply, the Activity bell, the
 * account, and the footer. Threads, Canvases, Explore, Create Space, the command palette and
 * Local MindRoom show where the deployment offers them and the person has not hidden them in
 * Settings (`useRailButtons`). On phones the top bar holds the command palette, and the account
 * shows there too; the rail keeps its account button, as on wider screens.
 */
export function SidebarNav({ footer, onPageNavSelect }: SidebarNavProps) {
  const { t } = useTranslation();
  const shown = useRailButtons();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;

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
              {shown.search && !phone && <SearchTab />}
              <UnverifiedTab />
              {shown.localMindroom && <LocalMindroomTab />}
              <ActivityTab onSelect={onPageNavSelect} />
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
