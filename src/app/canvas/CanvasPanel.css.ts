import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export { Header, Panel } from '../ui/panels/SidePanel.css';
export { Data, Error, Notice, Staged } from '../messages/canvas/canvasHost.css';

export const TitleGroup = style({
  flex: '1 1 auto',
  minWidth: 0,
});

export const Controls = style({
  flex: '0 0 auto',
});

export const Title = style({
  flex: '1 1 auto',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
});

export const FrameWrap = style({
  flex: '1 1 auto',
  minHeight: 0,
  overflow: 'hidden',
  position: 'relative',
  width: '100%',
});

export const Frame = style({
  backgroundColor: color.Background.Container,
  border: 'none',
  display: 'block',
  height: '100%',
  // eslint-disable-next-line no-restricted-syntax -- FrameWrap is dir=ltr so top-left stays the scale origin.
  left: 0,
  position: 'absolute',
  top: 0,
  width: '100%',
});

export const Footer = style({
  borderTop: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  display: 'flex',
  flexDirection: 'column',
  flex: '0 0 auto',
  gap: config.space.S200,
  minHeight: '2.5rem',
  alignItems: 'flex-start',
  padding: `${config.space.S200} ${config.space.S300}`,
  paddingBottom: `calc(${config.space.S200} + env(safe-area-inset-bottom, 0px))`,
});

export const Version = style({
  whiteSpace: 'nowrap',
});
