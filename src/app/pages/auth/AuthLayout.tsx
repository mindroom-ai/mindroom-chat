import React, { FormEventHandler, ReactNode, useCallback, useEffect, useState } from 'react';
import { Box, Button, Input, Scroll, Spinner, Text, color } from 'folds';
import { Header } from '../../components/glass/GlassPrimitives';
import {
  ParticleBackgroundSurface,
  usePersistentParticleBackground,
} from '../../components/particle-background';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { AutoDiscoveryAction, autoDiscovery, type AutoDiscoveryInfo } from '../../cs-api';
import { AutoDiscoveryInfoProvider } from '../../hooks/useAutoDiscoveryInfo';
import { AuthServerProvider } from '../../hooks/useAuthServer';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useActiveSession } from '../../hooks/useSessionStore';
import { MINDROOM_AUTH_BRANDING } from '../../mindroom/auth/authUi';
import { createMatrixFetchFn } from '../../mindroom/matrix/matrixClientFactory';
import { decodeRouteParam } from '../pathUtils';
import { resolveAuthRouteRedirect } from '../routeSessionGuards';
import { resolveAddAccountReturnPath } from './addAccount';
import { buildAuthRoutePath, isServerChoiceLocked, resolveAuthServer } from './authRouteUtils';
import { AuthFooter } from './AuthFooter';
import * as css from './styles.css';

const DEFAULT_SERVER = 'mindroom.chat';

/** The configured servers, offered as suggestions in the free-text server field. */
const SERVER_LIST_ID = 'auth-server-list';

type DiscoveryState =
  | { status: 'loading' }
  | { status: 'ready'; info: AutoDiscoveryInfo }
  | { status: 'error'; server: string; action: AutoDiscoveryAction };

const useDefaultServer = (): string => {
  const { homeserverList, defaultHomeserver } = useClientConfig();
  return homeserverList?.[defaultHomeserver ?? 0] ?? homeserverList?.[0] ?? DEFAULT_SERVER;
};

const useServerLocked = (): boolean => isServerChoiceLocked(useClientConfig());

/** The server's well-known answer; `retry` asks again after a failure. */
const useServerDiscovery = (server: string): [DiscoveryState, () => void] => {
  const [state, setState] = useState<DiscoveryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    autoDiscovery(createMatrixFetchFn(fetch), server).then(([error, info]) => {
      if (cancelled) return;
      if (info && !error) setState({ status: 'ready', info });
      else
        setState({
          status: 'error',
          server,
          action: error?.action ?? AutoDiscoveryAction.FAIL_PROMPT,
        });
    });
    return () => {
      cancelled = true;
    };
  }, [server, attempt]);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return [state, retry];
};

type DiscoveryFailureProps = { failure: AutoDiscoveryAction; retry: () => void };

/** Why the server could not be used, and a way to try it again. */
function DiscoveryFailure(props: DiscoveryFailureProps) {
  const { t } = useTranslation();
  const insecure = props.failure === AutoDiscoveryAction.FAIL_INSECURE;
  return (
    <Box direction="Column" alignItems="Start" gap="200" role="alert">
      <Text style={{ color: color.Critical.Main }} size="T300">
        {insecure
          ? t('sharedUi.authLayout.onlyHttpsServersAreAllowedHttpIsSupportedForLocalNetworkServers')
          : t('sharedUi.authLayout.failedToConnectEitherServerIsUnavailableAtThisMomentOrDoes')}
      </Text>
      {!insecure && (
        <Button variant="Secondary" fill="Soft" size="300" radii="300" onClick={props.retry}>
          <Text as="span" size="B300">
            {t('sharedUi.authFlowsLoader.retry')}
          </Text>
        </Button>
      )}
    </Box>
  );
}

function ServerPicker({
  server,
  onChange,
}: {
  server: string;
  onChange: (server: string) => void;
}) {
  const { t } = useTranslation();
  const { homeserverList } = useClientConfig();
  const locked = useServerLocked();

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const target = event.target as HTMLFormElement & { serverInput: HTMLInputElement };
    const value = target.serverInput.value.trim();
    if (value && value !== server) onChange(value);
  };

  if (locked && (homeserverList?.length ?? 0) <= 1) return null;

  return (
    <Box as="form" onSubmit={handleSubmit} direction="Column" gap="100">
      <Text as="label" size="L400" priority="300">
        {t('sharedUi.serverPicker.server')}
      </Text>
      {locked && homeserverList && homeserverList.length > 0 ? (
        <select
          aria-label={t('sharedUi.serverPicker.server')}
          value={server}
          onChange={(event) => onChange(event.target.value)}
        >
          {homeserverList.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      ) : (
        <>
          <Input
            key={server}
            name="serverInput"
            defaultValue={server}
            aria-label={t('sharedUi.serverPicker.server')}
            list={homeserverList && homeserverList.length > 1 ? SERVER_LIST_ID : undefined}
            autoComplete="off"
            variant="Background"
            size="500"
            outlined
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              if (value && value !== server) onChange(value);
            }}
          />
          {homeserverList && homeserverList.length > 1 && (
            <datalist id={SERVER_LIST_ID} aria-label={t('sharedUi.serverPicker.serverList')}>
              {homeserverList.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          )}
        </>
      )}
    </Box>
  );
}

