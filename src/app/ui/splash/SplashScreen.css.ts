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

/** Stacks above the particle canvas that paints behind the splash screen. */
const Layer = style({
  position: 'relative',
  zIndex: 1,
});

export const SplashScreenContent = style([
  Layer,
  {
    display: 'flex',
    flexDirection: 'column',
  },
]);

/** The app name pinned under the content, clear of the home indicator on phones. */
export const SplashScreenFooter = style([
  Layer,
  {
    paddingInline: config.space.S400,
    paddingTop: config.space.S400,
    paddingBottom: `calc(${config.space.S400} + env(safe-area-inset-bottom, 0px))`,
  },
]);

/** The app name, quieter than the loading line; its clearing in the art stays opaque. */
export const SplashScreenName = style({
  color: `color-mix(in srgb, currentColor 75%, transparent)`,
});
