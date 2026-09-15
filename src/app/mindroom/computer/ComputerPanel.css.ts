import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, DefaultReset, toRem } from 'folds';

export const Panel = style([
  DefaultReset,
  {
    backgroundColor: color.Surface.Container,
    color: color.Surface.OnContainer,
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 clamp(22rem, 42vw, 42rem)',
    minWidth: 0,
    position: 'relative',
    '@media': {
      [`screen and (max-width: ${toRem(750)})`]: {
        bottom: 0,
        flex: 'none',
        left: 0,
        position: 'fixed',
        right: 0,
        top: 0,
        zIndex: 20,
      },
    },
  },
]);

export const Header = style({
  alignItems: 'center',
  borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  display: 'flex',
  flex: '0 0 auto',
  gap: config.space.S200,
  justifyContent: 'space-between',
  minHeight: toRem(56),
  padding: `${config.space.S200} ${config.space.S300}`,
  paddingTop: `calc(${config.space.S200} + env(safe-area-inset-top, 0px))`,
});

export const Body = style({
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  gap: config.space.S300,
  minHeight: 0,
  padding: config.space.S300,
});

export const ScreenFrame = style({
  alignItems: 'center',
  background: '#111',
  borderRadius: config.radii.R300,
  display: 'flex',
  flex: '1 1 auto',
  justifyContent: 'center',
  minHeight: toRem(240),
  overflow: 'hidden',
});

export const Screen = style({
  alignItems: 'center',
  display: 'flex',
  height: '100%',
  justifyContent: 'center',
  minHeight: 0,
  outline: 'none',
  width: '100%',
  selectors: {
    '&:focus-visible': {
      boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.Primary.Main}`,
    },
  },
});

globalStyle(`${Screen} canvas`, {
  maxHeight: '100%',
  maxWidth: '100%',
});

export const Status = style({
  color: color.Surface.OnContainer,
});

export const Error = style({
  color: color.Critical.Main,
});

export const Actions = style({
  display: 'flex',
  flex: '0 0 auto',
  flexWrap: 'wrap',
  gap: config.space.S200,
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
});

export const AgentSelect = style({
  background: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  maxWidth: '100%',
  padding: `${config.space.S200} ${config.space.S300}`,
});
