import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import {
  particleBackgroundColorVar,
  particleCardBackgroundVar,
  particleCardBorderVar,
  particleCardHighlightVar,
  particleCardTextVar,
} from '../../components/particle-background/particleBackgroundTheme.css';

export const AuthLayout = style({
  minHeight: '100%',
  backgroundColor: particleBackgroundColorVar,
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
  backgroundColor: particleCardBackgroundVar,
  backdropFilter: 'blur(6px) saturate(1.18)',
  WebkitBackdropFilter: 'blur(6px) saturate(1.18)',
  color: particleCardTextVar,
  borderRadius: config.radii.R400,
  boxShadow: `${config.shadow.E100}, inset 0 1px 0 ${particleCardHighlightVar}`,
  border: `${config.borderWidth.B300} solid ${particleCardBorderVar}`,
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
