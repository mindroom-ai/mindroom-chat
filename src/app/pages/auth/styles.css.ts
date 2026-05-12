import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const AuthLayout = style({
  minHeight: '100%',
  backgroundColor: '#0f0d2e',
  color: color.Background.OnContainer,
  padding: config.space.S400,
  paddingRight: config.space.S200,
  paddingBottom: 0,
  position: 'relative',
  isolation: 'isolate',
  overflow: 'hidden',
});

export const AuthParticleBackground = style({
  position: 'absolute',
  inset: 0,
  zIndex: 0,
  pointerEvents: 'none',
  background:
    'radial-gradient(circle at 50% 45%, rgba(221, 162, 144, 0.18), rgba(15, 13, 46, 0.12) 30%, rgba(15, 13, 46, 1) 72%)',
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      opacity: 0.75,
    },
  },
});

export const AuthParticleCanvas = style({
  width: '100%',
  height: '100%',
  opacity: 1,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      display: 'none',
    },
  },
});

export const AuthCard = style({
  position: 'relative',
  zIndex: 1,
  marginTop: '1vh',
  maxWidth: toRem(460),
  width: '100%',
  backgroundColor: 'rgba(18, 16, 42, 0.28)',
  backdropFilter: 'blur(6px) saturate(1.18)',
  WebkitBackdropFilter: 'blur(6px) saturate(1.18)',
  color: '#f8f5ff',
  borderRadius: config.radii.R400,
  boxShadow: `${config.shadow.E100}, inset 0 1px 0 rgba(255, 255, 255, 0.16)`,
  border: `${config.borderWidth.B300} solid rgba(255, 255, 255, 0.22)`,
  overflow: 'hidden',
});

export const AuthLogo = style([
  DefaultReset,
  {
    width: toRem(26),
    height: toRem(26),

    borderRadius: '50%',
  },
]);

export const AuthHeader = style({
  padding: `0 ${config.space.S400}`,
  borderBottomWidth: config.borderWidth.B300,
});

export const AuthCardContent = style({
  maxWidth: toRem(402),
  width: '100%',
  margin: 'auto',
  padding: config.space.S400,
  paddingTop: config.space.S700,
  paddingBottom: toRem(44),
  gap: toRem(44),
});

export const AuthFooter = style({
  padding: config.space.S200,
  paddingBottom: `calc(${config.space.S200} + env(safe-area-inset-bottom, 0px))`,
});
