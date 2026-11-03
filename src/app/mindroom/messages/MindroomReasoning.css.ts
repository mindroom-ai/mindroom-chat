import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** The model's reasoning above an agent reply: a toggle and, when open, the reasoning text. */
export const Reasoning = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  marginBottom: config.space.S100,
});

export const Toggle = style({



  alignSelf: 'flex-start',
  padding: `${toRem(2)} 0`,



  font: 'inherit',
  opacity: 0.7,




    },
  },
});

export const Label = style({
  fontSize: toRem(13),
  fontWeight: 500,
});

export const Body = style({
  minWidth: 0,
  paddingInlineStart: config.space.S300,
  borderInlineStart: `${config.borderWidth.B400} solid ${color.SurfaceVariant.ContainerLine}`,
  color: color.SurfaceVariant.OnContainer,
  opacity: 0.8,
  fontSize: toRem(14),
});

/** Tool names in the live activity line. */
export const ActivityCode = style({
  fontFamily: 'monospace',
  fontSize: '0.9em',
  padding: `0 ${toRem(3)}`,
  borderRadius: config.radii.R300,
  background: color.SurfaceVariant.Container,
});
