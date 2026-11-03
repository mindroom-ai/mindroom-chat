import React, { ReactNode } from 'react';
import classNames from 'classnames';
import { Box, Text } from 'folds';
import { ParticleBackgroundSurface, usePersistentParticleBackground } from '../particle-background';
import { MINDROOM_CLIENT_BRANDING } from '../../mindroom/branding/clientBranding';
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

  return (
    <Box
      direction="Column"
      className={classNames(
        css.SplashScreen,
        !customBackground && persistentBackground && css.SplashScreenPersistentParticle
      )}
    >
      {customBackground ? (
        background
      ) : (
        <div className={css.SplashScreenParticle}>
          <ParticleBackgroundSurface position="fixed" />
        </div>
      )}
      <Box grow="Yes" direction="Column" className={css.SplashScreenContent}>
        {children}
      </Box>
      <Box justifyContent="Center" className={css.SplashScreenFooter}>
        <Text size="H2" align="Center">
          {MINDROOM_CLIENT_BRANDING.appName}
        </Text>
      </Box>
    </Box>
  );
}
