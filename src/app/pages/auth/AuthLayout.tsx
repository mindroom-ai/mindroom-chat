import React, { FormEventHandler, ReactNode, useEffect, useState } from 'react';
import { Box, Input, Scroll, Spinner, Text, color } from 'folds';
import { Header } from '../../components/glass/GlassPrimitives';
import {
  ParticleBackgroundSurface,
  usePersistentParticleBackground,
} from '../../components/particle-background';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { autoDiscovery, type AutoDiscoveryInfo } from '../../cs-api';
import { AutoDiscoveryInfoProvider } from '../../hooks/useAutoDiscoveryInfo';
import { AuthServerProvider } from '../../hooks/useAuthServer';
import { useClientConfig } from '../../hooks/useClientConfig';
import { MINDROOM_AUTH_BRANDING } from '../../mindroom/auth/authUi';
import { createMatrixFetchFn } from '../../mindroom/matrix/matrixClientFactory';
import { decodeRouteParam } from '../pathUtils';
import { resolveAuthRouteRedirect } from '../routeSessionGuards';
import { buildAuthRoutePath, resolveAuthServer } from './authRouteUtils';
import { AuthFooter } from './AuthFooter';
import * as css from './styles.css';

const DEFAULT_SERVER = 'mindroom.chat';

type DiscoveryState =
  | { status: 'loading' }
  | { status: 'ready'; info: AutoDiscoveryInfo }
  | { status: 'error'; server: string };

const useDefaultServer = (): string => {
  const { homeserverList, defaultHomeserver } = useClientConfig();
  return homeserverList?.[defaultHomeserver ?? 0] ?? homeserverList?.[0] ?? DEFAULT_SERVER;
};

/**
 * Whether the deployment pins sign-in to its configured homeservers: custom
 * servers are off, or the picker is hidden because only one server is listed.
 */
const useServerLocked = (): boolean => {
  const { homeserverList, allowCustomHomeservers, auth } = useClientConfig();
  return (
    allowCustomHomeservers === false ||
    (auth?.hideServerPickerWhenSingle === true && (homeserverList?.length ?? 0) === 1)
  );
};

const useServerDiscovery = (server: string): DiscoveryState => {
  const [state, setState] = useState<DiscoveryState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    autoDiscovery(createMatrixFetchFn(fetch), server).then(([error, info]) => {
      if (cancelled) return;
      setState(info && !error ? { status: 'ready', info } : { status: 'error', server });
    });
    return () => {
      cancelled = true;
    };
  }, [server]);
  return state;
};

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
        <Input
          key={server}
          name="serverInput"
          defaultValue={server}
          aria-label={t('sharedUi.serverPicker.server')}
          variant="Background"
          size="500"
          outlined
          onBlur={(event) => {
            const value = event.currentTarget.value.trim();
            if (value && value !== server) onChange(value);
          }}
        />
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
  const discovery = useServerDiscovery(server);

  const homeRedirect =
    typeof window !== 'undefined' ? resolveAuthRouteRedirect(window.location.href) : null;
  useEffect(() => {
    if (homeRedirect) navigate(homeRedirect, { replace: true });
  }, [homeRedirect, navigate]);

  const handleServerChange = (nextServer: string) => {
    if (resolveAuthServer(nextServer, defaultServer, locked, homeserverList) !== nextServer) return;
    navigate(
      buildAuthRoutePath({
        pathname,
        search,
        hash,
        registrationAllowed: auth?.allowRegistration !== false,
        server: nextServer,
      }),
      { replace: true }
    );
  };

  return (
    <AuthFrame>
      <Box className={css.AuthCard} direction="Column">
        <Header className={css.AuthHeader} size="600" variant="Surface">
          <Box grow="Yes" alignItems="Center" gap="300">
            <img
              className={css.AuthLogo}
              src={MINDROOM_AUTH_BRANDING.logoSrc}
              alt={MINDROOM_AUTH_BRANDING.logoAlt}
            />
            <Text size="H3">{MINDROOM_AUTH_BRANDING.appName}</Text>
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
            <Text style={{ color: color.Critical.Main }} size="T300">
              {t('sharedUi.authLayout.failedToFindServer')}
            </Text>
          )}
          {discovery.status === 'ready' && (
            <AuthServerProvider value={server}>
              <AutoDiscoveryInfoProvider value={discovery.info}>
                <Outlet context={{ server }} />
              </AutoDiscoveryInfoProvider>
            </AuthServerProvider>
          )}
        </Box>
      </Box>
      <AuthFooter />
    </AuthFrame>
  );
}
