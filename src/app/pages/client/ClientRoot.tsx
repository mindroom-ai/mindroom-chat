import React, {
  CSSProperties,
  ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Spinner,
  Text,
  color,
  config,
  toRem,
  type RectCords,
} from 'folds';
import { PopOut } from '../../components/directional';
import { Dialog, Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import FocusTrap from 'focus-trap-react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from 'jotai';
import { ClientEvent, SyncState, type MatrixClient } from 'matrix-js-sdk';
import { HttpApiEvent } from 'matrix-js-sdk/lib/http-api/interface';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MindRoomSplashScreen, SplashScreen } from '../../components/splash-screen';
import { ServerConfigsLoader } from '../../components/ServerConfigsLoader';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useActiveSession } from '../../hooks/useSessionStore';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { CapabilitiesProvider } from '../../hooks/useCapabilities';
import { MediaConfigProvider } from '../../hooks/useMediaConfig';
import { createMindroomSyncEngine, MindroomSyncEngineProvider } from '../../mindroom/engine';
import type { MindroomSyncEngine } from '../../mindroom/engine';
import {
  useLivePrefetchConfig,
  usePrefetchConfigSubscription,
} from '../../mindroom/settings/useLivePrefetchConfig';
import type { StoredSession } from '../../state/sessions';
import { forgetComposerStateOfSession } from '../../state/room/roomInputDrafts';
import { closeClient } from '../../mindroom/matrix/closeClient';
import { clearSecretStorageKeys } from '../../../client/secretStorageKeys';
import {
  clearAllCacheAndReload,
  initClient,
  logoutClient,
  removeCurrentClientSessionAndReload,
  removeSessionAndReload,
  startClient,
} from '../../../client/initMatrix';
import { getLoginPath } from '../pathUtils';
import { ClientStartupProvider } from './ClientStartupContext';
import { SpecVersions } from './SpecVersions';
import { SyncStatus } from './SyncStatus';

type ClientBootstrapSession = Parameters<typeof initClient>[0];

const toBootstrapSession = ({
  sessionId,
  accessToken,
  baseUrl,
  deviceId,
  userId,
  refreshToken,
}: StoredSession): ClientBootstrapSession =>
  ({ sessionId, accessToken, baseUrl, deviceId, userId, refreshToken } as ClientBootstrapSession);

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

const describeStartupError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type RecoveryAction = 'logout' | 'remove-account' | 'clear-cache';

/**
 * Runs at most one recovery action at a time. Each of them ends in a reload,
 * so only a failure hands the controls back.
 */
function useRecoveryAction() {
  const runningRef = useRef(false);
  const [running, setRunning] = useState<RecoveryAction>();

  const run = useCallback((action: RecoveryAction, perform: () => Promise<void>): Promise<void> => {
    if (runningRef.current) return Promise.resolve();
    runningRef.current = true;
    setRunning(action);
    return perform().catch(() => {
      runningRef.current = false;
      setRunning(undefined);
    });
  }, []);

  return { running, run };
}

/** The recovery menu closes on an outside click or Escape and leaves focus where it landed. */
const MENU_FOCUS_TRAP = {
  clickOutsideDeactivates: true,
  escapeDeactivates: true,
  returnFocusOnDeactivate: false,
  initialFocus: false,
} as const;

