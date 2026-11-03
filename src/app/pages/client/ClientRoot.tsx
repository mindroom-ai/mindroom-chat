import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Icon, IconButton, Icons, PopOut, Spinner, Text, config } from 'folds';
import { Dialog, Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import FocusTrap from 'focus-trap-react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClientEvent, type MatrixClient } from 'matrix-js-sdk';
import { HttpApiEvent } from 'matrix-js-sdk/lib/http-api/interface';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  clearAllCacheAndReload,
  initClient,
  removeCurrentClientSessionAndReload,
  startClient,
} from '../../../client/initMatrix';
import { clearSecretStorageKeys } from '../../../client/secretStorageKeys';
import { MindRoomSplashScreen, SplashScreen } from '../../components/splash-screen';
import { ServerConfigsLoader } from '../../components/ServerConfigsLoader';
import { CapabilitiesProvider } from '../../hooks/useCapabilities';
import { MediaConfigProvider } from '../../hooks/useMediaConfig';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { useActiveSession } from '../../hooks/useSessionStore';
import { useClientConfig } from '../../hooks/useClientConfig';
import type { StoredSession } from '../../state/sessions';
import { createMindroomSyncEngine, MindroomSyncEngineProvider } from '../../mindroom/engine';
import type { MindroomSyncEngine } from '../../mindroom/engine';
import { getLoginPath } from '../pathUtils';
import { SpecVersions } from './SpecVersions';
import { SyncStatus } from './SyncStatus';
import { ClientStartupProvider } from './ClientStartupContext';

type ClientBootstrapSession = Parameters<typeof initClient>[0];

const toBootstrapSession = (session: StoredSession): ClientBootstrapSession =>
  ({
    sessionId: session.sessionId,




    refreshToken: session.refreshToken,
  } as ClientBootstrapSession);

/**
 * Whether the client restored rooms from its store, so the shell can render
 * before the first sync. A saved sync token alone does not count: without
 * rooms the shell would be empty.
 */
export const hasCachedClientShell = (mx: MatrixClient): boolean => mx.getRooms().length > 0;

type StartupState =
  | { status: 'loading'; mx?: MatrixClient }
  | { status: 'started'; mx: MatrixClient }
  | { status: 'error'; mx?: MatrixClient; error: unknown };

function StartupRecoveryMenu({ mx }: { mx?: MatrixClient }) {
  const { t } = useTranslation();






















                  void clearAllCacheAndReload(mx);
                }}
              >
                <Text size="T300">{t('featureUi.client.startup.clearCache')}</Text>
              </MenuItem>
            </Box>
          </Menu>
        </FocusTrap>
      }
    >
      <IconButton
        variant="Background"
        aria-label={t('featureUi.client.startup.recoveryOptions')}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
          setAnchor(event.currentTarget.getBoundingClientRect())
        }
      >
        <Icon src={Icons.VerticalDots} />
      </IconButton>
    </PopOut>
  );
}

function StartupSplash({ mx }: { mx?: MatrixClient }) {
  const clientConfig = useClientConfig() as { splash?: { loadingMessages?: string[] } };
  const loadingMessages = clientConfig.splash?.loadingMessages;
  return (
    <MindRoomSplashScreen loadingMessages={loadingMessages}>
      <Box justifyContent="End" style={{ padding: config.space.S400 }}>
        <StartupRecoveryMenu mx={mx} />
      </Box>
    </MindRoomSplashScreen>
  );
}

function StartupError({
  error,
  mx,
  onRetry,
}: {
  error: unknown;
  mx?: MatrixClient;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <SplashScreen>
      <Box grow="Yes" direction="Column" alignItems="Center" justifyContent="Center">
        <Dialog>
          <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
            <Text>{t('featureUi.client.startup.failed', { message })}</Text>
            <Button variant="Critical" onClick={onRetry}>
              <Text as="span" size="B400">
                {t('featureUi.client.startup.retry')}
              </Text>
            </Button>
            <Button variant="Secondary" fill="Soft" onClick={() => clearAllCacheAndReload(mx)}>
              <Text as="span" size="B400">
                {t('featureUi.client.startup.clearCache')}
              </Text>
            </Button>
          </Box>
        </Dialog>
      </Box>
    </SplashScreen>
  );
}

function CatchingUp() {
  const { t } = useTranslation();
  return (
    <Box
      alignItems="Center"
      gap="200"
      style={{ position: 'fixed', top: 0, insetInline: 0, justifyContent: 'center', zIndex: 10 }}
    >
      <Spinner size="100" variant="Secondary" />
      <Text size="T200">{t('featureUi.client.startup.catchingUp')}</Text>
    </Box>
  );
}

