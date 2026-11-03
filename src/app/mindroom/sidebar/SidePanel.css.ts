import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// The shell shared by the room's side panels (canvas, computer): a full-height column beside
// the conversation, with a header row the height of the room header.
export const Panel = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  backgroundColor: color.Background.Container,
  color: color.Background.OnContainer,
  borderInlineStart: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
});

// Title on the left, controls pushed to the right edge.
export const Header = style({
  flex: '0 0 auto',
  display: 'flex',
  gap: config.space.S200,
  alignItems: 'center',
  justifyContent: 'space-between',
  minHeight: toRem(56),
  padding: `${config.space.S200} ${config.space.S200} ${config.space.S200} ${config.space.S400}`,
  borderBottom: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
});

export { Header as SidePanelHeader, Panel as SidePanelPanel };
