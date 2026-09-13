import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const leftAccentWidth = toRem(4);

export const Card = style({
  alignSelf: 'flex-start',
  width: 'fit-content',
  minWidth: 0,
  maxWidth: `min(100%, ${toRem(500)})`,
  padding: config.space.S300,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  boxShadow: `inset ${leftAccentWidth} 0 0 ${color.SurfaceVariant.ContainerLine}`,
});

export const Header = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S200,
});

export const ToolName = style({
  fontWeight: 700,
});

export const StatusLabel = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  padding: `${config.space.S100} ${config.space.S200}`,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid currentColor`,
});

export const Meta = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S100,
});

export const MetaDot = style({
  opacity: config.opacity.P400,
});

export const Details = style({
  minWidth: 0,
});

export const JsonBlock = style({
  marginTop: config.space.S200,
  padding: config.space.S200,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.Background.Container,
  color: color.Background.OnContainer,
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(13),
  lineHeight: 1.45,
});

export const Scope = style({
  padding: config.space.S200,
  borderRadius: config.radii.R300,
  backgroundColor: color.Background.Container,
});
