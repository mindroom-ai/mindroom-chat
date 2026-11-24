import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const solid = (width: string, lineColor: string) => `${width} solid ${lineColor}`;

export const TriggerCard = style({
  selectors: {
    '&[data-highlighted="true"]': {
      borderColor: color.Primary.Main,
      backgroundColor: `color-mix(in srgb, ${color.Primary.Container} 45%, transparent)`,
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: toRem(2),
    },
  },
});

export const CardHeader = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: config.space.S300,
  minWidth: 0,
  paddingBlockStart: config.space.S300,
  paddingBlockEnd: config.space.S200,
  paddingInline: config.space.S300,
  color: color.Surface.OnContainer,
});

export const CardBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  minWidth: 0,
  paddingBlockStart: 0,
  paddingBlockEnd: config.space.S300,
  paddingInline: config.space.S300,
});

export const IconTileNeutral = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: toRem(28),
  height: toRem(28),
  borderRadius: config.radii.R300,
  flexShrink: 0,
  marginBlockStart: toRem(1),
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

export const StatusPillNeutral = style({
  display: 'inline-flex',
  alignItems: 'center',
  paddingBlock: toRem(2),
  paddingInline: toRem(8),
  borderRadius: config.radii.Pill,
  fontSize: config.fontSize.T200,
  fontWeight: config.fontWeight.W500,
  lineHeight: 1.3,
  flexShrink: 0,
  maxWidth: '100%',
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  border: solid(config.borderWidth.B300, color.SurfaceVariant.ContainerLine),
});
