import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

/** A note the form wants read before it is sent, such as that nothing is emailed. */
export const Notice = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: config.space.S200,
  padding: config.space.S300,
  borderRadius: config.radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

/** An invitation to send, just made: its line to select and its Copy button. */
export const Invitation = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: config.space.S200,
  flexBasis: '100%',
  padding: config.space.S300,
  borderRadius: config.radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});
