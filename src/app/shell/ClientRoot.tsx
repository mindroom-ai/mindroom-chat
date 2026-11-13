import React, { ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Spinner,
  Text,
  config,
  toRem,
  type RectCords,
} from 'folds';
import { PopOut } from '../ui/directional';
import { Dialog, Menu, MenuItem } from '../ui/glass/GlassPrimitives';
import FocusTrap from 'focus-trap-react';
import { Navigate } from 'react-router-dom';
import { useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import { ClientEvent, SyncState, type MatrixClient } from 'matrix-js-sdk';
import { HttpApiEvent } from 'matrix-js-sdk/lib/http-api/interface';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SplashScreen } from '../ui/splash/SplashScreen';
import { MindRoomSplashScreen } from '../ui/splash/BrandedSplashScreen';
import { ServerConfigsLoader } from '../matrix/ServerConfigsLoader';
import { useClientConfig } from '../config/useClientConfig';
import { useActiveSession, useStoredSessions } from '../matrix/session/useSessionStore';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { CapabilitiesProvider } from '../matrix/hooks/useCapabilities';
import { MediaConfigProvider } from '../matrix/hooks/useMediaConfig';
import { createSyncEngine, SyncEngineProvider } from '../event-store/engine';
import type { SyncEngine } from '../event-store/engine';
import {
  useLivePrefetchConfig,
  usePrefetchConfigSubscription,
} from '../event-store/useLivePrefetchConfig';
import type { StoredSession } from '../matrix/session/sessions';
import { closeClient } from '../matrix/client/closeClient';
import { clearSecretStorageKeys } from '../matrix/client/secretStorageKeys';
import {
  clearAllCacheAndReload,
  initClient,
  logoutClient,
  logoutSessionWithoutStores,
} from '../account/lifecycle/initMatrix';
import {
  removeCurrentClientSessionAndReload,
  removeSessionAndReload,
} from '../account/lifecycle/sessionLifecycle';
import { startClient } from '../matrix/client/clientSyncPolicy';
import { getLoginPath, getOriginBaseUrl } from '../routes/pathUtils';
import { withAddAccountSearchIf } from '../navigation/addAccount';
import { ClientStartupProvider } from '../matrix/ClientStartupContext';
import { SpecVersions } from './SpecVersions';
import { SyncStatus } from './SyncStatus';
import { reloadWouldLoseWork } from './reloadWouldLoseWork';
import { ReloadWouldLoseWorkContext } from '../ui/PartUnavailable';
import type { TFunction } from 'i18next';
import { describeKnownError } from '../lib/describeError';
import { ErrorDetail } from '../ui/ErrorDetail';
import {
  DeviceIdentityVerificationError,
  MissingCryptoStoreError,
} from '../matrix/client/cryptoStoreContinuity';

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

/**
 * What the client's sync loop reported so far. `reported` turns on with the
 * first state of any kind (an error included), so the live status banner can
 * explain it; `live` only once rooms reflect the server. `restoredRooms`
 * records whether the store had rooms before that first report; it decides
 * the versions gate and is not revised later, so the gate never switches
 * under a mounted shell.
 */
type SyncProgress = { reported: boolean; live: boolean; restoredRooms: boolean };

// The states after which the SDK's rooms are ready (Matrix JS SDK `SyncState`).
const ROOMS_READY_STATES: ReadonlySet<SyncState> = new Set([
  SyncState.Catchup,
  SyncState.Prepared,
  SyncState.Syncing,
]);

const NO_SYNC_YET: SyncProgress = { reported: false, live: false, restoredRooms: false };

const noteSyncReport = (
  known: SyncProgress,
  state: SyncState | null,
  hasRooms: boolean
): SyncProgress => {
  if (state === null) return known;
  const live = known.live || ROOMS_READY_STATES.has(state);
  if (known.reported) return known.live === live ? known : { ...known, live };
  return { reported: true, live, restoredRooms: known.restoredRooms || hasRooms };
};

