import React, { useCallback, useEffect } from 'react';
import { Box, Button, Header, Scroll, Spinner, Text, color } from 'folds';
import classNames from 'classnames';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';

import { AuthFooter } from './AuthFooter';
import * as css from './styles.css';
import {
  clientAllowedServer,
  clientDefaultServer,
  useClientConfig,
} from '../../hooks/useClientConfig';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { ServerPicker } from './ServerPicker';
import { AutoDiscoveryAction, autoDiscovery } from '../../cs-api';
import { SpecVersionsLoader } from '../../components/SpecVersionsLoader';
import { SpecVersionsProvider } from '../../hooks/useSpecVersions';
import { AutoDiscoveryInfoProvider } from '../../hooks/useAutoDiscoveryInfo';
import { AuthFlowsLoader } from '../../components/AuthFlowsLoader';
import { AuthFlowsProvider } from '../../hooks/useAuthFlows';
import { AuthServerProvider } from '../../hooks/useAuthServer';
import { useActiveSession } from '../../hooks/useSessionStore';
import { tryDecodeURIComponent } from '../../utils/dom';
import { buildAuthRoutePath } from './authRouteUtils';
import { resolveAddAccountReturnPath } from './addAccount';
import { MINDROOM_AUTH_BRANDING } from '../../mindroom/auth/authUi';
import {
  ParticleBackgroundSurface,
  usePersistentParticleBackground,
} from '../../components/particle-background';
import { HostedDeploymentLauncher } from './HostedDeploymentLauncher';

function AuthLayoutLoading({ message }: { message: string }) {
  return (
    <Box justifyContent="Center" alignItems="Center" gap="200">
      <Spinner size="100" variant="Secondary" />
      <Text align="Center" size="T300">
        {message}
      </Text>
    </Box>
  );
}

function AuthLayoutError({ message }: { message: string }) {
  return (
    <Box justifyContent="Center" alignItems="Center" gap="200">
      <Text align="Center" style={{ color: color.Critical.Main }} size="T300">
        {message}
      </Text>
    </Box>
  );
}

