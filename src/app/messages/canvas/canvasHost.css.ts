import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { footerInset } from '../../ui/styles/RoomOverlay.css';

export const Error = style({
  color: color.Critical.Main,
});

export const Notice = style({
  alignItems: 'center',
  backgroundColor: color.SurfaceVariant.Container,
  borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  display: 'flex',
  flex: '0 0 auto',
  gap: config.space.S200,
  justifyContent: 'space-between',
  padding: `${config.space.S200} ${config.space.S300}`,
});

export const Staged = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  width: '100%',
});

export const Data = style({
  fontFamily: 'monospace',
  fontSize: '0.75rem',
  maxHeight: '10rem',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

// A themed page in the thread can be far taller than the screen.
export const StickyAnswer = style({
  backgroundColor: color.Surface.Container,
  borderTop: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  // Above the room's composer, which floats over the end of the conversation, and above Jump to
  // Latest, which floats S400 over the composer and is 44 px tall to a finger.
  bottom: `calc(${footerInset} + ${config.space.S400} + 44px + ${config.space.S200})`,
  paddingBlock: config.space.S200,
  position: 'sticky',
  zIndex: 1,
});
