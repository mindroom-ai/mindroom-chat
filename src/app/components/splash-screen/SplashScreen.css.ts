import { globalStyle, style } from '@vanilla-extract/css';
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

/**
 * Over the interactive particle canvas: empty space passes touches and clicks through to the
 * canvas, while the splash's own controls stay clickable.
 */
export const SplashScreenParticle = style({
  pointerEvents: 'none',
});

globalStyle(
  `${SplashScreenParticle} :is(a, button, input, select, textarea, [tabindex]:not([tabindex='-1']))`,
  { pointerEvents: 'auto' }
);

export const SplashScreenContent = style({
  position: 'relative',
  display: 'flex',







  position: 'relative',
  paddingInline: config.space.S400,
  paddingTop: config.space.S400,
  paddingBottom: `calc(${config.space.S400} + env(safe-area-inset-bottom, 0px))`,
  opacity: config.opacity.P300,
});
