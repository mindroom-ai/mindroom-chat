import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import {
  PARTICLE_BACKGROUND_COLOR,
  PARTICLE_CARD_BACKGROUND,
  PARTICLE_CARD_BORDER,
  PARTICLE_CARD_HIGHLIGHT,
  PARTICLE_CARD_TEXT,
} from '../../components/particle-background/particleBackgroundTheme';

export const AuthLayout = style({
  minHeight: '100%',
  backgroundColor: PARTICLE_BACKGROUND_COLOR,
  color: color.Background.OnContainer,
  padding: config.space.S400,
  paddingRight: config.space.S200,
  paddingBottom: 0,
  position: 'relative',
  isolation: 'isolate',
  overflow: 'hidden',
});

export const AuthCard = style({
  position: 'relative',
  zIndex: 1,
  marginTop: '1vh',
  maxWidth: toRem(460),
  width: '100%',
  backgroundColor: PARTICLE_CARD_BACKGROUND,
  backdropFilter: 'blur(6px) saturate(1.18)',
  WebkitBackdropFilter: 'blur(6px) saturate(1.18)',
  color: PARTICLE_CARD_TEXT,
  borderRadius: config.radii.R400,
  boxShadow: `${config.shadow.E100}, inset 0 1px 0 ${PARTICLE_CARD_HIGHLIGHT}`,
  border: `${config.borderWidth.B300} solid ${PARTICLE_CARD_BORDER}`,
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