const noteStoreRestored = (known: SyncProgress, hasRooms: boolean): SyncProgress =>
  known.reported || known.restoredRooms === hasRooms
    ? known
    : { ...known, restoredRooms: hasRooms };

type RecoveryAction = 'logout' | 'remove-account' | 'clear-cache' | 'sign-in-again';

/**
 * The ways out of a start that hangs or fails: sign out (with a client), clear the cache, or
 * remove the account. One runs at a time; each ends in a reload, so only a failure hands the
 * controls back.
 */
function useRecoveryActions(session: StoredSession, mx: MatrixClient | undefined) {
  const { t } = useTranslation();
  const runningRef = useRef(false);
  const [running, setRunning] = useState<RecoveryAction>();

  const run = (action: RecoveryAction, perform: () => Promise<void>) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(action);
    perform().catch(() => {
      runningRef.current = false;
      setRunning(undefined);
    });
  };

  const clearing = running === 'clear-cache';
  return {
    busy: running !== undefined,
    clearing,
    signingInAgain: running === 'sign-in-again',
    clearCacheLabel: clearing
      ? t('sharedUi.clientRoot.clearing')
      : t('sharedUi.clientRoot.clearCacheAndReload'),
    logout: mx && (() => run('logout', () => logoutClient(mx))),
    clearCache: () => run('clear-cache', () => clearAllCacheAndReload(mx)),
    removeAccount: () => run('remove-account', () => removeSessionAndReload(session, mx)),
    signInAgain: (loginHref: string) =>
      run('sign-in-again', () => logoutSessionWithoutStores(session, loginHref)),
  };
}

/** The recovery menu closes on an outside click or Escape and leaves focus where it landed. */
const MENU_FOCUS_TRAP = {
  clickOutsideDeactivates: true,
  escapeDeactivates: true,
  returnFocusOnDeactivate: false,
  initialFocus: false,
} as const;

type StartupScreenProps = { session: StoredSession; mx?: MatrixClient };

function StartupRecoveryMenu({ session, mx }: StartupScreenProps) {
  const { t } = useTranslation();
  const recovery = useRecoveryActions(session, mx);
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const hideMenu = () => setMenuAnchor(undefined);
  const { busy } = recovery;

  const recoveryItems = (
    <Menu>
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        {recovery.logout && (
          <MenuItem size="300" radii="300" disabled={busy} onClick={recovery.logout}>
            <Text size="T300">{t('sharedUi.clientRoot.logout')}</Text>
          </MenuItem>
        )}
        <MenuItem
          size="300"
          radii="300"
          disabled={busy}
          after={recovery.clearing ? <Spinner size="100" variant="Secondary" /> : undefined}
          onClick={recovery.clearCache}
        >
          <Text size="T300">{recovery.clearCacheLabel}</Text>
        </MenuItem>
        <MenuItem
          size="300"
          radii="300"
          variant="Critical"
          disabled={busy}
          onClick={recovery.removeAccount}
        >
          <Text size="T300">{t('sharedUi.clientRoot.removeAccount')}</Text>
        </MenuItem>
      </Box>
    </Menu>
  );

  const recoveryMenu = (
    <FocusTrap focusTrapOptions={{ ...MENU_FOCUS_TRAP, onDeactivate: hideMenu }}>
      {recoveryItems}
    </FocusTrap>
  );

  return (
    <Box
      style={{
        position: 'absolute',
        insetInlineEnd: config.space.S400,
        insetBlockStart: `calc(${config.space.S400} + env(safe-area-inset-top, 0px))`,
      }}
    >
      <PopOut anchor={menuAnchor} align="End" position="Bottom" offset={4} content={recoveryMenu}>
        <IconButton
          aria-label={t('sharedUi.clientRoot.startupRecoveryOptions')}
          aria-haspopup="menu"
          aria-expanded={menuAnchor !== undefined}
          variant="Secondary"
          fill="None"
          size="300"
          radii="300"
          onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
            setMenuAnchor(event.currentTarget.getBoundingClientRect())
          }
        >
          <Icon src={Icons.VerticalDots} size="200" />
        </IconButton>
      </PopOut>
    </Box>
  );
}

