import React, { ReactNode, useEffect, useRef } from 'react';
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
import { ScreenSize } from '../hooks/useScreenSize';
import {
  MindroomNavigationProvider,
  MindroomPageRoot,
  MindroomSidebarNav,
} from '../mindroom/sidebar/MindroomNavigation';
import { MindroomPageNav } from '../mindroom/sidebar/ResizablePageNav';
import { MindroomMessageSearch } from '../mindroom/message-search/MindroomMessageSearch';
import { ConnectPage } from '../mindroom/local-mindroom/ConnectPage';
import { ConnectionsPage } from '../mindroom/connections/ConnectionsPage';
import { CreateRoomForm } from '../features/create-room/CreateRoom';
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
import { getHomeRoomPath } from './pathUtils';
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
import { useHomeSearchRooms } from './client/home/useHomeRooms';
import { Direct } from './client/direct/Direct';
import { DirectCreate } from './client/direct/DirectCreate';
import { Space, SpaceRouteProvider } from './client/space/Space';
import { useSpaceSearchRooms } from './client/space/useSpaceSearchRooms';
import { Lobby } from '../features/lobby/Lobby';
import { useSpace } from '../hooks/useSpace';
import { useRoomName } from '../hooks/useRoomMeta';
import { Threads } from './client/threads';
import { Canvases } from './client/canvases';
import { FeaturedRooms } from './client/explore/Featured';
import { PublicRooms } from './client/explore/Server';
import { Invites } from './client/inbox/Invites';

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

function SectionPage({ path, nav }: { path: string; nav: ReactNode }) {
  return (
    <MindroomPageRoot nav={<MindroomPageNav path={path}>{nav}</MindroomPageNav>}>
      <Outlet />
    </MindroomPageRoot>
  );
}

function CreateRoomPage() {
  const navigate = useNavigate();
  return (
    <div
      style={{
        padding: '24px',
        width: '100%',
        maxWidth: '640px',
        margin: '0 auto',
        overflowY: 'auto',
      }}
    >
      <CreateRoomForm onCreate={(roomId) => navigate(getHomeRoomPath(roomId))} />
    </div>
  );
}

function HomeSearchPage() {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const defaultRooms = useHomeSearchRooms();
  return (
    <div ref={scrollRef} style={{ flexGrow: 1, minWidth: 0, overflowY: 'auto' }}>
      <MindroomMessageSearch
        defaultRooms={defaultRooms}
        scopeName={t('nav.home')}
        allowGlobal
        scrollRef={scrollRef}
      />
    </div>
  );
}

function SpaceSearchPage() {
  const space = useSpace();
  const scrollRef = useRef<HTMLDivElement>(null);
  const defaultRooms = useSpaceSearchRooms(space.roomId);
  const name = useRoomName(space);
  return (
    <div ref={scrollRef} style={{ flexGrow: 1, minWidth: 0, overflowY: 'auto' }}>
      <MindroomMessageSearch defaultRooms={defaultRooms} scopeName={name} scrollRef={scrollRef} />
    </div>
  );
}

function JoinRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(HOME_PATH, { replace: true });
  }, [navigate]);
  return null;
}

export const createRouter = (clientConfig: ClientConfig, _screenSize: ScreenSize) => {
  const { hashRouter } = clientConfig;
  const routes = createRoutesFromElements(
    <Route>
      <Route path={ROOT_PATH} element={<RootRedirect />} />






      <Route path={CONNECTIONS_PATH} element={<ConnectionsPage />} />
      <Route element={<ProtectedRoutes hashRouter={hashRouter} />}>
        <Route path={HOME_PATH} element={<SectionPage path={HOME_PATH} nav={<Home />} />}>
          <Route index element={<WelcomePage />} />
          <Route path={HOME_CREATE_PATH} element={<CreateRoomPage />} />
          <Route path={HOME_JOIN_PATH} element={<JoinRedirect />} />
          <Route path={HOME_SEARCH_PATH} element={<HomeSearchPage />} />
          <Route path={HOME_ROOM_PATH} element={<RoomPage />} />
        </Route>
        <Route path={DIRECT_PATH} element={<SectionPage path={DIRECT_PATH} nav={<Direct />} />}>
          <Route index element={<WelcomePage />} />
          <Route path={DIRECT_CREATE_PATH} element={<DirectCreate />} />
          <Route path={DIRECT_ROOM_PATH} element={<RoomPage />} />
        </Route>
        <Route path={THREADS_PATH} element={<Threads />} />
        <Route path={CANVASES_PATH} element={<Canvases />} />
        <Route path={EXPLORE_PATH} element={<Outlet />}>
          <Route index element={<FeaturedRooms />} />
          <Route path={EXPLORE_FEATURED_PATH} element={<FeaturedRooms />} />
          <Route path={EXPLORE_SERVER_PATH} element={<PublicRooms />} />
        </Route>
        <Route path={INBOX_PATH} element={<Outlet />}>
          <Route index element={<Invites />} />
          <Route path={INBOX_INVITES_PATH} element={<Invites />} />
        </Route>
        <Route
          path={SPACE_PATH}
          element={
            <SpaceRouteProvider>
              <SectionPage path={SPACE_PATH} nav={<Space />} />
            </SpaceRouteProvider>
          }
        >
          <Route index element={<Lobby />} />
          <Route path={SPACE_LOBBY_PATH} element={<Lobby />} />
          <Route path={SPACE_SEARCH_PATH} element={<SpaceSearchPage />} />
          <Route path={SPACE_ROOM_PATH} element={<RoomPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={ROOT_PATH} replace />} />
    </Route>
  );






};
