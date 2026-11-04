import React, { type ComponentType, lazy, useState } from 'react';
import {
  Navigate,
  Route,
  createBrowserRouter,
  createHashRouter,
  createRoutesFromElements,
} from 'react-router-dom';
import type { ClientConfig } from '../hooks/useClientConfig';
import type { ScreenSize } from '../hooks/useScreenSize';
import { ConnectPage } from '../mindroom/local-mindroom/ConnectPage';
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
import { getAppBasePath } from '../utils/basePath';
import { AuthLayout } from './auth/AuthLayout';
import { Login } from './auth/login/Login';
import { Register } from './auth/register/Register';
import { ResetPassword } from './auth/reset-password/ResetPassword';
import { ClientRoot } from './client/ClientRoot';

// The signed-in pages load as their own chunks, so the sign-in pages start without them.
// ProtectedRoutes asks for them as soon as a signed-in route renders: they load while ClientRoot
// starts the account, which takes longer, so its splash never waits for them.
type ClientPages = typeof import('./client/clientPages');
type RoomModule = typeof import('../mindroom/threads/MindroomRoom');
let clientPages: ClientPages | undefined;
let roomModule: RoomModule | undefined;
const loadClientPages = () =>
  import('./client/clientPages').then((pages) => {
    clientPages = pages;
    return pages;
  });
const loadRoom = () =>
  import('../mindroom/threads/MindroomRoom').then((room) => {
    roomModule = room;
    return room;
  });

const preloadSignedInPages = (): void => {
  loadClientPages().catch(() => undefined);
  loadRoom().catch(() => undefined);
};

/**
 * A component from a lazily loaded module. Once the module is in, it renders directly: a
 * React.lazy component suspends on its first render even then, and the nested pages would each
 * suspend in turn, leaving the page empty for a few renders.
 */
const fromModule = <M, P extends object>(
  loaded: () => M | undefined,
  load: () => Promise<M>,
  pick: (module: M) => ComponentType<P>
): ComponentType<P> => {
  // React.lazy's exotic component renders like the component it loads.
  const Lazy = lazy(async () => ({ default: pick(await load()) })) as unknown as ComponentType<P>;
  function LazyPage(props: P) {
    const [Component] = useState(() => {
      const module = loaded();
      return module ? pick(module) : Lazy;
    });
    return <Component {...props} />;
  }
  return LazyPage;
};

const fromPages = <P extends object>(pick: (pages: ClientPages) => ComponentType<P>) =>
  fromModule(() => clientPages, loadClientPages, pick);

const SignedInChrome = fromPages((pages) => pages.SignedInChrome);
const SectionPage = fromPages((pages) => pages.SectionPage);
const SpaceSectionPage = fromPages((pages) => pages.SpaceSectionPage);
const SectionIndex = fromPages((pages) => pages.SectionIndex);
const CreateRoomPage = fromPages((pages) => pages.CreateRoomPage);
const JoinAddressPage = fromPages((pages) => pages.JoinAddressPage);
const PageMain = fromPages((pages) => pages.PageMain);
const ConnectionsRoute = fromPages((pages) => pages.ConnectionsRoute);
const HomeSearchPage = fromPages((pages) => pages.HomeSearchPage);
const SpaceSearchPage = fromPages((pages) => pages.SpaceSearchPage);
const WelcomePage = fromPages((pages) => pages.WelcomePage);
const RoomRoute = fromPages((pages) => pages.RoomRoute);
const Home = fromPages((pages) => pages.Home);
const Direct = fromPages((pages) => pages.Direct);
const DirectCreate = fromPages((pages) => pages.DirectCreate);
const SpaceRouteProvider = fromPages((pages) => pages.SpaceRouteProvider);
const Lobby = fromPages((pages) => pages.Lobby);
const Threads = fromPages((pages) => pages.Threads);
const Canvases = fromPages((pages) => pages.Canvases);
const FeaturedRooms = fromPages((pages) => pages.FeaturedRooms);
const PublicRooms = fromPages((pages) => pages.PublicRooms);
const Invites = fromPages((pages) => pages.Invites);
const InboxNav = fromPages((pages) => pages.InboxNav);
const ExploreNav = fromPages((pages) => pages.ExploreNav);
const Notifications = fromPages((pages) => pages.Notifications);
const Room = fromModule(
  () => roomModule,
  loadRoom,
  (room) => room.Room
);

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
  preloadSignedInPages();
  return (
    <ClientRoot>
      <SignedInChrome />
    </ClientRoot>
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
