import { ReactNode, Suspense } from 'react';
import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { Outlet, useNavigate } from 'react-router-dom';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import {
  NavigationProvider,
  SectionPageRoot,
  CollapsibleSidebarNav,
  SpacePageRoot,
} from '../sidebar/Navigation';
import { CollapsiblePageNav } from '../sidebar/ResizablePageNav';
import { CreateRoomForm } from '../rooms/create/CreateRoom';
import { JoinRoomPanel } from '../rooms/join/JoinAddressPrompt';
import { Page } from '../ui/page/Page';
import { PhonePageHeader } from '../ui/page/PhonePageHeader';
import { HOME_PATH } from '../routes/paths';
import { getHomeRoomPath, withSearchParam } from '../routes/pathUtils';
import { ClientBindAtoms } from './ClientBindAtoms';
import { ClientLayout } from './ClientLayout';
import { FloatingCardsContext, useFloatingCardsLayout } from '../ui/page/floatingCards';
import { FloatingShell } from '../ui/page/floatingCards.css';
import './layout/floatingCardsLayout.css';
import { ClientShell } from './ClientShell';
import { useMarkPhoneSectionRoot } from '../navigation/phoneNavDrawer';
import { Space } from '../sidebar/space/Space';
import { PhoneTopBar } from '../sidebar/PhoneTopBar';
import { PhoneNavDrawer } from '../sidebar/PhoneNavDrawer';
import { usePluginPage } from '../plugins/PluginPageRoute';
import { MembersOverlayFollowsNavigation } from '../members/useMembersDrawer';

// The signed-in pages. Router.tsx loads this module on its own, so the sign-in pages start
// without the code of every signed-in screen; the signed-in client starts its account while
// the module loads.

export { HomeSearchPage, SpaceSearchPage } from '../search/MessageSearchPage';
export { PageMain } from '../ui/page/Page';
export { ConnectionsRoute } from '../connections/ConnectionsRoute';
export { WelcomePage } from './WelcomePage';
export { RoomRoute } from '../room/RoomRoute';
export { Home } from '../sidebar/home/Home';
export { Direct } from '../sidebar/direct/Direct';
export { DirectCreate } from '../sidebar/direct/DirectCreate';
export { SpaceRouteProvider } from '../sidebar/space/Space';
export { Lobby } from '../spaces/lobby/Lobby';
export { ThreadsNav } from '../threads/page/ThreadsNav';
export { ThreadsEmpty } from '../threads/page/ThreadsEmpty';
export { Canvases } from '../canvas/page/Canvases';
export { FeaturedRooms } from '../rooms/explore/Featured';
export { PublicRooms } from '../rooms/explore/Server';
export { Invites } from '../notifications/inbox/Invites';
export { ActivityNav } from '../activity/ActivityNav';
export { ActivityEmpty } from '../activity/ActivityEmpty';
export { ExploreNav } from '../rooms/explore/ExploreNav';
export { PluginPageRoute } from '../plugins/PluginPageRoute';

/**
 * The rail beside the page, but none beside a plugin page that fills the window. It reads the
 * address itself, so a navigation renders it again and not the frame around every page.
 */
function RailBesidePage({ rail }: { rail: ReactNode }) {
  return <>{usePluginPage()?.page.fillsWindow ? null : rail}</>;
}

/**
 * The signed-in frame around every page: account atoms, dialogs, the rail and the page. Wider
 * than a phone, the page and the side panels beside a room float as cards on the app background;
 * phones, also held sideways, stay full-bleed.
 */
export function SignedInChrome() {
  const floating = useFloatingCardsLayout();
  // Beside the page on wider screens; on phones in the drawer below the top bar.
  const nav = <CollapsibleSidebarNav />;
  return (
    <ClientBindAtoms>
      <ClientShell>
        <NavigationProvider>
          <FloatingCardsContext.Provider value={floating}>
            <MembersOverlayFollowsNavigation />
            <ClientLayout
              nav={<RailBesidePage rail={nav} />}
              phoneTopBar={<PhoneTopBar />}
              phoneNavDrawer={<PhoneNavDrawer nav={nav} />}
              className={floating ? FloatingShell : undefined}
            >
              {/* A page whose code is still loading leaves the rail and dialogs in place. */}
              <Suspense fallback={null}>
                <Outlet />
              </Suspense>
            </ClientLayout>
          </FloatingCardsContext.Provider>
        </NavigationProvider>
      </ClientShell>
    </ClientBindAtoms>
  );
}

/** A section with its navigation; `navId` names the section whose open page is remembered. */
export function SectionPage({ nav, navId }: { nav: ReactNode; navId?: string }) {
  return (
    <SectionPageRoot navId={navId} nav={<CollapsiblePageNav>{nav}</CollapsiblePageNav>}>
      <Outlet />
    </SectionPageRoot>
  );
}

/**
 * A section's own page. A phone stays at this address with the section's list out in its drawer,
 * so where wider screens redirect (a space to its lobby) a phone shows
 * `phonePage` in place, and a way back to the list lands here with the drawer out.
 */
export function SectionIndex({
  page,
  phonePage = page,
}: {
  page: ReactNode;
  phonePage?: ReactNode;
}) {
  // It is the section's own page, where a phone's drawer comes out.
  useMarkPhoneSectionRoot();
  return <>{useScreenSizeContext() === ScreenSize.Mobile ? phonePage : page}</>;
}

/** A space with its navigation; it remembers the page open in that space. */
export function SpaceSectionPage() {
  return (
    <SpacePageRoot
      nav={
        <CollapsiblePageNav>
          <Space />
        </CollapsiblePageNav>
      }
    >
      <Outlet />
    </SpacePageRoot>
  );
}

export function CreateRoomPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  return (
    <Page>
      <PhonePageHeader to={HOME_PATH} title={t('nav.createRoom')} />
      <div
        style={{
          padding: '24px',
          width: '100%',
          maxWidth: '640px',
          margin: '0 auto',
          overflowY: 'auto',
          flexGrow: 1,
          minHeight: 0,
        }}
      >
        {/* On phones the title bar names the page. */}
        {!phone && (
          <Text as="h1" size="H4" style={{ marginBottom: '16px' }}>
            {t('nav.createRoom')}
          </Text>
        )}
        <CreateRoomForm onCreate={(roomId) => navigate(getHomeRoomPath(roomId))} />
      </div>
    </Page>
  );
}

const JOIN_PAGE_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minHeight: 0,
  width: '100%',
  maxWidth: '640px',
  margin: '0 auto',
  padding: '24px',
} as const;

/** `/home/join/`: the Join a Room search and list as a page, the way `/home/create/` holds room creation. */
export function JoinAddressPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const title = t('sharedUi.joinAddressPrompt.joinARoom');
  const openRoom = (roomIdOrAlias: string, viaServers?: string[], eventId?: string) =>
    navigate(
      withSearchParam(getHomeRoomPath(roomIdOrAlias, eventId), {
        viaServers: viaServers && viaServers.length > 0 ? viaServers.join(',') : undefined,
      })
    );
  return (
    <Page>
      <PhonePageHeader to={HOME_PATH} title={title} />
      {/* A column the list scrolls in, under the title and the search field. */}
      <div style={JOIN_PAGE_STYLE}>
        {!phone && (
          <Text as="h1" size="H4" style={{ marginBottom: '16px' }}>
            {title}
          </Text>
        )}
        <JoinRoomPanel onOpen={openRoom} />
      </div>
    </Page>
  );
}
