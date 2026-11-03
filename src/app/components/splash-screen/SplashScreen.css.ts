import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const SplashScreen = style({
  position: 'relative',
  minHeight: '100%',
  isolation: 'isolate',
  backgroundColor: color.Background.Container,
  color: color.Background.OnContainer,
});

/** The app-wide particle renderer already paints behind this screen; let it show. */
export const SplashScreenPersistentParticle = style({
  backgroundColor: 'transparent',
});

export const SplashScreenParticle = style({
  position: 'fixed',
  inset: 0,
  zIndex: -1,
  pointerEvents: 'none',
});

export const SplashScreenContent = style({
  position: 'relative',
  display: 'flex',









  paddingBottom: `calc(${config.space.S400} + env(safe-area-inset-bottom, 0px))`,
  opacity: config.opacity.P300,
});
