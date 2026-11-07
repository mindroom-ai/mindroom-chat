import { ReactNode } from 'react';
import classNames from 'classnames';
import { Box, Text } from 'folds';
import {
  ParticleBackgroundSurface,
  usePersistentParticleBackground,
} from '../particle-background/PersistentParticleBackground';
import { useLoadedOrCachedClientConfig } from '../../config/ClientConfigLoader';
import { deploymentBranding } from '../branding/deploymentBranding';
import {
  ParticleTextBackdrop,
  ParticleTextQuiet,
} from '../particle-background/ParticleTextBackdrop.css';
import * as css from './SplashScreen.css';

type SplashScreenProps = {
  children?: ReactNode;
  /** Replaces the MindRoom particle background. */
  background?: ReactNode;
};

/** Full-screen loading and error surface with the app name at the bottom. */
export function SplashScreen({ children, background }: SplashScreenProps) {
  const persistentBackground = usePersistentParticleBackground();
  const customBackground = background !== undefined && background !== null && background !== false;
  // The deployment's name, from its configuration or the last one this browser loaded. Before any
  // has loaded the name is unknown, and naming MindRoom Chat could name another deployment's app.
  const config = useLoadedOrCachedClientConfig();
  const title = config && deploymentBranding(config).title;

  return (
    <Box
      direction="Column"
      className={classNames(
        css.SplashScreen,
        !customBackground && css.SplashScreenParticle,
        !customBackground && persistentBackground && css.SplashScreenPersistentParticle
      )}
    >
      {customBackground ? background : <ParticleBackgroundSurface position="fixed" />}
      <Box grow="Yes" direction="Column" className={css.SplashScreenContent}>
        {children}
      </Box>
      <Box justifyContent="Center" className={css.SplashScreenFooter}>
        {title && (
          <Text
            size="H2"
            align="Center"
            className={classNames(ParticleTextQuiet, ParticleTextBackdrop)}
          >
            {title}
          </Text>
        )}
      </Box>
    </Box>
  );
}
