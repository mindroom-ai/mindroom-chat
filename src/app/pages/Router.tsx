import React, { ReactNode } from 'react';
import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import {
  Navigate,
  Outlet,
  Route,
  createBrowserRouter,
  createHashRouter,
  createRoutesFromElements,
  useNavigate,
} from 'react-router-dom';
import type { ClientConfig } from '../hooks/useClientConfig';
import { ScreenSize, useScreenSizeContext } from '../hooks/useScreenSize';
import {
  MindroomNavigationProvider,
  MindroomPageRoot,
  MindroomSidebarNav,
  MindroomSpacePageRoot,
} from '../mindroom/sidebar/MindroomNavigation';
import { MindroomPageNav } from '../mindroom/sidebar/ResizablePageNav';
import { HomeSearchPage, SpaceSearchPage } from '../mindroom/message-search/MessageSearchPage';
import { ConnectPage } from '../mindroom/local-mindroom/ConnectPage';
import { ConnectionsRoute } from './client/connections/ConnectionsRoute';
import { CreateRoomForm } from '../features/create-room/CreateRoom';
import { JoinAddressForm } from '../components/join-address-prompt';
import { Page, PageMain } from '../components/page';
import { PhonePageHeader } from '../components/page/PhonePageHeader';
import { setAfterLoginRedirectPath } from './afterLoginRedirectPath';
import { resolveProtectedRouteRedirect, resolveRootRouteRedirect } from './routeSessionGuards';
import {
  CANVASES_PATH,
  CONNECTIONS_PATH,
  CONNECT_PATH,
  DIRECT_CREATE_PATH,
  DIRECT_PATH,
  DIRECT_ROOM_PATH,
  EXPLORE_FEATURED_PATH,
  EXPLORE_PATH,
  EXPLORE_SERVER_PATH,
  HOME_CREATE_PATH,
  HOME_JOIN_PATH,
  HOME_PATH,
  HOME_ROOM_PATH,
  HOME_SEARCH_PATH,
  INBOX_INVITES_PATH,
  INBOX_NOTIFICATIONS_PATH,
  INBOX_PATH,
  LOGIN_PATH,
  REGISTER_PATH,
  RESET_PASSWORD_PATH,
  ROOT_PATH,
  SPACE_LOBBY_PATH,
  SPACE_PATH,
  SPACE_ROOM_PATH,
  SPACE_SEARCH_PATH,
  THREADS_PATH,
} from './paths';
import { getHomeRoomPath, withSearchParam } from './pathUtils';
import { getAppBasePath } from '../utils/basePath';
import { AuthLayout } from './auth/AuthLayout';
import { Login } from './auth/login/Login';
import { Register } from './auth/register/Register';
import { ResetPassword } from './auth/reset-password/ResetPassword';
import { ClientRoot } from './client/ClientRoot';
import { ClientBindAtoms } from './client/ClientBindAtoms';
import { ClientLayout } from './client/ClientLayout';
import { ClientShell } from './client/ClientShell';
import { WelcomePage } from './client/WelcomePage';
import { RoomRoute } from './client/RoomRoute';
import { Room } from '../mindroom/threads/MindroomRoom';
import { Home } from './client/home/Home';
import { Direct } from './client/direct/Direct';
import { DirectCreate } from './client/direct/DirectCreate';
import { Space, SpaceRouteProvider } from './client/space/Space';
import { Lobby } from '../features/lobby/Lobby';
import { Threads } from './client/threads';
import { Canvases } from './client/canvases';
import { FeaturedRooms } from './client/explore/Featured';
import { PublicRooms } from './client/explore/Server';
import { Invites } from './client/inbox/Invites';
import { InboxNav } from './client/inbox/InboxNav';
import { ExploreNav } from './client/explore/ExploreNav';
import { Notifications } from './client/inbox/Notifications';

const currentHref = (): string => (typeof window !== 'undefined' ? window.location.href : '');

/** A room address: the MindRoom room view once joined, else its summary. */
function RoomPage() {
  return (
    <RoomRoute>
      <Room />
    </RoomRoute>
  );
}

/** `/`: the last route of the active account, or login. */
function RootRedirect() {
  const decision = resolveRootRouteRedirect(currentHref());
  if (decision.afterLoginPath) setAfterLoginRedirectPath(decision.afterLoginPath);
  return <Navigate to={decision.redirectTo} replace />;
}

/** Signed-in routes send signed-out visitors to login and remember where they were going. */
function ProtectedRoutes({ hashRouter }: { hashRouter: ClientConfig['hashRouter'] }) {
  const decision = resolveProtectedRouteRedirect(currentHref(), hashRouter);
  if (decision) {
    if (decision.afterLoginPath) setAfterLoginRedirectPath(decision.afterLoginPath);
    return <Navigate to={decision.redirectTo} replace />;
  }
  return (
    <ClientRoot>
      <ClientBindAtoms>
        <ClientShell>
          <MindroomNavigationProvider>
            <ClientLayout nav={<MindroomSidebarNav />}>
              <Outlet />
            </ClientLayout>
          </MindroomNavigationProvider>
        </ClientShell>
      </ClientBindAtoms>
    </ClientRoot>
  );
}

/** A section with its navigation; `navId` names the section whose open page is remembered. */
function SectionPage({ path, nav, navId }: { path: string; nav: ReactNode; navId?: string }) {
  return (
    <MindroomPageRoot navId={navId} nav={<MindroomPageNav path={path}>{nav}</MindroomPageNav>}>
      <Outlet />
    </MindroomPageRoot>
  );
}

