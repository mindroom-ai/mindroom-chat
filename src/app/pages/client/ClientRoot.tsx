import {
  Box,
  Button,
  config,
  Dialog,
  Icon,
  IconButton,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Spinner,
  Text,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import React, { MouseEventHandler, ReactNode, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { HttpApiEvent } from 'matrix-js-sdk/lib/http-api/interface';
import type { HttpApiEventHandlerMap } from 'matrix-js-sdk/lib/http-api/interface';
import {
  ClientBootstrapSession,
  clearAllCacheAndReload,
  clearLoginData,
  initClient,
  logoutClient,
  removeCurrentClientSessionAndReload,
  removeSessionAndReload,
  startClient,
} from '../../../client/initMatrix';
import { MindRoomSplashScreen, SplashScreen } from '../../components/splash-screen';
import { ServerConfigsLoader } from '../../components/ServerConfigsLoader';
import { CapabilitiesProvider } from '../../hooks/useCapabilities';
import { MediaConfigProvider } from '../../hooks/useMediaConfig';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { SpecVersions } from './SpecVersions';
import { stopPropagation } from '../../utils/keyboard';
import { SyncStatus } from './SyncStatus';
import { AuthMetadataProvider } from '../../hooks/useAuthMetadata';
import { StoredSession } from '../../state/sessions';
import { useActiveSession } from '../../hooks/useSessionStore';
import { useClientConfig } from '../../hooks/useClientConfig';
import { getLoginPath } from '../pathUtils';
import { ClientStartupProvider } from './ClientStartupContext';
import { useSyncState } from '../../hooks/useSyncState';
import { AutoDiscovery } from './AutoDiscovery';
import {
  isInitialClientCatchupInProgress,
  type ClientSyncStateData,
} from '../../hooks/useInitialClientCatchup';
import {
  createMindroomSyncEngine,
  MindroomSyncEngineProvider,
  resolvePrefetchConfig,
  type MindroomSyncEngine,
} from '../../mindroom/engine';
import { getDefaultStore } from 'jotai';
import { settingsAtom } from '../../state/settings';

type ClientMatrixClient = Awaited<ReturnType<typeof initClient>> & {
  on: (
    event: HttpApiEvent.SessionLoggedOut,
    listener: HttpApiEventHandlerMap[HttpApiEvent.SessionLoggedOut]
  ) => unknown;
  removeListener: (
    event: HttpApiEvent.SessionLoggedOut,
    listener: HttpApiEventHandlerMap[HttpApiEvent.SessionLoggedOut]
  ) => unknown;
};

export const hasCachedClientShell = (mx: ClientMatrixClient): boolean => {
  return mx.getRooms().length > 0;
};

function ClientRootLoading({ loadingMessages }: { loadingMessages?: readonly string[] }) {
  return <MindRoomSplashScreen loadingMessages={loadingMessages} />;
}

function ClientRootSyncingStatus() {
  return (
    <Box
      direction="Row"
      shrink="No"
      alignItems="Center"
      justifyContent="Center"
      gap="100"
      style={{ padding: config.space.S100 }}
    >
      <Spinner variant="Secondary" size="100" />
      <Text size="T300">Catching up...</Text>
    </Box>
  );
}

function ClientRootOptions({
  mx,
  activeSession,
}: {
  mx?: ClientMatrixClient;
  activeSession?: StoredSession;
}) {
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [clearing, setClearing] = useState(false);

  const handleToggle: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  const handleClearCache = async () => {
    if (!mx || clearing) return;

    setClearing(true);

    try {
      await clearAllCacheAndReload(mx);
    } catch {
      setClearing(false);
    }
  };

  return (
    <IconButton
      style={{
        position: 'absolute',
        top: config.space.S100,
        right: config.space.S100,
      }}
      variant="Background"
      fill="None"
      onClick={handleToggle}
    >
      <Icon size="200" src={Icons.VerticalDots} />
      <PopOut
        anchor={menuAnchor}
        position="Bottom"
        align="End"
        offset={6}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => setMenuAnchor(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
              isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {mx && (
                  <MenuItem
                    onClick={handleClearCache}
                    size="300"
                    radii="300"
                    disabled={clearing}
                    before={clearing && <Spinner size="100" variant="Secondary" />}
                  >
                    <Text as="span" size="T300" truncate>
                      {clearing ? 'Clearing...' : 'Clear Cache and Reload'}
                    </Text>
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    if (mx) {
                      logoutClient(mx).catch(() => undefined);
                      return;
                    }
                    if (activeSession) {
                      removeSessionAndReload(activeSession).catch(() => undefined);
                      return;
                    }
                    clearLoginData().catch(() => undefined);
                  }}
                  size="300"
                  radii="300"
                  variant="Critical"
                  fill="None"
                >
                  <Text as="span" size="T300" truncate>
                    Logout
                  </Text>
                </MenuItem>
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </IconButton>
  );
}

const useLogoutListener = (
  mx: ClientMatrixClient | undefined,
  activeSession: StoredSession | undefined
) => {
  useEffect(() => {
    const handleLogout: HttpApiEventHandlerMap[HttpApiEvent.SessionLoggedOut] = async () => {
      if (!mx) return;
      await removeCurrentClientSessionAndReload(mx, activeSession);
    };

    mx?.on(HttpApiEvent.SessionLoggedOut, handleLogout);
    return () => {
      mx?.removeListener(HttpApiEvent.SessionLoggedOut, handleLogout);
    };
  }, [activeSession, mx]);
};

type ClientState =
  | {
      status: 'idle';
    }
  | {
      status: 'loading' | 'starting';
      session: ClientBootstrapSession;
      mx?: ClientMatrixClient;
    }
  | {
      status: 'success';
      session: ClientBootstrapSession;
      mx: ClientMatrixClient;
    }
  | {
      status: 'error';
      session: ClientBootstrapSession;
      error: Error;
      mx?: ClientMatrixClient;
    };

type ClientRootProps = {
  children: ReactNode;
};
export function ClientRoot({ children }: ClientRootProps) {
  const clientConfig = useClientConfig();
  const activeSession = useActiveSession();
  const [retryCount, setRetryCount] = useState(0);
  const [clientState, setClientState] = useState<ClientState>({ status: 'idle' });
  const mx = 'mx' in clientState ? clientState.mx : undefined;
  const activeSessionId = activeSession?.sessionId;
  const activeSessionBaseUrl = activeSession?.baseUrl;
  const activeSessionUserId = activeSession?.userId;
  const activeSessionDeviceId = activeSession?.deviceId;
  const activeSessionAccessToken = activeSession?.accessToken;
  const clientBootstrapSession = useMemo(
    (): ClientBootstrapSession | undefined =>
      activeSessionId &&
      activeSessionBaseUrl &&
      activeSessionUserId &&
      activeSessionDeviceId &&
      activeSessionAccessToken
        ? {
            sessionId: activeSessionId,
            baseUrl: activeSessionBaseUrl,
            userId: activeSessionUserId,
            deviceId: activeSessionDeviceId,
            accessToken: activeSessionAccessToken,
          }
        : undefined,
    [
      activeSessionAccessToken,
      activeSessionBaseUrl,
      activeSessionDeviceId,
      activeSessionId,
      activeSessionUserId,
    ]
  );

  useLogoutListener(mx, activeSession);

  // CINNY-207 P3.1: MindroomSyncEngine is the client-level owner of
  // Tier-1 cache writes (D2). It is created alongside the Matrix client
  // and torn down on logout / client swap, independent of which room is
  // mounted. Attaching listeners here — BEFORE the startClient effect
  // below — is deliberate: React runs effects in declaration order at
  // commit, so this effect binds mx.on(RoomEvent.*) before startClient
  // begins delivering sync events. Missing an event because the engine
  // wasn't listening yet is the exact regression class this ordering
  // guards against.
  const [syncEngine, setSyncEngine] = useState<MindroomSyncEngine | undefined>(undefined);
  useEffect(() => {
    if (!mx) {
      setSyncEngine(undefined);
      return undefined;
    }
    // CINNY-207 P7.2 audit finding #5: supply a live PrefetchConfig
    // supplier so the gap-fill executor can honor the user's
    // `prefetchScope` selection (my-server / all-rooms / current-room-
    // only). Reads through the default jotai store on every call so a
    // mid-session scope change takes effect on the next enqueue
    // without an engine rebuild.
    const store = getDefaultStore();
    const engine = createMindroomSyncEngine({
      mx,
      getPrefetchConfig: () =>
        resolvePrefetchConfig(
          store.get(settingsAtom) as unknown as {
            prefetchScope?: unknown;
            prefetchDepth?: unknown;
          }
        ),
    });
    engine.start();
    setSyncEngine(engine);
    return () => {
      engine.stop();
      setSyncEngine((current) => (current === engine ? undefined : current));
    };
  }, [mx]);

  const [hasCachedShell, setHasCachedShell] = useState(false);
  const [syncStateData, setSyncStateData] = useState<ClientSyncStateData>({
    current: null,
    previous: undefined,
  });

  useEffect(() => {
    setSyncStateData({
      current: mx?.getSyncState?.() ?? null,
      previous: undefined,
    });
  }, [mx]);

  useSyncState(
    mx,
    useMemo(
      () => (current, previous) => {
        setSyncStateData((existing) => {
          if (existing.current === current && existing.previous === previous) {
            return existing;
          }
          return { current, previous };
        });
      },
      []
    )
  );
  useEffect(() => {
    let disposed = false;
    let nextClient: ClientMatrixClient | undefined;

    if (!clientBootstrapSession) {
      setClientState({ status: 'idle' });
      return () => undefined;
    }

    setClientState({
      status: 'loading',
      session: clientBootstrapSession,
    });
    setHasCachedShell(false);

    const loadClient = async () => {
      try {
        nextClient = (await initClient(clientBootstrapSession)) as ClientMatrixClient;
        if (disposed) {
          nextClient.stopClient();
          return;
        }

        setClientState({
          status: 'starting',
          session: clientBootstrapSession,
          mx: nextClient,
        });
      } catch (error) {
        if (nextClient) {
          nextClient.stopClient();
        }
        if (disposed) return;

        setClientState({
          status: 'error',
          session: clientBootstrapSession,
          error: error instanceof Error ? error : new Error('Failed to initialize Matrix client.'),
          mx: nextClient,
        });
      }
    };

    loadClient().catch(() => undefined);

    return () => {
      disposed = true;
      nextClient?.stopClient();
    };
  }, [clientBootstrapSession, retryCount]);

  useEffect(() => {
    if (clientState.status !== 'starting' || !clientState.mx) return undefined;

    let disposed = false;
    const { mx: nextClient, session } = clientState;

    const startInitializedClient = async () => {
      try {
        await startClient(nextClient);
        if (disposed) return;

        setHasCachedShell(hasCachedClientShell(nextClient));

        setClientState((currentState) => {
          if (
            currentState.status !== 'starting' ||
            currentState.mx !== nextClient ||
            currentState.session.sessionId !== session.sessionId
          ) {
            return currentState;
          }

          return {
            status: 'success',
            session,
            mx: nextClient,
          };
        });
      } catch (error) {
        nextClient.stopClient();
        if (disposed) return;

        setClientState({
          status: 'error',
          session,
          error: error instanceof Error ? error : new Error('Failed to initialize Matrix client.'),
          mx: nextClient,
        });
      }
    };

    startInitializedClient().catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [clientState]);

  if (!activeSession) {
    return <Navigate to={getLoginPath()} replace />;
  }

  const hasSeenSyncActivity = syncStateData.current !== null;
  const hasCompletedInitialCatchup = !isInitialClientCatchupInProgress(syncStateData);
  const canRenderReadyContent = Boolean(mx) && (hasSeenSyncActivity || hasCachedShell);

  const readyContent = mx ? (
    <ClientStartupProvider hasCompletedInitialSync={hasCompletedInitialCatchup}>
      <MatrixClientProvider value={mx as never}>
        {syncEngine ? (
          <MindroomSyncEngineProvider engine={syncEngine}>
            <ServerConfigsLoader mx={mx}>
              {(serverConfigs) => (
                <CapabilitiesProvider value={serverConfigs.capabilities ?? {}}>
                  <MediaConfigProvider value={serverConfigs.mediaConfig ?? {}}>
                    <AuthMetadataProvider value={serverConfigs.authMetadata}>
                      <AutoDiscovery userId={activeSession.userId} baseUrl={activeSession.baseUrl}>
                        {children}
                      </AutoDiscovery>
                    </AuthMetadataProvider>
                  </MediaConfigProvider>
                </CapabilitiesProvider>
              )}
            </ServerConfigsLoader>
          </MindroomSyncEngineProvider>
        ) : null}
      </MatrixClientProvider>
    </ClientStartupProvider>
  ) : null;

  return (
    <SpecVersions baseUrl={activeSession.baseUrl}>
      {clientState.status !== 'error' &&
        canRenderReadyContent &&
        mx &&
        (!hasSeenSyncActivity ? <ClientRootSyncingStatus /> : <SyncStatus mx={mx} />)}
      {clientState.status !== 'error' && !mx && (
        <ClientRootOptions mx={mx} activeSession={activeSession} />
      )}
      {clientState.status === 'error' && (
        <SplashScreen>
          <Box direction="Column" grow="Yes" alignItems="Center" justifyContent="Center" gap="400">
            <Dialog>
              <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
                <Text>{`Failed to start account ${clientState.session.userId}. ${clientState.error.message}`}</Text>
                <Button variant="Critical" onClick={() => setRetryCount((count) => count + 1)}>
                  <Text as="span" size="B400">
                    Retry
                  </Text>
                </Button>
                <Button
                  variant="Critical"
                  fill="Soft"
                  onClick={() => {
                    removeSessionAndReload(clientState.session, clientState.mx).catch(
                      () => undefined
                    );
                  }}
                >
                  <Text as="span" size="B400">
                    Remove Account
                  </Text>
                </Button>
              </Box>
            </Dialog>
          </Box>
        </SplashScreen>
      )}
      {clientState.status !== 'error' && !canRenderReadyContent ? (
        <ClientRootLoading loadingMessages={clientConfig.splash?.loadingMessages} />
      ) : (
        readyContent
      )}
    </SpecVersions>
  );
}
