import { useEffect } from 'react';

import { acquireSplashOverlay, releaseSplashOverlay } from './statusBarOverlay';

export const useNativeSplashOverlay = (): void => {
  useEffect(() => {
    acquireSplashOverlay();

    return () => {
      requestAnimationFrame(() => {
        releaseSplashOverlay();
      });
    };
  }, []);
};
