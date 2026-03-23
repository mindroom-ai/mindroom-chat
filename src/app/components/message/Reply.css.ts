import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const ReplyBend = style({
  flexShrink: 0,
});

export const ThreadIndicator = style({
  alignSelf: 'flex-start',
  width: 'fit-content',
  maxWidth: '100%',
  padding: `${config.space.S100} ${config.space.S200}`,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,

  selectors: {
    'button&': {
      cursor: 'pointer',
    },
    'button&:hover, button&:focus-visible': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
      borderColor: color.SurfaceVariant.ContainerLine,
    },
    'button&:active': {
      backgroundColor: color.SurfaceVariant.ContainerActive,
    },
  },
});

export const ThreadIndicatorResolved = style({
  borderColor: color.Success.ContainerLine,
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
});

export const ThreadParticipants = style({
  flexShrink: 0,
});

export const ThreadParticipant = style({
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.Container}`,
});

export const Reply = style({
  marginBottom: toRem(1),
  minWidth: 0,
  maxWidth: '100%',
  minHeight: config.lineHeight.T300,
  selectors: {
    'button&': {
      cursor: 'pointer',
    },
  },
});

export const ReplyContent = style({
  opacity: config.opacity.P300,

  selectors: {
    [`${Reply}:hover &`]: {
      opacity: config.opacity.P500,
    },
  },
});