/** The particle splash while the client opens its stores and starts syncing. */
function StartupSplash({ session, mx }: StartupScreenProps) {
  const loadingMessages = useClientConfig().splash?.loadingMessages;
  return (
    <MindRoomSplashScreen loadingMessages={loadingMessages}>
      <StartupRecoveryMenu session={session} mx={mx} />
    </MindRoomSplashScreen>
  );
}

type StartupFailureProps = StartupScreenProps & { error: unknown; onRetry: () => void };

/**
 * Why startup failed, translated: the device identity check says what to do (its own text is
 * English and says the same, so it is not repeated), anything else what it can. Lost encryption
 * keys have their own screen.
 */
const startupFailureReason = (
  t: TFunction,
  error: unknown
): { reason: string; showDetail: boolean } => {
  if (error instanceof DeviceIdentityVerificationError) {
    return { reason: t('errors.deviceIdentityUnverified'), showDetail: false };
  }
  return { reason: describeKnownError(t, error) ?? '', showDetail: true };
};

/**
 * The device's encryption keys are gone from this browser, and its homeserver keeps the old ones:
 * no retry can help, so the way on is a new sign-in (a new device) on the same homeserver.
 */
function EncryptionKeysLost({ session }: { session: StoredSession }) {
  const { t } = useTranslation();
  const { hashRouter } = useClientConfig();
  const recovery = useRecoveryActions(session, undefined);
  const { busy } = recovery;
  const otherAccounts = useStoredSessions().some(
    (stored) => stored.sessionId !== session.sessionId
  );
  const loginHref = `${getOriginBaseUrl(hashRouter)}${withAddAccountSearchIf(
    getLoginPath(session.baseUrl),
    otherAccounts
  )}`;

  return (
    <SplashScreen>
      <Box
        grow="Yes"
        direction="Column"
        alignItems="Center"
        justifyContent="Center"
        style={{ padding: config.space.S400 }}
      >
        <Dialog>
          <Box
            direction="Column"
            gap="300"
            style={{ padding: config.space.S400, maxWidth: toRem(440) }}
          >
            <Text as="h2" size="H4">
              {t('sharedUi.clientRoot.keysLostTitle')}
            </Text>
            {/* A user ID has no spaces, and a long one must still wrap on a phone. */}
            <Text role="alert" size="T300" style={{ overflowWrap: 'anywhere' }}>
              {t('sharedUi.clientRoot.keysLost', { userId: session.userId })}
            </Text>
            <Button
              variant="Primary"
              disabled={busy}
              before={
                recovery.signingInAgain ? <Spinner size="100" variant="Primary" /> : undefined
              }
              onClick={() => recovery.signInAgain(loginHref)}
            >
              <Text as="span" size="B400">
                {t('sharedUi.clientRoot.signInAgain')}
              </Text>
            </Button>
            <Button variant="Critical" fill="None" disabled={busy} onClick={recovery.removeAccount}>
              <Text as="span" size="B400">
                {t('sharedUi.clientRoot.removeAccount')}
              </Text>
            </Button>
          </Box>
        </Dialog>
      </Box>
    </SplashScreen>
  );
}

/** Startup threw: say why, and offer another try or a way out. */
function StartupFailure({ session, mx, error, onRetry }: StartupFailureProps) {
  const { t } = useTranslation();
  const recovery = useRecoveryActions(session, mx);
  const { busy } = recovery;
  const { reason, showDetail } = startupFailureReason(t, error);

  return (
    <SplashScreen>
      <Box
        grow="Yes"
        direction="Column"
        alignItems="Center"
        justifyContent="Center"
        style={{ padding: config.space.S400 }}
      >
        <Dialog>
          <Box
            direction="Column"
            gap="300"
            style={{ padding: config.space.S400, maxWidth: toRem(440) }}
          >
            <Text role="alert" size="T300">
              {t('sharedUi.clientRoot.failedToStartAccountValue1Value2', {
                value1: session.userId,
                value2: reason,
              })}
              {showDetail && <ErrorDetail error={error} />}
            </Text>
            <Button variant="Primary" disabled={busy} onClick={onRetry}>
              <Text as="span" size="B400">
                {t('sharedUi.clientRoot.retry')}
              </Text>
            </Button>
            <Button
              variant="Secondary"
              fill="Soft"
              disabled={busy}
              before={recovery.clearing ? <Spinner size="100" variant="Secondary" /> : undefined}
              onClick={recovery.clearCache}
            >
              <Text as="span" size="B400">
                {recovery.clearCacheLabel}
              </Text>
            </Button>
            <Button variant="Critical" fill="None" disabled={busy} onClick={recovery.removeAccount}>
              <Text as="span" size="B400">
                {t('sharedUi.clientRoot.removeAccount')}
              </Text>
            </Button>
          </Box>
        </Dialog>
      </Box>
    </SplashScreen>
  );
}

