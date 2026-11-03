import React from 'react';
import { Box, Button, Text, color, config } from 'folds';
import { Dialog } from '../components/glass/GlassPrimitives';
import { useTranslation } from 'react-i18next';
import { ClientConfigAuthenticationError } from '../components/ClientConfigLoader';
import { MindRoomSplashScreen, SplashScreen } from '../components/splash-screen';

/** Shown while the deployment's client configuration loads. */
export function ConfigConfigLoading() {
  return <MindRoomSplashScreen />;
}

type ConfigConfigErrorProps = {
  error: unknown;
  retry: () => void;
  /** Continues with the cached configuration; absent without one. */
  ignore?: () => void;
  /** Reloads the page at the top level so the host's sign-in can run. */
  authenticate: () => void;
};

/**
 * The client configuration did not load. A redirect to the host's sign-in
 * means the web session expired; anything else can be retried. Offline use
 * needs a cached configuration.
 */
export function ConfigConfigError({ error, retry, ignore, authenticate }: ConfigConfigErrorProps) {
  const { t } = useTranslation();
  const expired = error instanceof ClientConfigAuthenticationError;
  const message = error instanceof Error ? error.message : String(error);

  return (
    <SplashScreen>
      <Box grow="Yes" direction="Column" gap="400" alignItems="Center" justifyContent="Center">
        <Dialog>





























                <Text as="span" size="B400">
                  {t('sharedUi.configConfig.continueOffline')}
                </Text>
              </Button>
            )}
          </Box>
        </Dialog>
      </Box>
    </SplashScreen>
  );
}
