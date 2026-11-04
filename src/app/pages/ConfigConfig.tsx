import { ComponentProps } from 'react';
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

type ConfigActionProps = Omit<ComponentProps<typeof Button>, 'onClick' | 'children'> & {
  label: string;
  /** Called without the click event, so callbacks never receive it as an argument. */
  onPress: () => void;
};

function ConfigAction({ label, onPress, ...buttonProps }: ConfigActionProps) {
  const handleClick = () => onPress();
  return (
    <Button {...buttonProps} onClick={handleClick}>
      <Text as="span" size="B400">
        {label}
      </Text>
    </Button>
  );
}

/**
 * The client configuration did not load. A redirect to the host's sign-in
 * means the web session expired; anything else can be retried. Offline use
 * needs a cached configuration.
 */
export function ConfigConfigError({ error, retry, ignore, authenticate }: ConfigConfigErrorProps) {
  const { t } = useTranslation();
  const sessionExpired = error instanceof ClientConfigAuthenticationError;

  const title = sessionExpired
    ? t('sharedUi.configConfig.yourWebSessionHasExpired')
    : t('sharedUi.configConfig.failedToLoadClientConfigurationFile');
  const detail = sessionExpired ? (
    <Text size="T300">{t('sharedUi.configConfig.signInAgainToReconnect')}</Text>
  ) : (
    <Text size="T300" style={{ color: color.Critical.Main }}>
      {error instanceof Error ? error.message : String(error)}
    </Text>
  );
  const recovery = sessionExpired ? (
    <ConfigAction
      variant="Primary"
      label={t('sharedUi.configConfig.signInAgain')}
      onPress={authenticate}
    />
  ) : (
    <ConfigAction variant="Critical" label={t('sharedUi.configConfig.retry')} onPress={retry} />
  );

  return (
    <SplashScreen>
      <Box direction="Column" justifyContent="Center" alignItems="Center" gap="400" grow="Yes">
        <Dialog>
          <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
            <Box direction="Column" gap="100">
              <Text>{title}</Text>
              {detail}
            </Box>
            {recovery}
            {ignore ? (
              <ConfigAction
                variant="Secondary"
                fill="Soft"
                label={t('sharedUi.configConfig.continueOffline')}
                onPress={ignore}
              />
            ) : null}
          </Box>
        </Dialog>
      </Box>
    </SplashScreen>
  );
}
