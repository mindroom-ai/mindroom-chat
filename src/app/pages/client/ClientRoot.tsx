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
import { HttpApiEvent, HttpApiEventHandlerMap, MatrixClient } from 'matrix-js-sdk';
import FocusTrap from 'focus-trap-react';
import React, { MouseEventHandler, ReactNode, useCallback, useEffect, useState } from 'react';
import {
  clearCacheAndReload,
  clearLoginData,
  initClient,
  logoutClient,
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

function ClientRootOptions({ mx, activeSession }: { mx?: MatrixClient; activeSession?: StoredSession }) {
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const handleToggle: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
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
                  <MenuItem onClick={() => clearCacheAndReload(mx)} size="300" radii="300">
                    <Text as="span" size="T300" truncate>
                      Clear Cache and Reload
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

const useLogoutListener = (mx: MatrixClient | undefined, activeSession: StoredSession | undefined) => {
  useEffect(() => {
    const handleLogout: HttpApiEventHandlerMap[HttpApiEvent.SessionLoggedOut] = async () => {
      if (!mx) return;
      if (activeSession) {
        await removeSessionAndReload(activeSession, mx);
        return;
      }

      mx.stopClient();
      await mx.clearStores();
      window.location.reload();
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
      session: StoredSession;
      mx?: MatrixClient;
    }
  | {
      status: 'success';
      session: StoredSession;
      mx: MatrixClient;
    }
  | {
      status: 'error';
      session: StoredSession;
      error: Error;
      mx?: MatrixClient;
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

  useLogoutListener(mx, activeSession);

  useEffect(() => {
    let disposed = false;
    let nextClient: MatrixClient | undefined;

    if (!activeSession) {
      setClientState({ status: 'idle' });
      return () => undefined;
    }

    setLoading(true);
    setClientState({
      status: 'loading',
      session: activeSession,
    });

    const loadClient = async () => {
      try {
        nextClient = await initClient(activeSession);
        if (disposed) {
          nextClient.stopClient();
          return;
        }

        setClientState({
          status: 'starting',
          session: activeSession,
          mx: nextClient,
        });

        await startClient(nextClient);
        if (disposed) {
          nextClient.stopClient();
          return;
        }

        setClientState({
          status: 'success',
          session: activeSession,
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
          session: activeSession,
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
  }, [activeSession, retryCount]);

  useSyncState(
    mx,
    useCallback((state) => {
      if (state === 'PREPARED') {
        setLoading(false);
      }
    }, [])
  );

  useEffect(() => {
    setLoading(true);
  }, [activeSession?.sessionId, retryCount]);

  if (!activeSession) {
    return <ClientRootLoading />;
  }

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
      {clientState.status !== 'error' && (loading || !mx) ? (
        <ClientRootLoading />
      ) : (
        <MatrixClientProvider value={mx}>
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
      )}
    </SpecVersions>
  );
}
