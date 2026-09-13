import { Box, Text } from 'folds';
import React, { ReactNode } from 'react';
import classNames from 'classnames';
import * as patternsCSS from '../../styles/Patterns.css';
import * as css from './SplashScreen.css';
import { MINDROOM_CLIENT_BRANDING } from '../../mindroom/branding/clientBranding';

type SplashScreenProps = {
  children: ReactNode;
};
export function SplashScreen({ children }: SplashScreenProps) {
  return (
    <Box
      className={classNames(css.SplashScreen, patternsCSS.BackgroundDotPattern)}
      direction="Column"
    >
      {children}
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
