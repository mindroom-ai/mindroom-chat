import { ReactNode, Suspense } from 'react';
import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { Outlet, useNavigate } from 'react-router-dom';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import {
  MindroomNavigationProvider,
  MindroomPageRoot,
  MindroomSidebarNav,
  MindroomSpacePageRoot,
} from '../../mindroom/sidebar/MindroomNavigation';
import { MindroomPageNav } from '../../mindroom/sidebar/ResizablePageNav';
import { CreateRoomForm } from '../../features/create-room/CreateRoom';
import { JoinRoomPanel } from '../../components/join-address-prompt';
import { Page } from '../../components/page';
import { PhonePageHeader } from '../../components/page/PhonePageHeader';
import { HOME_PATH } from '../paths';
import { getHomeRoomPath, withSearchParam } from '../pathUtils';
import { ClientBindAtoms } from './ClientBindAtoms';
import { ClientLayout } from './ClientLayout';
import { FloatingCardsContext, useFloatingCardsLayout } from '../../components/page/floatingCards';
import { FloatingShell } from '../../components/page/floatingCards.css';
import { ClientShell } from './ClientShell';
import { Space } from './space/Space';

// The signed-in pages. Router.tsx loads this module on its own, so the sign-in pages start
// without the code of every signed-in screen; the signed-in client starts its account while
// the module loads.

export { HomeSearchPage, SpaceSearchPage } from '../../mindroom/message-search/MessageSearchPage';
export { PageMain } from '../../components/page';
export { ConnectionsRoute } from './connections/ConnectionsRoute';
export { WelcomePage } from './WelcomePage';
export { RoomRoute } from './RoomRoute';
export { Home } from './home/Home';
export { Direct } from './direct/Direct';
export { DirectCreate } from './direct/DirectCreate';
export { SpaceRouteProvider } from './space/Space';
export { Lobby } from '../../features/lobby/Lobby';
export { Threads } from './threads';
export { Canvases } from './canvases';
export { FeaturedRooms } from './explore/Featured';
export { PublicRooms } from './explore/Server';
export { Invites } from './inbox/Invites';
export { InboxNav } from './inbox/InboxNav';
export { ExploreNav } from './explore/ExploreNav';
export { Notifications } from './inbox/Notifications';

/**
 * The signed-in frame around every page: account atoms, dialogs, the rail and the page. Wider
 * than a phone, the page and the side panels beside a room float as cards on the app background;
 * phones, also held sideways, stay full-bleed.
 */
export function SignedInChrome() {
  const floating = useFloatingCardsLayout();
  return (
    <ClientBindAtoms>
      <ClientShell>
        <MindroomNavigationProvider>
          <FloatingCardsContext.Provider value={floating}>
            <ClientLayout
              nav={<MindroomSidebarNav />}
              className={floating ? FloatingShell : undefined}
            >
              {/* A page whose code is still loading leaves the rail and dialogs in place. */}
              <Suspense fallback={null}>
                <Outlet />
              </Suspense>
            </ClientLayout>
          </FloatingCardsContext.Provider>
        </MindroomNavigationProvider>
      </ClientShell>
    </ClientBindAtoms>
  );
}

/** A section with its navigation; `navId` names the section whose open page is remembered. */
export function SectionPage({
  path,
  nav,
  navId,
}: {
  path: string;
  nav: ReactNode;
  navId?: string;
}) {
  return (
    <MindroomPageRoot navId={navId} nav={<MindroomPageNav path={path}>{nav}</MindroomPageNav>}>
      <Outlet />
    </MindroomPageRoot>
  );
}

/** A space with its navigation; it remembers the page open in that space. */
export function SpaceSectionPage({ path }: { path: string }) {
  return (
    <MindroomSpacePageRoot
      nav={
        <MindroomPageNav path={path}>
          <Space />
        </MindroomPageNav>
      }
    >
      <Outlet />
    </MindroomSpacePageRoot>
  );
}

/** A section's own page: on phones its navigation list fills the screen there instead. */
export function SectionIndex({ page }: { page: ReactNode }) {
  return useScreenSizeContext() === ScreenSize.Mobile ? null : <>{page}</>;
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
