import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Panel } from './ResizablePanel.css';

/** The width of the folded edge tab at a panel's start edge. */
export const STRIP_WIDTH = 40;

// Folded, the tab is all of the panel that shows: a vertical column at the room's end edge that
// brings the panel back beside the conversation.
export const Tab = style({
  display: 'flex',
  flexFlow: 'column',
  alignItems: 'center',
  gap: config.space.S100,
  paddingBlock: config.space.S200,
  overflow: 'hidden',
  blockSize: '100%',
  border: 'none',
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  font: 'inherit',
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: color.Surface.ContainerHover },
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: `calc(-1 * ${config.borderWidth.B600})`,
    },
  },
});

// The panel's box gives its content its own width; the tab keeps its own, as its width too:
// folded, the box takes the width of what it holds, and WebKit counts a flex item's width there,
// not its flex basis.
globalStyle(`${Panel} > :first-child > ${Tab}`, {
  flex: `0 0 ${STRIP_WIDTH}px`,
  width: STRIP_WIDTH,
});
// Folded, the box holds only the tab; the content stays mounted, out of sight.
globalStyle(`${Panel}[data-folded] > :first-child > :not(${Tab})`, { display: 'none' });

export const TabLabel = style({
  writingMode: 'vertical-rl',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

// Compact rounded control pill at the end of a side panel's header: panel-specific actions, then
// frame controls (Fill, Fold) and Close.
export const ControlPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(2),
  flexShrink: 0,
  padding: toRem(2),
  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const ControlExtras = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(2),
  selectors: {
    '&:empty': { display: 'none' },
  },
});

export const ControlSeparator = style({
  inlineSize: config.borderWidth.B300,
  blockSize: toRem(16),
  marginInline: toRem(2),
  flexShrink: 0,
  backgroundColor: color.SurfaceVariant.ContainerLine,
  selectors: {
    [`${ControlExtras}:empty + &`]: { display: 'none' },
    '&:last-child': { display: 'none' },
  },
});