/** A space with its navigation; it remembers the page open in that space. */
function SpaceSectionPage({ path }: { path: string }) {
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
function SectionIndex({ page }: { page: ReactNode }) {
  return useScreenSizeContext() === ScreenSize.Mobile ? null : <>{page}</>;
}

function CreateRoomPage() {
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

/** `/home/join/`: the join-by-address form as a page, the way `/home/create/` holds room creation. */
function JoinAddressPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const title = t('sharedUi.joinAddressPrompt.joinWithAddress');
  const openRoom = (roomIdOrAlias: string, viaServers?: string[], eventId?: string) =>
    navigate(
      withSearchParam(getHomeRoomPath(roomIdOrAlias, eventId), {
        viaServers: viaServers && viaServers.length > 0 ? viaServers.join(',') : undefined,
      })
    );
  return (
    <Page>
      <PhonePageHeader to={HOME_PATH} title={title} />
      <div style={{ padding: '24px', width: '100%', maxWidth: '640px', margin: '0 auto' }}>
        {!phone && (
          <Text as="h1" size="H4" style={{ marginBottom: '16px' }}>
            {title}
          </Text>
        )}
        <JoinAddressForm onOpen={openRoom} style={{}} />
      </div>
    </Page>
  );
}

export const createRouter = (clientConfig: ClientConfig, _screenSize: ScreenSize) => {
  const { hashRouter } = clientConfig;
  const routes = createRoutesFromElements(
    <Route>
      <Route path={ROOT_PATH} element={<RootRedirect />} />
      <Route path={CONNECT_PATH} element={<ConnectPage />} />
      <Route element={<AuthLayout />}>
        <Route path={LOGIN_PATH} Component={Login} />
        <Route path={REGISTER_PATH} Component={Register} />
        <Route path={RESET_PASSWORD_PATH} Component={ResetPassword} />
      </Route>
      <Route element={<ProtectedRoutes hashRouter={hashRouter} />}>
        {/* The portal hand-off asks the signed-in client for an OpenID token. */}
        <Route
          path={CONNECTIONS_PATH}
          element={
            <PageMain>
              <ConnectionsRoute />
            </PageMain>
          }
        />
        <Route
          path={HOME_PATH}
          element={<SectionPage path={HOME_PATH} navId="home" nav={<Home />} />}
        >
          <Route index element={<SectionIndex page={<WelcomePage />} />} />
          <Route path={HOME_CREATE_PATH} element={<CreateRoomPage />} />
          <Route path={HOME_JOIN_PATH} element={<JoinAddressPage />} />
          <Route path={HOME_SEARCH_PATH} element={<HomeSearchPage />} />
          <Route path={HOME_ROOM_PATH} element={<RoomPage />} />
        </Route>
        <Route
          path={DIRECT_PATH}
          element={<SectionPage path={DIRECT_PATH} navId="direct" nav={<Direct />} />}
        >
          <Route index element={<SectionIndex page={<WelcomePage />} />} />
          <Route path={DIRECT_CREATE_PATH} element={<DirectCreate />} />
          <Route path={DIRECT_ROOM_PATH} element={<RoomPage />} />
        </Route>
        <Route
          path={THREADS_PATH}
          element={
            <PageMain>
              <Threads />
            </PageMain>
          }
        />
        <Route
          path={CANVASES_PATH}
          element={
            <PageMain>
              <Canvases />
            </PageMain>
          }
        />
        <Route
          path={EXPLORE_PATH}
          element={<SectionPage path={EXPLORE_PATH} nav={<ExploreNav />} />}
        >
          <Route index element={<SectionIndex page={<FeaturedRooms />} />} />
          <Route path={EXPLORE_FEATURED_PATH} element={<FeaturedRooms />} />
          <Route path={EXPLORE_SERVER_PATH} element={<PublicRooms />} />
        </Route>
        <Route path={INBOX_PATH} element={<SectionPage path={INBOX_PATH} nav={<InboxNav />} />}>
          <Route index element={<SectionIndex page={<Invites />} />} />
          <Route path={INBOX_NOTIFICATIONS_PATH} element={<Notifications />} />
          <Route path={INBOX_INVITES_PATH} element={<Invites />} />
        </Route>
        <Route
          path={SPACE_PATH}
          element={
            <SpaceRouteProvider>
              <SpaceSectionPage path={SPACE_PATH} />
            </SpaceRouteProvider>
          }
        >
          {/* A space opens on its lobby, which phones leave for the space's room list. */}
          <Route index element={<SectionIndex page={<Navigate to="lobby" replace />} />} />
          <Route path={SPACE_LOBBY_PATH} element={<Lobby />} />
          <Route path={SPACE_SEARCH_PATH} element={<SpaceSearchPage />} />
          <Route path={SPACE_ROOM_PATH} element={<RoomPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={ROOT_PATH} replace />} />
    </Route>
  );

  // The hash router keeps routes after `#`, for hosts that cannot send every path to index.html;
  // the browser router lives under the deployment base path.
  const hashMode = hashRouter?.enabled === true;
  const makeRouter = hashMode ? createHashRouter : createBrowserRouter;
  return makeRouter(routes, { basename: hashMode ? hashRouter?.basename : getAppBasePath() });
};
