import { Box, Text } from 'folds';
import React, { ReactNode } from 'react';
import classNames from 'classnames';
import * as patternsCSS from '../../styles/Patterns.css';
import * as css from './SplashScreen.css';
import { MINDROOM_CLIENT_BRANDING } from '../../mindroom/branding/clientBranding';
import { AuthParticleBackground } from '../../pages/auth/AuthParticleBackground';

type SplashScreenProps = {
  children: ReactNode;
  particleBackground?: boolean;
};

export function SplashScreen({ children, particleBackground = false }: SplashScreenProps) {
  return (
    <Box
      className={classNames(
        css.SplashScreen,
        !particleBackground && patternsCSS.BackgroundDotPattern
      )}
      direction="Column"
    >
      {particleBackground && <AuthParticleBackground />}
      {particleBackground ? (
        <Box className={css.SplashScreenContent} direction="Column" grow="Yes">
          {children}
        </Box>
      ) : (
        children
      )}
      <Box
        className={css.SplashScreenFooter}
        shrink="No"
        alignItems="Center"
        justifyContent="Center"
      >
        <Text size="H2" align="Center">
          {MINDROOM_CLIENT_BRANDING.appName}
        </Text>
      </Box>
    </Box>
  );
}
