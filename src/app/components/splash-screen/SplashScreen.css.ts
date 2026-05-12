import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const SplashScreen = style({
  minHeight: '100%',
  backgroundColor: color.Background.Container,
  color: color.Background.OnContainer,
  position: 'relative',
  isolation: 'isolate',
  overflow: 'hidden',
});

export const SplashScreenContent = style({
  position: 'relative',
  zIndex: 1,
});

export const SplashScreenFooter = style({
  position: 'relative',
  zIndex: 1,
  padding: config.space.S400,
  paddingBottom: `calc(${config.space.S400} + env(safe-area-inset-bottom, 0px))`,
});
