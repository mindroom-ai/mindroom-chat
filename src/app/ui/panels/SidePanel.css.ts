import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// The shell shared by the room's side panels: a full-height column beside the conversation, with a
// borderless header row aligned with the room header.
export const Panel = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
});

// Title at the start, floating control pill pushed to the end edge.
export const Header = style({
  flex: '0 0 auto',
  display: 'flex',
  gap: config.space.S200,
  alignItems: 'center',
  justifyContent: 'space-between',
  minHeight: toRem(54),
  paddingBlock: config.space.S100,
  paddingInline: `${config.space.S400} ${config.space.S300}`,
});

export { Header as SidePanelHeader, Panel as SidePanelPanel };