function StartupRecoveryMenu({ mx }: { mx?: MatrixClient }) {
  const { t } = useTranslation();
  const session = useActiveSession();
  const { running, run } = useRecoveryAction();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const hideMenu = () => setMenuAnchor(undefined);
  const busy = running !== undefined;

  const recoveryItems = (
    <Menu>
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        {mx && (
          <MenuItem
            size="300"
            radii="300"
            disabled={busy}
            onClick={() => run('logout', () => logoutClient(mx))}
          >
            <Text size="T300">{t('sharedUi.clientRoot.logout')}</Text>
          </MenuItem>
        )}
        <MenuItem
          size="300"
          radii="300"
          disabled={busy}
          after={running === 'clear-cache' ? <Spinner size="100" variant="Secondary" /> : undefined}
          onClick={() => run('clear-cache', () => clearAllCacheAndReload(mx))}
        >
          <Text size="T300">
            {running === 'clear-cache'
              ? t('sharedUi.clientRoot.clearing')
              : t('sharedUi.clientRoot.clearCacheAndReload')}
          </Text>
        </MenuItem>
        {session && (
          <MenuItem
            size="300"
            radii="300"
            variant="Critical"
            disabled={busy}
            onClick={() => run('remove-account', () => removeSessionAndReload(session, mx))}
          >
            <Text size="T300">{t('sharedUi.clientRoot.removeAccount')}</Text>
          </MenuItem>
        )}
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
function StartupSplash({ mx }: { mx?: MatrixClient }) {
  const loadingMessages = useClientConfig().splash?.loadingMessages;
  return (
    <MindRoomSplashScreen loadingMessages={loadingMessages}>
      <StartupRecoveryMenu mx={mx} />
    </MindRoomSplashScreen>
  );
}

type StartupFailureProps = {
  session: StoredSession;
  mx?: MatrixClient;
  error: unknown;
  onRetry: () => void;
};

/** Startup threw: say why, and offer another try or a way out. */
function StartupFailure({ session, mx, error, onRetry }: StartupFailureProps) {
  const { t } = useTranslation();
  const { running, run } = useRecoveryAction();
  const busy = running !== undefined;
  const clearing = running === 'clear-cache';

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
                value2: describeStartupError(error),
              })}
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
              before={clearing ? <Spinner size="100" variant="Secondary" /> : undefined}
              onClick={() => run('clear-cache', () => clearAllCacheAndReload(mx))}
            >
              <Text as="span" size="B400">
                {clearing
                  ? t('sharedUi.clientRoot.clearing')
                  : t('sharedUi.clientRoot.clearCacheAndReload')}
              </Text>
            </Button>
            <Button
              variant="Critical"
              fill="None"
              disabled={busy}
              onClick={() => run('remove-account', () => removeSessionAndReload(session, mx))}
            >
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

const CATCHING_UP_STYLE: CSSProperties = {
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
  paddingBlock: config.space.S100,
};

/** Shown above a shell rendered from the store until the sync loop reports its first state. */
function CatchingUpBar() {
  const { t } = useTranslation();
  return (
    <Box
      data-testid="client-sync-status"
      shrink="No"
      alignItems="Center"
      justifyContent="Center"
      style={CATCHING_UP_STYLE}
    >
      <Text size="L400">{t('sharedUi.clientRoot.catchingUp')}</Text>
    </Box>
  );
}

type AccountProvidersProps = {
  mx: MatrixClient;
  engine: MindroomSyncEngine;
  sync: SyncProgress;
  children: ReactNode;
};

/** Everything the signed-in pages read from context, plus the sync banner above them. */
function AccountProviders({ mx, engine, sync, children }: AccountProvidersProps) {
  return (
    <ServerConfigsLoader mx={mx}>
      {(serverConfigs) => (
        <MatrixClientProvider value={mx}>
          <MindroomSyncEngineProvider engine={engine}>
            <CapabilitiesProvider value={serverConfigs.capabilities ?? {}}>
              <MediaConfigProvider value={serverConfigs.mediaConfig ?? {}}>
                <ClientStartupProvider hasCompletedInitialSync={sync.live}>
                  {/* One live region for every banner, so a change of state is read out. */}
                  <div role="status" aria-live="polite">
                    {sync.reported ? <SyncStatus mx={mx} /> : <CatchingUpBar />}
                  </div>
                  {children}
                </ClientStartupProvider>
              </MediaConfigProvider>
            </CapabilitiesProvider>
          </MindroomSyncEngineProvider>
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
  const [engine, setEngine] = useState<MindroomSyncEngine>();
  const [sync, setSync] = useState<SyncProgress>(NO_SYNC_YET);
  const [queryClient] = useState(() => new QueryClient());
  const store = useStore();
  const getPrefetchConfig = useLivePrefetchConfig();
  const subscribePrefetchConfig = usePrefetchConfigSubscription();
  const { mx } = startup;

  useEffect(() => {
    latestSession.current = session;
  }, [session]);

  // Account teardown: keys unlocked for this account, its cached queries and the reply targets
  // and staged files of its composers go with it.
  useEffect(
    () => () => {
      clearSecretStorageKeys();
      queryClient.clear();
      forgetComposerStateOfSession(store);
    },
    [queryClient, store]
  );

  // Opening the stores; a retry opens a fresh client with the latest credentials.
  useEffect(() => {
    let abandoned = false;
    let opened: MatrixClient | undefined;
    setStartup({ status: 'loading' });
    setSync(NO_SYNC_YET);
    initClient(toBootstrapSession(latestSession.current)).then(
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
    const created = createMindroomSyncEngine({ mx, getPrefetchConfig, subscribePrefetchConfig });
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
          <Suspense fallback={<StartupSplash mx={mx} />}>
            <AccountProviders mx={mx} engine={shellEngine} sync={sync}>
              {children}
            </AccountProviders>
          </Suspense>
        ) : (
          <StartupSplash mx={mx} />
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
