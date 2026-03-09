import React, { ReactNode } from 'react';
import { Box, Dialog, config, Text, Button, Spinner } from 'folds';
import { SpecVersionsLoader } from '../../components/SpecVersionsLoader';
import { SpecVersionsProvider } from '../../hooks/useSpecVersions';
import { SplashScreen } from '../../components/splash-screen';
import { clearBrowserCacheAndReload, removeSessionAndReload } from '../../../client/initMatrix';
import { useActiveSession } from '../../hooks/useSessionStore';

export function SpecVersions({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const activeSession = useActiveSession();

  return (
    <SpecVersionsLoader
      baseUrl={baseUrl}
      fallback={() => (
        <SplashScreen>
          <Box direction="Column" grow="Yes" alignItems="Center" justifyContent="Center" gap="400">
            <Spinner variant="Secondary" size="600" />
            <Text>Connecting to server</Text>
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
          </Box>
        </SplashScreen>
      )}
      error={(err, retry, ignore) => (
        <SplashScreen>
          <Box direction="Column" grow="Yes" alignItems="Center" justifyContent="Center" gap="400">
            <Dialog>
              <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
                <Text>
                  Failed to connect to homeserver. Either homeserver is down or your internet.
                </Text>
                <Button variant="Critical" onClick={retry}>
                  <Text as="span" size="B400">
                    Retry
                  </Text>
                </Button>
                <Button
                  variant="Critical"
                  fill="Soft"
                  onClick={() => {
                    clearBrowserCacheAndReload();
                  }}
                >
                  <Text as="span" size="B400">
                    Clear Cache and Reload
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
      {(versions) => <SpecVersionsProvider value={versions}>{children}</SpecVersionsProvider>}
    </SpecVersionsLoader>
  );
}
