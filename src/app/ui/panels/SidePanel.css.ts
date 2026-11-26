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

// Title at the start, header controls pushed to the end edge; wraps onto a second row on narrow
// 200 px desktop panels so titles stay readable and Close is never clipped.
export const Header = style({
  flex: '0 0 auto',
  display: 'flex',
  flexWrap: 'wrap',
  rowGap: config.space.S100,
  columnGap: config.space.S200,
  alignItems: 'center',
  justifyContent: 'space-between',
  minHeight: toRem(54),
  paddingBlock: config.space.S100,
  paddingInline: `${config.space.S400} ${config.space.S200}`,
});

export { Header as SidePanelHeader, Panel as SidePanelPanel };
