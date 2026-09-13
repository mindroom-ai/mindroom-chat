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
import React, {
  MouseEventHandler,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
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
import { SplashScreen } from '../../components/splash-screen';
import { ServerConfigsLoader } from '../../components/ServerConfigsLoader';
import { CapabilitiesProvider } from '../../hooks/useCapabilities';
import { MediaConfigProvider } from '../../hooks/useMediaConfig';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { SpecVersions } from './SpecVersions';
import { useSyncState } from '../../hooks/useSyncState';
import { stopPropagation } from '../../utils/keyboard';
import { SyncStatus } from './SyncStatus';
import { AuthMetadataProvider } from '../../hooks/useAuthMetadata';
import { StoredSession } from '../../state/sessions';
import { useActiveSession } from '../../hooks/useSessionStore';
import { getLoginPath } from '../pathUtils';

const READY_SYNC_STATES = new Set(['PREPARED', 'SYNCING', 'CATCHUP']);

const isClientReadySyncState = (state: string | null | undefined): boolean =>
  !!state && READY_SYNC_STATES.has(state);

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

function ClientRootLoading() {
  return (
    <SplashScreen>
      <Box direction="Column" grow="Yes" alignItems="Center" justifyContent="Center" gap="400">
        <Spinner variant="Secondary" size="600" />
        <Text>Heating up</Text>
      </Box>
    </SplashScreen>
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
  const activeSession = useActiveSession();
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    let disposed = false;
    let nextClient: ClientMatrixClient | undefined;

    if (!clientBootstrapSession) {
      setClientState({ status: 'idle' });
      return () => undefined;
    }

    setLoading(true);
    setClientState({
      status: 'loading',
      session: clientBootstrapSession,
    });

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
        setLoading(false);

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

        setLoading(false);
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

  useSyncState(
    mx,
    useCallback((state: string) => {
      if (isClientReadySyncState(state)) {
        setLoading(false);
      }
    }, [])
  );

  useEffect(() => {
    if (!mx || typeof mx.getSyncState !== 'function') return;
    if (isClientReadySyncState(mx.getSyncState())) {
      setLoading(false);
    }
  }, [mx]);

  useEffect(() => {
    setLoading(true);
  }, [activeSession?.sessionId, retryCount]);

  if (!activeSession) {
    return <Navigate to={getLoginPath()} replace />;
  }

  const readyContent = mx ? (
    <MatrixClientProvider value={mx as never}>
      <ServerConfigsLoader mx={mx}>
        {(serverConfigs) => (
          <CapabilitiesProvider value={serverConfigs.capabilities ?? {}}>
            <MediaConfigProvider value={serverConfigs.mediaConfig ?? {}}>
              <AuthMetadataProvider value={serverConfigs.authMetadata}>
                {children}
              </AuthMetadataProvider>
            </MediaConfigProvider>
          </CapabilitiesProvider>
        )}
      </ServerConfigsLoader>
    </MatrixClientProvider>
  ) : (
    <ClientRootLoading />
  );

  return (
    <SpecVersions baseUrl={activeSession.baseUrl}>
      {mx && <SyncStatus mx={mx} />}
      {loading && <ClientRootOptions mx={mx} activeSession={activeSession} />}
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
      {clientState.status !== 'error' && (loading || !mx) ? <ClientRootLoading /> : readyContent}
    </SpecVersions>
  );
}