type AccountProvidersProps = {
  mx: MatrixClient;
  engine: SyncEngine;
  sync: SyncProgress;
  children: ReactNode;
};

/** Everything the signed-in pages read from context, plus how the connection is. */
function AccountProviders({ mx, engine, sync, children }: AccountProvidersProps) {
  const store = useStore();
  const wouldLoseWork = useCallback(() => reloadWouldLoseWork(store, mx), [store, mx]);
  return (
    <ServerConfigsLoader mx={mx}>
      {(serverConfigs) => (
        <MatrixClientProvider value={mx}>
          <ReloadWouldLoseWorkContext.Provider value={wouldLoseWork}>
            <SyncEngineProvider engine={engine}>
              <CapabilitiesProvider value={serverConfigs.capabilities ?? {}}>
                <MediaConfigProvider value={serverConfigs.mediaConfig ?? {}}>
                  <ClientStartupProvider hasCompletedInitialSync={sync.live}>
                    {/* One live region for how the connection is, so a change is read out. The
                        pill floats over the page (SyncStatus), from here until the layout offers
                        its place. */}
                    <div role="status" aria-live="polite" style={{ position: 'relative' }}>
                      <SyncStatus mx={mx} reported={sync.reported} />
                    </div>
                    {children}
                  </ClientStartupProvider>
                </MediaConfigProvider>
              </CapabilitiesProvider>
            </SyncEngineProvider>
          </ReloadWouldLoseWorkContext.Provider>
        </MatrixClientProvider>
      )}
    </ServerConfigsLoader>
  );
}

type ClientSessionProps = { session: StoredSession; children: ReactNode };

/** Clients whose account is being removed after the server ended its session. */
const clientsLeavingAfterLogout = new WeakSet<MatrixClient>();

/**
 * One account's client, from opening its stores to a running sync. Mounted
 * with the session ID as key, so switching accounts unmounts the previous
 * account's tree in the same render; credential rotations keep the client.
 */