/** The full-height scrolling page the sign-in card sits on, above the particle background. */
function AuthFrame({ children }: { children: ReactNode }) {
  const persistentParticle = usePersistentParticleBackground();
  const layoutClassName = classNames(
    css.AuthLayout,
    persistentParticle && css.AuthLayoutPersistentParticle
  );

  return (
    <Scroll hideTrack size="300" variant="Background" visibility="Hover">
      <Box className={layoutClassName}>
        <ParticleBackgroundSurface />
        {children}
      </Box>
    </Scroll>
  );
}

/** The sign-in card around login, registration and password reset, with the homeserver choice. */
export function AuthLayout() {
  const { t } = useTranslation();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const { server: encodedServer } = useParams();
  const defaultServer = useDefaultServer();
  const locked = useServerLocked();
  const { auth, homeserverList } = useClientConfig();
  const requestedServer = encodedServer ? decodeRouteParam(encodedServer) : undefined;
  const server = resolveAuthServer(requestedServer, defaultServer, locked, homeserverList);
  const [discovery, retryDiscovery] = useServerDiscovery(server);
  const activeSession = useActiveSession();
  // Adding an account can be abandoned: back to where the signed-in account was.
  const returnPath = resolveAddAccountReturnPath(search, activeSession);

  const homeRedirect =
    typeof window !== 'undefined' ? resolveAuthRouteRedirect(window.location.href) : null;
  useEffect(() => {
    if (homeRedirect) navigate(homeRedirect, { replace: true });
  }, [homeRedirect, navigate]);

  const registrationAllowed = auth?.allowRegistration !== false;
  const showServer = (nextServer: string) =>
    navigate(
      buildAuthRoutePath({ pathname, search, hash, registrationAllowed, server: nextServer }),
      { replace: true }
    );

  // The address always names the server the card shows: `/login` becomes `/login/<default>`,
  // and a server a locked deployment does not offer is replaced by the one it falls back to.
  const urlNamesServer = requestedServer?.trim() === server;
  useEffect(() => {
    if (!homeRedirect && !urlNamesServer) showServer(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeRedirect, urlNamesServer, server]);

  const handleServerChange = (nextServer: string) => {
    if (resolveAuthServer(nextServer, defaultServer, locked, homeserverList) !== nextServer) return;
    showServer(nextServer);
  };

  return (
    <AuthFrame>
      <Box as="main" className={css.AuthCard} direction="Column">
        <Header className={css.AuthHeader} size="600" variant="Surface">
          <Box grow="Yes" alignItems="Center" gap="300">
            <img
              className={css.AuthLogo}
              src={MINDROOM_AUTH_BRANDING.logoSrc}
              alt={MINDROOM_AUTH_BRANDING.logoAlt}
            />
            {/* The page's one heading; each page's own title is a paragraph under the server. */}
            <Text as="h1" size="H3">
              {MINDROOM_AUTH_BRANDING.appName}
            </Text>
          </Box>
        </Header>
        <Box className={css.AuthCardContent} direction="Column" gap="500">
          <ServerPicker server={server} onChange={handleServerChange} />
          {discovery.status === 'loading' && (
            <Box justifyContent="Center" alignItems="Center" gap="200">
              <Spinner variant="Secondary" size="200" />
              <Text size="T300">{t('sharedUi.authLayout.lookingForServer')}</Text>
            </Box>
          )}
          {discovery.status === 'error' && (
            <DiscoveryFailure failure={discovery.action} retry={retryDiscovery} />
          )}
          {discovery.status === 'ready' && (
            <AuthServerProvider value={server}>
              <AutoDiscoveryInfoProvider value={discovery.info}>
                <Outlet context={{ server }} />
              </AutoDiscoveryInfoProvider>
            </AuthServerProvider>
          )}
          {returnPath && (
            <Text align="Center" size="T300">
              <Link to={returnPath}>{t('sharedUi.authLayout.backToCurrentAccount')}</Link>
            </Text>
          )}
        </Box>
      </Box>
      <AuthFooter />
    </AuthFrame>
  );
}
