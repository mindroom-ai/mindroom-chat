import React, { FormEventHandler, useEffect, useState } from 'react';
import { Box, Input, Scroll, Spinner, Text, color } from 'folds';
import { Header } from '../../components/glass/GlassPrimitives';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { autoDiscovery, type AutoDiscoveryInfo } from '../../cs-api';
import { AutoDiscoveryInfoProvider } from '../../hooks/useAutoDiscoveryInfo';
import { useClientConfig } from '../../hooks/useClientConfig';
import { MINDROOM_CLIENT_BRANDING } from '../../mindroom/branding/clientBranding';
import { createMatrixFetchFn } from '../../mindroom/matrix/matrixClientFactory';
import { resolveAuthRouteRedirect } from '../routeSessionGuards';
import { buildAuthRoutePath } from './authRouteUtils';
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
  const { homeserverList, allowCustomHomeservers, auth } = useClientConfig();
  const fixed =
    allowCustomHomeservers === false ||
    (auth?.hideServerPickerWhenSingle === true && (homeserverList?.length ?? 0) === 1);

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const target = event.target as HTMLFormElement & { serverInput: HTMLInputElement };
    const value = target.serverInput.value.trim();
    if (value && value !== server) onChange(value);
  };

  if (fixed && homeserverList?.length === 1) return null;

  return (
    <Box as="form" onSubmit={handleSubmit} direction="Column" gap="100">
      <Text as="label" size="L400" priority="300">
        {t('featureUi.auth.homeserver')}
      </Text>
      {homeserverList && homeserverList.length > 0 && allowCustomHomeservers === false ? (
        <select
          aria-label={t('featureUi.auth.homeserver')}
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
          aria-label={t('featureUi.auth.homeserver')}
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

/** The sign-in card around login, registration and password reset, with the homeserver choice. */




  const { server: encodedServer } = useParams();
  const defaultServer = useDefaultServer();
  const server = encodedServer ? decodeURIComponent(encodedServer) : defaultServer;
  const discovery = useServerDiscovery(server);
  const { auth } = useClientConfig();

  const homeRedirect =
    typeof window !== 'undefined' ? resolveAuthRouteRedirect(window.location.href) : null;
  useEffect(() => {
    if (homeRedirect) navigate(homeRedirect, { replace: true });
  }, [homeRedirect, navigate]);

  const handleServerChange = (nextServer: string) => {
    navigate(
      buildAuthRoutePath({
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        registrationAllowed: auth?.allowRegistration !== false,
        server: nextServer,
      }),
      { replace: true }
    );









        gap="400"
      >
        <Box className={css.AuthCard} direction="Column">
          <Header className={css.AuthHeader} size="600" variant="Surface">
            <Box grow="Yes" alignItems="Center" gap="300">
              <img
                className={css.AuthLogo}
                src={MINDROOM_CLIENT_BRANDING.logoSrc}
                alt={MINDROOM_CLIENT_BRANDING.logoAlt}
              />
              <Text size="H3">{MINDROOM_CLIENT_BRANDING.appName}</Text>
            </Box>
          </Header>
          <Box className={css.AuthCardContent} direction="Column" gap="500">
            <ServerPicker server={server} onChange={handleServerChange} />
            {discovery.status === 'loading' && (
              <Box justifyContent="Center">
                <Spinner variant="Secondary" size="600" />
              </Box>
            )}
            {discovery.status === 'error' && (
              <Text style={{ color: color.Critical.Main }} size="T300">
                {t('featureUi.auth.discoveryFailed', { server: discovery.server })}
              </Text>
            )}
            {discovery.status === 'ready' && (
              <AutoDiscoveryInfoProvider value={discovery.info}>
                <Outlet context={{ server }} />
              </AutoDiscoveryInfoProvider>
            )}
          </Box>
        </Box>
        <AuthFooter />
      </Box>
    </Scroll>
  );
}
