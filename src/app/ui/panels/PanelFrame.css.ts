import { globalStyle, style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { Panel } from './ResizablePanel.css';

/** The width of the frame's strip at a panel's start edge, which the panel's content gives up. */
export const STRIP_WIDTH = 40;

// A column at the start of the panel's box, before its content: the frame's controls beside the
// conversation or across the room, or, folded, the tab that is all of the panel that shows.
export const Strip = style({
  display: 'flex',
  flexFlow: 'column',
  alignItems: 'center',
  gap: config.space.S100,
  paddingBlock: config.space.S200,
  overflow: 'hidden',
  backgroundColor: color.Background.Container,
  color: color.Background.OnContainer,
});
// The panel's box gives its content its own width; the strip keeps its own.
globalStyle(`${Panel} > :first-child > ${Strip}`, { flex: `0 0 ${STRIP_WIDTH}px` });
// Folded, the box holds only the tab; the content stays mounted, out of sight.
globalStyle(`${Panel}[data-folded] > :first-child > :not(${Strip})`, { display: 'none' });

export const Tab = style([
  Strip,
  {
    height: '100%',
    border: 'none',
    borderInlineStart: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
    font: 'inherit',
    cursor: 'pointer',
    selectors: {
      '&:hover': { backgroundColor: color.Background.ContainerHover },
      '&:focus-visible': {
        outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
        outlineOffset: `calc(-1 * ${config.borderWidth.B600})`,
      },
    },
  },
]);

export const TabLabel = style({
  writingMode: 'vertical-rl',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});