export function AuthLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { server: urlEncodedServer } = useParams();
  const activeSession = useActiveSession();

  const clientConfig = useClientConfig();
  const registrationAllowed = clientConfig.auth?.allowRegistration !== false;

  const defaultServer = clientDefaultServer(clientConfig);
  let server: string = urlEncodedServer ? tryDecodeURIComponent(urlEncodedServer) : defaultServer;

  if (!clientAllowedServer(clientConfig, server)) {
    server = defaultServer;
  }

  const [discoveryState, discoverServer] = useAsyncCallback(
    useCallback(async (serverName: string) => {
      const response = await autoDiscovery(fetch, serverName);
      return {
        serverName,
        response,
      };
    }, [])
  );

  useEffect(() => {
    if (server) discoverServer(server);
  }, [discoverServer, server]);

  // if server is mismatches with path server, update path
  useEffect(() => {
    if (!urlEncodedServer || tryDecodeURIComponent(urlEncodedServer) !== server) {
      navigate(
        buildAuthRoutePath({
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
          registrationAllowed,
          server,
        }),
        { replace: true }
      );
    }
  }, [urlEncodedServer, navigate, location, server, registrationAllowed]);

  const selectServer = useCallback(
    (newServer: string) => {
      if (newServer === server) {
        if (discoveryState.status === AsyncStatus.Loading) return;
        discoverServer(server);
        return;
      }
      navigate(
        buildAuthRoutePath({
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
          registrationAllowed,
          server: newServer,
        })
      );
    },
    [navigate, location, discoveryState, server, discoverServer, registrationAllowed]
  );

  const [autoDiscoveryError, autoDiscoveryInfo] =
    discoveryState.status === AsyncStatus.Success ? discoveryState.data.response : [];

  const serverList = clientConfig.homeserverList ?? [];
  const hideServerPicker =
    clientConfig.auth?.hideServerPickerWhenSingle === true &&
    !clientConfig.allowCustomHomeservers &&
    serverList.length === 1;
  const addAccountReturnPath = resolveAddAccountReturnPath(location.search, activeSession);
  const hasPersistentParticleBackground = usePersistentParticleBackground();

  return (
    <Scroll variant="Background" visibility="Hover" size="300" hideTrack>
      <Box
        className={classNames(
          css.AuthLayout,
          hasPersistentParticleBackground && css.AuthLayoutPersistentParticle
        )}
        direction="Column"
        alignItems="Center"
        justifyContent="SpaceBetween"
        gap="400"
      >
        <ParticleBackgroundSurface />
        <Box direction="Column" className={css.AuthCard}>
          <Header className={css.AuthHeader} size="600" variant="Surface">
            <Box grow="Yes" direction="Row" gap="300" alignItems="Center">
              <img
                className={css.AuthLogo}
                src={MINDROOM_AUTH_BRANDING.logoSrc}
                alt={MINDROOM_AUTH_BRANDING.logoAlt}
              />
              <Text size="H3">{MINDROOM_AUTH_BRANDING.appName}</Text>
            </Box>
          </Header>
          <Box className={css.AuthCardContent} direction="Column">
            {addAccountReturnPath && (
              <Button
                variant="Secondary"
                fill="Soft"
                size="400"
                onClick={() => navigate(addAccountReturnPath, { replace: true })}
              >
                Back to current account
              </Button>
            )}
            <HostedDeploymentLauncher />
            {!hideServerPicker && (
              <Box direction="Column" gap="100">
                <Text as="label" size="L400" priority="300">
                  Server
                </Text>
                <ServerPicker
                  server={server}
                  serverList={serverList}
                  allowCustomServer={clientConfig.allowCustomHomeservers}
                  onServerChange={selectServer}
                />
              </Box>
            )}
            {discoveryState.status === AsyncStatus.Loading && (
              <AuthLayoutLoading message="Looking for server..." />
            )}
            {discoveryState.status === AsyncStatus.Error && (
              <AuthLayoutError message="Failed to find server." />
            )}
            {autoDiscoveryError?.action === AutoDiscoveryAction.FAIL_PROMPT && (
              <AuthLayoutError
                message={`Failed to connect. Server configuration found with ${autoDiscoveryError.host} appears unusable.`}
              />
            )}
            {autoDiscoveryError?.action === AutoDiscoveryAction.FAIL_ERROR && (
              <AuthLayoutError message="Failed to connect. Server configuration base_url appears invalid." />
            )}
            {autoDiscoveryError?.action === AutoDiscoveryAction.FAIL_INSECURE && (
              <AuthLayoutError message="Only HTTPS servers are allowed. HTTP is supported for local-network servers only." />
            )}
            {discoveryState.status === AsyncStatus.Success && autoDiscoveryInfo && (
              <AuthServerProvider value={discoveryState.data.serverName}>
                <AutoDiscoveryInfoProvider value={autoDiscoveryInfo}>
                  <SpecVersionsLoader
                    baseUrl={autoDiscoveryInfo['m.homeserver'].base_url}
                    fallback={() => (
                      <AuthLayoutLoading
                        message={`Connecting to ${autoDiscoveryInfo['m.homeserver'].base_url}`}
                      />
                    )}
                    error={() => (
                      <AuthLayoutError message="Failed to connect. Either server is unavailable at this moment or does not exist." />
                    )}
                  >
                    {(specVersions) => (
                      <SpecVersionsProvider value={specVersions}>
                        <AuthFlowsLoader
                          fallback={() => (
                            <AuthLayoutLoading message="Loading authentication flow..." />
                          )}
                          error={() => (
                            <AuthLayoutError message="Failed to get authentication flow information." />
                          )}
                        >
                          {(authFlows) => (
                            <AuthFlowsProvider value={authFlows}>
                              <Outlet />
                            </AuthFlowsProvider>
                          )}
                        </AuthFlowsLoader>
                      </SpecVersionsProvider>
                    )}
                  </SpecVersionsLoader>
                </AutoDiscoveryInfoProvider>
              </AuthServerProvider>
            )}
          </Box>
        </Box>
        <AuthFooter />
      </Box>
    </Scroll>
  );
}
