import { useTranslation } from 'react-i18next';
import { Box, Button, Dialog, Text, color, config } from 'folds';
import React from 'react';
import { isClientConfigAuthenticationError } from '../components/ClientConfigLoader';
import { MindRoomSplashScreen, SplashScreen } from '../components/splash-screen';

export function ConfigConfigLoading() {
  return <MindRoomSplashScreen />;
}

type ConfigConfigErrorProps = {
  error: unknown;
  retry: () => void;
  ignore?: () => void;
  authenticate: () => void;
};
export function ConfigConfigError({ error, retry, ignore, authenticate }: ConfigConfigErrorProps) {
  const { t } = useTranslation();
  const authenticationRequired = isClientConfigAuthenticationError(error);

  return (
    <SplashScreen>
      <Box grow="Yes" direction="Column" gap="400" alignItems="Center" justifyContent="Center">
        <Dialog>
          <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
            <Box direction="Column" gap="100">
              <Text>
                {authenticationRequired
                  ? t('sharedUi.configConfig.yourWebSessionHasExpired')
                  : t('sharedUi.configConfig.failedToLoadClientConfigurationFile')}
              </Text>
              {authenticationRequired ? (
                <Text size="T300">
                  {ignore
                    ? t('sharedUi.configConfig.signInAgainToReconnectOrContinueInOfflineMode')
                    : t('sharedUi.configConfig.signInAgainToReconnect')}
                </Text>
              ) : (
                typeof error === 'object' &&
                error &&
                'message' in error &&
                typeof error.message === 'string' && (
                  <Text size="T300" style={{ color: color.Critical.Main }}>
                    {error.message}
                  </Text>
                )
              )}
            </Box>
            <Button
              variant="Critical"
              onClick={() => (authenticationRequired ? authenticate() : retry())}
            >
              <Text as="span" size="B400">
                {authenticationRequired
                  ? t('sharedUi.configConfig.signInAgain')
                  : t('sharedUi.configConfig.retry')}
              </Text>
            </Button>
            {ignore && (
              <Button variant="Critical" onClick={() => ignore()} fill="Soft">
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
