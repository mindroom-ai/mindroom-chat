import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from 'react-error-boundary';
import { Box, Button, Text, config } from 'folds';
import { Dialog } from '../glass/GlassPrimitives';
import { SplashScreen } from '../splash-screen';
import { ErrorDetail } from '../ErrorDetail';
import { useNewVersion } from '../app-update/NewVersionNotice';
import { checkForNewVersion, reloadForNewVersion } from '../../../appUpdate';
import { isMissingBuildFile } from '../../utils/describeError';

/**
 * What the app shows when a screen fails to render, in place of a blank page: what happened, the
 * error's own text, and Reload. A part that cannot load because a deployment removed this build's
 * files (a plain `lazy` without a fallback, such as a route's page) ends up here too; then it says
 * a new version is available, and Reload starts it. It says so from the failure itself, before
 * the server's version is known, and also when the server publishes no version.
 */
export function AppCrashScreen({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const newVersion = useNewVersion() !== undefined || isMissingBuildFile(error);
  const [reloading, setReloading] = useState(false);

  const reload = () => {
    setReloading(true);
    reloadForNewVersion().catch(() => setReloading(false));
  };

  return (
    <SplashScreen>
      <Box direction="Column" justifyContent="Center" alignItems="Center" gap="400" grow="Yes">
        <Dialog role="alert">
          <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
            <Box direction="Column" gap="100">
              <Text>
                {newVersion ? t('sharedUi.appUpdate.available') : t('sharedUi.appError.title')}
              </Text>
              <Text size="T300">
                {newVersion
                  ? t('sharedUi.appUpdate.reloadToUse')
                  : t('sharedUi.appError.description')}
                <ErrorDetail error={error} />
              </Text>
            </Box>
            <Button variant="Primary" disabled={reloading} onClick={reload}>
              <Text as="span" size="B400">
                {t('sharedUi.appUpdate.reload')}
              </Text>
            </Button>
          </Box>
        </Dialog>
      </Box>
    </SplashScreen>
  );
}

/**
 * The app's root error boundary. Route errors reach it too: the root route rethrows them
 * (src/app/pages/Router.tsx). A failure also asks the server for its version, so a page left
 * behind by a deployment says so.
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      FallbackComponent={AppCrashScreen}
      onError={() => {
        checkForNewVersion().catch(() => undefined);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