function ClientSession({ session, children }: ClientSessionProps) {
  const latestSession = useRef(session);
  const [attempt, setAttempt] = useState(0);
  const [startup, setStartup] = useState<StartupState>({ status: 'loading' });
  const [engine, setEngine] = useState<SyncEngine>();
  const [sync, setSync] = useState<SyncProgress>(NO_SYNC_YET);
  const [queryClient] = useState(() => new QueryClient());
  const getPrefetchConfig = useLivePrefetchConfig();
  const subscribePrefetchConfig = usePrefetchConfigSubscription();
  const { mx } = startup;

  useEffect(() => {
    latestSession.current = session;
  }, [session]);

  // Account teardown: keys unlocked for this account and its cached queries go with it. What its
  // pages kept in the app-wide store goes when they unmount (`ClientBindAtoms`, `accountState.ts`).
  useEffect(
    () => () => {
      clearSecretStorageKeys();
      queryClient.clear();
    },
    [queryClient]
  );

  // Opening the stores; a retry opens a fresh client with the latest credentials.
  useEffect(() => {
    let abandoned = false;
    let opened: MatrixClient | undefined;
    setStartup({ status: 'loading' });
    setSync(NO_SYNC_YET);
    initClient(latestSession.current).then(
      (client) => {
        if (abandoned) {
          closeClient(client);
          return;
        }
        opened = client;
        setStartup({ status: 'loading', mx: client });
      },
      (error: unknown) => {
        if (!abandoned) setStartup({ status: 'error', error });
      }
    );
    return () => {
      abandoned = true;
      if (opened) closeClient(opened);
    };
  }, [session.sessionId, attempt]);

  // The effects below are declared in the order they must subscribe: the engine
  // first, then the startup listeners, and only then the sync loop starts.
  useEffect(() => {
    if (!mx) return undefined;
    const created = createSyncEngine({ mx, getPrefetchConfig, subscribePrefetchConfig });
    created.start();
    setEngine(created);
    return () => {
      created.stop();
      setEngine((current) => (current === created ? undefined : current));
    };
  }, [mx, getPrefetchConfig, subscribePrefetchConfig]);

  useEffect(() => {
    if (!mx) return undefined;
    const noteSyncState = (state: SyncState | null) => {
      const hasRooms = state !== null && hasCachedClientShell(mx);
      setSync((known) => noteSyncReport(known, state, hasRooms));
    };
    // Every request the server refuses after a logout reports it; the account is removed once.
    const leaveAfterServerLogout = () => {
      if (clientsLeavingAfterLogout.has(mx)) return;
      clientsLeavingAfterLogout.add(mx);
      // A failure that throws before its promise exists is shown the same way.
      Promise.resolve()
        .then(() => removeCurrentClientSessionAndReload(mx, latestSession.current))
        .catch((error: unknown) => setStartup({ status: 'error', mx, error }));
    };
    noteSyncState(mx.getSyncState());
    mx.on(ClientEvent.Sync, noteSyncState);
    mx.on(HttpApiEvent.SessionLoggedOut, leaveAfterServerLogout);
    return () => {
      mx.removeListener(ClientEvent.Sync, noteSyncState);
      mx.removeListener(HttpApiEvent.SessionLoggedOut, leaveAfterServerLogout);
    };
  }, [mx]);

  useEffect(() => {
    if (!mx) return undefined;
    let abandoned = false;
    startClient(mx).then(
      () => {
        if (abandoned) return;
        const hasRooms = hasCachedClientShell(mx);
        setSync((known) => noteStoreRestored(known, hasRooms));
        setStartup({ status: 'started', mx });
      },
      (error: unknown) => {
        if (!abandoned) setStartup({ status: 'error', mx, error });
      }
    );
    return () => {
      abandoned = true;
    };
  }, [mx]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  if (startup.status === 'error' && startup.error instanceof MissingCryptoStoreError) {
    return <EncryptionKeysLost session={session} />;
  }
  if (startup.status === 'error') {
    return (
      <StartupFailure session={session} mx={startup.mx} error={startup.error} onRetry={retry} />
    );
  }

  const shellEngine = mx && engine?.mx === mx ? engine : undefined;
  const shellReady = sync.reported || (startup.status === 'started' && sync.restoredRooms);

  return (
    <QueryClientProvider client={queryClient}>
      <SpecVersions baseUrl={session.baseUrl} allowCachedContent={sync.restoredRooms}>
        {mx && shellEngine && shellReady ? (
          // The signed-in pages load as their own chunk (Router.tsx); the splash stays until then.
          <Suspense fallback={<StartupSplash session={session} mx={mx} />}>
            <AccountProviders mx={mx} engine={shellEngine} sync={sync}>
              {children}
            </AccountProviders>
          </Suspense>
        ) : (
          <StartupSplash session={session} mx={mx} />
        )}
      </SpecVersions>
    </QueryClientProvider>
  );
}

/**
 * The signed-in root: starts the active account's Matrix client and provides
 * it to the pages below, or sends a visitor without an account to login.
 */
export function ClientRoot({ children }: { children: ReactNode }) {
  const session = useActiveSession();
  if (!session) return <Navigate to={getLoginPath()} replace />;
  return (
    <ClientSession key={session.sessionId} session={session}>
      {children}
    </ClientSession>
  );
}
