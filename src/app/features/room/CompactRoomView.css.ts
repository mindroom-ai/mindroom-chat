import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config } from 'folds';

export const View = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  padding: `0 ${config.space.S300} ${config.space.S300}`,
  overflowY: 'auto',
});

export const EmptyState = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '8rem',
  padding: config.space.S300,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} dashed ${color.SurfaceVariant.ContainerLine}`,
  color: color.SurfaceVariant.OnContainer,
});

export const Card = style([
  DefaultReset,
  {
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S100,
    width: '100%',
    padding: `${config.space.S200} ${config.space.S300}`,
    borderRadius: config.radii.R400,
    border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
    backgroundColor: color.SurfaceVariant.Container,
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'background-color 120ms ease, border-color 120ms ease',
    ':hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    ':focus-visible': {
      outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
]);

export const Row = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
});

export const SummaryRow = style({
  justifyContent: 'space-between',
});

export const SummaryLead = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
  flex: 1,
});

export const SummaryText = style({
  minWidth: 0,
  flex: 1,
});

export const TimeText = style({
  whiteSpace: 'nowrap',
  flexShrink: 0,
});

export const MetaText = style({
  minWidth: 0,
  whiteSpace: 'nowrap',
});

export const MetaTruncate = style({
  minWidth: 0,
  flex: 1,
});

export const MetaSpacer = style({
  minWidth: 0,
  flex: 1,
});

export const ScreenReaderText = style({
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px',
});

export const AttentionDot = recipe({
  base: {
    width: '0.5rem',
    height: '0.5rem',
    borderRadius: '999px',
    flexShrink: 0,
  },
  variants: {
    state: {
      'needs-attention': {
        backgroundColor: color.Critical.Main,
      },
      waiting: {
        backgroundColor: color.Success.Main,
      },
      streaming: {
        backgroundColor: color.Primary.Main,
      },
      resolved: {
        backgroundColor: color.SurfaceVariant.OnContainer,
      },
      idle: {
        backgroundColor: color.SurfaceVariant.ContainerLine,
      },
    },
  },
});
