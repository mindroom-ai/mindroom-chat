import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';

/** One pinned message: its sender row above its content; a click on it opens the message. */
export const PinnedEntry = style([
  DefaultReset,
  {
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S100,
    minInlineSize: 0,
    paddingBlock: config.space.S200,
    paddingInline: config.space.S200,
    borderRadius: config.radii.R300,
    overflowWrap: 'anywhere',
    cursor: 'pointer',
    '@media': {
      '(hover: hover)': {
        selectors: { '&:hover': { backgroundColor: color.Surface.ContainerHover } },
      },
    },
  },
]);

/** The sender's avatar and name and the send time, as the button that opens the message. */
export const PinnedJump = style({
  // A plain row: no button chrome, the menu's text color and font.
  all: 'unset',
  cursor: 'pointer',
  // Avatar, name and time side by side; the row takes the width the Unpin button leaves.
  display: 'flex',
  alignItems: 'center',
  paddingInline: config.space.S100,
  gap: config.space.S200,
  flexGrow: 1,
  minInlineSize: 0,
  boxSizing: 'border-box',
  borderRadius: config.radii.R300,
  paddingBlock: config.space.S100,
  selectors: {
    // The keyboard ring, drawn inside so the scroll area does not clip it.
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: `calc(-1 * ${config.borderWidth.B600})`,
    },
  },
});
