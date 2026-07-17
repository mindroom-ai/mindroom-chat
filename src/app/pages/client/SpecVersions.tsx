import React, { ReactNode } from 'react';
import { Box, Dialog, config, Text, Button, Spinner } from 'folds';
import { SpecVersionsLoader } from '../../components/SpecVersionsLoader';
import { SpecVersionsProvider } from '../../hooks/useSpecVersions';
import { MindRoomSplashScreen, SplashScreen } from '../../components/splash-screen';
import { clearAllCacheAndReload, removeSessionAndReload } from '../../../client/initMatrix';
import { useActiveSession } from '../../hooks/useSessionStore';
import { specVersions, type SpecVersions as SpecVersionsResponse } from '../../cs-api';
import { readCachedSpecVersions, writeCachedSpecVersions } from '../../state/cachedSpecVersions';

function LoadedSpecVersions({
  baseUrl,
  userId,
  versions,
  children,
}: {
  baseUrl: string;
  userId?: string;
  versions: SpecVersionsResponse;
  children: ReactNode;
}) {
  React.useEffect(() => {
    if (!userId) return;
    writeCachedSpecVersions(baseUrl, userId, versions);
  }, [baseUrl, userId, versions]);

  return <SpecVersionsProvider value={versions}>{children}</SpecVersionsProvider>;
}

export function SpecVersions({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const activeSession = useActiveSession();
  const userId = activeSession?.userId;
  const accessToken = activeSession?.accessToken;
  const request = React.useCallback<typeof fetch>(
    (input, init) =>
      fetch(
        input,
        accessToken
          ? {
              ...init,
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          : init
      ),
    [accessToken]
  );
  const cachedVersions = React.useMemo(
    () => (userId ? readCachedSpecVersions(baseUrl, userId) : undefined),
    [baseUrl, userId]
  );
  const [clearing, setClearing] = React.useState(false);

  React.useEffect(() => {
    if (!cachedVersions || !userId) return;

    specVersions(request, baseUrl)
      .then((versions) => writeCachedSpecVersions(baseUrl, userId, versions))
      .catch(() => undefined);
  }, [baseUrl, cachedVersions, request, userId]);

  const handleClearCache = async () => {
    if (clearing) return;

    setClearing(true);

    try {
      await clearAllCacheAndReload();
    } catch {
      setClearing(false);
    }
  };

  if (cachedVersions) {
    return <SpecVersionsProvider value={cachedVersions}>{children}</SpecVersionsProvider>;
  }

  return (
    <SpecVersionsLoader
      baseUrl={baseUrl}
      request={request}
      fallback={() => (
        <MindRoomSplashScreen message="Connecting to server">
          <Button
            variant="Critical"
            fill="Soft"
            onClick={() => {
              if (activeSession) {
                removeSessionAndReload(activeSession).catch(() => undefined);
                return;
              }
              window.location.reload();
            }}
          >
            <Text as="span" size="B400">
              Cancel and return to sign in
            </Text>
          </Button>
        </MindRoomSplashScreen>
      )}
      error={(err, retry, ignore) => (
        <SplashScreen>
          <Box direction="Column" grow="Yes" alignItems="Center" justifyContent="Center" gap="400">
            <Dialog>
              <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
                <Text>
                  Unable to connect to the homeserver. The homeserver or your internet connection
                  may be down.
                </Text>
                <Button variant="Critical" onClick={retry}>
                  <Text as="span" size="B400">
                    Retry
                  </Text>
                </Button>
                <Button
                  variant="Critical"
                  fill="Soft"
                  onClick={handleClearCache}
                  disabled={clearing}
                  before={clearing && <Spinner size="200" variant="Secondary" fill="Soft" />}
                >
                  <Text as="span" size="B400">
                    {clearing ? 'Clearing...' : 'Clear Cache and Reload'}
                  </Text>
                </Button>
                <Button variant="Critical" onClick={ignore} fill="Soft">
                  <Text as="span" size="B400">
                    Continue
                  </Text>
                </Button>
              </Box>
            </Dialog>
          </Box>
        </SplashScreen>
      )}
    >
      {(versions) => (
        <LoadedSpecVersions baseUrl={baseUrl} userId={userId} versions={versions}>
          {children}
        </LoadedSpecVersions>
      )}
    </SpecVersionsLoader>
  );
}