/** Follows whether the client has finished at least one sync. */
const useFirstSync = (mx: MatrixClient): boolean => {
  const [synced, setSynced] = useState(() => mx.getSyncState() !== null);
  useEffect(() => {
    const handleSync = () => setSynced(true);
    mx.on(ClientEvent.Sync, handleSync);
    return () => {
      mx.removeListener(ClientEvent.Sync, handleSync);
    };
  }, [mx]);
  return synced;
};

/** One sync engine per client, started for its lifetime. */
const useSyncEngine = (mx: MatrixClient): MindroomSyncEngine | undefined => {
  const [engine, setEngine] = useState<MindroomSyncEngine>();
  useEffect(() => {
    let created: MindroomSyncEngine | undefined;
    try {
      created = createMindroomSyncEngine({ mx });
      created.start();
      setEngine(created);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[ClientRoot] Could not start the sync engine', error);
    }
    return () => {
      created?.stop();
    };
  }, [mx]);
  return engine;
};

function ClientShell({
  mx,
  baseUrl,
  started,
  children,
}: {
  mx: MatrixClient;
  baseUrl: string;
  started: boolean;
  children: ReactNode;
}) {
  // The engine listens to sync first; the shell's own listener comes after it.
  const engine = useSyncEngine(mx);
  const synced = useFirstSync(mx);
  const cachedShell = hasCachedClientShell(mx);
  const showShell = synced || (started && cachedShell);

  const content = showShell ? (
    <ClientStartupProvider hasCompletedInitialSync={synced}>
      {synced ? <SyncStatus mx={mx} /> : <CatchingUp />}
      {children}
    </ClientStartupProvider>
  ) : (
    <StartupSplash mx={mx} />
  );

  return (
    <SpecVersions baseUrl={baseUrl} allowCachedContent={cachedShell}>
      <MatrixClientProvider value={mx}>




                {engine ? (
                  <MindroomSyncEngineProvider engine={engine}>{content}</MindroomSyncEngineProvider>
                ) : (
                  content
                )}
              </MediaConfigProvider>
            </CapabilitiesProvider>
          )}
        </ServerConfigsLoader>
      </MatrixClientProvider>
    </SpecVersions>
  );
}

function ClientSession({ session, children }: { session: StoredSession; children: ReactNode }) {
  // Rotated tokens and new metadata must not restart the client; a retry uses the latest ones.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [queryClient] = useState(() => new QueryClient());
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<StartupState>({ status: 'loading' });

  useEffect(
    () => () => {
      // Leaving this account: forget the secret storage keys it cached in memory.
      clearSecretStorageKeys();
      queryClient.clear();
    },
    [queryClient]
  );

  useEffect(() => {
    let cancelled = false;
    let client: MatrixClient | undefined;
    const handleLoggedOut = async () => {
      if (client) await removeCurrentClientSessionAndReload(client, sessionRef.current);
    };

    const start = async () => {
      try {
        client = await initClient(toBootstrapSession(sessionRef.current));
      } catch (error) {
        if (!cancelled) setState({ status: 'error', error });
        return;
      }
      if (cancelled) {
        client.stopClient();
        return;
      }
      client.on(HttpApiEvent.SessionLoggedOut, handleLoggedOut);
      setState({ status: 'loading', mx: client });
      try {
        await startClient(client);
        if (!cancelled) setState({ status: 'started', mx: client });
      } catch (error) {
        if (!cancelled) setState({ status: 'error', mx: client, error });
      }
    };
    void start();

    return () => {
      cancelled = true;
      if (client) {
        client.removeListener(HttpApiEvent.SessionLoggedOut, handleLoggedOut);
        client.stopClient();
      }
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  let content: ReactNode;
  if (state.status === 'error') {
    content = <StartupError error={state.error} mx={state.mx} onRetry={retry} />;
  } else if (!state.mx) {
    content = <StartupSplash />;
  } else {
    content = (
      <ClientShell mx={state.mx} baseUrl={session.baseUrl} started={state.status === 'started'}>
        {children}
      </ClientShell>
    );
  }

  return <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>;
}

type ClientRootProps = {
  children: ReactNode;
};

/**
 * Creates and starts the Matrix client of the active account and provides it
 * to the signed-in app. Switching accounts replaces the whole tree in the
 * same render, with a fresh query cache, so nothing shows one account's data
 * with another's client.
 */
export function ClientRoot({ children }: ClientRootProps) {
  const session = useActiveSession();
  if (!session) return <Navigate to={getLoginPath()} replace />;
  return (
    <ClientSession key={session.sessionId} session={session}>
      {children}
    </ClientSession>
  );
}
